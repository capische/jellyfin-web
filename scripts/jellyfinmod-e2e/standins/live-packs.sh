#!/usr/bin/env bash
# The legal season-pack fixture of the live acceptance (design/season-packs-design.md, "Legal pack fixture"): the series
# "JellyfinMod Pack Fixture" (two seasons of three episodes) in the TMDB stand-in's catalog, and four web-seeded releases on
# the private Torznab feed: a Season 1 pack (three episodes, a sample and an extra), a Season 2 pack, a complete pack (both
# seasons in "Season 01" / "Season 02" folders) and a single S01E01. Episodes are 45 s clips of Night of the Living Dead
# (1968, public domain), re-encoded with the image's own ffmpeg; every release is its own encode, so no two files share a
# fingerprint. Runs on the test host from <state root>/standins/bin, with the stand-ins running (control on loopback).
#
#   live-packs.sh catalog   adds the series to catalog.json (idempotent; the stand-in re-reads it on every request)
#   live-packs.sh build     encodes the clips (skips existing ones) and publishes the four releases (re-publishing is safe)
#   live-packs.sh status    the releases, their info hashes and the fixture's torrents in the separate Transmission
#   live-packs.sh reset     between checklist items: the fixture's torrents out of the client (with their data, which is
#                           this instance's own download folder), the series folder out of the library, a library scan, and
#                           proof through the API that no fixture episode still has a file (exit 1 otherwise; needs a
#                           signed-in live-jf.py)
#   live-packs.sh withdraw  takes the four releases off the feed (catalog and files stay)
#
# Settings (environment; host paths stay out of the repository): PACK_SOURCE (build: the public-domain source video, read
# only), JFMOD_LIVE_SHARED (reset: the instance's shared media and downloads folder), PACK_SECONDS (default 45).
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)          # <state root>/standins/bin
ROOT=$(cd -- "$HERE/../.." && pwd)                                 # <state root>
CONTROL=http://127.0.0.1:48119
TX=http://127.0.0.1:29091/transmission/rpc
IMAGE=jellyfinmod-live:current
SOURCE=${PACK_SOURCE:-}
SHARED=${JFMOD_LIVE_SHARED:-}
SECONDS_EACH=${PACK_SECONDS:-45}
SERIES_TMDB=800010 SERIES_TVDB=9800010 SERIES_NAME="JellyfinMod Pack Fixture"
STAGE=$ROOT/staging/fx-pack
grep -q 'container_name: jellyfinmod-live$' "$ROOT/compose.yml" 2>/dev/null || { echo "live-packs: $ROOT is not the live instance's state root" >&2; exit 2; }

# Episode -> start offset in the film (s); the same scene in every release, a different encode per release.
declare -A START=([s01e01]=120 [s01e02]=900 [s01e03]=1800 [s02e01]=2700 [s02e02]=3600 [s02e03]=4500)
EPISODES=(s01e01 s01e02 s01e03 s02e01 s02e02 s02e03)

encode() { # encode <out file> <start> <seconds> <width> <height> <video kbit/s>
    [ -s "$1" ] && return 0
    docker run --rm --user 1000:1000 --entrypoint /usr/lib/jellyfin-ffmpeg/ffmpeg -v "$(dirname "$SOURCE"):/in:ro" -v "$STAGE:/out" \
        "$IMAGE" -v error -y -ss "$2" -t "$3" -i "/in/$(basename "$SOURCE")" -map 0:v:0 -map 0:a:0 \
        -vf "scale=$4:$5:force_original_aspect_ratio=decrease,pad=$4:$5:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset veryfast \
        -b:v "$6k" -maxrate "$6k" -bufsize "$(( $6 * 2 ))k" -pix_fmt yuv420p -c:a aac -b:a 64k -ac 2 "/out/$(basename "$1")"
    echo "encoded $(basename "$1") $(stat -c %s "$1") bytes"
}

