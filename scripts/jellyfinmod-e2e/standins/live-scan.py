#!/usr/bin/env python3
"""P5 I5 live E2E for the scan wait (review P2-a/b, P2-f/g), on the live instance's real Jellyfin 12 and real Transmission.
Runs on the test host from <state root>/standins/bin. Each case grabs legal fixtures through the real API, lets the real
client download them from the web seed, follows each import operation by id (GET /Imports/{id}), and asserts:
  - no full library scan ("Validating media library" in the host log, read in one checked call) since the case began;
  - every import reaches `completed`, is bound to a native item, and that item is the target's `jellyfinItemId`;
  - exactly one `imported` history event for the target in this run, and no `media_missing` event.
Exits non-zero when any check fails, after restoring any setting it changed.

  live-scan.py ordinary ENTRY
  live-scan.py overlapping SERIES EP_A EP_B                  B links while A is still scanning, both in one season folder
  live-scan.py delay ENTRY SECONDS                           with the host's LibraryMonitorDelay set to SECONDS
  live-scan.py restart ENTRY                                 container restarted while the import is scanning
  live-scan.py cancel ENTRY                                  queue Remove while scanning: cancelled, no full scan
  live-scan.py cancel-later SERIES EP_A EP_B                 B (a sibling of A) reports its change 30-60 s after A and is
                                                             cancelled at once: A still waits for the refresh B restarted
  live-scan.py unrelated-stream SERIES_X EP_A SERIES_Y EP... imports into another series every 40 s while A scans
  live-scan.py related-stream SERIES EP_A EP...              sibling imports every 40 s: A escalates no later than the cap
"""
import datetime, importlib.util, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("a8", os.path.join(HERE, "live-a8.py"))
a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)
call, search, grab = a8.call, a8.search, a8.grab
CONTAINER = "jellyfinmod-live"
FAILURES = []


class CaseFailure(Exception):
    pass


def check(name, ok, detail=None):
    a8.check(name, ok, detail)
    if not ok:
        FAILURES.append(name)


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def full_scans(since):
    result = subprocess.run(["docker", "logs", "--since", since, CONTAINER], capture_output=True, text=True)
    if result.returncode != 0:
        raise CaseFailure(f"the host log could not be read (docker exit {result.returncode})")
    return [line[:90] for line in (result.stdout + result.stderr).splitlines() if "Validating media library" in line]


def grab_one(entry, episode=None):
    status, found = search(entry, episode)
    rows = [c for c in found["candidates"] if c["eligible"]]
    if not rows:
        raise CaseFailure(f"no eligible release for {entry} {episode}")
    s, body = grab(found["searchId"], rows[0]["releaseId"])
    final = a8.wait_final(body["id"]) if s == 202 else body
    if (final or {}).get("state") != "accepted":
        raise CaseFailure(f"grab not accepted: {s} {final}")
    # The import operation appears once the monitor sees the accepted grab.
    deadline = time.time() + 120
    while time.time() < deadline:
        for row in call("GET", "/JellyfinMod/Queue")[1]["items"]:
            if row["grabId"] == final["id"]:
                return row["id"]
        time.sleep(3)
    raise CaseFailure(f"no import operation appeared for grab {final['id']}")


def operation(import_id):
    status, body = call("GET", f"/JellyfinMod/Imports/{import_id}")
    if status != 200:
        raise CaseFailure(f"import {import_id} disappeared (GET /Imports answered {status})")
    return body


