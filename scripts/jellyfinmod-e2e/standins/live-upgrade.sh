#!/usr/bin/env bash
# In-place upgrade from the first 0.1.0.0 image to a newer build of the same version (PHASE7 §4.8, S5), in one
# disposable container on a loopback port. Runs on the test host from <state root>/standins/bin; takes about 5 minutes.
#
#   live-upgrade.sh NEW_IMAGE [OLD_IMAGE] [PORT]
#     NEW_IMAGE  the image built from the reviewed plugin tip
#     OLD_IMAGE  default capische/jellyfin-mod:0.1.0.0 (Friday's first 0.1.0.0)
#     PORT       default 58096; must be free
#
# The container gets a copy of this instance's configuration with users and libraries only: server XML, library
# definitions and a consistent backup of jellyfin.db. It leaves out metadata, every plugin folder, the plugin database,
# its secrets and its XML. Three starts on that one config:
#   1. OLD_IMAGE: "installed JellyfinMod 0.1.0.0"; neither new migration applied.
#   2. NEW_IMAGE: "replaced JellyfinMod 0.1.0.0 build <old> with build <new>"; the plugin folder holds the new build;
#      PhaseSevenTraktObservations and PhaseFiveScanAnchor applied; /JellyfinMod/Health 0.1.0.0 and Ok; the bundle id
#      differs from start 1, and /web/ serves it (its <meta name="jellyfinmod-web">).
#   3. NEW_IMAGE again: "does not replace it"; the plugin folder keeps start 2's build.
# No start may log an [ERR] or [FTL] line. Afterwards the container and the copy are removed, and that is checked.
# Prints one PASS/FAIL line per check, never a token; ends "PASS: in-place upgrade (N checks)" and exits 0, or exits 1.
set -uo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
NEW=${1:?usage: live-upgrade.sh NEW_IMAGE [OLD_IMAGE] [PORT]}
OLD=${2:-capische/jellyfin-mod:0.1.0.0}
PORT=${3:-58096}
ROOT=$(cd ../.. && pwd)
SOURCE=$ROOT/config
SCRATCH=$ROOT/upgrade-scratch
LOGS=$ROOT/standins/state/upgrade-logs
NAME=jellyfinmod-upgrade
BASE=http://127.0.0.1:$PORT
checks=0 failed=0

pass() { checks=$((checks + 1)); echo "PASS: $*"; }
fail() { checks=$((checks + 1)); failed=1; echo "FAIL: $*"; }
check() { # check <description> <command...>
    local what=$1; shift
    if "$@"; then pass "$what"; else fail "$what"; fi
}

# Preconditions: memory, the port, no leftover container or copy, both images present.
kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
[ "$kb" -ge 1258291 ] || { echo "refusing: MemAvailable $((kb / 1024)) MB is below 1.2 GB"; exit 1; }
if ss -ltnH "sport = :$PORT" | grep -q .; then echo "refusing: port $PORT is in use"; exit 1; fi
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then echo "refusing: a container $NAME exists"; exit 1; fi
[ -e "$SCRATCH" ] && { echo "refusing: $SCRATCH exists (a previous run did not finish)"; exit 1; }
for image in "$OLD" "$NEW"; do
    docker image inspect "$image" > /dev/null 2>&1 || { echo "refusing: image $image is not on this host"; exit 1; }
done

teardown() {
    docker rm -f "$NAME" > /dev/null 2>&1
    rm -rf "$SCRATCH"
}
trap teardown EXIT

# The config copy: users and libraries only.
mkdir -p "$SCRATCH/config/data" "$SCRATCH/cache" "$LOGS"
cp -a "$SOURCE/config" "$SOURCE/root" "$SCRATCH/config/"
sqlite3 "$SOURCE/data/jellyfin.db" ".backup '$SCRATCH/config/data/jellyfin.db'"
DB=$SCRATCH/config/data/jellyfinmod/jellyfinmod.db
FOLDER=$SCRATCH/config/plugins/JellyfinMod_0.1.0.0

# A build timestamp, normalised: Jellyfin rewrites meta.json with seven fractional digits (…T07:51:58.0000000Z).
STAMP='import json,re,sys; print(re.sub(r"\.\d+", "", json.load(open(sys.argv[1]) if len(sys.argv) > 1 else sys.stdin)["timestamp"]))'
image_build() { # the build timestamp of the plugin an image carries
    docker run --rm --entrypoint cat "$1" /opt/jellyfinmod/plugin/meta.json | python3 -c "$STAMP"
}
folder_build() { # the build timestamp of the plugin in the config's JellyfinMod_0.1.0.0 folder
    python3 -c "$STAMP" "$FOLDER/meta.json" 2>/dev/null || echo none
}
migrations() {
    sqlite3 "$DB" 'SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId' 2>/dev/null
}
start() { # start <n> <image>: runs until Jellyfin and the plugin answer, logs to upgrade-logs/start-<n>.log
    docker run -d --name "$NAME" --user 1000:1000 -p "127.0.0.1:$PORT:8096" \
        -v "$SCRATCH/config:/config" -v "$SCRATCH/cache:/cache" "$2" > /dev/null || return 1
    local until=$(($(date +%s) + 300))
    until [ "$(curl -s -m 5 "$BASE/health")" = Healthy ]; do
        [ "$(date +%s)" -ge "$until" ] && return 1
        docker ps --format '{{.Names}}' | grep -qx "$NAME" || return 1
        sleep 3
    done
    health > /dev/null || { sleep 10; health > /dev/null; }
}
stop() { # stop <n>: stops the container and keeps its log
    docker logs "$NAME" > "$LOGS/start-$1.log" 2>&1
    docker stop -t 30 "$NAME" > /dev/null
    docker rm "$NAME" > /dev/null
}
health() { # prints "<version> <ok> <bundleId>" from /JellyfinMod/Health, signed in as oleksii (empty password)
    python3 - "$BASE" <<'PY'
import json, sys, urllib.request
base = sys.argv[1]
client = 'MediaBrowser Client="jfmod-upgrade", Device="host", DeviceId="jfmod-upgrade", Version="1"'
def call(path, body=None, token=None):
    auth = client + (f', Token="{token}"' if token else "")
    request = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": auth},
                                     method="GET" if body is None else "POST")
    return json.load(urllib.request.urlopen(request, timeout=30))