catalog() {
    python3 - "$ROOT/catalog.json" "$SERIES_TMDB" "$SERIES_TVDB" "$SERIES_NAME" <<'PY'
import json, sys
path, tmdb, tvdb, name = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
data = json.load(open(path))
data["series"] = [s for s in data.get("series", []) if s["id"] != tmdb]
names = {1: ["The Cemetery", "The Farmhouse", "Boarded Windows"], 2: ["The Radio", "The Truck", "Dawn"]}
dates = {1: ["2025-01-06", "2025-01-13", "2025-01-20"], 2: ["2025-09-01", "2025-09-08", "2025-09-15"]}
data["series"].append({
    "id": tmdb, "name": name, "first_air_date": "2025-01-06", "imdb_id": "tt9800010", "tvdb_id": tvdb, "episode_run_time": 1,
    "seasons": [{"season_number": n, "episodes": [
        {"id": tmdb * 100 + n * 10 + e, "episode_number": e, "name": names[n][e - 1], "air_date": dates[n][e - 1], "runtime": 1}
        for e in (1, 2, 3)]} for n in (1, 2)]})
json.dump(data, open(path, "w"), indent=1)
print("catalog: series", tmdb, name, "tvdb", tvdb, "episodes", sum(len(s["episodes"]) for s in data["series"][-1]["seasons"]))
PY
}

publish() { # publish <id> <title> <seasons json> <episode or null> <files json: [[path in torrent, staged file], ...]>
    local id=$1 title=$2 seasons=$3 episode=$4 files=$5 seed=$ROOT/webseed/$1
    rm -rf "$seed"; mkdir -p "$seed"
    python3 - "$id" "$title" "$seasons" "$episode" "$files" "$seed" "$SERIES_TVDB" <<'PY' | curl -s -X POST "$CONTROL/release" --data-binary @- \
        | python3 -c 'import sys,json; d=json.load(sys.stdin); print("published", d.get("id"), d.get("infoHash"), d.get("size"), d.get("error",""))'
import json, os, sys
rid, title, seasons, episode, files, seed, tvdb = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), json.loads(sys.argv[4]), json.loads(sys.argv[5]), sys.argv[6], int(sys.argv[7])
single = len(files) == 1 and files[0][0] is None
torrent = title + (".mkv" if single else "")
for path, staged in files:
    target = os.path.join(seed, torrent, path) if path else os.path.join(seed, torrent)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    os.link(staged, target)   # the web seed serves <id>/<torrent name>[/<path>]
spec = {"id": rid, "indexerId": 1, "title": title, "torrentName": torrent, "tvdbid": tvdb, "seasons": seasons, "episode": episode,
        "seeders": 30, "category": 5040, "webseed": True}
if single: spec["file"] = files[0][1]
else: spec["files"] = [{"path": path, "file": staged} for path, staged in files]
print(json.dumps(spec))
PY
}

build() {
    [ -n "$SOURCE" ] && [ -r "$SOURCE" ] || { echo "live-packs: PACK_SOURCE must name a readable public-domain video" >&2; exit 2; }
    mkdir -p "$STAGE"
    for ep in "${EPISODES[@]}"; do
        encode "$STAGE/$ep-720p-season.mkv" "${START[$ep]}" "$SECONDS_EACH" 1280 720 1000
        encode "$STAGE/$ep-720p-complete.mkv" "${START[$ep]}" "$SECONDS_EACH" 1280 720 1150
    done
    encode "$STAGE/s01e01-1080p-single.mkv" "${START[s01e01]}" "$SECONDS_EACH" 1920 1080 1800
    encode "$STAGE/s01-sample.mkv" 140 8 1280 720 800
    encode "$STAGE/s01-extra.mkv" 5200 20 1280 720 900
    local base=JellyfinMod.Pack.Fixture
    local s1=$base.S01.720p.WEB.H264-JFMOD s2=$base.S02.720p.WEB.H264-JFMOD all=$base.S01-S02.Complete.720p.WEB.H264-JFMOD
    publish fx-pack-s01 "$s1" '[1]' null "$(printf '[["%s","%s"],["%s","%s"],["%s","%s"],["%s","%s"],["%s","%s"]]' \
        "$base.S01E01.720p.WEB.H264-JFMOD.mkv" "$STAGE/s01e01-720p-season.mkv" "$base.S01E02.720p.WEB.H264-JFMOD.mkv" "$STAGE/s01e02-720p-season.mkv" \
        "$base.S01E03.720p.WEB.H264-JFMOD.mkv" "$STAGE/s01e03-720p-season.mkv" "jellyfinmod.pack.fixture.s01.sample.mkv" "$STAGE/s01-sample.mkv" \
        "Extras/Behind the Fixture.mkv" "$STAGE/s01-extra.mkv")"
    publish fx-pack-s02 "$s2" '[2]' null "$(printf '[["%s","%s"],["%s","%s"],["%s","%s"]]' \
        "$base.S02E01.720p.WEB.H264-JFMOD.mkv" "$STAGE/s02e01-720p-season.mkv" "$base.S02E02.720p.WEB.H264-JFMOD.mkv" "$STAGE/s02e02-720p-season.mkv" \
        "$base.S02E03.720p.WEB.H264-JFMOD.mkv" "$STAGE/s02e03-720p-season.mkv")"
    local files="[" sep=""
    for ep in "${EPISODES[@]}"; do
        local up=${ep^^} season=${ep:1:2}
        files+="$sep[\"Season $season/$base.$up.720p.WEB.H264-JFMOD.mkv\",\"$STAGE/$ep-720p-complete.mkv\"]"; sep=","
    done
    publish fx-pack-all "$all" '[1,2]' null "$files]"
    publish fx-pack-s01e01 "$base.S01E01.1080p.WEB.H264-JFMOD" '[1]' 1 "[[null,\"$STAGE/s01e01-1080p-single.mkv\"]]"
}