def wait_state(import_id, states, timeout=900):
    """Waits until the operation is in one of `states`; a terminal state that is not wanted is a failure."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        op = operation(import_id)
        if op["state"] in states:
            return op
        if op["state"] in ("completed", "blocked", "failed", "cancelled"):
            raise CaseFailure(f"import {import_id[:8]} ended {op['state']}/{op.get('reason')} while waiting for {sorted(states)}")
        time.sleep(3)
    raise CaseFailure(f"import {import_id[:8]} did not reach {sorted(states)} in {timeout} s")


def target_item(entry, episode):
    detail = call("GET", f"/JellyfinMod/Entries/{entry}")[1]
    if episode is None:
        return detail["entry"].get("jellyfinItemId")
    return next((e.get("jellyfinItemId") for e in detail["episodes"] if e["id"] == episode), None)


def verify_import(label, since, import_id, entry, episode=None):
    op = operation(import_id)
    check(f"{label}: import {import_id[:8]} completed", op["state"] == "completed", [op["state"], op.get("reason")])
    item = target_item(entry, episode)
    check(f"{label}: the target is bound to the imported native item", bool(op.get("nativeItemId")) and op.get("nativeItemId") == item,
          [op.get("nativeItemId"), item])
    events = [e for e in call("GET", f"/JellyfinMod/Entries/{entry}")[1]["history"]
              if parse_time(e["createdAt"]) >= parse_time(since) and (episode is None or e.get("episodeId") in (None, episode))]
    kinds = [e["eventType"] for e in events]
    imported = [e for e in events if e["eventType"] == "imported" and (episode is None or e.get("episodeId") == episode)]
    check(f"{label}: exactly one imported event in this run and no media_missing ({(episode or entry)[:8]})",
          len(imported) == 1 and not any("missing" in k for k in kinds), kinds[:8])
    return op


def no_full_scan(label, since):
    scans = full_scans(since)
    check(f"{label}: no full library scan ran", not scans, scans)


def set_monitor_delay(seconds):
    configuration = call("GET", "/System/Configuration")[1]
    previous = configuration["LibraryMonitorDelay"]
    configuration["LibraryMonitorDelay"] = seconds
    status, _ = call("POST", "/System/Configuration", configuration)
    if status >= 300:
        raise CaseFailure(f"could not set LibraryMonitorDelay ({status})")
    return previous


def parse_time(value):
    """The host's ISO 8601 UTC timestamps, with up to seven fractional digits and an optional Z."""
    text = value.rstrip("Z")
    if "." in text:
        head, fraction = text.split(".", 1)
        text = head + "." + fraction[:6]
    return datetime.datetime.fromisoformat(text).replace(tzinfo=datetime.timezone.utc)


def seconds_between(later, earlier):
    return (parse_time(later) - parse_time(earlier)).total_seconds()


