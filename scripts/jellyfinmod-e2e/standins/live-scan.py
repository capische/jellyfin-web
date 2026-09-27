#!/usr/bin/env python3
"""P5 I5 live E2E for the scan wait (review P2-a/b, P2-f/g), on the live instance's real Jellyfin 12 and real Transmission.
Runs on the test host from <state root>/standins/bin. Each case grabs legal fixtures through the real API, lets the real
client download them from the web seed, follows each import operation by id (GET /Imports/{id}), and asserts:
  - no full library scan ("Validating media library" in the host log, read in one checked call) since the case began;
  - every import reaches `completed`, is bound to a native item, and that item is the target's `jellyfinItemId`;
  - exactly one `imported` history event for the target in this run, and no `media_missing` event.
Exits non-zero when any check fails, after restoring any setting it changed.

  live-scan.py ordinary ENTRY
  live-scan.py overlapping SERIES EP_A EP_B
      B links while A is still scanning, both in one season folder
  live-scan.py delay ENTRY SECONDS
      with the host's LibraryMonitorDelay set to SECONDS
  live-scan.py restart ENTRY
      container restarted while the import is scanning
  live-scan.py cancel ENTRY
      queue Remove while scanning: cancelled, no full scan
  live-scan.py cancel-later SERIES EP_A EP_B
      B (a sibling of A in one season folder) reports its change 35-60 s after A and is cancelled while A still scans:
      A waits for the refresh B's report restarted, with no full scan
  live-scan.py series-siblings SERIES_X EP_X SERIES_Y EP_Y
      two new series (sibling folders under the library root), B reporting 35-60 s after A: the host folds them into one
      refresh, and A waits for it with no full scan (review P2-n)
  live-scan.py related-stream SERIES EP_A EP...
      sibling imports in A's season folder every 30 s keep the host's refresh from running: A escalates to a library
      scan at the cap, three waits after its request, and not before
Any other case name exits 2 without running; a run in which no check ran fails.
cancel-later, series-siblings and related-stream run with the host's LibraryMonitorDelay at 60 s and the import poll at
2 s (both restored after). cancel-later and series-siblings require the plugin's own debug line for A, "Import <id>
defers its library scan N s after its request", with N at or past A's first wait (90 s): A's evaluation found it unbound
there and held the scan back, where escalating from A's own request would have run a full library scan.
That unrelated reports never postpone the escalation needs A to stay unbound past its first wait while they continue,
which the host's working refresh prevents live; PhaseFiveIntegration proves it with the host's scan held back.
"""
import datetime, importlib.util, json, os, re, subprocess, sys, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("a8", os.path.join(HERE, "live-a8.py"))
a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)
call, search, grab = a8.call, a8.search, a8.grab
CONTAINER = "jellyfinmod-live"
FAILURES = []
CHECKS = []
CASES = ("ordinary", "overlapping", "delay", "restart", "cancel", "cancel-later", "series-siblings", "related-stream")


class CaseFailure(Exception):
    pass



def check(name, ok, detail=None):
    a8.check(name, ok, detail)
    CHECKS.append(name)
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


def set_import_poll(seconds):
    status, current = call("GET", "/JellyfinMod/Settings/Import")
    if status != 200:
        raise CaseFailure(f"could not read the import settings ({status})")
    previous = current["importPollSeconds"]
    status, _ = call("PATCH", "/JellyfinMod/Settings/Import", dict(current, importPollSeconds=seconds))
    if status >= 300:
        raise CaseFailure(f"could not set importPollSeconds ({status})")
    return previous


def read_monitor_delay():
    return call("GET", "/System/Configuration")[1]["LibraryMonitorDelay"]


def read_import_poll():
    return call("GET", "/JellyfinMod/Settings/Import")[1]["importPollSeconds"]


