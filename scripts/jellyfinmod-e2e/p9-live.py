#!/usr/bin/env python3
"""Phase 9 (R8) live acceptance on the isolated instance: ratings through the real host, against the MDBList stand-in.

Runs in steps so the browser runner (p9-ratings.mjs) can sit between them:

  p9-live.py setup        disposable library + NFO titles (locked: no metadata provider is ever asked), a temporary viewer
  p9-live.py unconfigured host fallback and TMDB-only answers, a run that calls nothing, refusals, fetcher order
  p9-live.py configure    the stand-in address (hidden XML field), the fixture key, Test
  p9-live.py fetch        the daily task through Jellyfin's task manager: one call per title, newest first, projection, access
  p9-live.py age          one title's MDBList values made 40 days old (service stopped), so cards show a stale value
  p9-live.py unage        the same values made current again, before the failure steps
  p9-live.py restart      a restart keeps settings, key and ratings
  p9-live.py failures     budget, manual refresh, 401, key error, 429, malformed, timeout, not found, five 503s
  p9-live.py kill         a container killed mid-call: its claim is counted, the title is not fetched again
  p9-live.py interrupt    the stopped-service helper restarts 18096 when the remote shell is sent TERM mid-step and when the
                          local call times out (needs JFMOD_P9_WORK)
  p9-live.py guard        only checks that the ratings settings are as this run last left them (run it before the browser runner)
  p9-live.py cleanup      every fixture, the key, the override and the ratings rows go; oleksii's ratings display
                          preferences are restored exactly (a key that did not exist is removed); UserViews shows Movies
                          and Shows only

p9-live-sim.py runs the stopped-service helper and the key-ownership chain on this machine against a fake service and a fake
ratings API, with no SSH and no test host.

Settings (environment, never committed): JFMOD_P9_URL (the isolated instance, port 18096 only), JFMOD_P9_SSH (ssh alias of
the host), JFMOD_P9_KEY_FILE (local 0600 file with the stand-in's fixture key), JFMOD_P9_BOUNDARY (the stand-in's address as
the container reaches it), JFMOD_P9_HOST_MEDIA (the host folder mounted at JFMOD_P9_CONTAINER_MEDIA), JFMOD_P9_COMPOSE (the
isolated service's compose file on the host), JFMOD_P9_DB (the plugin database on the host), JFMOD_P9_OUT (results JSON),
JFMOD_P9_WORK (a scratch folder on the host, never the SD card; only the interrupt step uses it).
Signs in as oleksii with an empty password. Never prints the key, a token, a password, an address or a host path.
"""
import json
import os
import re
import secrets
import signal
import subprocess
import threading
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ["JFMOD_P9_URL"].rstrip("/")
# JFMOD_P9_REMOTE=local runs the host-side commands on this machine instead of over SSH: only p9-live-sim.py sets it, with a
# fake service and a fake ratings API, and then nothing may reach the isolated instance (port 18096) or the test host.
SIM = os.environ.get("JFMOD_P9_REMOTE") == "local"
_target = urllib.parse.urlparse(BASE)
if SIM and (_target.hostname != "127.0.0.1" or _target.port == 18096):
    sys.exit("The simulation runs only against its own local stand-in, never port 18096")
if not SIM and _target.port != 18096:
    sys.exit("Runs only against the isolated instance (port 18096)")
SSH = os.environ.get("JFMOD_P9_SSH", "") if SIM else os.environ["JFMOD_P9_SSH"]
# How long an interrupted stopped-service step is given to end on TERM before it is killed (the simulation shortens it).
TERM_WAIT = int(os.environ.get("JFMOD_P9_TERM_WAIT", "120"))
KEY = open(os.environ["JFMOD_P9_KEY_FILE"]).read().strip()
BOUNDARY = os.environ.get("JFMOD_P9_BOUNDARY", "")
HOST_MEDIA = os.environ.get("JFMOD_P9_HOST_MEDIA", "")
CONTAINER_MEDIA = os.environ.get("JFMOD_P9_CONTAINER_MEDIA", "/test-media")
COMPOSE = os.environ.get("JFMOD_P9_COMPOSE", "")
DB = os.environ.get("JFMOD_P9_DB", "")
OUT = os.environ.get("JFMOD_P9_OUT")
WORK = os.environ.get("JFMOD_P9_WORK", "")
STATE_FILE = os.environ.get("JFMOD_P9_STATE", os.path.join(os.path.dirname(os.environ["JFMOD_P9_KEY_FILE"]), "p9-live-state.json"))
PLUGIN_ID = "6f1a2b3c4d5e4f609a718b2c3d4e5f60"
LIBRARY = "JellyfinMod P9 Ratings"
FOLDER = "jfmod-p9-ratings"
AUTH = 'MediaBrowser Client="jfmod-p9-live", Device="cli", DeviceId="jfmod-p9-live", Version="1"'
TITLES = [(990901, "JellyfinMod P9 Ratings Host", "7.4", "87"), (990902, "JellyfinMod P9 Ratings Second", "6.2", None)]
KILL_TITLE = (990903, "JellyfinMod P9 Ratings Kill", "5.5", None)
SECRETS = [KEY]
results = []
PREF_KEYS = ("jfmodRatingsSources", "jfmodRatingsCardSource")
AGED_TITLE = 990902


def scrub(text):
    text = str(text)
    for value in SECRETS:
        if value:
            text = text.replace(value, "<secret>")
    text = re.sub(r"\b(?:10|127|172\.(?:1[6-9]|2\d|3[01])|192\.168)(?:\.\d{1,3}){2,3}(?::\d+)?\b", "<private-ip>", text)
    return re.sub(r"/(?:mnt|home|Users|private)/[^\s\"',)]+", "<host-path>", text)


def check(condition, what, detail=None):
    verdict = "PASS" if condition else "FAIL"
    results.append({"check": what, "verdict": verdict, "detail": scrub(json.dumps(detail))[:600] if detail is not None else None})
    print(f"{verdict} {what}" + (f" :: {scrub(json.dumps(detail))[:300]}" if detail is not None else ""))
    return condition


def load_state():
    return json.load(open(STATE_FILE)) if os.path.exists(STATE_FILE) else {}


