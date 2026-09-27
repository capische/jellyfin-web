#!/usr/bin/env python3
"""P6 M9 safeguards on the live instance (runs on the test host from <state root>/standins/bin). Each case makes the given
targets due (searchNow), applies one safeguard, queues a manual automation run (POST /Automation/Run, which obeys every
budget), waits for it, prints the run and its decisions and the queue's paused reasons, then restores what it changed.
Exits non-zero when a check fails.

  live-safeguards.py breaker ENTRY...        stand-in feed C answers 500: its breaker opens, other feeds keep answering
  live-safeguards.py floor ENTRY...          free-space floor above the mount's free space: nothing is grabbed
  live-safeguards.py client ENTRY...         the relay to the client is stopped (live-env.sh relay-stop first): no grab
  live-safeguards.py off ENTRY...            automation switched off while the run is in progress: it halts
"""
import importlib.util, json, os, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("a8", os.path.join(HERE, "live-a8.py"))
a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)
call = a8.call
FAILURES = []


def check(name, ok, detail=None):
    a8.check(name, ok, detail)
    if not ok:
        FAILURES.append(name)


def fault(service, mode):
    urllib.request.urlopen(f"http://127.0.0.1:48119/fault?service={service}&mode={mode}", timeout=10).read()


def status():
    return call("GET", "/JellyfinMod/Automation/Status")[1]


def settings():
    return call("GET", "/JellyfinMod/Settings/Automation")[1]


def patch_settings(changes):
    current = settings()
    body = {k: current[k] for k in current}
    body.update(changes)
    status_code, answer = call("PATCH", "/JellyfinMod/Settings/Automation", body)
    if status_code != 200:
        raise SystemExit(f"automation settings not saved: {status_code} {answer}")
    return {k: current[k] for k in changes}


def make_due(entries):
    for entry in entries:
        if ":" in entry:
            series, episode = entry.split(":")
            call("PATCH", f"/JellyfinMod/Entries/{series}/Episodes/{episode}", {"searchNow": True})
        else:
            call("PATCH", f"/JellyfinMod/Entries/{entry}", {"searchNow": True})


def run(during=None):
    before = status()["lastRun"]["id"]
    code, body = call("POST", "/JellyfinMod/Automation/Run")
    if code != 202:
        raise SystemExit(f"run not queued: {code} {body}")
    deadline = time.time() + 900
    acted = False
    while time.time() < deadline:
        current = status()
        if during and not acted and current["running"]:
            time.sleep(3)
            during()
            acted = True
        if current["lastRun"]["id"] != before and not current["running"]:
            return current
        time.sleep(2)
    raise SystemExit("the run did not finish in 15 minutes")


def decisions(run_id):
    items = call("GET", "/JellyfinMod/Automation/Decisions?limit=100")[1]["items"]
    return [d for d in items if d.get("runId") == run_id]


def queue_paused():
    return call("GET", "/JellyfinMod/Queue")[1].get("automation")


def show(label, current, found):
    last = current["lastRun"]
    print(label, {k: last[k] for k in ("status", "targetsConsidered", "searched", "grabbed", "detail")})
    for d in found:
        print("  ", d["kind"], d["reason"], d["title"], (d.get("episodeId") or "")[:8], (d.get("detail") or "")[:90])


def main(case, entries):
    make_due(entries)
    if case == "breaker":
        fault("torznab3", "500")
        try:
            current = run()
        finally:
            fault("torznab3", "ok")
        found = decisions(current["lastRun"]["id"])
        show("breaker", current, found)
        feed_c = next(i for i in current["indexers"] if i["name"] == "Boundary feed C")
        check("breaker: feed C's breaker is open after its failures", bool(feed_c["breakerOpenUntil"]), feed_c)
        check("breaker: a breaker_opened decision is recorded", any(d["kind"] == "breaker_opened" for d in found), [d["kind"] for d in found])
        check("breaker: other feeds kept answering", any(v > 0 for k, v in current["lastRun"]["queriesByIndexer"].items()
                                                        if k.replace("-", "") != feed_c["id"]), current["lastRun"]["queriesByIndexer"])
    elif case == "floor":
        free = status()["budgets"]["freeBytes"]
        previous = patch_settings({"freeSpaceFloorBytes": free + 50_000_000_000})
        try:
            paused = status()["pausedReasons"]
            banner = queue_paused()
            current = run()
        finally:
            patch_settings(previous)
        found = decisions(current["lastRun"]["id"])
        show("floor", current, found)
        check("floor: the status and the queue report free_space_floor before the run", "free_space_floor" in paused and
              "free_space_floor" in (banner or {}).get("pausedReasons", []), [paused, banner])
        check("floor: nothing is grabbed and the decision says free_space_floor",
              current["lastRun"]["grabbed"] == 0 and any(d["reason"] == "free_space_floor" for d in found), [d["reason"] for d in found])
    elif case == "client":
        paused = status()["pausedReasons"]
        current = run()
        found = decisions(current["lastRun"]["id"])
        show("client", current, found)
        check("client: nothing is grabbed and the decision says client_unreachable",
              current["lastRun"]["grabbed"] == 0 and any(d["reason"] == "client_unreachable" for d in found) or
              current["lastRun"]["status"] != "completed", [current["lastRun"]["status"], [d["reason"] for d in found], paused])
    elif case == "off":
        switched = {}
        def switch_off():
            switched.update(patch_settings({"automationEnabled": False}))
            switched["banner"] = queue_paused()
        try:
            current = run(during=switch_off)
        finally:
            patch_settings({"automationEnabled": True})
        found = decisions(current["lastRun"]["id"])
        show("off", current, found)
        considered, searched = current["lastRun"]["targetsConsidered"], current["lastRun"]["searched"]
        check("off: switched off mid-run, the run halts before searching every due target", bool(switched) and searched < considered,
              [considered, searched, current["lastRun"]["status"], current["lastRun"]["detail"]])
        check("off: while off, the queue reports automation disabled", "disabled" in (switched.get("banner") or {}).get("pausedReasons", []),
              switched.get("banner"))
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed")
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