token = call("/Users/AuthenticateByName", {"Username": "oleksii", "Pw": ""})["AccessToken"]
health = {k.lower(): v for k, v in call("/JellyfinMod/Health", token=token).items()}
web = {k.lower(): v for k, v in (health.get("web") or {}).items()}
print(health.get("version"), health.get("ok"), web.get("bundleid"))
PY
}
served_bundle() { # the bundle id /web/ serves: its <meta name="jellyfinmod-web" content="<id>">
    curl -s -m 10 "$BASE/web/" | grep -oE '<meta name="jellyfinmod-web" content="[0-9a-f]+"' | head -1 | grep -oE '[0-9a-f]{12,}"$' | tr -d '"'
}
errors() { grep -cE '\[(ERR|FTL)\]' "$LOGS/start-$1.log"; }

old_build=$(image_build "$OLD")
new_build=$(image_build "$NEW")
echo "old image build $old_build; new image build $new_build"
check "the new image carries a later build than the old one" test "$new_build" '>' "$old_build"

# Start 1: the first 0.1.0.0.
if start 1 "$OLD"; then
    read -r version1 ok1 bundle1 <<< "$(health)"
    stop 1
    check "start 1 logs: installed JellyfinMod 0.1.0.0" grep -q "installed JellyfinMod 0.1.0.0" "$LOGS/start-1.log"
    check "start 1 plugin folder holds the old build ($old_build)" test "$(folder_build)" = "$old_build"
    check "start 1 Health 0.1.0.0, Ok (got $version1 $ok1)" test "$version1 $ok1" = "0.1.0.0 True"
    check "start 1 has neither new migration" test -z "$(migrations | grep -E 'PhaseSevenTraktObservations|PhaseFiveScanAnchor')"
    check "start 1 logs no [ERR]/[FTL] line" test "$(errors 1)" -eq 0
else
    docker logs "$NAME" > "$LOGS/start-1.log" 2>&1
    fail "start 1 did not come up (log: upgrade-logs/start-1.log)"
    exit 1
fi

# Start 2: the new image on the same config.
if start 2 "$NEW"; then
    read -r version2 ok2 bundle2 <<< "$(health)"
    served2=$(served_bundle)
    stop 2
    check "start 2 logs: replaced JellyfinMod 0.1.0.0 build … with build …" \
        grep -qE "replaced JellyfinMod 0\.1\.0\.0 build .+ with build " "$LOGS/start-2.log"
    grep -oE "replaced JellyfinMod 0\.1\.0\.0 build .+ with build [^ ]+" "$LOGS/start-2.log" | head -1
    check "start 2 plugin folder holds the new build ($new_build)" test "$(folder_build)" = "$new_build"
    check "start 2 applied PhaseSevenTraktObservations" grep -q "_PhaseSevenTraktObservations$" <(migrations)
    check "start 2 applied PhaseFiveScanAnchor" grep -q "_PhaseFiveScanAnchor$" <(migrations)
    check "start 2 Health 0.1.0.0, Ok (got $version2 $ok2)" test "$version2 $ok2" = "0.1.0.0 True"
    check "start 2 bundle $bundle2 differs from start 1's $bundle1" test -n "$bundle2" -a "$bundle2" != "$bundle1"
    check "start 2 /web/ serves the Health bundle (served $served2)" test "$served2" = "$bundle2"
    check "start 2 logs no [ERR]/[FTL] line" test "$(errors 2)" -eq 0
else
    docker logs "$NAME" > "$LOGS/start-2.log" 2>&1
    fail "start 2 did not come up (log: upgrade-logs/start-2.log)"
    exit 1
fi

# Start 3: the new image again keeps the build.
if start 3 "$NEW"; then
    read -r version3 ok3 bundle3 <<< "$(health)"
    stop 3
    check "start 3 logs: does not replace it" grep -q "does not replace it" "$LOGS/start-3.log"
    check "start 3 plugin folder keeps the new build ($new_build)" test "$(folder_build)" = "$new_build"
    check "start 3 Health 0.1.0.0, Ok, bundle unchanged (got $version3 $ok3 $bundle3)" \
        test "$version3 $ok3 $bundle3" = "0.1.0.0 True $bundle2"
    check "start 3 logs no [ERR]/[FTL] line" test "$(errors 3)" -eq 0
else
    docker logs "$NAME" > "$LOGS/start-3.log" 2>&1
    fail "start 3 did not come up (log: upgrade-logs/start-3.log)"
    exit 1
fi

# Teardown, proven.
trap - EXIT
teardown
check "no $NAME container remains" test -z "$(docker ps -a --format '{{.Names}}' | grep -x "$NAME")"
check "the config copy is removed" test ! -e "$SCRATCH"
check "port $PORT is free again" test -z "$(ss -ltnH "sport = :$PORT")"

if [ $failed -eq 0 ]; then echo "PASS: in-place upgrade ($checks checks)"; else echo "FAIL: in-place upgrade"; fi
exit $failed
