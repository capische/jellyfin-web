#!/usr/bin/env bash
# Live acceptance of Phases 4-6 on a dedicated JellyfinMod instance (brief live-acceptance-p4-p6): a Jellyfin built from
# the current tips, a clone of the acceptance instance's configuration without its JellyfinMod plugin data, the real
# Prowlarr (read-only) and the separate real Transmission reached through this instance's own relay, and the stand-ins
# for TMDB (over TLS as api.themoviedb.org) and for a private Torznab feed that serves legal fixtures by web seed.
# Run from the workstation; everything happens on the test host over SSH. Never touches another instance.
#
#   live-env.sh image <release-image-dir>   copies a scripts/build-release.sh image/ context and builds the image
#   live-env.sh up                          directories, clone, certificates, stand-ins, compose up; waits for health
#   live-env.sh standins                    (re)starts only the stand-ins
#   live-env.sh relay-stop | relay-start    makes the Transmission unreachable for this instance only, and back
#   live-env.sh mem                         prints MemAvailable; exits 3 below the 1 GB floor
#   live-env.sh down                        stops the stand-ins and the compose project (state is kept)
#
# Settings (environment): JFMOD_SSH (required). Everything else is fixed below so no run can aim at another instance.
set -euo pipefail

SSH=${JFMOD_SSH:?JFMOD_SSH is required: the ssh alias of the test host}
# Host paths come from the environment (keep them in an ignored file, never in the repository):
#   JFMOD_LIVE_ROOT             this instance's state directory (config, cache, stand-ins, secrets)
#   JFMOD_LIVE_SHARED           the writable folder, inside the separate Transmission's mount, for media and downloads
#   JFMOD_LIVE_SOURCE_CONFIG    the /config of the instance to clone (all of it, without JellyfinMod's own state)
#   JFMOD_LIVE_OTHER_DOWNLOADS  the other instance's download folder, mounted read-only so the seed index resolves it
ROOT=${JFMOD_LIVE_ROOT:?JFMOD_LIVE_ROOT is required}
SHARED=${JFMOD_LIVE_SHARED:?JFMOD_LIVE_SHARED is required}
SOURCE_CONFIG=${JFMOD_LIVE_SOURCE_CONFIG:?JFMOD_LIVE_SOURCE_CONFIG is required}
OTHER_DOWNLOADS=${JFMOD_LIVE_OTHER_DOWNLOADS:?JFMOD_LIVE_OTHER_DOWNLOADS is required}
PORT=48096
BASE=48110
SUB=172.31.48
STANDIN_BIND=172.24.0.1   # the acceptance network's gateway: reachable from the VPN'd Transmission without the tunnel
IMAGE=jellyfinmod-live:current
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

remote() { ssh "$SSH" bash -s -- "$@"; }

image() {
    local context=${1:?the release image/ directory}
    [[ -f $context/Dockerfile && -f $context/package/JellyfinMod.dll ]] || { echo "live-env: $context is not a release image context" >&2; exit 2; }
    remote "$ROOT" <<'EOF'
mkdir -p "$1/image"
EOF
    rsync -a --delete "$context/" "$SSH:$ROOT/image/"
    remote "$ROOT" "$IMAGE" <<'EOF'
set -euo pipefail
docker build -q -t "$2" "$1/image" | cut -c8-19
EOF
}

mem() {
    remote <<'EOF'
kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
echo "MemAvailable $((kb / 1024)) MB; swap used $(awk '/SwapTotal/{t=$2}/SwapFree/{f=$2}END{print int((t-f)/1024)}' /proc/meminfo) MB"
[ "$kb" -ge 1048576 ] || { echo "BELOW the 1 GB floor"; exit 3; }
EOF
}

standins() {
    rsync -a "$HERE/" "$SSH:$ROOT/standins/bin/"
    remote "$ROOT" "$BASE" "$STANDIN_BIND" <<'EOF'
set -euo pipefail
ROOT=$1 BASE=$2 BIND=$3
[ -s "$ROOT/standins/pid" ] && kill "$(cat "$ROOT/standins/pid")" 2>/dev/null && sleep 1 || true
cd "$ROOT/standins/bin"
STANDIN_BIND="$BIND" STANDIN_PORT_BASE="$BASE" STANDIN_SECRETS="$ROOT/secrets/fixture.env" STANDIN_STATE="$ROOT/standins/state" \
  STANDIN_DOWNLOADS="$ROOT/standins/unused-downloads" STANDIN_CATALOG="$ROOT/catalog.json" \
  STANDIN_WEBSEED_BASE="http://$(docker inspect jellyfinmod-live-webseed --format '{{range $k, $v := .NetworkSettings.Networks}}{{if eq $k "jellyfinmod-acceptance_default"}}{{$v.IPAddress}}{{end}}{{end}}' 2>/dev/null)/" \
  setsid nohup node standins.mjs >> "$ROOT/logs/standins.log" 2>&1 < /dev/null &
echo $! > "$ROOT/standins/pid"
for i in $(seq 1 20); do curl -s -o /dev/null "http://127.0.0.1:$((BASE + 9))/state" && break; sleep 0.5; done
echo "stand-ins pid $(cat "$ROOT/standins/pid"): $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$((BASE + 9))/state")"
EOF
}

