#!/usr/bin/env python3
"""Phase 9 live runner, simulated on this machine (web review 2026-10-07 round 5): the stopped-service helper and the ratings
key-ownership chain of p9-live.py, exercised through its real functions with no SSH and no test host.

- The host-side commands run here (JFMOD_P9_REMOTE=local) against a fake `docker` whose `stop` hands the stop to a
  "daemon" in a session of its own (it carries on when the client is killed, as Docker's does) and logs every stop and
  start, a fake `setsid` (macOS has none) and the real `sqlite3` on a scratch database.
- The ratings settings are served by a small local HTTP stand-in with the plugin's own revision rule (a save against an
  older revision is 409; every save raises the revision), backed by the same scratch database the runner reads.
- Nothing here can reach the isolated instance: p9-live.py refuses port 18096 in this mode, and every address is 127.0.0.1.

Usage: python3 p9-live-sim.py [results.json]. Exit status 0 when every check passes.
"""
import importlib.util
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = tempfile.mkdtemp(prefix="p9-live-sim-")
BIN = os.path.join(WORK, "bin")
DOCKER = os.path.join(WORK, "docker")
DB = os.path.join(WORK, "plugin.db")
os.makedirs(BIN)
os.makedirs(DOCKER)

FAKE_SETSID = r'''#!/usr/bin/env python3
# setsid as util-linux has it: a new session (and process group) for the command; forks first when the caller already leads
# a group, and with --wait waits for it and returns its status.
import os, sys
args = sys.argv[1:]
wait = bool(args) and args[0] == "--wait"
if wait:
    args = args[1:]
if os.getpgrp() == os.getpid():
    pid = os.fork()
    if pid == 0:
        os.setsid()
        os.execvp(args[0], args)
    if not wait:
        sys.exit(0)
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    sys.exit(code if code >= 0 else 128 - code)
os.setsid()
os.execvp(args[0], args)
'''

FAKE_DOCKER = r'''#!/bin/bash
# A fake `docker` for one service: `compose -f FILE stop|start NAME` and `inspect -f FORMAT NAME`. A stop is carried out by a
# "daemon" in a session of its own, so it finishes even when this client is killed; a stop or start logs an event.
dir="$FAKE_DOCKER_DIR"
now() { python3 -c 'import time; print(f"{time.time():.3f}")'; }
log() { echo "$(now) $*" >> "$dir/events"; }
case "$1" in
  compose)
    action="$4"
    case "$action" in
      stop)
        if [ "$(cat "$dir/state")" = running ] && [ ! -e "$dir/stopping" ]; then
          touch "$dir/stopping"
          log stop-begin
          setsid bash -c "sleep ${FAKE_STOP_SECONDS:-1}; echo exited > '$dir/state'; rm -f '$dir/stopping'; echo \"\$(python3 -c 'import time; print(f\"{time.time():.3f}\")') stop-end\" >> '$dir/events'" </dev/null >/dev/null 2>&1 &
        fi
        while [ -e "$dir/stopping" ]; do sleep 0.1; done
        exit 0;;
      start)
        [ -e "$dir/stopping" ] && log start-during-stop
        echo running > "$dir/state"
        log start
        exit 0;;
    esac;;
  inspect)
    state=$(cat "$dir/state")
    case "$3" in
      *Status*) echo "$state";;
      *Running*) [ "$state" = running ] && echo true || echo false;;
    esac
    exit 0;;
esac
exit 1
'''

for name, body in (("setsid", FAKE_SETSID), ("docker", FAKE_DOCKER)):
    path = os.path.join(BIN, name)
    with open(path, "w") as handle:
        handle.write(body)
    os.chmod(path, 0o755)


# ---- The ratings settings stand-in: the plugin's revision rule over the scratch database the runner reads.
class Api:
    tests = 0
    refreshes = 0
    after_save = None  # a save "by someone else" that lands right after the runner's own
    queued = 0
    task_state = "Idle"