def run_case(case, args, since):
    if case == "ordinary":
        a = grab_one(args[0])
        wait_state(a, {"completed"})
        verify_import("ordinary", since, a, args[0])
        no_full_scan("ordinary", since)
    elif case == "overlapping":
        series, first, second = args
        a = grab_one(series, first)
        wait_state(a, {"scanning"})
        b = grab_one(series, second)
        op_b = wait_state(b, {"linked", "scanning", "completed"})
        op_a = operation(a)
        # Overlap: B's link happened while A was still scanning (A not completed yet, or completed after B linked).
        overlapped = op_a["state"] == "scanning" or (op_a.get("completedAt") and op_b.get("linkedAt")
                                                      and seconds_between(op_a["completedAt"], op_b["linkedAt"]) > 0)
        check("overlapping: B linked while A was still scanning", bool(overlapped), [op_a["state"], op_a.get("completedAt"), op_b.get("linkedAt")])
        wait_state(a, {"completed"})
        wait_state(b, {"completed"})
        paths = [os.path.dirname(operation(x)["admin"]["destinationPath"]) for x in (a, b)]
        check("overlapping: both episodes share one season folder", paths[0] == paths[1], [p.rsplit("/", 2)[-2:] for p in paths])
        verify_import("overlapping", since, a, series, first)
        verify_import("overlapping", since, b, series, second)
        no_full_scan("overlapping", since)
    elif case == "delay":
        entry, seconds = args[0], int(args[1])
        previous = set_monitor_delay(seconds)
        try:
            a = grab_one(entry)
            op = wait_state(a, {"scanning"})
            done = wait_state(a, {"completed"}, timeout=seconds * 4 + 300)
            print("bound", round(seconds_between(done["completedAt"], op["scanRequestedAt"])), "s after the scan request, monitor delay", seconds)
            verify_import(f"delay {seconds}s", since, a, entry)
            no_full_scan(f"delay {seconds}s", since)
        finally:
            set_monitor_delay(previous)
    elif case == "restart":
        a = grab_one(args[0])
        wait_state(a, {"scanning"})
        subprocess.run(["docker", "restart", "-t", "20", CONTAINER], check=True, capture_output=True)
        for _ in range(60):
            if subprocess.run(["curl", "-s", "http://127.0.0.1:48096/health"], capture_output=True, text=True).stdout == "Healthy":
                break
            time.sleep(3)
        subprocess.run([sys.executable, os.path.join(HERE, "live-jf.py"), "login"], check=True, capture_output=True)
        wait_state(a, {"completed"})
        verify_import("restart in scanning", since, a, args[0])
        no_full_scan("restart in scanning", since)
    elif case == "cancel":
        a = grab_one(args[0])
        wait_state(a, {"scanning"})
        status, body = call("DELETE", f"/JellyfinMod/Queue/{a}", {"removeFromClient": False, "blocklist": False})
        check("cancel in scanning: Remove answers 200 and the operation is cancelled", status == 200 and (body or {}).get("state") == "cancelled",
              [status, (body or {}).get("state")])
        time.sleep(150)
        events = [e["eventType"] for e in call("GET", f"/JellyfinMod/Entries/{args[0]}")[1]["history"]
                  if parse_time(e["createdAt"]) >= parse_time(since)]
        check("cancel: no imported event is written for a cancelled import", "imported" not in events, events[:6])
        no_full_scan("cancel", since)
    elif case == "cancel-later":
        series, first, second = args
        a = grab_one(series, first)
        op_a = wait_state(a, {"scanning"})
        time.sleep(25)
        b = grab_one(series, second)
        op_b = wait_state(b, {"scanning"})
        offset = seconds_between(op_b["scanRequestedAt"], op_a["scanRequestedAt"])
        status, body = call("DELETE", f"/JellyfinMod/Queue/{b}", {"removeFromClient": False, "blocklist": False})
        print("B requested its scan", round(offset), "s after A and was cancelled:", status, (body or {}).get("state"))
        check("cancel-later: B requested 30-60 s after A (inside A's host delay) and was cancelled", status == 200 and 30 <= offset <= 60, [status, round(offset)])
        wait_state(a, {"completed"})
        verify_import("cancel-later", since, a, series, first)
        no_full_scan("cancel-later", since)
    elif case in ("unrelated-stream", "related-stream"):
        if case == "unrelated-stream":
            series, first, other, stream = args[0], args[1], args[2], args[3:]
        else:
            series, first, stream = args[0], args[1], args[2:]
            other = series
        a = grab_one(series, first)
        op_a = wait_state(a, {"scanning"})
        started = []
        for episode in stream:
            if operation(a)["state"] != "scanning":
                break
            started.append((grab_one(other, episode), episode))
            time.sleep(40)
        done = wait_state(a, {"completed"}, timeout=1200)
        waited = seconds_between(done["completedAt"], op_a["scanRequestedAt"])
        print(case, "A bound", round(waited), "s after its scan request;", len(started), "stream imports started")
        check(f"{case}: the stream overlapped A's scanning (at least one import started while A scanned)", len(started) >= 1, len(started))
        verify_import(case, since, a, series, first)
        for b, episode in started:
            wait_state(b, {"completed"}, timeout=1200)
            verify_import(case, since, b, other, episode)
        scans = full_scans(since)
        if case == "unrelated-stream":
            check("unrelated-stream: no full library scan ran (unrelated imports never postponed A)", not scans, scans)
            check("unrelated-stream: A bound within one host delay plus margin of its request", waited <= 150, round(waited))
        else:
            check("related-stream: the deferral is bounded (A bound within three waits plus a scan)", waited <= 3 * 90 + 120, [round(waited), scans[:2]])


def main(case, args):
    since = now_iso()
    try:
        run_case(case, args, since)
    except CaseFailure as failure:
        check(f"{case}: {failure}", False)
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed")
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
