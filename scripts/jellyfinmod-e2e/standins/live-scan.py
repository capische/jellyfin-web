#!/usr/bin/env python3
"""P5 I5 live E2E for the scan wait (review P2-a/P2-b), on the live instance's real Jellyfin 12 and real Transmission.
Runs on the test host from <state root>/standins/bin. Each case grabs legal fixtures through the real API, lets the real
client download them from the web seed, and then asserts, from the host's own log and the plugin's API:
  - no full library scan ("Validating media library") ran between the first link and the last completion;
  - every import completed and is bound; exactly one `imported` history event per target; no `media_missing`.

  live-scan.py ordinary ENTRY
  live-scan.py overlapping SERIES_ENTRY EPISODE_A EPISODE_B      two episodes into one season folder, 45 s apart
  live-scan.py delay ENTRY SECONDS                               with the host's LibraryMonitorDelay set to SECONDS
  live-scan.py restart ENTRY                                     container restarted while the import is scanning
  live-scan.py cancel ENTRY                                      queue Remove while scanning: cancelled, no full scan
"""
import datetime, importlib.util, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("a8", os.path.join(HERE, "live-a8.py"))
a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)
call, check, search, grab = a8.call, a8.check, a8.search, a8.grab
CONTAINER = "jellyfinmod-live"


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def full_scans(since):
    logs = subprocess.run(["docker", "logs", "--since", since, CONTAINER], capture_output=True, text=True).stdout
    logs += subprocess.run(["docker", "logs", "--since", since, CONTAINER], capture_output=True, text=True).stderr
    return [line[:90] for line in logs.splitlines() if "Validating media library" in line]


def grab_one(entry, episode=None):
    status, found = search(entry, episode)
    rows = [c for c in found["candidates"] if c["eligible"]]
    s, body = grab(found["searchId"], rows[0]["releaseId"])
    final = a8.wait_final(body["id"]) if s == 202 else body
    if (final or {}).get("state") != "accepted":
        raise SystemExit(f"grab not accepted: {s} {final}")
    return final["id"]


def import_for(grab_id):
    for row in call("GET", "/JellyfinMod/Queue")[1]["items"]:
        if row["grabId"] == grab_id:
            return row
    return None


def wait_state(grab_id, states, timeout=900):
    deadline = time.time() + timeout
    while time.time() < deadline:
        row = import_for(grab_id)
        if row and row["importState"] in states:
            return row
        if row is None:
            return None
        time.sleep(5)
    raise SystemExit(f"timed out waiting for {states}")


def history(entry, episode=None):
    events = call("GET", f"/JellyfinMod/Entries/{entry}")[1]["history"]
    return [e["eventType"] for e in events if episode is None or e.get("episodeId") in (None, episode)]


def verify(label, since, targets):
    for entry, episode in targets:
        events = history(entry, episode)
        check(f"{label}: exactly one imported event and no media_missing ({(episode or entry)[:8]})",
              events.count("imported") == 1 and not any("missing" in e for e in events), events[:6])
    scans = full_scans(since)
    check(f"{label}: no full library scan ran", not scans, scans)


def set_monitor_delay(seconds):
    configuration = call("GET", "/System/Configuration")[1]
    previous = configuration["LibraryMonitorDelay"]
    configuration["LibraryMonitorDelay"] = seconds
    call("POST", "/System/Configuration", configuration)
    return previous


def main(case, args):
    since = now_iso()
    if case == "ordinary":
        g = grab_one(args[0])
        row = wait_state(g, {"scanning", "completed"})
        start = time.time()
        done = wait_state(g, {"completed", "blocked"})
        print("bound after", round(time.time() - start), "s in scanning")
        check("ordinary: the import completes and is bound", done is None or done["importState"] == "completed", done and done["importState"])
        verify("ordinary", since, [(args[0], None)])
    elif case == "overlapping":
        series, first, second = args
        g1 = grab_one(series, first)
        wait_state(g1, {"scanning", "completed"})
        time.sleep(45)
        g2 = grab_one(series, second)
        for g in (g1, g2):
            done = wait_state(g, {"completed", "blocked"})
            check(f"overlapping: import {g[:8]} completes", done is None or done["importState"] == "completed", done and done["importState"])
        verify("overlapping", since, [(series, first), (series, second)])
    elif case == "delay":
        entry, seconds = args[0], int(args[1])
        previous = set_monitor_delay(seconds)
        try:
            g = grab_one(entry)
            wait_state(g, {"scanning", "completed"})
            start = time.time()
            done = wait_state(g, {"completed", "blocked"})
            print("bound after", round(time.time() - start), "s in scanning with a", seconds, "s monitor delay")
            check(f"delay {seconds}s: the import completes without escalating", done is None or done["importState"] == "completed", done and done["importState"])
            verify(f"delay {seconds}s", since, [(entry, None)])
        finally:
            set_monitor_delay(previous)
    elif case == "restart":
        g = grab_one(args[0])
        wait_state(g, {"scanning"})
        subprocess.run(["docker", "restart", "-t", "20", CONTAINER], check=True, capture_output=True)
        for _ in range(60):
            if subprocess.run(["curl", "-s", "http://127.0.0.1:48096/health"], capture_output=True, text=True).stdout == "Healthy":
                break
            time.sleep(3)
        subprocess.run([sys.executable, os.path.join(HERE, "live-jf.py"), "login"], check=True, capture_output=True)
        done = wait_state(g, {"completed", "blocked"})
        check("restart in scanning: the same import completes after the restart", done is None or done["importState"] == "completed", done and done["importState"])
        verify("restart", since, [(args[0], None)])
    elif case == "cancel":
        g = grab_one(args[0])
        row = wait_state(g, {"scanning"})
        status, body = call("DELETE", f"/JellyfinMod/Queue/{row['id']}", {"removeFromClient": False, "blocklist": False})
        check("cancel in scanning: Remove answers 200 and the operation is cancelled", status == 200 and body["state"] == "cancelled", [status, body.get("state")])
        time.sleep(150)
        events = history(args[0])
        check("cancel: no imported event is written for a cancelled import", "imported" not in events, events[:6])
        scans = full_scans(since)
        check("cancel: no full library scan ran", not scans, scans)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
