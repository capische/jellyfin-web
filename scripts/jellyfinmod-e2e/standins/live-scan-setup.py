#!/usr/bin/env python3
"""Prepares the scan-wait live E2E (live-scan.py) on the live instance. Runs on the test host from
<state root>/standins/bin:
  - keeps a copy of the stand-in catalog (<state root>/catalog.before-scan.json; refuses when one is already there),
  - adds the scan titles to the stand-in catalog (runtime 1 minute),
  - stages a 12 s legal fixture per release on the private feed (live-stage.sh),
  - adds the catalog entries (movies to Movies, series to Shows),
  - writes <state root>/standins/state/scan-ids.json, which live-scan-all.sh reads.
Undo with live-scan-teardown.sh."""
import importlib.util, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("a8", os.path.join(HERE, "live-a8.py"))
a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)

MOVIES = [(700020, "JellyfinMod Scan Plain"), (700021, "JellyfinMod Scan Delay"), (700022, "JellyfinMod Scan Restart"),
          (700023, "JellyfinMod Scan Cancel")]
SERIES = [(800005, "JellyfinMod Scan Pair", 4), (800002, "JellyfinMod Scan Stream", 12),
          (800003, "JellyfinMod Scan Sibling One", 1), (800004, "JellyfinMod Scan Sibling Two", 1)]


def dotted(title):
    return title.replace(" ", ".")


catalog_file = os.path.join(ROOT, "catalog.json")
backup = os.path.join(ROOT, "catalog.before-scan.json")
if os.path.exists(backup):
    raise SystemExit("refusing: catalog.before-scan.json exists (run live-scan-teardown.sh first)")
catalog = json.load(open(catalog_file))
json.dump(catalog, open(backup, "w"), indent=1)
have = {item["id"] for item in catalog["movies"]} | {item["id"] for item in catalog["series"]}
for tmdb, title in MOVIES:
    if tmdb not in have:
        catalog["movies"].append({"id": tmdb, "title": title, "release_date": "2025-09-01", "imdb_id": f"tt9{tmdb}", "runtime": 1})
for tmdb, name, count in SERIES:
    if tmdb not in have:
        catalog["series"].append({"id": tmdb, "name": name, "first_air_date": "2026-01-01", "imdb_id": f"tt9{tmdb}", "seasons": [
            {"season_number": 1, "episodes": [{"id": tmdb * 100 + 10 + number, "episode_number": number, "name": f"Part {number}",
                                               "air_date": f"2026-01-{number:02d}"} for number in range(1, count + 1)]}]})
json.dump(catalog, open(catalog_file, "w"), indent=1)

releases = [(f"fx-scan-m{tmdb}", f"{dotted(title)}.2025.1080p.WEB-DL.H264-JFMOD", tmdb, 2040) for tmdb, title in MOVIES]
releases += [(f"fx-scan-s{tmdb}-e{number:02d}", f"{dotted(name)}.S01E{number:02d}.1080p.WEB-DL.H264-JFMOD", tmdb, 5040)
             for tmdb, name, count in SERIES for number in range(1, count + 1)]
for name, title, tmdb, category in releases:
    result = subprocess.run([os.path.join(HERE, "live-stage.sh"), name, title + ".mkv", title, str(tmdb), str(category)],
                            env=dict(os.environ, FIXTURE_SECONDS="12"), capture_output=True, text=True)
    fields = result.stdout.split()
    if result.returncode != 0 or len(fields) < 3 or fields[2] == "None":
        raise SystemExit(f"staging {name} failed: {result.stdout[-200:]} {result.stderr[-200:]}")
print("staged", len(releases), "fixtures")

folders = {folder["Name"]: folder["ItemId"] for folder in a8.call("GET", "/Library/VirtualFolders")[1]}
ids = {}
for tmdb, _ in MOVIES:
    status, body = a8.call("POST", "/JellyfinMod/Entries", {"mediaType": "movie", "tmdbId": tmdb, "targetLibraryId": folders["Movies"]})
    entry = (body or {}).get("entry") or body or {}
    if status != 200 or not entry.get("id"):
        raise SystemExit(f"adding movie {tmdb} failed: {status}")
    ids[str(tmdb)] = entry["id"]
for tmdb, _, count in SERIES:
    status, body = a8.call("POST", "/JellyfinMod/Entries", {"mediaType": "series", "tmdbId": tmdb, "targetLibraryId": folders["Shows"]})
    entry = (body or {}).get("entry") or body or {}
    if status != 200 or not entry.get("id"):
        raise SystemExit(f"adding series {tmdb} failed: {status}")
    ids[str(tmdb)] = entry["id"]
    episodes = a8.call("GET", f"/JellyfinMod/Entries/{entry['id']}")[1]["episodes"]
    ids[f"{tmdb}-episodes"] = {f"E{item['episodeNumber']:02d}": item["id"] for item in episodes}
    if len(ids[f"{tmdb}-episodes"]) != count:
        raise SystemExit(f"series {tmdb} has {len(ids[f'{tmdb}-episodes'])} episodes, expected {count}")
os.makedirs(os.path.join(ROOT, "standins", "state"), exist_ok=True)
json.dump(ids, open(os.path.join(ROOT, "standins", "state", "scan-ids.json"), "w"), indent=1)
print("added", len(MOVIES), "movies and", len(SERIES), "series; ids in standins/state/scan-ids.json")