up() {
    mem
    remote "$ROOT" "$SHARED" "$SOURCE_CONFIG" "$BASE" "$SUB" "$STANDIN_BIND" "$PORT" "$IMAGE" "$OTHER_DOWNLOADS" <<'EOF'
set -euo pipefail
ROOT=$1 SHARED=$2 SRC=$3 BASE=$4 SUB=$5 BIND=$6 PORT=$7 IMAGE=$8 OTHER=$9
mkdir -p "$ROOT"/{webseed,cache,standins/state,standins/unused-downloads,staging,certs,secrets,logs} "$SHARED"/{media/movies,media/movies-b,media/tv,media-alt/movies,downloads}
if [ ! -e "$ROOT/config/.cloned" ]; then
  # Clone rule: all of /config, metadata included, but none of the JellyfinMod plugin's own state, so this instance starts
  # on a fresh plugin database and can never claim the source instance's grabs on the shared Transmission.
  rsync -a --exclude '/data/jellyfinmod/' --exclude '/plugins/JellyfinMod*' --exclude '/plugins/configurations/JellyfinMod.xml' \
    --exclude '/data/jellyfin.db*' --exclude '/transcodes/' --exclude '/log/*' "$SRC/" "$ROOT/config/"
  sqlite3 "$SRC/data/jellyfin.db" ".backup '$ROOT/config/data/jellyfin.db'"
  sqlite3 "$ROOT/config/data/jellyfin.db" 'PRAGMA integrity_check;' | head -1
  # Every image the clone references must be present (workspace clone rule); count, reading one path per line.
  sqlite3 "$ROOT/config/data/jellyfin.db" "SELECT Path FROM BaseItemImageInfos WHERE Path LIKE '/config/%' OR Path LIKE '%MetadataPath%'" \
    | sed -e "s#^/config/#$ROOT/config/#" -e "s#^%MetadataPath%#$ROOT/config/metadata#" \
    | { m=0; n=0; while IFS= read -r f; do n=$((n + 1)); [ -e "$f" ] || m=$((m + 1)); done; echo "clone: $n referenced images, $m missing"; }
  touch "$ROOT/config/.cloned"
fi
if [ ! -s "$ROOT/secrets/fixture.env" ]; then
  umask 077
  gen() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  { echo "TMDB_TOKEN=ey$(gen 40)"; echo "PROWLARR_KEY=$(gen 32 | tr 'A-Z' 'a-z')"; echo "TX_USER=jfmod"; echo "TX_PASSWORD=$(gen 24)"; } > "$ROOT/secrets/fixture.env"
  umask 022
fi
if [ ! -s "$ROOT/certs/tmdb.crt" ]; then
  cd "$ROOT/certs"
  openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj "/CN=JellyfinMod live stand-in CA" -keyout ca.key -out ca.crt >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -subj "/CN=api.themoviedb.org" -keyout tmdb.key -out tmdb.csr >/dev/null 2>&1
  printf 'subjectAltName=DNS:api.themoviedb.org\n' > san.ext
  openssl x509 -req -in tmdb.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 7 -extfile san.ext -out tmdb.crt >/dev/null 2>&1
  chmod 644 tmdb.key
  cat /etc/ssl/certs/ca-certificates.crt ca.crt > ca-bundle.crt
fi
cat > "$ROOT/certs/nginx.conf" <<NGINX
events {}
http { server { listen 443 ssl; server_name api.themoviedb.org;
  ssl_certificate /certs/tmdb.crt; ssl_certificate_key /certs/tmdb.key;
  location / { proxy_pass http://$BIND:$BASE; proxy_set_header Host api.themoviedb.org; } } }
NGINX
cat > "$ROOT/certs/webseed.conf" <<NGINX
events {}
http { limit_conn_zone \$binary_remote_addr zone=peer:1m; server { listen 80; root /webseed; location / { limit_conn peer 1; limit_rate 200k; } } }
NGINX
TX_IP=$(docker inspect transmission-acceptance --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
cat > "$ROOT/compose.yml" <<YAML
# JellyfinMod live acceptance (P4 A8, P5 I3-I9, P6 M2-M9). Its own network, memory cap and relay to the separate
# Transmission; production media is not mounted. Generated by live-env.sh.
name: jellyfinmod-live
networks:
  default:
    ipam:
      config:
        - subnet: $SUB.0/24
          gateway: $SUB.1
  acceptance:
    external: true
    name: jellyfinmod-acceptance_default
services:
  jellyfin:
    image: $IMAGE
    pull_policy: never
    container_name: jellyfinmod-live
    user: "1000:1000"
    mem_limit: 900m
    memswap_limit: 900m
    environment:
      TZ: Australia/Sydney
      SSL_CERT_FILE: /certs/ca-bundle.crt
    ports:
      - "$PORT:8096"
    extra_hosts:
      - "api.themoviedb.org:$SUB.10"
    volumes:
      - $ROOT/config:/config
      - $ROOT/cache:/cache
      - $ROOT/certs/ca-bundle.crt:/certs/ca-bundle.crt:ro
      # One shared, writable mount at the same path the Transmission uses: library and downloads on one filesystem.
      - $SHARED:/accept/live48096
      # The other instance's downloads, read-only, so this instance's seed index can resolve every torrent in the client.
      - $OTHER:/accept/downloads:ro
      # A second bind mount of the same host filesystem, for the cross_filesystem (EXDEV) import case.
      - $SHARED/media-alt:/accept/alt48096
    restart: "no"
  tls:
    image: nginx:alpine
    container_name: jellyfinmod-live-tls
    networks:
      default:
        ipv4_address: $SUB.10
    volumes:
      - $ROOT/certs:/certs:ro
      - $ROOT/certs/nginx.conf:/etc/nginx/nginx.conf:ro
    restart: "no"
  # The web seed for the legal fixtures. The separate Transmission binds its connections to its VPN address, so a reply
  # must be routed back through that container rather than to the host: this container alone carries that route.
  webseed:
    image: nginx:alpine
    container_name: jellyfinmod-live-webseed
    cap_add:
      - NET_ADMIN
    networks:
      - acceptance
    command: ["sh", "-c", "ip route add 10.0.0.0/8 via $TX_IP && exec nginx -g 'daemon off;'"]
    volumes:
      - $ROOT/webseed:/webseed:ro
      - $ROOT/certs/webseed.conf:/etc/nginx/nginx.conf:ro
    restart: "no"
  relay:
    image: alpine/socat
    container_name: jellyfinmod-live-relay
    command: TCP-LISTEN:9091,fork,reuseaddr TCP:host.docker.internal:29091
    extra_hosts:
      - "host.docker.internal:host-gateway"
    networks:
      default:
        ipv4_address: $SUB.11
    restart: "no"
YAML
[ -s "$ROOT/catalog.json" ] || echo '{"movies":[],"series":[]}' > "$ROOT/catalog.json"
EOF
    remote "$ROOT" "$PORT" <<'EOF'
set -euo pipefail
ROOT=$1 PORT=$2
docker compose -f "$ROOT/compose.yml" up -d 2>&1 | tail -3
for i in $(seq 1 100); do
  [ "$(curl -s "http://127.0.0.1:$PORT/health")" = Healthy ] && curl -s "http://127.0.0.1:$PORT/web/index.html" | grep -q 'name="jellyfinmod-web"' && break
  sleep 3
done
echo "health $(curl -s "http://127.0.0.1:$PORT/health") after $((i * 3)) s; image $(docker inspect -f '{{.Image}}' jellyfinmod-live | cut -c8-19)"
EOF
    standins
}

relay() {
    remote "$ROOT" "$1" <<'EOF'
docker compose -f "$1/compose.yml" "$2" relay 2>&1 | tail -1
docker ps -a --filter name=jellyfinmod-live-relay --format '{{.Names}} {{.Status}}'
EOF
}

down() {
    remote "$ROOT" <<'EOF'
ROOT=$1
[ -s "$ROOT/standins/pid" ] && kill "$(cat "$ROOT/standins/pid")" 2>/dev/null
docker compose -f "$ROOT/compose.yml" down 2>&1 | tail -2
echo "containers: $(docker ps -a --format '{{.Names}}' | grep -c '^jellyfinmod-live' || true)"
EOF
}

case ${1:-} in
    image) image "${2:-}" ;;
    up) up ;;
    standins) standins ;;
    relay-stop) relay stop ;;
    relay-start) relay start ;;
    mem) mem ;;
    down) down ;;
    *) sed -n '2,16p' "$0"; exit 2 ;;
esac