def settings_row():
    with sqlite3.connect(DB) as db:
        return db.execute("SELECT Revision, ApiKeyRef, DailyBudget, Enabled FROM RatingsSettings").fetchone()


def foreign_save(key_ref=None, budget=None):
    """A save by someone else: the user's own key, or another setting, raising the revision as the plugin does."""
    with sqlite3.connect(DB) as db:
        if key_ref is not None:
            db.execute("UPDATE RatingsSettings SET ApiKeyRef = ?, Revision = Revision + 1", (key_ref,))
        if budget is not None:
            db.execute("UPDATE RatingsSettings SET DailyBudget = ?, Revision = Revision + 1", (budget,))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def dto(self):
        revision, ref, budget, enabled = settings_row()
        return {"revision": revision, "apiKeyConfigured": ref is not None, "providerOverride": False, "dailyBudget": budget,
                "enabled": bool(enabled), "verified": False}

    def do_GET(self):
        if self.path in ("/System/Info/Public", "/JellyfinMod/Health"):
            return self.reply(200, {})
        if self.path == "/JellyfinMod/Settings/Ratings":
            return self.reply(200, self.dto())
        if self.path == "/JellyfinMod/Ratings/Status":
            return self.reply(200, {"queued": Api.queued})
        if self.path == "/ScheduledTasks":
            return self.reply(200, [{"Key": "JellyfinModRatingsRefresh", "Id": "ratings", "State": Api.task_state}])
        return self.reply(404, {})

    def do_POST(self):
        if self.path == "/JellyfinMod/Settings/Ratings/Test":
            Api.tests += 1
            return self.reply(200, {"ok": True})
        if self.path.endswith("/Ratings/Refresh"):
            Api.refreshes += 1
            return self.reply(202, {"queued": True})
        return self.reply(404, {})

    def do_PATCH(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        revision, ref, budget, enabled = settings_row()
        if body.get("revision") != revision:
            return self.reply(409, {"type": "revision_conflict"})
        action = (body.get("apiKey") or {}).get("action", "unchanged")
        if action == "replace":
            ref = "sec_" + os.urandom(6).hex()
        elif action == "clear":
            ref = None
        with sqlite3.connect(DB) as db:
            db.execute("UPDATE RatingsSettings SET Revision = ?, ApiKeyRef = ?, DailyBudget = ?, Enabled = ?",
                       (revision + 1, ref, body.get("dailyBudget", budget), int(body.get("enabled", bool(enabled)))))
        answer = self.dto()
        if Api.after_save:
            hook, Api.after_save = Api.after_save, None
            hook()
        return self.reply(200, answer)


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


port = free_port()
assert port != 18096
server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()

key_file = os.path.join(WORK, "key")
with open(key_file, "w") as handle:
    handle.write("sim-fixture-key")
os.environ.update({
    "JFMOD_P9_REMOTE": "local", "JFMOD_P9_URL": f"http://127.0.0.1:{port}", "JFMOD_P9_KEY_FILE": key_file,
    "JFMOD_P9_STATE": os.path.join(WORK, "state.json"), "JFMOD_P9_DB": DB, "JFMOD_P9_COMPOSE": os.path.join(WORK, "compose.yml"),
    "JFMOD_P9_TERM_WAIT": "3", "FAKE_DOCKER_DIR": DOCKER, "PATH": BIN + os.pathsep + os.environ["PATH"],
})
spec = importlib.util.spec_from_file_location("p9live", os.path.join(HERE, "p9-live.py"))
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)
assert live.SIM and live.BASE.endswith(str(port))

results = []


def check(condition, what, detail=None):
    results.append({"check": what, "verdict": "PASS" if condition else "FAIL", "detail": detail})
    print(("PASS " if condition else "FAIL ") + what + (f" :: {json.dumps(detail)[:300]}" if detail is not None else ""))


