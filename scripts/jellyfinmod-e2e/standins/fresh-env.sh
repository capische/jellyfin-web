#!/usr/bin/env bash
# P7.S11: a disposable JellyfinMod image container with its stand-ins, for the fresh-install acceptance.
# Run from the workstation; everything happens on the test host over SSH. Never touches another container.
#
#   fresh-env.sh up      state directory, generated fixture secrets (0600), a CA and a certificate for
#                        api.themoviedb.org, the stand-ins (node, on the host), a TLS terminator answering as
#                        api.themoviedb.org, and the Jellyfin container from $IMAGE with --add-host and the CA
#                        trusted through SSL_CERT_FILE; waits for /health.
#   fresh-env.sh stage   generates a real 60 s video with the image's own ffmpeg and publishes it as a release on
#                        the stand-in Torznab feed for TMDB 990001 ("JellyfinMod Standin Movie", tt9900001), as a 1080p WEB-DL.
#   fresh-env.sh stage-trakt  (JFMOD_TRAKT=1, P7.Q16) generates the Trakt fixture media with the image's own ffmpeg:
#                        two movies and one show (S01E01, S01E02, S02E01) whose folders carry the TMDB/TVDB ids the
#                        Trakt stand-in reports.
#   fresh-env.sh env     prints the environment the runners need (addresses and file paths only, never a value).
#   fresh-env.sh down    removes the container, the TLS terminator, the network, the stand-ins and the state
#                        directory, and proves each is gone.
#
# Settings (environment, all optional):
#   JFMOD_SSH=<ssh alias of the test host> (required)
#   JFMOD_ROOT=<disposable state directory on that host whose name starts with jellyfinmod-s11> (required)
#   JFMOD_IMAGE=capische/jellyfin-mod:0.1.0.0
#   JFMOD_PORT=38096  JFMOD_STANDIN_PORT_BASE=38110  JFMOD_NET=jfmod-s11img  JFMOD_SUBNET=172.31.212
#   JFMOD_LOCAL=<workstation dir for the 0600 copies of the fixture and admin files; default: $TMPDIR/jfmod-s11>
#   JFMOD_TRAKT=1 (P7.Q16) also answers as api.trakt.tv: a second certificate from the same CA, a second server in the
#     TLS terminator, --add-host api.trakt.tv, and trakt.mjs on JFMOD_STANDIN_PORT_BASE+5 (its control on loopback +8).
#     The state directory's name may then also start with jellyfinmod-q16.
# The throwaway administrator is created later by `image-review.mjs` (JELLYFINMOD_IMAGE_STEP=wizard), which writes
# its generated password to $JFMOD_LOCAL/admin (0600). Nothing here prints a secret.
set -euo pipefail

SSH=${JFMOD_SSH:?JFMOD_SSH is required: the ssh alias of the test host}
IMAGE=${JFMOD_IMAGE:-capische/jellyfin-mod:0.1.0.0}
ROOT=${JFMOD_ROOT:?JFMOD_ROOT is required: a disposable state directory on the test host}
PORT=${JFMOD_PORT:-38096}
BASE=${JFMOD_STANDIN_PORT_BASE:-38110}
NET=${JFMOD_NET:-jfmod-s11img}
TRAKT=${JFMOD_TRAKT:-0}
SUB=${JFMOD_SUBNET:-172.31.212}
LOCAL=${JFMOD_LOCAL:-${TMPDIR:-/tmp}/jfmod-s11}
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ $PORT =~ ^(8096|18096|28096)$ ]] && { echo "fresh-env: refusing port $PORT" >&2; exit 2; }
case ${ROOT##*/} in
    jellyfinmod-s11*) ;;
    jellyfinmod-q16*) [ "$TRAKT" = 1 ] || { echo "fresh-env: a jellyfinmod-q16 root is for JFMOD_TRAKT=1" >&2; exit 2; } ;;
    *) echo "fresh-env: refusing root $ROOT (its name must start with jellyfinmod-s11 or jellyfinmod-q16)" >&2; exit 2 ;;
esac

remote() { ssh "$SSH" bash -s -- "$@"; }