def save_state(state):
    fd = os.open(STATE_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(state, handle)


bodies = []


def call(method, path, body=None, token=None, raw=False):
    state = load_state()
    token = token if token is not None else state.get("token")
    header = AUTH + (f', Token="{token}"' if token else "")
    data = body.encode() if isinstance(body, str) else json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json", "Authorization": header})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            text = response.read().decode()
            status = response.status
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        status = error.code
    except (urllib.error.URLError, ConnectionError, OSError) as error:
        # The service restarting (or not up yet): no answer, which callers that wait for it treat as "not yet".
        return 0, type(error).__name__
    if "JellyfinMod" in path or "Ratings" in path:
        bodies.append(text)
    if raw:
        return status, text
    try:
        return status, json.loads(text) if text else None
    except json.JSONDecodeError:
        return status, text


def sign_in():
    status, result = call("POST", "/Users/AuthenticateByName", {"Username": "oleksii", "Pw": ""}, token="")
    if status != 200:
        sys.exit(f"sign-in failed: {status}")
    state = load_state()
    state["token"] = result["AccessToken"]
    state["userId"] = result["User"]["Id"]
    save_state(state)
    SECRETS.append(result["AccessToken"])


def remote(script, *args, timeout=600, session=False):
    """Runs a bash script on the test host (here, in the simulation). `session` starts it as the leader of a session and
    process group of its own, so everything it starts can be found and ended as one group."""
    command = (["setsid", "--wait"] if session else []) + ["bash", "-s", "--", *args]
    return subprocess.run(command if SIM else ["ssh", SSH, *command], input=script, text=True, capture_output=True, timeout=timeout)


class RecoveryFailed(Exception):
    """A stopped-service step could not be shown to have ended, so the service was left as it was (not started)."""


def wait_service():
    wait_for(lambda: call("GET", "/System/Info/Public", token="")[0] == 200, "the start", 300)
    wait_for(lambda: call("GET", "/JellyfinMod/Health")[0] == 200, "Health", 300)


def with_service_stopped(sql, timeout=600, pidfile=None, ensure=True):
    """Runs SQL on the plugin database with the isolated service stopped, then starts it again (review rounds 2-5).

    On the host a monitor shell, the leader of its own session, runs the work — the stop, then the SQL — in a second
    session and process group, and waits for it. On INT, TERM or HUP the monitor ends the work's whole group (TERM, a wait,
    KILL, and a check that it is empty) and exits with the signal's status; it never starts the service itself.

    Here the operation is always shown to have ended before anything else happens: `recover` finds both groups by a marker
    in their command lines, ends whatever is left the same way and confirms it is gone. Only then does `restart_clean` run:
    it waits for any stop still under way (`docker compose stop`), confirms the container has exited, starts it and confirms
    it runs. If the operation cannot be shown to have ended — the recovery call failed, or a group would not empty — the
    service is left exactly as it is and RecoveryFailed is raised for the step to report."""
    marker = "p9op-" + secrets.token_hex(6)
    script = (f"cd ~ || exit 1\n"
              + (f"echo $$ > '{pidfile}'\n" if pidfile else "")
              + f"work=\n"
              f"alive() {{ [ -n \"$work\" ] && pgrep -g \"$work\" >/dev/null; }}\n"
              f"end_work() {{\n"
              f"  [ -n \"$work\" ] || return 0\n"
              f"  kill -TERM -- \"-$work\" 2>/dev/null\n"
              f"  for i in $(seq 1 {TERM_WAIT}); do alive || return 0; sleep 1; done\n"
              f"  kill -KILL -- \"-$work\" 2>/dev/null\n"
              f"  for i in $(seq 1 30); do alive || return 0; sleep 1; done\n"
              f"  return 1\n"
              f"}}\n"
              f"on_signal() {{ trap '' INT TERM HUP; end_work || exit 97; exit \"$1\"; }}\n"
              f"trap 'on_signal 130' INT; trap 'on_signal 143' TERM; trap 'on_signal 129' HUP\n"
              f"setsid bash -s -- '{marker}' <<'WORK' &\n"
              f"docker compose -f '{COMPOSE}' stop jellyfinmod-test >/dev/null || exit 90\n"
              f"sqlite3 '{DB}' <<'SQL'\n{sql}\nSQL\n"
              f"WORK\n"
              f"work=$!\n"
              f"wait \"$work\"; rc=$?\n"
              f"trap '' INT TERM HUP\n"
              f"end_work || exit 97\n"
              f"exit $rc\n")
    interrupted = None
    try:
        out = remote(script, marker, timeout=timeout, session=True)
    except (subprocess.TimeoutExpired, OSError, KeyboardInterrupt, SystemExit) as error:
        interrupted = error
        out = subprocess.CompletedProcess(args=[], returncode=124, stdout="", stderr=type(error).__name__)
    out.marker = marker
    if not recover(marker):
        raise RecoveryFailed(f"the stopped-service step {marker} could not be shown to have ended; the service was left as it was")
    if ensure:
        started = restart_clean()
        if started.returncode != 0:
            raise RecoveryFailed(f"the service could not be started cleanly after {marker} (step {started.returncode})")
        wait_service()
    if isinstance(interrupted, (KeyboardInterrupt, SystemExit)):
        raise interrupted
    return out


def recover(marker):
    """Ends whatever is left of a stopped-service operation and confirms it is gone (review rounds 4-5). Every process whose
    command line carries the marker and leads its own process group — the monitor and the work — has that whole group sent
    TERM, waited for, sent KILL if it has not emptied, and checked again. True only when the call itself succeeded and every
    such group is empty; anything else (the call failed, timed out, or a group would not empty) is False."""
    try:
        out = remote(f"""
groups=""
for pid in $(pgrep -f '{marker}'); do
  group=$(ps -o pgid= -p "$pid" | tr -d ' ')
  [ "$group" = "$pid" ] && groups="$groups $pid"
done
[ -z "$groups" ] && exit 0
for group in $groups; do kill -TERM -- "-$group" 2>/dev/null; done
empty() {{ for group in $groups; do pgrep -g "$group" >/dev/null && return 1; done; return 0; }}
for i in $(seq 1 {TERM_WAIT}); do empty && exit 0; sleep 1; done
for group in $groups; do kill -KILL -- "-$group" 2>/dev/null; done
for i in $(seq 1 30); do empty && exit 0; sleep 1; done
exit 3
""", timeout=TERM_WAIT + 120)
    except (subprocess.TimeoutExpired, OSError):
        return False
    return out.returncode == 0


def restart_clean():
    """Starts the service only once it has certainly stopped: `docker compose stop` returns when any stop still under way has
    finished (and does nothing when the service is already stopped), the container must then be `exited`, and after the start
    it must be `running`. Each failed step exits with its own status."""
    return remote(f"""
cd ~ || exit 1
docker compose -f '{COMPOSE}' stop jellyfinmod-test >/dev/null || exit 4
[ "$(docker inspect -f '{{{{.State.Status}}}}' jellyfinmod-test)" = exited ] || exit 5
docker compose -f '{COMPOSE}' start jellyfinmod-test >/dev/null || exit 6
[ "$(docker inspect -f '{{{{.State.Status}}}}' jellyfinmod-test)" = running ] || exit 7
""", timeout=300)


def service_running():
    return remote("docker inspect -f '{{.State.Running}}' jellyfinmod-test").stdout.strip() == "true"


def step_interrupt():
    """The stopped-service helper under interruption: TERM to the remote shell mid-step, and a local time-out (round 3, P2 5).
    Each step stops 18096 for a few seconds; nothing in the database changes (the SQL step only waits)."""
    if not WORK:
        check(False, "JFMOD_P9_WORK names a scratch folder on the host for the interrupt step")
        return
    pidfile = f"{WORK.rstrip('/')}/p9-stopped-step.pid"
    remote(f"rm -f '{pidfile}'")
    result = {}
    worker = threading.Thread(target=lambda: result.update(out=with_service_stopped(".shell sleep 40", pidfile=pidfile)))
    worker.start()
    wait_for(lambda: remote(f"test -s '{pidfile}'").returncode == 0 and not service_running(), "the step to stop the service", 120)
    sent = time.time()
    remote(f"kill -TERM $(cat '{pidfile}')")
    worker.join(300)
    running = service_running()
    elapsed = round(time.time() - sent)
    out = result.get("out")
    gone = out is not None and remote(f"pgrep -f '{out.marker}'").returncode != 0
    check(out is not None and out.returncode == 143 and gone and running and elapsed < 120,
          "TERM to the step's shell mid-SQL (waiting 40 s): its whole work group ends, the step exits with the signal's status, and the "
          "service is started only once that is confirmed", {"exit": out.returncode if out else None, "operationGone": gone, "running": running,
                                                            "secondsAfterTerm": elapsed})
    remote(f"rm -f '{pidfile}'")
    # A local time-out while the SQL step waits: the remote operation is ended before the service starts, so its SQL (here a
    # marker file written after the wait) never runs once the service is back (review round 4, P2 2).
    late = f"{WORK.rstrip('/')}/p9-late-sql"
    remote(f"rm -f '{late}'")
    started = time.time()
    out = with_service_stopped(f".shell sleep 30\n.shell touch '{late}'", timeout=8)
    gone = remote(f"pgrep -f '{out.marker}'").returncode != 0
    healthy = call("GET", "/JellyfinMod/Health")[0] == 200
    wait_for(lambda: time.time() - started > 45, "the time the SQL step would have needed", 60)
    late_ran = remote(f"test -e '{late}'").returncode == 0
    still = call("GET", "/JellyfinMod/Health")[0] == 200 and service_running()
    check(out.returncode == 124 and gone and healthy and not late_ran and still,
          "A local time-out mid-step: the remote operation is ended before the service starts, its SQL never runs afterwards, and the "
          "service stays up", {"exit": out.returncode, "operationGone": gone, "lateSqlRan": late_ran, "stillUp": still})
    remote(f"rm -f '{late}'")
    # A local time-out while the service is still stopping: the stop finishes before recovery starts the service, so no late stop
    # takes it down again.
    started = time.time()
    out = with_service_stopped("SELECT 1;", timeout=2)
    gone = remote(f"pgrep -f '{out.marker}'").returncode != 0
    wait_for(lambda: time.time() - started > 30, "a stop's own time limit", 60)
    still = call("GET", "/JellyfinMod/Health")[0] == 200 and service_running()
    check(out.returncode == 124 and gone and still, "A local time-out during the stop itself: recovery waits for it, and the service is up "
          "afterwards and stays up", {"exit": out.returncode, "operationGone": gone, "stillUp": still})


def boundary(method, path, body=None):
    """The stand-in's control port, which listens on the host's loopback only."""
    data = json.dumps(body) if body is not None else ""
    out = subprocess.run(["ssh", SSH, "curl", "-s", "-X", method, "-H", "'Content-Type: application/json'", "--data-binary", "@-",
                          f"http://127.0.0.1:18121{path}"], input=data, text=True, capture_output=True, timeout=60).stdout
    return json.loads(out) if out else None


def calls():
    return boundary("GET", "/state")["calls"]


def task(key="JellyfinModRatingsRefresh", timeout=300):
    if key == "JellyfinModRatingsRefresh":
        expect_own()
    status, tasks = call("GET", "/ScheduledTasks")
    target = next(item for item in tasks if item["Key"] == key)
    call("POST", f"/ScheduledTasks/Running/{target['Id']}")
    deadline = time.time() + timeout
    time.sleep(2)
    while time.time() < deadline:
        status, current = call("GET", f"/ScheduledTasks/{target['Id']}")
        if current["State"] == "Idle" and current.get("LastExecutionResult", {}).get("StartTimeUtc", "") >= target.get("LastExecutionResult", {}).get("StartTimeUtc", ""):
            return current.get("LastExecutionResult", {})
        time.sleep(2)
    raise TimeoutError("the ratings task did not finish")


def settings():
    return call("GET", "/JellyfinMod/Settings/Ratings")[1]


def rstatus():
    return call("GET", "/JellyfinMod/Ratings/Status")[1]


class ForeignKey(Exception):
    """The ratings settings are not as this run last left them: someone else saved (the user's own key, perhaps). Nothing may
    replace, clear, test or refresh with what is there."""


def snapshot():
    """The ratings settings' revision and the configured key's opaque secret-store reference ('' when none), read together in
    one statement, read-only, from the plugin database; never the key. No row yet means the defaults: revision 1, no key."""
    out = remote(f"sqlite3 -readonly '{DB}' \"SELECT Revision || '|' || IFNULL(ApiKeyRef, '') FROM RatingsSettings LIMIT 1\"")
    if out.returncode != 0:
        raise RuntimeError("the ratings settings could not be read")
    text = out.stdout.strip()
    if not text:
        return 1, ""
    revision, _, ref = text.partition("|")
    return int(revision), ref


def expect_own():
    """The settings are exactly as this run last wrote them: the same revision (any save, by anyone, raises it) and the same key
    reference. Checked before every provider action (Test, a refresh, the daily task) and every configuration change. The
    plugin has no conditional Test or refresh, so a save between this check and the action itself is not excluded; the window
    is one HTTP round trip (review round 5, finding 2)."""
    state = load_state()
    if "lastRevision" not in state:
        raise ForeignKey()
    revision, ref = snapshot()
    if revision != state["lastRevision"] or ref != state.get("fixtureKeyRef", ""):
        raise ForeignKey()
    return revision


def write(body):
    """Every ratings settings save this run makes. It is sent against the revision this run last wrote, so a save by anyone
    else in between is refused by the plugin (409) and stops the run. Ownership is then read against the revision this save
    produced: the revision and the key reference come from one statement, and unless the revision is still the one this save
    returned, a save came right after it and nothing is recorded (review round 5, finding 1)."""
    state = load_state()
    if "lastRevision" not in state:
        raise ForeignKey()
    code, response = call("PATCH", "/JellyfinMod/Settings/Ratings", {"revision": state["lastRevision"], **body})
    if code == 409:
        raise ForeignKey()
    if code != 200:
        return code, response
    revision, ref = snapshot()
    if revision != response["revision"]:
        raise ForeignKey()
    action = (body.get("apiKey") or {}).get("action", "unchanged")
    if action == "replace":
        state["fixtureKeyRef"] = ref
    elif ref != ("" if action == "clear" else state.get("fixtureKeyRef", "")):
        raise ForeignKey()
    else:
        state["fixtureKeyRef"] = ref
    state["lastRevision"] = revision
    save_state(state)
    return code, response


def set_fixture_key():
    """Saves the fixture key, over no key or this run's own only, and records its reference as this run's."""
    expect_own()
    return write({"apiKey": {"action": "replace", "value": KEY}})


def test_key():
    """Test, only while the settings are as this run left them."""
    expect_own()
    return call("POST", "/JellyfinMod/Settings/Ratings/Test")


def configure_plugin(config):
    """A change to the plugin's XML configuration (the stand-in address), only while the settings are as this run left them."""
    expect_own()
    return call("POST", f"/Plugins/{PLUGIN_ID}/Configuration", config)


def by_source(ratings):
    return {rating["source"]: rating for rating in ratings}


def entries(query):
    return call("GET", "/JellyfinMod/Entries?" + urllib.parse.urlencode({"query": query, "limit": 50}))[1]["items"]


def wait_for(condition, what, seconds=120):
    deadline = time.time() + seconds
    while time.time() < deadline:
        value = condition()
        if value:
            return value
        time.sleep(3)
    raise TimeoutError(what)


def nfo(tmdb, title, rating, critic):
    critic_line = f"\n  <criticrating>{critic}</criticrating>" if critic else ""
    return f"""<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<movie>
  <title>{title}</title>
  <year>2026</year>
  <plot>A disposable Phase 9 fixture.</plot>
  <rating>{rating}</rating>{critic_line}
  <tmdbid>{tmdb}</tmdbid>
  <uniqueid type="tmdb" default="true">{tmdb}</uniqueid>
  <lockdata>true</lockdata>
</movie>
"""


def make_titles(titles):
    script = "set -e\n"
    for tmdb, title, rating, critic in titles:
        folder = f"{HOST_MEDIA}/{FOLDER}/{title} (2026)"
        script += f"mkdir -p '{folder}'\ncat > '{folder}/movie.nfo' <<'NFO'\n{nfo(tmdb, title, rating, critic)}NFO\n"
        script += (f"docker exec jellyfinmod-test /usr/lib/jellyfin-ffmpeg/ffmpeg -loglevel error -y -f lavfi -i color=black:s=320x240:d=3 "
                   f"-c:v libx264 -t 3 '{CONTAINER_MEDIA}/{FOLDER}/{title} (2026)/{title} (2026).mkv'\n")
    out = remote(script)
    if out.returncode:
        sys.exit("fixture creation failed: " + scrub(out.stderr)[:400])


def library_id():
    status, folders = call("GET", "/Library/VirtualFolders")
    return next((folder["ItemId"] for folder in folders if folder["Name"] == LIBRARY), None)


def options(order):
    return {"Enabled": True, "EnableRealtimeMonitor": False, "SaveLocalMetadata": False, "DownloadImagesInAdvance": False,
            "EnableChapterImageExtraction": False, "ExtractChapterImagesDuringLibraryScan": False, "EnableTrickplayImageExtraction": False,
            "ExtractTrickplayImagesDuringLibraryScan": False, "EnableEmbeddedTitles": False, "MetadataSavers": [],
            "LocalMetadataReaderOrder": ["Nfo"], "DisabledLocalMetadataReaders": [],
            "PathInfos": [{"Path": f"{CONTAINER_MEDIA}/{FOLDER}"}],
            "TypeOptions": [{"Type": "Movie", "MetadataFetchers": order, "MetadataFetcherOrder": order, "ImageFetchers": [], "ImageFetcherOrder": []}]}


def scan():
    """Scans the disposable library only; the instance's own libraries are not touched."""
    state = load_state()
    call("POST", f"/Items/{state['libraryId']}/Refresh?" + urllib.parse.urlencode({"Recursive": "true", "MetadataRefreshMode": "Default",
                                                                                  "ImageRefreshMode": "None", "ReplaceAllMetadata": "false"}))


def item_for(title):
    state = load_state()
    status, result = call("GET", f"/Users/{state['userId']}/Items?" + urllib.parse.urlencode(
        {"Recursive": "true", "IncludeItemTypes": "Movie", "SearchTerm": title, "Fields": "ProviderIds,ParentId"}))
    return next((item for item in result["Items"] if item["Name"] == title), None)


# ---------------------------------------------------------------------------------------------------------------------------

def viewer_policy(user_id):
    """An ordinary user who sees the instance's own Movies and Shows, and not the disposable library."""
    status, folders = call("GET", "/Library/VirtualFolders")
    own = [folder["ItemId"] for folder in folders if folder["Name"] in ("Movies", "Shows")]
    status, user = call("GET", f"/Users/{user_id}")
    policy = user["Policy"]
    policy.update({"IsAdministrator": False, "EnableAllFolders": False, "EnabledFolders": own})
    call("POST", f"/Users/{user_id}/Policy", policy)


def prefs_path(user_id):
    return f"/DisplayPreferences/usersettings?userId={user_id}&client=emby"


def prefs_snapshot(user_id):
    """The ratings keys of oleksii's display preferences: each key's value, and which keys exist at all. A read that fails, or
    an answer without its CustomPrefs object, raises: a guess would later delete keys that existed (round 2, P3 5)."""
    status_code, prefs = call("GET", prefs_path(user_id))
    if status_code != 200 or not isinstance(prefs, dict) or not isinstance(prefs.get("CustomPrefs"), dict):
        raise RuntimeError(f"display preferences could not be read ({status_code})")
    custom = prefs["CustomPrefs"]
    return {key: custom[key] for key in PREF_KEYS if key in custom}


def restore_prefs(state):
    """Puts oleksii's ratings keys back as setup found them and retires the snapshot once that is confirmed; the snapshot stays
    for another try when anything fails. Returns whether the keys are as they were."""
    before = state.get("prefsBefore")
    if before is None:
        return None
    path = prefs_path(state["userId"])
    status_code, prefs = call("GET", path)
    if status_code != 200 or not isinstance(prefs, dict) or not isinstance(prefs.get("CustomPrefs"), dict):
        return False
    custom = prefs["CustomPrefs"]
    for key in PREF_KEYS:
        if key in before:
            custom[key] = before[key]
        else:
            custom.pop(key, None)
    call("POST", path, prefs)
    restored = prefs_snapshot(state["userId"]) == before
    if restored:
        state.pop("prefsBefore", None)
        save_state(state)
    return restored


def age(days):
    """Moves one title's MDBList values by `days` with the service stopped (there is no API for it)."""
    return with_service_stopped(f"UPDATE TitleRatings SET FetchedAt = strftime('%Y-%m-%d %H:%M:%f', FetchedAt, '{days:+d} days') "
                                f"WHERE Provider = 'mdblist' AND EntryId IN (SELECT Id FROM Entries WHERE TmdbId = {AGED_TITLE}); SELECT changes();")


def step_age():
    state = load_state()
    out = age(-40)
    ratings = by_source(call("GET", f"/JellyfinMod/Entries/{state['entries'][str(AGED_TITLE)]}")[1]["ratings"])
    other = by_source(call("GET", f"/JellyfinMod/Entries/{state['entries'][str(TITLES[0][0])]}")[1]["ratings"])
    check(out.returncode == 0 and ratings["imdb"]["stale"] and not other["imdb"]["stale"],
          "One title's MDBList values are 40 days old and read as stale; the other title's stay current", out.stdout.strip())


def step_unage():
    state = load_state()
    out = age(40)
    ratings = by_source(call("GET", f"/JellyfinMod/Entries/{state['entries'][str(AGED_TITLE)]}")[1]["ratings"])
    check(out.returncode == 0 and not ratings["imdb"]["stale"], "The aged title's values are current again", out.stdout.strip())


def step_setup():
    sign_in()
    revision, ref = snapshot()
    if settings()["apiKeyConfigured"] or ref:
        check(False, "No ratings key is configured before the run starts (a key there is the user's own; nothing touches it)")
        raise ForeignKey()
    state = load_state()
    # The start of this run's chain of saves: each later save is sent against the revision this run last wrote.
    state["lastRevision"] = revision
    state["fixtureKeyRef"] = ""
    save_state(state)
    status, health = call("GET", "/JellyfinMod/Health")
    check(all(name in health["Capabilities"] for name in ("ratings", "ratings.cards", "settings.ratings")), "Health lists the ratings capabilities",
          {"version": health["Version"], "bundle": health["Web"]["BundleId"]})
    boundary("POST", "/reset")
    boundary("POST", "/mode", {"mode": "full", "titles": {}})
    # oleksii's own ratings display choice, restored exactly by cleanup (web review 2026-10-07, P3 7). A repeated setup keeps
    # the first snapshot, never one the runs themselves wrote.
    if "prefsBefore" not in state:
        try:
            state["prefsBefore"] = prefs_snapshot(state["userId"])
        except RuntimeError as error:
            check(False, "oleksii's display preferences are read before anything changes them", str(error))
            raise
    state["logSince"] = subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip()
    save_state(state)
    make_titles(TITLES)
    if not library_id():
        query = urllib.parse.urlencode({"name": LIBRARY, "collectionType": "movies", "refreshLibrary": "true"})
        created, _ = call("POST", f"/Library/VirtualFolders?{query}", {"LibraryOptions": options(["TheMovieDb", "The Open Movie Database"])})
        check(created in (200, 204), "The disposable library is created (fetchers listed, NFOs locked, no image fetchers)", created)
    wait_for(lambda: all(item_for(title) for _, title, _, _ in TITLES), "the disposable titles appear", 600)
    host = item_for(TITLES[0][1])
    check(host.get("CommunityRating") == 7.4 and host.get("CriticRating") == 87, "The host item carries the NFO's community and critic ratings",
          {k: host.get(k) for k in ("CommunityRating", "CriticRating")})
    wait_for(lambda: len([e for e in entries("JellyfinMod P9 Ratings") if e["state"] == "onDisk"]) == 2, "the reconciler creates the entries", 600)
    found = entries("JellyfinMod P9 Ratings")
    state = load_state()
    state["libraryId"] = library_id()
    state["hostItem"] = host["Id"]
    state["entries"] = {str(entry["tmdbId"]): entry["id"] for entry in found}
    # A temporary viewer with access to Movies and Shows only: an ordinary user, and a no-access user for the disposable library.
    password = secrets.token_urlsafe(18)
    SECRETS.append(password)
    status, user = call("POST", "/Users/New", {"Name": "jfmod-p9-viewer", "Password": password})
    viewer_policy(user["Id"])
    status, auth = call("POST", "/Users/AuthenticateByName", {"Username": "jfmod-p9-viewer", "Pw": password}, token="")
    state["viewerId"] = user["Id"]
    state["viewerToken"] = auth["AccessToken"]
    save_state(state)
    check(status == 200 and not auth["User"]["Policy"]["IsAdministrator"], "A temporary ordinary viewer (Movies only) exists for the access checks")


def step_unconfigured():
    state = load_state()
    SECRETS.extend([state["token"], state.get("viewerToken", "")])
    s = settings()
    check(s["enabled"] and not s["apiKeyConfigured"] and s["refreshDays"] == 14 and s["dailyBudget"] == 500 and not s["providerOverride"] and
          s["defaultSources"] == ["imdb", "tomatoes_critic", "tomatoes_audience", "tmdb", "trakt"],
          "Unconfigured defaults: on, no key, 14 days, 500 a day, the decided order, no override", s)
    status, item = call("GET", f"/JellyfinMod/Ratings/Items/{state['hostItem']}")
    ratings = by_source(item["ratings"])
    check(status == 200 and ratings.get("tmdb", {}).get("provider") == "host_tmdb" and ratings["tmdb"]["value"] == 7.4 and
          ratings.get("tomatoes_critic", {}).get("provider") == "host_omdb" and ratings["tomatoes_critic"]["value"] == 87 and "imdb" not in ratings,
          "Unconfigured: the on-disk title shows the host's critic score as RT (host_omdb) and its community score as TMDB (TheMovieDb first)",
          item["ratings"])
    detail = call("GET", f"/JellyfinMod/Entries/{state['entries']['990901']}")[1]
    check(by_source(detail["ratings"]).keys() == ratings.keys(), "The entry detail answers the same as the item page", list(by_source(detail["ratings"])))
    viewer_policy(state["viewerId"])
    fileless = [e for e in call("GET", "/JellyfinMod/Entries?state=none&limit=200")[1]["items"] if (e.get("metadata") or {}).get("communityRating")]
    state["fileless"] = fileless[0]["id"]
    save_state(state)
    detail = call("GET", f"/JellyfinMod/Entries/{fileless[0]['id']}")[1]
    check([(r["source"], r["provider"]) for r in detail["ratings"]] == [("tmdb", "tmdb")], "Unconfigured: a file-less entry shows TMDB only, from its own snapshot",
          detail["ratings"])
    # The fetcher order decides who wrote CommunityRating: OMDb first makes it IMDb.
    call("POST", "/Library/VirtualFolders/LibraryOptions", {"Id": state["libraryId"], "LibraryOptions": options(["The Open Movie Database", "TheMovieDb"])})
    ratings = by_source(call("GET", f"/JellyfinMod/Ratings/Items/{state['hostItem']}")[1]["ratings"])
    check(ratings.get("imdb", {}).get("provider") == "host_omdb" and ratings["imdb"]["value"] == 7.4 and ratings["imdb"].get("votes") is None and "tmdb" not in ratings,
          "With OMDb first the host's community score is IMDb (host_omdb), without votes", ratings)
    call("POST", "/Library/VirtualFolders/LibraryOptions", {"Id": state["libraryId"], "LibraryOptions": options(["TheMovieDb", "The Open Movie Database"])})
    before = len(calls())
    result = task()
    st = rstatus()
    check(len(calls()) == before and st["lastRun"]["stopReason"] == "not_configured" and result.get("Status") == "Completed",
          "Unconfigured, the daily task (run through Jellyfin's task manager) calls nothing and says why", st["lastRun"])
    code, body = refresh(state['entries']['990901'])
    check(code == 409 and body["type"] == "not_configured", "A manual refresh without a key is 409 not_configured", body)
    viewer = state["viewerToken"]
    check(call("GET", "/JellyfinMod/Settings/Ratings", token=viewer)[0] == 403 and call("GET", "/JellyfinMod/Ratings/Status", token=viewer)[0] == 403 and
          call("POST", "/JellyfinMod/Settings/Ratings/Test", token=viewer)[0] == 403 and
          call("POST", f"/JellyfinMod/Entries/{state['fileless']}/Ratings/Refresh", token=viewer)[0] == 403,
          "An ordinary user gets 403 from the settings, status, Test and refresh")
    check(call("GET", f"/JellyfinMod/Ratings/Items/{state['hostItem']}", token=viewer)[0] == 404 and
          call("GET", f"/JellyfinMod/Entries/{state['entries']['990901']}", token=viewer)[0] == 404,
          "A user without access to the disposable library gets 404 for its item and entry")
    check(all(call("GET", path, token="")[0] == 401 for path in ("/JellyfinMod/Ratings/Defaults", f"/JellyfinMod/Ratings/Items/{state['hostItem']}",
                                                                   "/JellyfinMod/Settings/Ratings")), "Anonymous requests get 401")
    defaults = call("GET", "/JellyfinMod/Ratings/Defaults", token=viewer)[1]
    check(defaults["enabled"] and "apiKeyConfigured" not in defaults, "An ordinary user reads the defaults and nothing about the key")


def step_configure():
    state = load_state()
    SECRETS.extend([state["token"]])
    status, config = call("GET", f"/Plugins/{PLUGIN_ID}/Configuration")
    # The value before the first configure only: a repeated configure must not record the stand-in as "before".
    state.setdefault("overrideBefore", "" if config.get("RatingsProviderBaseUrl", "") == BOUNDARY else config.get("RatingsProviderBaseUrl", ""))
    save_state(state)
    config["RatingsProviderBaseUrl"] = BOUNDARY
    code, _ = configure_plugin(config)
    check(code in (200, 204) and settings()["providerOverride"], "The instance points at the MDBList stand-in through the hidden XML field")
    code, body = set_fixture_key()
    check(code == 200 and body["apiKeyConfigured"] and not body["verified"], "The fixture key is saved, write-only", body)
    code, _ = call("PATCH", "/JellyfinMod/Settings/Ratings", {"apiKey": {"action": "replace", "value": KEY}, "revision": body["revision"] - 1})
    check(code == 409, "A save against a stale revision is 409")
    code, body = test_key()
    test_calls = [c for c in calls() if c["id"] == 278]
    check(code == 200 and body["ok"] and "tomatoes_audience" in body["sources"] and len(test_calls) == 1 and test_calls[0]["keyOk"] and settings()["verified"],
          "Test makes one call for the fixed title with the key and marks it verified", body)


def identities():
    """Distinct title identities with a TMDB id, read from the plugin database (read-only)."""
    out = remote(f"sqlite3 -readonly '{DB}' \"SELECT COUNT(*) FROM (SELECT DISTINCT MediaType, TmdbId FROM Entries WHERE TmdbId > 0)\"")
    return int(out.stdout.strip())


def step_reset():
    """Removes every stored rating, attempt and ratings setting with the service stopped (there is no API for it), and the
    stand-in address from the configuration."""
    status_code, config = call("GET", f"/Plugins/{PLUGIN_ID}/Configuration")
    if config.get("RatingsProviderBaseUrl"):
        config["RatingsProviderBaseUrl"] = load_state().get("overrideBefore", "")
        call("POST", f"/Plugins/{PLUGIN_ID}/Configuration", config)
    # Decided inside the stopped-service step, so no save can come in between: with any key configured nothing is deleted.
    out = with_service_stopped("CREATE TEMP TABLE keyless AS SELECT NOT EXISTS (SELECT 1 FROM RatingsSettings WHERE ApiKeyRef IS NOT NULL) AS ok; "
                               "DELETE FROM TitleRatings WHERE (SELECT ok FROM keyless); DELETE FROM RatingsFetches WHERE (SELECT ok FROM keyless); "
                               "DELETE FROM RatingsProviderStates WHERE (SELECT ok FROM keyless); DELETE FROM RatingsSettings WHERE (SELECT ok FROM keyless); "
                               "SELECT (SELECT COUNT(*) FROM TitleRatings) + (SELECT COUNT(*) FROM RatingsFetches) + (SELECT COUNT(*) FROM RatingsSettings);")
    check(out.returncode == 0 and out.stdout.strip().endswith("0"), "Every stored rating, attempt and ratings setting is removed (service stopped, then started)",
          out.stdout.strip())


def step_fetch():
    state = load_state()
    boundary("POST", "/reset")
    st = rstatus()
    total = identities()
    entry_count = st["entries"]
    started = time.time()
    task(timeout=900)
    log = calls()
    ids = [c["id"] for c in log]
    st = rstatus()
    pairs = {(c["kind"], c["id"]) for c in log}
    check(len(log) == total and len(pairs) == total and all(c["keyOk"] for c in log),
          f"The first run calls MDBList once per title identity ({total} titles, {entry_count} entries), each with the key",
          {"calls": len(log), "distinct": len(pairs), "seconds": round(time.time() - started)})
    check(ids[:2] == [990902, 990901], "Never-fetched titles go newest first (the two disposable titles were added last)", ids[:4])
    check(st["lastRun"]["fetched"] == total and st["lastRun"]["failed"] == 0 and st["entriesWithoutRatings"] == 0 and st["budget"]["used"] == total + 1,
          "Status: every title fetched, none failed, the budget counts the run and the Test", st)
    host = by_source(call("GET", f"/JellyfinMod/Ratings/Items/{state['hostItem']}")[1]["ratings"])
    check([s for s in host] == ["imdb", "tomatoes_critic", "tomatoes_audience", "tmdb", "trakt", "metacritic", "metacritic_user", "letterboxd", "rogerebert"] and
          all(r["provider"] == "mdblist" for r in host.values()) and host["imdb"]["value"] == 8.1 and host["imdb"]["votes"] == 250000 and
          host["tomatoes_critic"]["value"] == 91 and host["tmdb"]["scale"] == "percent" and host["rogerebert"]["scale"] == "four",
          "Configured: MDBList's values replace the host fallback, one per source, each in its own scale", host)
    fileless = by_source(call("GET", f"/JellyfinMod/Entries/{state['fileless']}")[1]["ratings"])
    check(fileless["tmdb"]["provider"] == "tmdb" and fileless["imdb"]["provider"] == "mdblist", "TMDB stays first-party on a title with its own TMDB snapshot",
          {k: v["provider"] for k, v in fileless.items()})
    viewer = state["viewerToken"]
    code, detail = call("GET", f"/JellyfinMod/Entries/{state['fileless']}", token=viewer)
    check(code == 200 and len(detail["ratings"]) == 9 and "blocker" not in json.dumps(detail), "An ordinary user reads the ratings of a title they can see, and no provider state")
    before = len(calls())
    task()
    check(len(calls()) == before, "A second run inside the refresh window calls nothing")
    code, browse = call("POST", "/JellyfinMod/Browse", {"mediaType": "movie", "targetLibraryId": state["libraryId"]})
    plain = all("rating" not in row for row in browse["items"])
    code, browse = call("POST", "/JellyfinMod/Browse", {"mediaType": "movie", "targetLibraryId": state["libraryId"], "ratingSource": "imdb"})
    check(plain and len(browse["items"]) == 2 and all(row["rating"]["source"] == "imdb" and row["rating"]["value"] == 8.1 for row in browse["items"]),
          "Browse rows carry no rating unless asked; with ratingSource each carries that one source")


def step_restart():
    state = load_state()
    out = remote(f"cd ~ && docker compose -f '{COMPOSE}' restart jellyfinmod-test")
    check(out.returncode == 0, "The isolated service restarts")
    wait_for(lambda: call("GET", "/System/Info/Public", token="")[0] == 200, "the restart", 300)
    wait_for(lambda: call("GET", "/JellyfinMod/Health")[0] == 200, "Health after the restart", 300)
    s = settings()
    host = call("GET", f"/JellyfinMod/Ratings/Items/{state['hostItem']}")[1]["ratings"]
    check(s["apiKeyConfigured"] and s["verified"] and s["providerOverride"] and len(host) == 9, "Settings, the key and the ratings survive a restart")


def refresh(entry):
    expect_own()
    return call("POST", f"/JellyfinMod/Entries/{entry}/Ratings/Refresh")


def calls_for(tmdb):
    return len([c for c in calls() if c["id"] == tmdb])


def step_failures():
    state = load_state()
    host_entry = state["entries"]["990901"]
    # Budget: spent means no run and no manual refresh.
    used = rstatus()["budget"]["used"]
    write({"dailyBudget": used})
    code, body = refresh(host_entry)
    before = len(calls())
    task()
    check(code == 409 and body["type"] == "budget_spent" and len(calls()) == before and rstatus()["lastRun"]["stopReason"] == "budget_spent",
          "A spent budget stops the task and refuses a manual refresh (409 budget_spent)", body)
    write({"dailyBudget": 500})
    # Manual refresh: queued, fetched once.
    before = calls_for(990901)
    code, body = refresh(host_entry)
    wait_for(lambda: calls_for(990901) == before + 1, "the queued refresh")
    check(code == 202 and body["queued"], "A manual refresh is accepted (202) and fetches that title once")
    fetched_at = by_source(call("GET", f"/JellyfinMod/Entries/{host_entry}")[1]["ratings"])["imdb"]["fetchedAt"]
    # 401: a blocker, values kept.
    boundary("POST", "/mode", {"mode": "unauthorized", "titles": {}})
    refresh(host_entry)
    wait_for(lambda: rstatus()["blocker"] == "unauthorized", "the blocker")
    code, body = refresh(host_entry)
    kept = by_source(call("GET", f"/JellyfinMod/Entries/{host_entry}")[1]["ratings"])
    check(code == 409 and body["type"] == "unauthorized" and kept["imdb"]["fetchedAt"] == fetched_at,
          "401 blocks fetching (409 unauthorized) and keeps the stored values with their date", body)
    boundary("POST", "/mode", {"mode": "full"})
    set_fixture_key()
    check(rstatus()["blocker"] is None, "Replacing the key lifts the blocker")
    boundary("POST", "/mode", {"mode": "errorkey"})
    code, body = test_key()
    check(body["code"] == "unauthorized" and rstatus()["blocker"] == "unauthorized", "A 200 that names a refused key is unauthorized too", body)
    boundary("POST", "/mode", {"mode": "full"})
    code, body = test_key()
    check(body["ok"] and rstatus()["blocker"] is None, "A passing Test lifts it")
    # 429: a breaker to the end of the UTC day, closed by a new key.
    boundary("POST", "/mode", {"mode": "ratelimited"})
    refresh(host_entry)
    wait_for(lambda: rstatus()["breaker"]["open"], "the rate-limit breaker")
    st = rstatus()
    code, body = refresh(host_entry)
    check(st["breaker"]["reason"] == "rate_limited" and st["breaker"]["until"][:10] > st["budget"]["day"][:10] and code == 409 and body["type"] == "breaker_open",
          "429 opens the breaker until the next UTC day at least; a manual refresh is 409 breaker_open", st["breaker"])
    boundary("POST", "/mode", {"mode": "full"})
    set_fixture_key()
    check(not rstatus()["breaker"]["open"], "A new key closes a rate-limit breaker (the quota is the key's)")
    # Malformed, slow and unknown answers: recorded, nothing changed.
    second = state["entries"]["990902"]
    for mode, title in (("malformed", 990902), ("notfound", 990902)):
        boundary("POST", "/mode", {"mode": "full", "titles": {str(title): mode}})
        before = calls_for(title)
        refresh(second)
        wait_for(lambda: calls_for(title) == before + 1, f"the {mode} refresh")
        time.sleep(2)
        st = rstatus()
        check(len(call("GET", f"/JellyfinMod/Entries/{second}")[1]["ratings"]) == 9 and (st["breaker"]["consecutiveFailures"] == (1 if mode == "malformed" else 0)),
              f"A {mode} answer changes no stored value" + (" and counts as a failure" if mode == "malformed" else " and is not a provider failure"), st["breaker"])
    boundary("POST", "/mode", {"mode": "full", "titles": {"990902": "slow"}})
    before = calls_for(990902)
    refresh(second)
    wait_for(lambda: calls_for(990902) == before + 1, "the slow call")
    wait_for(lambda: rstatus()["breaker"]["consecutiveFailures"] == 1, "the timeout", 60)
    check(True, "A provider slower than 15 s times out and counts as a failure")
    # Five server errors in a row: a one-hour breaker.
    boundary("POST", "/mode", {"mode": "fail", "titles": {}})
    for _ in range(5):
        before = len(calls())
        if refresh(host_entry)[0] != 202:
            break
        wait_for(lambda: len(calls()) == before + 1, "a failing refresh")
        time.sleep(1)
    st = wait_for(lambda: rstatus() if rstatus()["breaker"]["open"] else None, "the failure breaker", 60)
    check(st["breaker"]["reason"] == "failures" and refresh(host_entry)[1]["type"] == "breaker_open", "Five server errors in a row open the one-hour breaker", st["breaker"])
    boundary("POST", "/mode", {"mode": "full", "titles": {}})


def step_kill():
    state = load_state()
    db = DB
    # The failure breaker from the previous step is the provider's and stays for an hour; it is cleared here directly so the
    # kill can run now (the cleanup step resets all ratings state the same way).
    out = with_service_stopped("UPDATE RatingsProviderStates SET BreakerUntil = NULL, BreakerReason = NULL, ConsecutiveFailures = 0;")
    check(out.returncode == 0, "The failure breaker is cleared with the service stopped (test harness, not product behaviour)")
    make_titles([KILL_TITLE])
    scan()
    entry = wait_for(lambda: next((e for e in entries(KILL_TITLE[1]) if e["state"] == "onDisk"), None), "the kill title's entry", 600)
    state["entries"][str(KILL_TITLE[0])] = entry["id"]
    save_state(state)
    boundary("POST", "/mode", {"mode": "full", "titles": {str(KILL_TITLE[0]): "slow"}})
    status_code, tasks = call("GET", "/ScheduledTasks")
    target = next(item for item in tasks if item["Key"] == "JellyfinModRatingsRefresh")
    expect_own()
    call("POST", f"/ScheduledTasks/Running/{target['Id']}")
    wait_for(lambda: calls_for(KILL_TITLE[0]) == 1, "the slow call is in flight", 60)
    out = remote("docker kill jellyfinmod-test >/dev/null; rc=$?; sleep 2; docker start jellyfinmod-test >/dev/null; started=$?; "
                 "if [ $rc -eq 0 ]; then rc=$started; fi; exit $rc")
    check(out.returncode == 0, "The container is killed (SIGKILL) while the call is in flight, then started")
    boundary("POST", "/mode", {"mode": "full", "titles": {}})
    wait_for(lambda: call("GET", "/JellyfinMod/Health")[0] == 200, "Health after the kill", 300)
    left = remote(f"sqlite3 '{db}' \"SELECT Outcome FROM RatingsFetches ORDER BY AttemptedAt DESC LIMIT 1\"").stdout.strip()
    check(left == "pending", "The killed call left its claim behind, committed before the call", left)
    task()
    after = calls_for(KILL_TITLE[0])
    outcome = remote(f"sqlite3 '{db}' \"SELECT Outcome FROM RatingsFetches ORDER BY AttemptedAt DESC LIMIT 1\"").stdout.strip()
    check(after == 1 and rstatus()["lastRun"]["fetched"] == 0, "After the kill the interrupted title is not fetched again that day; the next run calls nothing",
          {"calls": after, "lastRun": rstatus()["lastRun"], "latestOutcome": outcome})


def step_cleanup():
    state = load_state()
    # oleksii's ratings display choice goes back first, before anything else here can fail: each key's value, and a key that
    # did not exist is removed. The snapshot is retired once that is confirmed, so a later run never restores an old one.
    keys_before = sorted(state.get("prefsBefore") or {})
    restored = restore_prefs(state)
    check(restored is not False, "oleksii's ratings display preferences are exactly as setup found them (or were already restored)",
          {"keysBefore": keys_before, "snapshotRetired": "prefsBefore" not in load_state()})
    SECRETS.extend([state.get("token", ""), state.get("viewerToken", "")])
    if library_id():
        code, _ = call("DELETE", "/Library/VirtualFolders?" + urllib.parse.urlencode({"name": LIBRARY, "refreshLibrary": "true"}))
        check(code in (200, 204), "The disposable library is removed through DELETE /Library/VirtualFolders", code)
        # The removal starts a library refresh; the user's views follow once it has run.
        status_code, tasks = call("GET", "/ScheduledTasks")
        refresh_id = next(item["Id"] for item in tasks if item["Key"] == "RefreshLibrary")
        time.sleep(3)
        wait_for(lambda: call("GET", f"/ScheduledTasks/{refresh_id}")[1]["State"] == "Idle", "the library refresh", 900)
    out = remote(f"rm -rf -- '{HOST_MEDIA}/{FOLDER}'")
    check(out.returncode == 0, "The disposable media and NFOs are deleted")
    if state.get("viewerId"):
        code, _ = call("DELETE", f"/Users/{state['viewerId']}")
        check(code in (200, 204), "The temporary viewer is deleted", code)
    # Only this run's own settings are put back: the clear is sent against the revision this run last wrote, so if anyone else
    # has saved since (the user's own key), the plugin refuses it and the ratings settings, the key and the stored ratings stay.
    try:
        code, body = write({"apiKey": {"action": "clear"}, "enabled": True, "refreshDays": 14, "dailyBudget": 500,
                            "defaultSources": ["imdb", "tomatoes_critic", "tomatoes_audience", "tmdb", "trakt"]})
        foreign = False
        check(code == 200 and not body["apiKeyConfigured"], "The fixture key is cleared from the secret store; settings are back to the defaults")
    except ForeignKey:
        foreign = True
        check(False, "The ratings settings are not as this run left them (someone else saved, perhaps the user's own key): cleanup "
                     "leaves the ratings settings, the key and the stored ratings alone, and removes only the fixtures")
    # The stand-in address goes in any case: without it the plugin uses MDBList itself.
    status_code, config = call("GET", f"/Plugins/{PLUGIN_ID}/Configuration")
    config["RatingsProviderBaseUrl"] = state.get("overrideBefore", "")
    call("POST", f"/Plugins/{PLUGIN_ID}/Configuration", config)
    check(not settings()["providerOverride"], "The stand-in address is removed from the configuration")
    # No API deletes stored ratings (none is planned), and DELETE /JellyfinMod/Entries refuses a title whose native binding
    # outlived its library (found on 2026-10-07: the absence rules never clear it once the library is gone). The fixture
    # entries and every stand-in rating are removed with the service stopped, foreign keys on.
    ids = ", ".join(str(tmdb) for tmdb, *_ in TITLES + [KILL_TITLE])
    out = with_service_stopped(f"PRAGMA foreign_keys = ON; BEGIN; CREATE TEMP TABLE p9 AS SELECT Id FROM Entries WHERE Title LIKE 'JellyfinMod P9 Ratings%' "
                               f"AND TmdbId IN ({ids}); DELETE FROM History WHERE EntryId IN (SELECT Id FROM p9); DELETE FROM Entries WHERE Id IN (SELECT Id FROM p9); "
                               f"DELETE FROM RatingsFetches WHERE MediaType = 'movie' AND TmdbId IN ({ids}); "
                               f"COMMIT; SELECT COUNT(*) FROM Entries WHERE Title LIKE 'JellyfinMod P9%';")
    check(out.returncode == 0 and out.stdout.strip().endswith("0"), "The fixture entries are removed (service stopped, foreign keys on)", out.stdout.strip())
    if not foreign:
        step_reset()
        s = settings()
        check(s["enabled"] and not s["apiKeyConfigured"] and not s["providerOverride"] and s["revision"] == 1, "Ratings settings are fresh defaults again", s)
    state = load_state()
    state.pop("fixtureKeyRef", None)
    state.pop("lastRevision", None)
    save_state(state)
    status_code, views = call("GET", f"/Users/{state['userId']}/Views")
    names = sorted(view["Name"] for view in views["Items"])
    check(names == ["Movies", "Shows"], "GET /UserViews for oleksii lists only Movies and Shows", names)
    leftovers = [e["title"] for e in call("GET", "/JellyfinMod/Entries?query=JellyfinMod&limit=50")[1]["items"]]
    check(not leftovers, "No JellyfinMod fixture title is left in the catalog", leftovers)
    status_code, users = call("GET", "/Users")
    check(all(user["Name"] != "jfmod-p9-viewer" for user in users), "No temporary user is left")


def step_leak():
    state = load_state()
    log = remote(f"docker logs --since '{state['logSince']}' jellyfinmod-test 2>&1").stdout
    hits = log.count(KEY)
    redacted = len(re.findall(r"/tmdb/(?:movie|show)/\d+\?\*", log))
    # The host's request loggers write under the category System.Net.Http.HttpClient.<name>.LogicalHandler/ClientHandler; a
    # stack frame of another plugin's failed call (System.Net.Http.HttpClient.SendAsync) is not a request log line.
    client_lines = len(re.findall(r"System\.Net\.Http\.HttpClient\.[\w.-]+\.(?:LogicalHandler|ClientHandler)", log))
    outbound = sorted(set(re.findall(r"HTTP request (?:GET|POST) https?://([a-z0-9.-]+\.[a-z]{2,})/", log)))
    check(hits == 0, "The container log since the run started never contains the fixture key", {"lines": log.count("\n")})
    check(redacted > 0 or client_lines == 0,
          "The host's HTTP client request logs are redacted (?*) where it writes them; at this host's log level it writes none, "
          "and the plugin itself never logs a request address", {"redactedLines": redacted, "httpClientLines": client_lines})
    fixture_providers = sorted(set(re.findall(r"Running (\w+) for [^\n]*jfmod-p9-ratings", log)))
    check(not any(name for name in fixture_providers if "Tmdb" in name or "Omdb" in name or "TheMovieDb" in name),
          "The disposable titles were only ever read by local providers (NFO, probe): no TMDb or OMDb provider ran for them",
          {"providers": fixture_providers, "outboundHostsLogged": outbound})
    check(all(KEY not in body for body in bodies), f"None of the {len(bodies)} JellyfinMod responses in this step carries the key")


if __name__ == "__main__":
    # TERM and HUP end this process through SystemExit, so every finally (the service restart above) still runs.
    for number in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, lambda signum, frame: sys.exit(128 + signum))
    step = sys.argv[1]
    if step != "setup" and not load_state().get("token"):
        sign_in()
    try:
        if step not in ("setup", "cleanup"):
            expect_own()
        {"guard": lambda: check(True, "The ratings settings are as this run last left them (same revision, same key)"), "setup": step_setup, "unconfigured": step_unconfigured, "configure": step_configure, "fetch": step_fetch, "restart": step_restart,
         "failures": step_failures, "kill": step_kill, "age": step_age, "unage": step_unage, "interrupt": step_interrupt, "cleanup": step_cleanup, "leak": step_leak, "reset": step_reset}[step]()
    except ForeignKey:
        check(False, "STOPPED: the ratings settings are not as this run last left them (someone else saved; perhaps the user's own key). "
                     "Nothing replaced, cleared, tested or refreshed with it. Report this; do not continue the run")
    except RecoveryFailed as failure:
        check(False, "STOPPED: a stopped-service step could not be shown to have ended, so the service was left as it was. Look at the "
                     "test host before anything else", str(failure))
    except Exception as error:  # a crashed step still records what it checked, and says why it stopped
        check(False, f"The step ran to the end ({type(error).__name__})", scrub(error)[:300])
    if bodies:
        check(all(KEY not in body for body in bodies), f"None of the {len(bodies)} JellyfinMod responses in this step carries the fixture key")
    if OUT:
        existing = json.load(open(OUT)) if os.path.exists(OUT) else {"runs": []}
        existing["runs"].append({"step": step, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": results})
        open(OUT, "w").write(json.dumps(existing, indent=1) + "\n")
    failed = [r for r in results if r["verdict"] != "PASS"]
    print(f"{step}: {len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)