def reset_service(state="running"):
    for name in ("events", "stopping"):
        path = os.path.join(DOCKER, name)
        if os.path.exists(path):
            os.remove(path)
    with open(os.path.join(DOCKER, "state"), "w") as handle:
        handle.write(state + "\n")


def events():
    path = os.path.join(DOCKER, "events")
    return [line.split(" ", 1)[1].strip() for line in open(path)] if os.path.exists(path) else []


def service():
    return open(os.path.join(DOCKER, "state")).read().strip()


def group_left(marker):
    return subprocess.run(["pgrep", "-f", marker], capture_output=True).returncode == 0


def ordered(log):
    """Every start comes after the stop before it has finished, and none during a stop."""
    return "start-during-stop" not in log and all(log[:i].count("stop-begin") == log[:i].count("stop-end") for i, e in enumerate(log) if e == "start")


with sqlite3.connect(DB) as db:
    db.execute("CREATE TABLE RatingsSettings (Revision INTEGER, ApiKeyRef TEXT, DailyBudget INTEGER, Enabled INTEGER)")
    db.execute("INSERT INTO RatingsSettings VALUES (1, NULL, 500, 1)")

# ---- The stopped-service helper (findings 3 and 4).
reset_service()
out = live.with_service_stopped("CREATE TABLE done (x); INSERT INTO done VALUES (1);")
with sqlite3.connect(DB) as db:
    ran = db.execute("SELECT COUNT(*) FROM done").fetchone()[0]
check(out.returncode == 0 and ran == 1 and service() == "running" and ordered(events()) and not group_left(out.marker),
      "Normal step: the service stops, the SQL runs, the service starts once the stop has finished", {"events": events()})

reset_service()
out = live.with_service_stopped("THIS IS NOT SQL;")
check(out.returncode != 0 and service() == "running" and ordered(events()), "A failing SQL step keeps its status and the service is started again",
      {"exit": out.returncode, "events": events()})

reset_service()
pidfile = os.path.join(WORK, "monitor.pid")
result = {}
worker = threading.Thread(target=lambda: result.update(out=live.with_service_stopped(".shell sleep 47", pidfile=pidfile)))
worker.start()
deadline = time.time() + 20
while time.time() < deadline and not (os.path.exists(pidfile) and os.path.getsize(pidfile) and service() == "exited"):
    time.sleep(0.1)
sent = time.time()
subprocess.run(["kill", "-TERM", open(pidfile).read().strip()])
worker.join(60)
out = result.get("out")
sleeper = subprocess.run(["pgrep", "-f", "sleep 47"], capture_output=True).returncode == 0
check(out is not None and out.returncode == 143 and not group_left(out.marker) and not sleeper and service() == "running" and ordered(events())
      and time.time() - sent < 15,
      "TERM to the step's shell mid-SQL: the whole work group ends (no sleeper left), and only then is the service started",
      {"exit": out.returncode if out else None, "sleeperLeft": sleeper, "events": events()})

reset_service()
late = os.path.join(WORK, "late-sql")
out = live.with_service_stopped(f".shell sleep 4\n.shell touch '{late}'", timeout=2)
time.sleep(6)
check(out.returncode == 124 and not group_left(out.marker) and not os.path.exists(late) and service() == "running" and ordered(events()),
      "A local time-out mid-SQL: the operation is ended and confirmed gone before the start; its SQL never runs afterwards",
      {"lateSqlRan": os.path.exists(late), "events": events()})

reset_service()
os.environ["FAKE_STOP_SECONDS"] = "4"
out = live.with_service_stopped("SELECT 1;", timeout=1)
time.sleep(5)
log = events()
check(out.returncode == 124 and not group_left(out.marker) and service() == "running" and ordered(log) and log[-1] == "start",
      "A local time-out during the stop itself: the start waits for the daemon's stop to finish, and the service stays up after",
      {"events": log})
os.environ["FAKE_STOP_SECONDS"] = "1"