up() {
    mkdir -p "$LOCAL" && chmod 700 "$LOCAL"
    remote "$ROOT" "$BASE" "$NET" "$SUB" "$TRAKT" <<'EOF'
set -euo pipefail
ROOT=$1 BASE=$2 NET=$3 SUB=$4 TRAKT=$5
[ -e "$ROOT" ] && { echo "fresh-env: $ROOT exists; run down first" >&2; exit 2; }
mkdir -p "$ROOT"/{config,cache,data/media/movies,data/media/tv,data/downloads,staging,standins/state,certs,secrets,logs}
umask 077
gen() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
{ echo "TMDB_TOKEN=ey$(gen 40)"; echo "PROWLARR_KEY=$(gen 32 | tr 'A-Z' 'a-z')"; echo "TX_USER=jfmod"; echo "TX_PASSWORD=$(gen 24)"; } > "$ROOT/secrets/fixture.env"
umask 022
cd "$ROOT/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=JellyfinMod S11 stand-in CA" -keyout ca.key -out ca.crt >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj "/CN=api.themoviedb.org" -keyout tmdb.key -out tmdb.csr >/dev/null 2>&1
printf 'subjectAltName=DNS:api.themoviedb.org\n' > san.ext
openssl x509 -req -in tmdb.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -extfile san.ext -out tmdb.crt >/dev/null 2>&1
chmod 644 tmdb.key
cat /etc/ssl/certs/ca-certificates.crt ca.crt > ca-bundle.crt
TRAKT_SERVER=
if [ "$TRAKT" = 1 ]; then
  openssl req -newkey rsa:2048 -nodes -subj "/CN=api.trakt.tv" -keyout trakt.key -out trakt.csr >/dev/null 2>&1
  printf 'subjectAltName=DNS:api.trakt.tv\n' > trakt-san.ext
  openssl x509 -req -in trakt.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -extfile trakt-san.ext -out trakt.crt >/dev/null 2>&1
  chmod 644 trakt.key
  TRAKT_SERVER="server { listen 443 ssl; server_name api.trakt.tv;
  ssl_certificate /certs/trakt.crt; ssl_certificate_key /certs/trakt.key;
  location / { proxy_pass http://$SUB.1:$((BASE + 5)); proxy_set_header Host api.trakt.tv; } }"
fi
cat > nginx.conf <<NGINX
events {}
http { server { listen 443 ssl; server_name api.themoviedb.org;
  ssl_certificate /certs/tmdb.crt; ssl_certificate_key /certs/tmdb.key;
  location / { proxy_pass http://$SUB.1:$BASE; proxy_set_header Host api.themoviedb.org; } }
  $TRAKT_SERVER }
NGINX
docker network create --subnet "$SUB.0/24" --gateway "$SUB.1" "$NET" >/dev/null
EOF
    rsync -a "$HERE/" "$SSH:$ROOT/standins/bin/"
    remote "$ROOT" "$BASE" "$NET" "$SUB" "$IMAGE" "$PORT" "$TRAKT" <<'EOF'
set -euo pipefail
ROOT=$1 BASE=$2 NET=$3 SUB=$4 IMAGE=$5 PORT=$6 TRAKT=$7
cd "$ROOT/standins/bin"
TRAKT_HOST=()
if [ "$TRAKT" = 1 ]; then
  TRAKT_BIND="$SUB.1" TRAKT_PORT=$((BASE + 5)) TRAKT_CONTROL_PORT=$((BASE + 8)) nohup node trakt.mjs > "$ROOT/logs/trakt.log" 2>&1 &
  echo $! > "$ROOT/standins/trakt.pid"
  TRAKT_HOST=(--add-host "api.trakt.tv:$SUB.10")
fi
STANDIN_BIND="$SUB.1" STANDIN_PORT_BASE="$BASE" STANDIN_SECRETS="$ROOT/secrets/fixture.env" STANDIN_STATE="$ROOT/standins/state" \
  STANDIN_DOWNLOADS="$ROOT/data/downloads" nohup node standins.mjs > "$ROOT/logs/standins.log" 2>&1 &
echo $! > "$ROOT/standins/pid"
docker run -d --name "$NET-tls" --network "$NET" --ip "$SUB.10" -v "$ROOT/certs:/certs:ro" \
  -v "$ROOT/certs/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:alpine >/dev/null
docker run -d --name "$NET-jellyfin" --network "$NET" --user 1000:1000 -p "$PORT:8096" \
  --add-host "api.themoviedb.org:$SUB.10" "${TRAKT_HOST[@]}" -e SSL_CERT_FILE=/certs/ca-bundle.crt -v "$ROOT/certs/ca-bundle.crt:/certs/ca-bundle.crt:ro" \
  -v "$ROOT/config:/config" -v "$ROOT/cache:/cache" -v "$ROOT/data:/data" "$IMAGE" >/dev/null
# The image lets Jellyfin's first start finish, stops it, registers the repository and starts it again (PHASE7 S5), so
# wait for a Healthy server whose /web is the patched page, not just for the first 200.
for i in $(seq 1 100); do
  [ "$(curl -s "http://127.0.0.1:$PORT/health")" = Healthy ] && curl -s "http://127.0.0.1:$PORT/web/index.html" | grep -q 'name="jellyfinmod-web"' \
    && [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$((BASE + 9))/state")" = 200 ] && docker logs "$NET-jellyfin" 2>&1 | grep -q 'registered the repository' && break
  sleep 3
done
echo "health $(curl -s "http://127.0.0.1:$PORT/health") after $((i * 3)) s; image $(docker inspect -f '{{.Image}}' "$NET-jellyfin" | cut -c8-19)"
EOF
    # The runners read the generated fixture credentials from a local 0600 copy; the value is never printed.
    (umask 077; ssh "$SSH" cat "$ROOT/secrets/fixture.env" > "$LOCAL/fixture.env")
    echo "up: container $NET-jellyfin on port $PORT, stand-ins at $SUB.1:$BASE..$((BASE + 9))"
}

stage() {
    remote "$ROOT" "$BASE" "$IMAGE" <<'EOF'
set -euo pipefail
ROOT=$1 BASE=$2 IMAGE=$3
# A 1080p WEB-DL of about 19 MB for a one-minute title, which the wizard's "JellyfinMod Standin HD" profile accepts
# (1080p WEB-DL allowed, inside its size-per-hour range). The release group must not read as an episode marker: a
# group of "S11" parses as season 11 and the release is rejected for a movie (seen in the first S11 run).
TITLE='JellyfinMod.Standin.Movie.2026.1080p.WEB-DL.H264-JFMOD'
docker run --rm --user 1000:1000 --entrypoint /usr/lib/jellyfin-ffmpeg/ffmpeg -v "$ROOT/staging:/staging" "$IMAGE" -v error -y \
  -f lavfi -i testsrc2=duration=60:size=1920x1080:rate=24 -f lavfi -i sine=frequency=440:duration=60 \
  -c:v libx264 -preset veryfast -b:v 2400k -maxrate 2400k -bufsize 4800k -pix_fmt yuv420p -c:a aac -b:a 64k -ac 1 -shortest \
  "/staging/$TITLE.mkv"
echo "staged $(stat -c %s "$ROOT/staging/$TITLE.mkv") bytes"
curl -s -X POST "http://127.0.0.1:$((BASE + 9))/release" -d "{\"id\":\"s11-movie\",\"indexerId\":1,\"title\":\"$TITLE\",\"torrentName\":\"$TITLE.mkv\",\"file\":\"$ROOT/staging/$TITLE.mkv\",\"tmdbid\":990001,\"imdbid\":\"tt9900001\",\"seeders\":40,\"category\":2040}" | head -c 200; echo
EOF
}

stage_trakt() {
    [ "$TRAKT" = 1 ] || { echo "fresh-env: stage-trakt needs JFMOD_TRAKT=1" >&2; exit 2; }
    remote "$ROOT" "$IMAGE" <<'EOF'
set -euo pipefail
ROOT=$1 IMAGE=$2
# The folder ids are what Jellyfin's resolvers read ([tmdbid-…], [tvdbid-…]); the Trakt stand-in reports the same ids.
# The show's episodes carry no ids of their own, so the Trakt plugin matches them by show, season and number.
M="$ROOT/data/media/movies" T="$ROOT/data/media/tv/JellyfinMod Trakt Show (2026) [tvdbid-990102]"
mkdir -p "$M/JellyfinMod Trakt Movie (2026) [tmdbid-990101]" "$M/JellyfinMod Trakt Unwatched (2026) [tmdbid-990103]" \
  "$T/Season 01" "$T/Season 02"
make() { # make <path under /data/media>: a 20 s 360p clip from the image's own ffmpeg
  docker run --rm --user 1000:1000 --entrypoint /usr/lib/jellyfin-ffmpeg/ffmpeg -v "$ROOT/data/media:/media" "$IMAGE" -v error -y \
    -f lavfi -i testsrc2=duration=20:size=640x360:rate=24 -f lavfi -i sine=frequency=440:duration=20 \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 64k -ac 1 -shortest "/media/$1"
}
make "movies/JellyfinMod Trakt Movie (2026) [tmdbid-990101]/JellyfinMod Trakt Movie (2026).mkv"
make "movies/JellyfinMod Trakt Unwatched (2026) [tmdbid-990103]/JellyfinMod Trakt Unwatched (2026).mkv"
S="tv/JellyfinMod Trakt Show (2026) [tvdbid-990102]"
make "$S/Season 01/JellyfinMod Trakt Show S01E01.mkv"
make "$S/Season 01/JellyfinMod Trakt Show S01E02.mkv"
make "$S/Season 02/JellyfinMod Trakt Show S02E01.mkv"
echo "staged $(find "$ROOT/data/media" -name '*.mkv' | wc -l) fixture files"
EOF
}

env_() {
    cat <<EOF
export JELLYFINMOD_S11_URL=http://<test-host>:$PORT/          # replace <test-host> with the test host's LAN address
export JELLYFINMOD_IMAGE_URL=\$JELLYFINMOD_S11_URL
export JELLYFINMOD_S11_STANDIN=$SUB.1
export JELLYFINMOD_S11_PORT_BASE=$BASE
export JELLYFINMOD_S11_SSH=$SSH
export JELLYFINMOD_S11_HOST_ROOT=$ROOT
export JELLYFINMOD_S11_FIXTURE_FILE=$LOCAL/fixture.env
export JELLYFINMOD_S11_ADMIN_FILE=$LOCAL/admin
export JELLYFINMOD_IMAGE_SECRET_FILE=$LOCAL/admin
EOF
    if [ "$TRAKT" = 1 ]; then
        cat <<EOF
export JELLYFINMOD_Q16_URL=\$JELLYFINMOD_S11_URL
export JELLYFINMOD_Q16_SSH=$SSH
export JELLYFINMOD_Q16_TRAKT_CONTROL=$((BASE + 8))
export JELLYFINMOD_Q16_LOCAL=$LOCAL
EOF
    fi
}

down() {
    remote "$ROOT" "$NET" "$PORT" "$BASE" <<'EOF'
ROOT=$1 NET=$2 PORT=$3 BASE=$4
for pid in "$ROOT/standins/pid" "$ROOT/standins/trakt.pid"; do
  [ -s "$pid" ] && { kill "$(cat "$pid")" 2>/dev/null; sleep 1; kill -9 "$(cat "$pid")" 2>/dev/null; }
done
docker rm -f -v "$NET-jellyfin" "$NET-tls" >/dev/null 2>&1
docker network rm "$NET" >/dev/null 2>&1
rm -rf "$ROOT"
echo "containers: $(docker ps -a --format '{{.Names}}' | grep -c "^$NET" || true)"
echo "network: $(docker network ls --format '{{.Name}}' | grep -c "^$NET$" || true)"
echo "state directory: $([ -e "$ROOT" ] && echo present || echo gone)"
echo "listening on $PORT or $BASE..$((BASE + 9)): $(ss -ltn | awk '{print $4}' | grep -c -E ":($PORT|$BASE|$((BASE + 1))|$((BASE + 2))|$((BASE + 3))|$((BASE + 5))|$((BASE + 8))|$((BASE + 9)))$" || true)"
echo "stand-in processes: $(pgrep -f 'node (standins|trakt).mjs' | wc -l)"
EOF
    rm -rf "$LOCAL"
    echo "local secret copies: $([ -e "$LOCAL" ] && echo present || echo gone)"
}

case ${1:-} in
    up) up ;;
    stage) stage ;;
    stage-trakt) stage_trakt ;;
    env) env_ ;;
    down) down ;;
    *) sed -n '2,29p' "$0"; exit 2 ;;
esac
