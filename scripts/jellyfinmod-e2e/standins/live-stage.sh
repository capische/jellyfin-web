#!/usr/bin/env bash
# Stages the legal fixtures of the live acceptance on the private Torznab feed: real 60 s videos made with the image's own
# ffmpeg, published as web-seeded torrents so the real Transmission downloads them with no peer. Runs on the test host.
#   live-stage.sh <name> <torrent-name> <release title> <tmdbid> <category> [layout]
#   FIXTURE_SECONDS (default 60) sets the single-file fixture length; the web seed serves 200 kB/s.
#   layout: single (default) | ambiguous (two equal videos) | archive (a .rar) | extras (video + sample + nfo)
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)   # runs from <state root>/standins/bin
CONTROL=http://127.0.0.1:48119
name=$1 torrent=$2 title=$3 tmdb=$4 category=$5 layout=${6:-single}
dir=$ROOT/staging/$name
mkdir -p "$dir"
video() { # video <file> <seconds> <frequency>
  [ -s "$1" ] || docker run --rm --user 1000:1000 --entrypoint /usr/lib/jellyfin-ffmpeg/ffmpeg -v "$dir:/out" jellyfinmod-live:current -v error -y \
    -f lavfi -i "testsrc2=duration=$2:size=1280x720:rate=24" -f lavfi -i "sine=frequency=$3:duration=$2" \
    -c:v libx264 -preset veryfast -b:v 1800k -pix_fmt yuv420p -c:a aac -b:a 64k -ac 2 -shortest "/out/$(basename "$1")"
}
case $layout in
  single)
    video "$dir/$torrent" "${FIXTURE_SECONDS:-60}" 440
    body="{\"id\":\"$name\",\"indexerId\":1,\"title\":\"$title\",\"torrentName\":\"$torrent\",\"file\":\"$dir/$torrent\",\"tmdbid\":$tmdb,\"seeders\":30,\"category\":$category,\"webseed\":true}" ;;
  ambiguous)
    video "$dir/a.mkv" 60 440; video "$dir/b.mkv" 60 660
    body="{\"id\":\"$name\",\"indexerId\":1,\"title\":\"$title\",\"torrentName\":\"$torrent\",\"files\":[{\"path\":\"$title.part1.mkv\",\"file\":\"$dir/a.mkv\"},{\"path\":\"$title.part2.mkv\",\"file\":\"$dir/b.mkv\"}],\"tmdbid\":$tmdb,\"seeders\":30,\"category\":$category,\"webseed\":true}" ;;
  archive)
    video "$dir/a.mkv" 60 440
    [ -s "$dir/a.rar" ] || cp "$dir/a.mkv" "$dir/a.rar"
    body="{\"id\":\"$name\",\"indexerId\":1,\"title\":\"$title\",\"torrentName\":\"$torrent\",\"files\":[{\"path\":\"$title.rar\",\"file\":\"$dir/a.rar\"}],\"tmdbid\":$tmdb,\"seeders\":30,\"category\":$category,\"webseed\":true}" ;;
  wrongep)
    video "$dir/a.mkv" 60 550
    body="{\"id\":\"$name\",\"indexerId\":1,\"title\":\"$title\",\"torrentName\":\"$torrent\",\"files\":[{\"path\":\"$7\",\"file\":\"$dir/a.mkv\"}],\"tmdbid\":$tmdb,\"seeders\":30,\"category\":$category,\"webseed\":true}" ;;
esac
# The web seed serves <id>/<torrent name>[/<path>] from $ROOT/webseed, as hardlinks of the staged files.
seed=$ROOT/webseed/$name; rm -rf "$seed"; mkdir -p "$seed"
python3 - "$body" "$seed" <<'PY'
import json, os, sys
spec, seed = json.loads(sys.argv[1]), sys.argv[2]
parts = [(p["path"], p["file"]) for p in spec["files"]] if "files" in spec else [(None, spec["file"])]
for path, file in parts:
    target = os.path.join(seed, spec["torrentName"], path) if path else os.path.join(seed, spec["torrentName"])
    os.makedirs(os.path.dirname(target), exist_ok=True)
    os.link(file, target)
PY
curl -s -X POST "$CONTROL/release" -d "$body" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("id"), d.get("infoHash"), d.get("size"), d.get("error",""))'
