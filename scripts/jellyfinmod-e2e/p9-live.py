#!/usr/bin/env python3
"""Phase 9 (R8) live acceptance on the isolated instance: ratings through the real host, against the MDBList stand-in.

Runs in steps so the browser runner (p9-ratings.mjs) can sit between them:

  p9-live.py setup        disposable library + NFO titles (locked: no metadata provider is ever asked), a temporary viewer
  p9-live.py unconfigured host fallback and TMDB-only answers, a run that calls nothing, refusals, fetcher order
  p9-live.py configure    the stand-in address (hidden XML field), the fixture key, Test
  p9-live.py fetch        the daily task through Jellyfin's task manager: one call per title, newest first, projection, access
  p9-live.py restart      a restart keeps settings, key and ratings
  p9-live.py failures     budget, manual refresh, 401, key error, 429, malformed, timeout, not found, five 503s
  p9-live.py kill         a container killed mid-call: its claim is counted, the title is not fetched again
  p9-live.py cleanup      every fixture, the key, the override and the ratings rows go; UserViews shows Movies and Shows only

Settings (environment, never committed): JFMOD_P9_URL (the isolated instance, port 18096 only), JFMOD_P9_SSH (ssh alias of
the host), JFMOD_P9_KEY_FILE (local 0600 file with the stand-in's fixture key), JFMOD_P9_BOUNDARY (the stand-in's address as
the container reaches it), JFMOD_P9_HOST_MEDIA (the host folder mounted at JFMOD_P9_CONTAINER_MEDIA), JFMOD_P9_COMPOSE (the
isolated service's compose file on the host), JFMOD_P9_DB (the plugin database on the host), JFMOD_P9_OUT (results JSON).
Signs in as oleksii with an empty password. Never prints the key, a token, a password, an address or a host path.
"""
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ["JFMOD_P9_URL"].rstrip("/")
if urllib.parse.urlparse(BASE).port != 18096:
    sys.exit("Runs only against the isolated instance (port 18096)")
SSH = os.environ["JFMOD_P9_SSH"]
KEY = open(os.environ["JFMOD_P9_KEY_FILE"]).read().strip()
BOUNDARY = os.environ.get("JFMOD_P9_BOUNDARY", "")
HOST_MEDIA = os.environ.get("JFMOD_P9_HOST_MEDIA", "")
CONTAINER_MEDIA = os.environ.get("JFMOD_P9_CONTAINER_MEDIA", "/test-media")
COMPOSE = os.environ.get("JFMOD_P9_COMPOSE", "")
DB = os.environ.get("JFMOD_P9_DB", "")
OUT = os.environ.get("JFMOD_P9_OUT")
STATE_FILE = os.environ.get("JFMOD_P9_STATE", os.path.join(os.path.dirname(os.environ["JFMOD_P9_KEY_FILE"]), "p9-live-state.json"))
PLUGIN_ID = "6f1a2b3c4d5e4f609a718b2c3d4e5f60"
LIBRARY = "JellyfinMod P9 Ratings"
FOLDER = "jfmod-p9-ratings"
AUTH = 'MediaBrowser Client="jfmod-p9-live", Device="cli", DeviceId="jfmod-p9-live", Version="1"'
TITLES = [(990901, "JellyfinMod P9 Ratings Host", "7.4", "87"), (990902, "JellyfinMod P9 Ratings Second", "6.2", None)]
KILL_TITLE = (990903, "JellyfinMod P9 Ratings Kill", "5.5", None)
SECRETS = [KEY]
results = []


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


def remote(script, *args):
    return subprocess.run(["ssh", SSH, "bash", "-s", "--", *args], input=script, text=True, capture_output=True, timeout=600)


def boundary(method, path, body=None):
    """The stand-in's control port, which listens on the host's loopback only."""
    data = json.dumps(body) if body is not None else ""
    out = subprocess.run(["ssh", SSH, "curl", "-s", "-X", method, "-H", "'Content-Type: application/json'", "--data-binary", "@-",
                          f"http://127.0.0.1:18121{path}"], input=data, text=True, capture_output=True, timeout=60).stdout
    return json.loads(out) if out else None


def calls():
    return boundary("GET", "/state")["calls"]


def task(key="JellyfinModRatingsRefresh", timeout=300):
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


def patch(body):
    body = {"revision": settings()["revision"], **body}
    return call("PATCH", "/JellyfinMod/Settings/Ratings", body)


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