hashes() {
    curl -s "$CONTROL/state" | python3 -c 'import sys,json
for r in json.load(sys.stdin)["releases"]:
    if r["id"].startswith("fx-pack-"): print(r["infoHash"], r["id"], r["size"], r["title"])'
}

tx() { # tx <json body>: the separate Transmission's RPC, with its session id handshake
    python3 - "$1" "$TX" <<'PY'
import json, sys, urllib.request, urllib.error
body, url = json.loads(sys.argv[1]), sys.argv[2]
def rpc(session=""):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"X-Transmission-Session-Id": session})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 409: return rpc(e.headers["X-Transmission-Session-Id"])
        raise
print(json.dumps(rpc()))
PY
}

status() {
    hashes
    local mine
    mine=$(hashes | awk '{print $1}' | paste -sd, -)
    tx '{"method":"torrent-get","arguments":{"fields":["hashString","name","percentDone","status","downloadDir","labels"]}}' \
        | python3 -c 'import sys,json
mine = set(sys.argv[1].split(","))
ts = json.load(sys.stdin)["arguments"]["torrents"]
for t in ts:
    if t["hashString"] in mine: print("client", t["hashString"][:12], "done=%.2f" % t["percentDone"], "status", t["status"], t["downloadDir"], ",".join(t["labels"]), t["name"])
print("fixture torrents in client:", sum(t["hashString"] in mine for t in ts), "of", len(ts))' "$mine"
}