reset_service()
os.environ["FAKE_STOP_SECONDS"] = "0"
seen = {}


def watch_resistant():
    # The resistant member exists while the step runs (so the kill below is real, not a step that never got that far).
    deadline = time.time() + 5
    while time.time() < deadline and not seen.get("alive"):
        seen["alive"] = subprocess.run(["pgrep", "-f", "sleep 53"], capture_output=True).returncode == 0
        time.sleep(0.1)


watcher = threading.Thread(target=watch_resistant)
watcher.start()
timed_out_at = time.time() + 2
resistant = os.path.join(WORK, "resistant.sh")
with open(resistant, "w") as handle:
    handle.write("#!/bin/bash\ntrap '' TERM\nsleep 53\n")
os.chmod(resistant, 0o755)
out = live.with_service_stopped(f".shell {resistant}", timeout=2)
watcher.join()
waited = round(time.time() - timed_out_at)
os.environ["FAKE_STOP_SECONDS"] = "1"
check(seen.get("alive") and out.returncode == 124 and waited >= live.TERM_WAIT and not group_left(out.marker)
      and subprocess.run(["pgrep", "-f", "sleep 53"], capture_output=True).returncode != 0 and service() == "running" and ordered(events()),
      "A member that ignores TERM is killed after the TERM wait: the group is confirmed empty before the start",
      {"memberSeen": seen.get("alive"), "secondsAfterTimeout": waited, "termWait": live.TERM_WAIT, "events": events()})

reset_service()
real_remote = live.remote


def failing_recovery(script, *args, **kwargs):
    if "kill -TERM --" in script and "pgrep -f" in script:
        return subprocess.CompletedProcess(args=[], returncode=255, stdout="", stderr="ssh: connection dropped")
    return real_remote(script, *args, **kwargs)


live.remote = failing_recovery
raised = None
try:
    live.with_service_stopped(".shell sleep 59", timeout=1)
except live.RecoveryFailed as failure:
    raised = failure
live.remote = real_remote
time.sleep(2)  # the daemon's own stop finishes in a second
check(raised is not None and "start" not in events() and service() == "exited",
      "When the recovery call itself fails, the service is not started and the step reports a recovery failure", {"events": events()})
if raised is not None:
    live.recover(raised.marker, raised.groups)

# An unmarked member left in a step's group after the processes that led it have gone (review round 6, finding 1): found
# through the group recorded when the step started, ended, and the group confirmed empty.
orphan = subprocess.Popen(["setsid", "bash", "-c", "sleep 61 >/dev/null 2>&1 & exit 0"])
orphan.wait()
group = orphan.pid
alive_before = subprocess.run(["bash", "-c", f"kill -0 -- -{group}"], capture_output=True).returncode == 0
ended = live.recover("p9op-" + "0" * 12, [group])
alive_after = subprocess.run(["bash", "-c", f"kill -0 -- -{group}"], capture_output=True).returncode == 0
check(alive_before and ended and not alive_after and subprocess.run(["pgrep", "-f", "sleep 61"], capture_output=True).returncode != 0,
      "An orphaned member whose group leader has gone is found by the recorded group, ended, and the group confirmed empty",
      {"aliveBefore": alive_before, "recovered": ended, "aliveAfter": alive_after})

reset_service()
out = live.with_service_stopped(".shell sleep 62 >/dev/null 2>&1 &")
check(out.returncode == 0 and subprocess.run(["pgrep", "-f", "sleep 62"], capture_output=True).returncode != 0 and service() == "running"
      and ordered(events()), "A member a finished step left behind in its group is ended before the service starts", {"events": events()})

reset_service()
real_groups = live.step_groups
live.step_groups = lambda text: None
missing = None
try:
    live.with_service_stopped("SELECT 1;")
except live.RecoveryFailed as failure:
    missing = failure