class Timing:
    """Sets the host's LibraryMonitorDelay and the plugin's import poll for one case, and restores both afterwards. Both
    originals are read before either is changed, and every setting whose write was attempted is restored, even when the
    write itself raised (it may have applied before its response was lost). A failure part-way through the setup restores
    before the error propagates; each restoration is attempted on its own."""

    SETTINGS = (("LibraryMonitorDelay", read_monitor_delay, set_monitor_delay),
                ("importPollSeconds", read_import_poll, set_import_poll))

    def __init__(self, delay, poll):
        self.wanted = {"LibraryMonitorDelay": delay, "importPollSeconds": poll}
        self.original, self.attempted = {}, set()

    def __enter__(self):
        for label, read, _ in self.SETTINGS:
            self.original[label] = read()
        try:
            for label, _, write in self.SETTINGS:
                self.attempted.add(label)
                write(self.wanted[label])
            applied = {label: read() for label, read, _ in self.SETTINGS}
            if applied != self.wanted:
                raise CaseFailure(f"timing settings did not apply: {applied}")
            time.sleep(16)  # the monitor reads the new poll after its current wait (at most the old 15 s)
        except BaseException:
            self.restore()
            raise
        return self

    def __exit__(self, *_):
        self.restore()
        return False

    def restore(self):
        for label, read, write in self.SETTINGS:
            if label not in self.attempted:
                continue
            previous = self.original[label]
            try:
                write(previous)
                current = read()
                check(f"timing setting {label} restored to {previous}", current == previous, current)
            except Exception as error:  # noqa: BLE001 - reported as a failed check, the other restoration still runs
                check(f"timing setting {label} restored to {previous}", False, str(error)[:200])
        self.attempted.clear()


def host_log(since):
    """The host log since `since`, with docker's own UTC timestamps, in one checked call."""
    result = subprocess.run(["docker", "logs", "--timestamps", "--since", since, CONTAINER], capture_output=True, text=True)
    if result.returncode != 0:
        raise CaseFailure(f"the host log could not be read (docker exit {result.returncode})")
    return (result.stdout + result.stderr).splitlines()


def require_deferral(label, since, import_id, done, wait):
    """The discriminating premise, from the plugin's own decision for A: its debug line "Import <id> defers its library
    scan N s after its request" is written only when A's own evaluation found A unbound (the binding is looked for first),
    N s after A's request, and held the escalation back because of a related request. With N at or past A's first wait,
    escalating from A's own request would have run a full library scan at that evaluation."""
    wanted = str(uuid.UUID(import_id))
    pattern = re.compile(r"Import " + re.escape(wanted) + r" defers its library scan (\d+) s after its request")
    lines = host_log(since)
    deferrals = [int(match.group(1)) for match in (pattern.search(line) for line in lines) if match]
    if not any("ImportMonitor: Import tick " in line for line in lines):
        raise CaseFailure("the host log has no import monitor debug lines (JellyfinMod debug logging is off)")
    check(f"{label}: A's own evaluation, past its first wait ({wait} s) and unbound, deferred the library scan",
          any(seconds >= wait for seconds in deferrals), deferrals[:6])
    check(f"{label}: A never escalated (one scan request)", done["scanAttempts"] == 1, done["scanAttempts"])


def parse_time(value):
    """The host's ISO 8601 UTC timestamps, with up to seven fractional digits and an optional Z."""
    text = value.rstrip("Z")
    if "." in text:
        head, fraction = text.split(".", 1)
        text = head + "." + fraction[:6]
    return datetime.datetime.fromisoformat(text).replace(tzinfo=datetime.timezone.utc)


def seconds_between(later, earlier):
    return (parse_time(later) - parse_time(earlier)).total_seconds()


