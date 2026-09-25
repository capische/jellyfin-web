#!/usr/bin/env bash
# P7.S11: a disposable JellyfinMod image container with its stand-ins, for the fresh-install acceptance.
# Run from the workstation; everything happens on the test host over SSH. Never touches another container.
#
#   fresh-env.sh up      state directory, generated fixture secrets (0600), a CA and a certificate for
#                        api.themoviedb.org, the stand-ins (node, on the host), a TLS terminator answering as
#                        api.themoviedb.org, and the Jellyfin container from $IMAGE with --add-host and the CA
#                        trusted through SSL_CERT_FILE; waits for /health.
#   fresh-env.sh stage   generates a real 60 s video with the image's own ffmpeg and publishes it as a release on
#                        the stand-in Torznab feed for TMDB 990001 ("JellyfinMod Standin Movie", tt9900001).
#   fresh-env.sh env     prints the environment the runners need (addresses and file paths only, never a value).
#   fresh-env.sh down    removes the container, the TLS terminator, the network, the stand-ins and the state
#                        directory, and proves each is gone.
#
# Settings (environment, all optional):
#   JFMOD_SSH=<ssh alias of the test host> (required)
#   JFMOD_ROOT=<disposable state directory on that host whose name starts with jellyfinmod-s11> (required)
#   JFMOD_IMAGE=capische/jellyfinmod:0.1.0.0
#   JFMOD_PORT=38096  JFMOD_STANDIN_PORT_BASE=38110  JFMOD_NET=jfmod-s11img  JFMOD_SUBNET=172.31.212
#   JFMOD_LOCAL=<workstation dir for the 0600 copies of the fixture and admin files; default: $TMPDIR/jfmod-s11>
# The throwaway administrator is created later by `image-review.mjs` (JELLYFINMOD_IMAGE_STEP=wizard), which writes
# its generated password to $JFMOD_LOCAL/admin (0600). Nothing here prints a secret.
set -euo pipefail

SSH=${JFMOD_SSH:?JFMOD_SSH is required: the ssh alias of the test host}
IMAGE=${JFMOD_IMAGE:-capische/jellyfinmod:0.1.0.0}
ROOT=${JFMOD_ROOT:?JFMOD_ROOT is required: a disposable state directory on the test host}
PORT=${JFMOD_PORT:-38096}
BASE=${JFMOD_STANDIN_PORT_BASE:-38110}
NET=${JFMOD_NET:-jfmod-s11img}
SUB=${JFMOD_SUBNET:-172.31.212}
LOCAL=${JFMOD_LOCAL:-${TMPDIR:-/tmp}/jfmod-s11}
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ $PORT =~ ^(8096|18096|28096)$ ]] && { echo "fresh-env: refusing port $PORT" >&2; exit 2; }
case ${ROOT##*/} in jellyfinmod-s11*) ;; *) echo "fresh-env: refusing root $ROOT (its name must start with jellyfinmod-s11)" >&2; exit 2 ;; esac

remote() { ssh "$SSH" bash -s -- "$@"; }

up() {
    mkdir -p "$LOCAL" && chmod 700 "$LOCAL"
    remote "$ROOT" "$BASE" "$NET" "$SUB" <<'EOF'
set -euo pipefail
ROOT=$1 BASE=$2 NET=$3 SUB=$4
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
cat > nginx.conf <<NGINX
events {}
http { server { listen 443 ssl; server_name api.themoviedb.org;
  ssl_certificate /certs/tmdb.crt; ssl_certificate_key /certs/tmdb.key;
  location / { proxy_pass http://$SUB.1:$BASE; proxy_set_header Host api.themoviedb.org; } } }
NGINX
docker network create --subnet "$SUB.0/24" --gateway "$SUB.1" "$NET" >/dev/null
EOF
    rsync -a "$HERE/" "$SSH:$ROOT/standins/bin/"
    remote "$ROOT" "$BASE" "$NET" "$SUB" "$IMAGE" "$PORT" <<'EOF'
set -euo pipefail
ROOT=$1 BASE=$2 NET=$3 SUB=$4 IMAGE=$5 PORT=$6
cd "$ROOT/standins/bin"
STANDIN_BIND="$SUB.1" STANDIN_PORT_BASE="$BASE" STANDIN_SECRETS="$ROOT/secrets/fixture.env" STANDIN_STATE="$ROOT/standins/state" \
  STANDIN_DOWNLOADS="$ROOT/data/downloads" nohup node standins.mjs > "$ROOT/logs/standins.log" 2>&1 &
echo $! > "$ROOT/standins/pid"
docker run -d --name "$NET-tls" --network "$NET" --ip "$SUB.10" -v "$ROOT/certs:/certs:ro" \
  -v "$ROOT/certs/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:alpine >/dev/null
docker run -d --name "$NET-jellyfin" --network "$NET" --user 1000:1000 -p "$PORT:8096" \
  --add-host "api.themoviedb.org:$SUB.10" -e SSL_CERT_FILE=/certs/ca-bundle.crt -v "$ROOT/certs/ca-bundle.crt:/certs/ca-bundle.crt:ro" \
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
TITLE='JellyfinMod.Standin.Movie.2026.1080p.BluRay.x264-S11'
docker run --rm --user 1000:1000 --entrypoint /usr/lib/jellyfin-ffmpeg/ffmpeg -v "$ROOT/staging:/staging" "$IMAGE" -v error -y \
  -f lavfi -i testsrc2=duration=60:size=1920x1080:rate=24 -f lavfi -i sine=frequency=440:duration=60 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest "/staging/$TITLE.mkv"
curl -s -X POST "http://127.0.0.1:$((BASE + 9))/release" -d "{\"id\":\"s11-movie\",\"indexerId\":1,\"title\":\"$TITLE\",\"torrentName\":\"$TITLE.mkv\",\"file\":\"$ROOT/staging/$TITLE.mkv\",\"tmdbid\":990001,\"imdbid\":\"tt9900001\",\"seeders\":25,\"category\":2040}" | head -c 200; echo
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
}

down() {
    remote "$ROOT" "$NET" "$PORT" "$BASE" <<'EOF'
ROOT=$1 NET=$2 PORT=$3 BASE=$4
[ -s "$ROOT/standins/pid" ] && { kill "$(cat "$ROOT/standins/pid")" 2>/dev/null; sleep 1; kill -9 "$(cat "$ROOT/standins/pid")" 2>/dev/null; }
docker rm -f -v "$NET-jellyfin" "$NET-tls" >/dev/null 2>&1
docker network rm "$NET" >/dev/null 2>&1
rm -rf "$ROOT"
echo "containers: $(docker ps -a --format '{{.Names}}' | grep -c "^$NET" || true)"
echo "network: $(docker network ls --format '{{.Name}}' | grep -c "^$NET$" || true)"
echo "state directory: $([ -e "$ROOT" ] && echo present || echo gone)"
echo "listening on $PORT or $BASE..$((BASE + 9)): $(ss -ltn | awk '{print $4}' | grep -c -E ":($PORT|$BASE|$((BASE + 1))|$((BASE + 2))|$((BASE + 3))|$((BASE + 9)))$" || true)"
echo "stand-in processes: $(pgrep -f 'node standins.mjs' | wc -l)"
EOF
    rm -rf "$LOCAL"
    echo "local secret copies: $([ -e "$LOCAL" ] && echo present || echo gone)"
}

case ${1:-} in
    up) up ;;
    stage) stage ;;
    env) env_ ;;
    down) down ;;
    *) sed -n '2,20p' "$0"; exit 2 ;;
esac