live.step_groups = real_groups
check(missing is not None and "start" not in events() and service() == "exited",
      "Without a valid report of the step's groups nothing can be confirmed, so the service is not started", {"events": events()})
reset_service()

# ---- Key ownership (findings 1 and 2).
live.save_state({"token": "sim", "lastRevision": 1, "fixtureKeyRef": ""})
code, _ = live.set_fixture_key()
state = live.load_state()
revision, ref = live.snapshot()
check(code == 200 and state["fixtureKeyRef"] == ref and ref and state["lastRevision"] == revision == 2,
      "The fixture key is saved against the run's revision and its reference recorded with the revision it produced")

Api.after_save = lambda: foreign_save(key_ref="sec_user")
try:
    live.write({"dailyBudget": 400})
    adopted = True
except live.ForeignKey:
    adopted = False
state = live.load_state()
check(not adopted and state["fixtureKeyRef"] == ref and state["lastRevision"] == 2 and live.snapshot()[1] == "sec_user",
      "A key saved right after the run's own save is not taken for the run's: nothing is recorded and the run stops")

try:
    live.write({"apiKey": {"action": "clear"}})
    cleared = True
except live.ForeignKey:
    cleared = False
check(not cleared and live.snapshot()[1] == "sec_user", "Cleanup's clear is refused (409) and the user's key stays")

Api.tests = Api.refreshes = 0
blocked = []
for action in (live.test_key, lambda: live.refresh("entry"), live.task, lambda: live.configure_plugin({})):
    try:
        action()
        blocked.append(False)
    except live.ForeignKey:
        blocked.append(True)
check(all(blocked) and Api.tests == 0 and Api.refreshes == 0, "Test, a refresh, the daily task and a configuration change are refused before any request",
      {"blocked": blocked, "tests": Api.tests, "refreshes": Api.refreshes})

with sqlite3.connect(DB) as db:
    db.execute("UPDATE RatingsSettings SET Revision = 5, ApiKeyRef = 'sec_run', DailyBudget = 500")
live.save_state({"token": "sim", "lastRevision": 5, "fixtureKeyRef": "sec_run"})
foreign_save(budget=7)
try:
    live.write({"dailyBudget": 2})
    overwrote = True
except live.ForeignKey:
    overwrote = False
check(not overwrote and settings_row()[2] == 7, "Another setting saved by someone else is not overwritten: the run's save is refused (409)")

with sqlite3.connect(DB) as db:
    db.execute("UPDATE RatingsSettings SET Revision = 9, ApiKeyRef = 'sec_run'")
live.save_state({"token": "sim", "lastRevision": 9, "fixtureKeyRef": "sec_run"})
Api.tests = Api.refreshes = 0
live.test_key()
live.refresh("entry")
check(Api.tests == 1 and Api.refreshes == 1, "While the settings are as the run left them, Test and a refresh go through")

# ---- Cleanup waits for work in flight (review round 6, finding 3).
Api.queued, Api.task_state = 2, "Running"
threading.Timer(3, lambda: setattr(Api, "queued", 0)).start()
threading.Timer(5, lambda: setattr(Api, "task_state", "Idle")).start()
began = time.time()
drained = live.drain(limit=20)
waited = time.time() - began
check(drained and waited >= 4.5, "The drain cleanup starts with waits until no refresh is queued and the ratings task is idle",
      {"seconds": round(waited, 1)})
Api.task_state = "Running"
check(not live.drain(limit=3), "If the task does not finish, the drain says so (and cleanup then clears nothing)")
Api.task_state = "Idle"

server.shutdown()
subprocess.run(["rm", "-rf", WORK])
failed = [r for r in results if r["verdict"] != "PASS"]
print(f"simulation: {len(results) - len(failed)} passed, {len(failed)} failed")
if len(sys.argv) > 1:
    with open(sys.argv[1], "w") as handle:
        json.dump({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": results}, handle, indent=1)
sys.exit(1 if failed else 0)