def cancel_later(series, first, second, since):
    a = grab_one(series, first)
    op_a = wait_state(a, {"scanning"})
    time.sleep(30)
    b = grab_one(series, second)
    op_b = wait_state(b, {"scanning"})
    offset = seconds_between(op_b["scanRequestedAt"], op_a["scanRequestedAt"])
    before = operation(a)
    status, body = call("DELETE", f"/JellyfinMod/Queue/{b}", {"removeFromClient": False, "blocklist": False})
    persisted, after = operation(b), operation(a)
    print("B requested its scan", round(offset), "s after A and was cancelled:", status, (body or {}).get("state"), persisted["state"])
    check("cancel-later: B requested its scan 35-60 s after A (inside A's host delay, and late enough that escalating 90 s after A would beat the refresh B restarted)", 35 <= offset <= 60, round(offset))
    check("cancel-later: A and B share one season folder",
          os.path.dirname(op_a["admin"]["destinationPath"]) == os.path.dirname(op_b["admin"]["destinationPath"]))
    check("cancel-later: A was still scanning (unbound) before and after B's cancellation",
          before["state"] == "scanning" and after["state"] == "scanning" and not after.get("nativeItemId"),
          [before["state"], after["state"]])
    check("cancel-later: Remove answered 200 with B cancelled, and GET /Imports/{id} still reads cancelled",
          status == 200 and (body or {}).get("state") == "cancelled" and persisted["state"] == "cancelled",
          [status, (body or {}).get("state"), persisted["state"]])
    done = wait_state(a, {"completed"})
    require_deferral("cancel-later", since, a, done, 90)
    after_b = seconds_between(done["completedAt"], op_b["scanRequestedAt"])
    # Premise: the host bound A only through the refresh B's report restarted (A's own would have run by B + 45 s).
    check("cancel-later: A bound at least 55 s after B's request (B's report restarted A's refresh)", after_b >= 55, round(after_b))
    verify_import("cancel-later", since, a, series, first)
    no_full_scan("cancel-later", since)


def series_siblings(series_x, episode_x, series_y, episode_y, since):
    tv = [folder for folder in call("GET", "/Library/VirtualFolders")[1] if folder.get("CollectionType") == "tvshows"]
    if not tv or not all(folder["LibraryOptions"].get("EnableRealtimeMonitor") for folder in tv):
        raise CaseFailure("the TV library does not monitor changes in real time, so the case would not discriminate")
    if target_item(series_x, None) or target_item(series_y, None):
        raise CaseFailure("both series must be new (not yet bound to a native series)")
    a = grab_one(series_x, episode_x)
    op_a = wait_state(a, {"scanning"})
    time.sleep(30)
    b = grab_one(series_y, episode_y)
    op_b = wait_state(b, {"scanning", "completed"})
    offset = seconds_between(op_b["scanRequestedAt"], op_a["scanRequestedAt"])
    series_folders = [os.path.dirname(os.path.dirname(op["admin"]["destinationPath"])) for op in (op_a, op_b)]
    print("B requested its scan", round(offset), "s after A; series folders", [f.rsplit("/", 1)[-1] for f in series_folders])
    check("series-siblings: B requested its scan 35-60 s after A (inside A's host delay, and late enough that escalating 90 s after A would beat the refresh B restarted)", 35 <= offset <= 60, round(offset))
    check("series-siblings: A and B created two sibling series folders under one library root",
          series_folders[0] != series_folders[1] and os.path.dirname(series_folders[0]) == os.path.dirname(series_folders[1]))
    done = wait_state(a, {"completed"})
    require_deferral("series-siblings", since, a, done, 90)
    after_b = seconds_between(done["completedAt"], op_b["scanRequestedAt"])
    check("series-siblings: A bound at least 55 s after B's request (the host folded both into one refresh)", after_b >= 55, round(after_b))
    wait_state(b, {"completed"})
    verify_import("series-siblings", since, a, series_x, episode_x)
    verify_import("series-siblings", since, b, series_y, episode_y)
    no_full_scan("series-siblings", since)