def step_setup():
    sign_in()
    state = load_state()
    status, health = call("GET", "/JellyfinMod/Health")
    check(all(name in health["Capabilities"] for name in ("ratings", "ratings.cards", "settings.ratings")), "Health lists the ratings capabilities",
          {"version": health["Version"], "bundle": health["Web"]["BundleId"]})
    boundary("POST", "/reset")
    boundary("POST", "/mode", {"mode": "full", "titles": {}})
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
    code, body = call("POST", f"/JellyfinMod/Entries/{state['entries']['990901']}/Ratings/Refresh")
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
    code, _ = call("POST", f"/Plugins/{PLUGIN_ID}/Configuration", config)
    check(code in (200, 204) and settings()["providerOverride"], "The instance points at the MDBList stand-in through the hidden XML field")
    code, body = patch({"apiKey": {"action": "replace", "value": KEY}})
    check(code == 200 and body["apiKeyConfigured"] and not body["verified"], "The fixture key is saved, write-only", body)
    code, _ = patch({"apiKey": {"action": "replace", "value": KEY}, "revision": body["revision"] - 1})
    check(code == 409, "A save against a stale revision is 409")
    code, body = call("POST", "/JellyfinMod/Settings/Ratings/Test")
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
    out = remote(f"cd ~ && docker compose -f '{COMPOSE}' stop jellyfinmod-test >/dev/null && "
                 f"sqlite3 '{DB}' \"DELETE FROM TitleRatings; DELETE FROM RatingsFetches; DELETE FROM RatingsProviderStates; DELETE FROM RatingsSettings;\" && "
                 f"sqlite3 '{DB}' \"SELECT (SELECT COUNT(*) FROM TitleRatings) + (SELECT COUNT(*) FROM RatingsFetches) + (SELECT COUNT(*) FROM RatingsSettings)\" && "
                 f"docker compose -f '{COMPOSE}' start jellyfinmod-test >/dev/null")
    check(out.returncode == 0 and out.stdout.strip().endswith("0"), "Every stored rating, attempt and ratings setting is removed (service stopped, then started)",
          out.stdout.strip())
    wait_for(lambda: call("GET", "/System/Info/Public", token="")[0] == 200, "the start", 300)
    wait_for(lambda: call("GET", "/JellyfinMod/Health")[0] == 200, "Health", 300)


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
    return call("POST", f"/JellyfinMod/Entries/{entry}/Ratings/Refresh")


def calls_for(tmdb):
    return len([c for c in calls() if c["id"] == tmdb])