reset() {
    [ -n "$SHARED" ] && [ -d "$SHARED/media/tv" ] || { echo "live-packs: JFMOD_LIVE_SHARED must name the shared folder" >&2; exit 2; }
    local mine
    mine=$(hashes | awk '{print $1}' | paste -sd, -)
    tx "{\"method\":\"torrent-get\",\"arguments\":{\"fields\":[\"hashString\",\"downloadDir\"]}}" | python3 -c 'import sys,json
mine = set(sys.argv[1].split(","))
ids = [t["hashString"] for t in json.load(sys.stdin)["arguments"]["torrents"] if t["hashString"] in mine and t["downloadDir"].startswith("/accept/live48096")]
print(json.dumps(ids))' "$mine" > "$ROOT/standins/state/.pack-reset-ids"
    tx "{\"method\":\"torrent-remove\",\"arguments\":{\"ids\":$(cat "$ROOT/standins/state/.pack-reset-ids"),\"delete-local-data\":true}}" >/dev/null
    echo "torrents removed: $(cat "$ROOT/standins/state/.pack-reset-ids")"; rm -f "$ROOT/standins/state/.pack-reset-ids"
    # Leftover download folders of the fixture (a torrent removed earlier without its data) and the series' library folder.
    find "$SHARED/downloads" -mindepth 1 -maxdepth 1 -name 'JellyfinMod.Pack.Fixture*' -exec rm -rf {} + 2>/dev/null || true
    find "$SHARED/media/tv" -mindepth 1 -maxdepth 1 -name 'JellyfinMod Pack Fixture*' -exec rm -rf {} + 2>/dev/null || true
    echo "library folders left in media/tv: $(find "$SHARED/media/tv" -mindepth 1 -maxdepth 1 | wc -l); downloads left: $(find "$SHARED/downloads" -mindepth 1 -maxdepth 1 | wc -l)"
    # Jellyfin keeps the items of an empty library root (it cannot tell an emptied folder from an unmounted one), so when the
    # fixture was the Shows library's only series its episodes would stay held after the scan. The root holds a folder the
    # host ignores by name while the scan runs (as live-cleanup.py does); one that was already there is left alone.
    local placeholder="$SHARED/media/tv/#recycle" made=""
    if [ ! -e "$placeholder" ]; then
        mkdir "$placeholder"; echo keep > "$placeholder/keep.txt"; made=1
        trap 'rm -rf "$SHARED/media/tv/#recycle"' EXIT
    fi
    local verified=0
    python3 - "$HERE/live-jf.py" "$SERIES_TMDB" "$SERIES_NAME" <<'PY' || verified=$?
import importlib.util, json, sys, time
spec = importlib.util.spec_from_file_location("jf", sys.argv[1]); jf = importlib.util.module_from_spec(spec); spec.loader.exec_module(jf)
tmdb, name = int(sys.argv[2]), sys.argv[3]

def call(method, path):
    try:
        status, text = jf.call(method, path)
    except OSError as error:   # no token file: live-jf.py login was not run
        raise SystemExit(f"reset FAIL: cannot call the live instance ({type(error).__name__}); run live-jf.py login first")
    if status >= 300:
        raise SystemExit(f"reset FAIL: {method} {path} returned {status}")
    return json.loads(text) if text else None

def held():
    """The fixture's episodes that still have a file: native items with a path, and catalog episodes on disk."""
    native = call("GET", "/Items?Recursive=true&IncludeItemTypes=Series,Episode&Fields=Path,ProviderIds")["Items"]
    files = [item.get("Path") for item in native if item.get("Path") and (
        item.get("SeriesName") == name or item.get("Name") == name and item["Type"] == "Series" or
        (item.get("ProviderIds") or {}).get("Tmdb") == str(tmdb) or "JellyfinMod Pack Fixture" in item["Path"])]
    catalog = []
    for entry in call("GET", "/JellyfinMod/Entries?limit=200")["items"]:
        if entry.get("tmdbId") == tmdb and entry.get("mediaType", "series") == "series":
            detail = call("GET", f"/JellyfinMod/Entries/{entry['id']}")
            catalog += [f"S{e['seasonNumber']:02}E{e['episodeNumber']:02}" for e in detail["episodes"] if e.get("availability") == "onDisk"]
    return files, catalog

call("POST", "/Library/Refresh")
deadline = time.time() + 600
while True:
    time.sleep(10)
    files, catalog = held()
    if not files and not catalog:
        print("reset verified: no native fixture item has a file and no catalog episode of the fixture is on disk")
        break
    if time.time() > deadline:
        print("reset FAIL: after the scan the fixture still has files:", len(files), "native items", files[:6],
              "catalog episodes on disk", catalog, file=sys.stderr)
        sys.exit(1)
PY
    if [ -n "$made" ]; then rm -rf "$placeholder"; trap - EXIT; fi
    [ "$verified" -eq 0 ] || { echo "live-packs: reset did not leave the fixture without files" >&2; exit 1; }
}

withdraw() { for id in fx-pack-s01 fx-pack-s02 fx-pack-all fx-pack-s01e01; do curl -s "$CONTROL/withdraw?id=$id" >/dev/null; rm -rf "$ROOT/webseed/$id"; done; echo withdrawn; }

case ${1:-} in
    catalog) catalog ;;
    build) build ;;
    status) status ;;
    reset) reset ;;
    withdraw) withdraw ;;
    *) sed -n '2,19p' "$0"; exit 2 ;;
esac