def related_stream(series, first, stream, since):
    delay = call("GET", "/System/Configuration")[1]["LibraryMonitorDelay"]
    wait = max(60, delay + 30)
    cap = 3 * wait
    a = grab_one(series, first)
    op_a = wait_state(a, {"scanning"})
    folder = os.path.dirname(op_a["admin"]["destinationPath"])
    started, escalated, next_grab = [], None, time.time()
    deadline = time.time() + cap + 120
    while time.time() < deadline:
        op = operation(a)
        if op["scanAttempts"] >= 2:
            escalated = op
            break
        if op["state"] != "scanning":
            raise CaseFailure(f"A left scanning ({op['state']}) before any escalation: the host's refresh ran, so the stream was too sparse")
        if time.time() >= next_grab:
            if not stream:
                raise CaseFailure("the stream ran out before A escalated")
            next_grab = time.time() + 30
            episode = stream.pop(0)
            started.append((grab_one(series, episode), episode))
        time.sleep(2)
    if escalated is None:
        raise CaseFailure(f"A did not escalate within the cap ({cap} s) plus 120 s")
    # Read the stream's first scan requests now, before any of them escalates in turn. Imports still downloading or linking
    # (no scan request yet, maybe no destination) are pending; the others supplied a report.
    stream_ops = [(b, episode, operation(b)) for b, episode in started]
    requested_a, escalated_at = op_a["scanRequestedAt"], escalated["scanRequestedAt"]
    reporting = [(b, episode, op) for b, episode, op in stream_ops
                 if op.get("scanRequestedAt") and seconds_between(escalated_at, op["scanRequestedAt"]) > 0]
    pending = [(b, episode, op) for b, episode, op in stream_ops if not op.get("scanRequestedAt")]
    reports = sorted([requested_a] + [op["scanRequestedAt"] for _, _, op in reporting], key=parse_time)
    gaps = [round(seconds_between(later, earlier)) for earlier, later in zip(reports, reports[1:])]
    quiet = round(seconds_between(escalated_at, reports[-1]))
    elapsed = round(seconds_between(escalated_at, requested_a))
    print("related-stream: escalated", elapsed, "s after A's request (cap", cap, "); report gaps", gaps, "; last report", quiet, "s before",
          ";", len(reporting), "stream imports reported,", len(pending), "pending")
    check("related-stream: A was still unbound when it escalated", escalated["state"] == "scanning" and not escalated.get("nativeItemId"))
    check("related-stream: every stream import that reported linked into A's season folder",
          all(os.path.dirname(op["admin"].get("destinationPath") or "") == folder for _, _, op in reporting),
          [(op["admin"].get("destinationPath") or "(none)").rsplit("/", 2)[-2:] for _, _, op in reporting])
    check(f"related-stream: related reports every < {delay} s up to the escalation (the host's refresh never ran)",
          len(reports) >= 3 and all(gap < delay for gap in gaps), [len(reports), gaps])
    check(f"related-stream: the last related report was < {wait} s before the escalation (the deferral was still live)", quiet < wait, quiet)
    check(f"related-stream: A escalated at the cap ({cap} s after its request) and not before", cap - 2 <= elapsed <= cap + 10, elapsed)
    wait_state(a, {"completed"}, timeout=1200)
    verify_import("related-stream", since, a, series, first)
    for b, episode in started:
        wait_state(b, {"completed"}, timeout=1200)
        verify_import("related-stream", since, b, series, episode)
    check("related-stream: the escalation ran a library scan", bool(full_scans(since)))


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
        with Timing(60, 2):
            cancel_later(*args, since)
    elif case == "series-siblings":
        with Timing(60, 2):
            series_siblings(*args, since)
    elif case == "related-stream":
        with Timing(60, 2):
            related_stream(args[0], args[1], list(args[2:]), since)
    else:
        raise CaseFailure(f"unknown case {case!r}")

def main(case, args):
    if case not in CASES:
        print(f"unknown case {case!r}; one of: {', '.join(CASES)}")
        sys.exit(2)
    since = now_iso()
    try:
        run_case(case, args, since)
    except CaseFailure as failure:
        check(f"{case}: {failure}", False)
    if FAILURES or not CHECKS:
        print(f"{len(FAILURES)} check(s) failed" if FAILURES else "no check ran")
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "", sys.argv[2:])