def step_failures():
    state = load_state()
    host_entry = state["entries"]["990901"]
    # Budget: spent means no run and no manual refresh.
    used = rstatus()["budget"]["used"]
    patch({"dailyBudget": used})
    code, body = refresh(host_entry)
    before = len(calls())
    task()
    check(code == 409 and body["type"] == "budget_spent" and len(calls()) == before and rstatus()["lastRun"]["stopReason"] == "budget_spent",
          "A spent budget stops the task and refuses a manual refresh (409 budget_spent)", body)
    patch({"dailyBudget": 500})
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
    patch({"apiKey": {"action": "replace", "value": KEY}})
    check(rstatus()["blocker"] is None, "Replacing the key lifts the blocker")
    boundary("POST", "/mode", {"mode": "errorkey"})
    code, body = call("POST", "/JellyfinMod/Settings/Ratings/Test")
    check(body["code"] == "unauthorized" and rstatus()["blocker"] == "unauthorized", "A 200 that names a refused key is unauthorized too", body)
    boundary("POST", "/mode", {"mode": "full"})
    code, body = call("POST", "/JellyfinMod/Settings/Ratings/Test")
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
    patch({"apiKey": {"action": "replace", "value": KEY}})
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
    out = remote(f"cd ~ && docker compose -f '{COMPOSE}' stop jellyfinmod-test >/dev/null && "
                 f"sqlite3 '{db}' \"UPDATE RatingsProviderStates SET BreakerUntil = NULL, BreakerReason = NULL, ConsecutiveFailures = 0\" && "
                 f"docker compose -f '{COMPOSE}' start jellyfinmod-test >/dev/null")
    check(out.returncode == 0, "The failure breaker is cleared with the service stopped (test harness, not product behaviour)")
    wait_for(lambda: call("GET", "/JellyfinMod/Health")[0] == 200, "Health", 300)
    make_titles([KILL_TITLE])
    scan()
    entry = wait_for(lambda: next((e for e in entries(KILL_TITLE[1]) if e["state"] == "onDisk"), None), "the kill title's entry", 600)
    state["entries"][str(KILL_TITLE[0])] = entry["id"]
    save_state(state)
    boundary("POST", "/mode", {"mode": "full", "titles": {str(KILL_TITLE[0]): "slow"}})
    status_code, tasks = call("GET", "/ScheduledTasks")
    target = next(item for item in tasks if item["Key"] == "JellyfinModRatingsRefresh")
    call("POST", f"/ScheduledTasks/Running/{target['Id']}")
    wait_for(lambda: calls_for(KILL_TITLE[0]) == 1, "the slow call is in flight", 60)
    out = remote("docker kill jellyfinmod-test >/dev/null && sleep 2 && docker start jellyfinmod-test >/dev/null")
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
    code, body = patch({"apiKey": {"action": "clear"}, "enabled": True, "refreshDays": 14, "dailyBudget": 500,
                        "defaultSources": ["imdb", "tomatoes_critic", "tomatoes_audience", "tmdb", "trakt"]})
    check(code == 200 and not body["apiKeyConfigured"], "The fixture key is cleared from the secret store; settings are back to the defaults")
    status_code, config = call("GET", f"/Plugins/{PLUGIN_ID}/Configuration")
    config["RatingsProviderBaseUrl"] = state.get("overrideBefore", "")
    call("POST", f"/Plugins/{PLUGIN_ID}/Configuration", config)
    check(not settings()["providerOverride"], "The stand-in address is removed from the configuration")
    # No API deletes stored ratings (none is planned), and DELETE /JellyfinMod/Entries refuses a title whose native binding
    # outlived its library (found on 2026-10-07: the absence rules never clear it once the library is gone). The fixture
    # entries and every stand-in rating are removed with the service stopped, foreign keys on.
    ids = ", ".join(str(tmdb) for tmdb, *_ in TITLES + [KILL_TITLE])
    out = remote(f"cd ~ && docker compose -f '{COMPOSE}' stop jellyfinmod-test >/dev/null && sqlite3 '{DB}' \""
                 f"PRAGMA foreign_keys = ON; BEGIN; CREATE TEMP TABLE p9 AS SELECT Id FROM Entries WHERE Title LIKE 'JellyfinMod P9 Ratings%' "
                 f"AND TmdbId IN ({ids}); DELETE FROM History WHERE EntryId IN (SELECT Id FROM p9); DELETE FROM Entries WHERE Id IN (SELECT Id FROM p9); "
                 f"COMMIT; SELECT COUNT(*) FROM Entries WHERE Title LIKE 'JellyfinMod P9%';\" && "
                 f"docker compose -f '{COMPOSE}' start jellyfinmod-test >/dev/null")
    check(out.returncode == 0 and out.stdout.strip().endswith("0"), "The fixture entries are removed (service stopped, foreign keys on)", out.stdout.strip())
    wait_for(lambda: call("GET", "/JellyfinMod/Health")[0] == 200, "Health", 300)
    step_reset()
    s = settings()
    check(s["enabled"] and not s["apiKeyConfigured"] and not s["providerOverride"] and s["revision"] == 1, "Ratings settings are fresh defaults again", s)
    # The browser run left oleksii's choice at the defaults; the two keys themselves go too.
    path = f"/DisplayPreferences/usersettings?userId={state['userId']}&client=emby"
    status_code, prefs = call("GET", path)
    custom = prefs.get("CustomPrefs") or {}
    removed = [key for key in ("jfmodRatingsSources", "jfmodRatingsCardSource") if custom.pop(key, None) is not None]
    if removed:
        call("POST", path, prefs)
    status_code, prefs = call("GET", path)
    check(not any(key.startswith("jfmodRatings") for key in (prefs.get("CustomPrefs") or {})), "oleksii's display preferences hold no ratings keys", removed)
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
    client_lines = log.count("System.Net.Http.HttpClient")
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
    step = sys.argv[1]
    if step != "setup" and not load_state().get("token"):
        sign_in()
    try:
        {"setup": step_setup, "unconfigured": step_unconfigured, "configure": step_configure, "fetch": step_fetch, "restart": step_restart,
         "failures": step_failures, "kill": step_kill, "cleanup": step_cleanup, "leak": step_leak, "reset": step_reset}[step]()
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
