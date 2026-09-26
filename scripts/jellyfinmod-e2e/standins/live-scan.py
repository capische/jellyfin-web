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
  live-scan.py cancel-later SERIES EP_A EP_B                     B (a sibling in A's season folder) reports its change
                                                                 30-60 s after A and is cancelled at once: A still waits for
                                                                 the host refresh B restarted, so no full scan (review P2-f)
  live-scan.py unrelated-stream SERIES_X EP_A SERIES_Y EP...     imports into another series every 40 s while A scans: A binds
                                                                 on its own refresh, no full scan (review P2-g)
  live-scan.py related-stream SERIES EP_A EP...                  sibling imports every 40 s keep the host's refresher from
                                                                 firing: A escalates no later than three waits after its
                                                                 request and still binds (review P2-g bound)
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

    elif case == "cancel-later":
        series, first, second = args
        g1 = grab_one(series, first)
        wait_state(g1, {"scanning"})
        t0 = time.time()
        time.sleep(25)
        g2 = grab_one(series, second)
        row = wait_state(g2, {"scanning", "completed"})
        offset = round(time.time() - t0)
        status, body = call("DELETE", f"/JellyfinMod/Queue/{row['id']}", {"removeFromClient": False, "blocklist": False})
        print("B reported its change about", offset, "s after A and was cancelled:", status, (body or {}).get("state"))
        check("cancel-later: B was cancelled while its report was pending (30-60 s after A)", status == 200 and 25 <= offset <= 75, [status, offset])
        done = wait_state(g1, {"completed", "blocked"})
        check("cancel-later: A completes", done is None or done["importState"] == "completed", done and done["importState"])
        verify("cancel-later", since, [(series, first)])
    elif case in ("unrelated-stream", "related-stream"):
        if case == "unrelated-stream":
            series, first, other, stream = args[0], args[1], args[2], args[3:]
        else:
            series, first, stream = args[0], args[1], args[2:]
            other = series
        g1 = grab_one(series, first)
        wait_state(g1, {"scanning", "completed"})
        t0 = time.time()
        grabs = []
        for episode in stream:
            if import_for(g1) is None or import_for(g1)["importState"] != "scanning":
                break
            grabs.append(grab_one(other, episode))
            time.sleep(40)
        done = wait_state(g1, {"completed", "blocked"})
        waited = round(time.time() - t0)
        print(case, "A bound", waited, "s after it started scanning;", len(grabs), "stream imports started")
        check(f"{case}: A completes", done is None or done["importState"] == "completed", done and done["importState"])
        for g in grabs:
            later = wait_state(g, {"completed", "blocked"})
            check(f"{case}: stream import {g[:8]} completes", later is None or later["importState"] == "completed", later and later["importState"])
        events = history(series, first)
        check(f"{case}: exactly one imported event for A and no media_missing", events.count("imported") == 1 and not any("missing" in e for e in events), events[:6])
        scans = full_scans(since)
        if case == "unrelated-stream":
            check("unrelated-stream: no full library scan ran (unrelated imports never postponed A)", not scans, scans)
            check("unrelated-stream: A bound within one host delay plus margin of starting to scan", waited <= 150, waited)
        else:
            check("related-stream: the deferral is bounded: A bound within three waits of its request plus a scan", waited <= 3 * 90 + 120, [waited, scans[:2]])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
