#!/bin/bash
# The real retention window's positive half (PHASE10 E5/E6, RET2), as a reboot-safe cron job on the isolated instance's
# host. Cron runs this every few minutes; it does nothing before the target time, runs `retention-live.py phase-b` once
# at or after it (so a reboot or an outage only delays the run), and removes its own crontab line when it is done.
#
#   retention-phase-b-cron.sh ENV_FILE DRIVER TARGET_UTC      TARGET_UTC as YYYYmmddHHMM, for example 202609251330
#
# ENV_FILE exports the driver's JFMOD_* settings (JFMOD_STATE_DIR included). phase-b always ends with retention switched
# off, the saved settings restored and every fixture removed (the driver's `finally`); if it stops before that point, this
# wrapper runs restore and cleanup itself. The log is $JFMOD_STATE_DIR/phase-b.log; phase-b.DONE marks completion.
set -u
ENV_FILE=$1
DRIVER=$2
TARGET=$3
source "$ENV_FILE"
STATE=$JFMOD_STATE_DIR

remove_job() {
    crontab -l 2>/dev/null | grep -v -F "retention-phase-b-cron.sh $ENV_FILE" | crontab -
}

exec 9>"$STATE/phase-b.lock"
flock -n 9 || exit 0
if [ -e "$STATE/phase-b.DONE" ]; then
    remove_job
    exit 0
fi
[ "$(date -u +%Y%m%d%H%M)" -ge "$TARGET" ] || exit 0
# The instance must answer before anything runs; otherwise try again at the next tick.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$JFMOD_BASE/JellyfinMod/Health")
[ "$code" = 401 ] || [ "$code" = 200 ] || exit 0

echo "phase-b started $(date -u +%FT%TZ)" >> "$STATE/phase-b.log"
python3 "$DRIVER" seed-server > "$STATE/seed-server-phaseb.log" 2>&1 &
SEED=$!
sleep 3
python3 "$DRIVER" phase-b >> "$STATE/phase-b.log" 2>&1
rc=$?
echo "exit=$rc" >> "$STATE/phase-b.log"
kill "$SEED" 2>/dev/null
if [ "$rc" -ne 0 ]; then
    # Whatever failed, the instance must not be left with retention on or fixtures behind.
    { python3 "$DRIVER" login && python3 "$DRIVER" restore && python3 "$DRIVER" cleanup; python3 "$DRIVER" logout; } \
        >> "$STATE/phase-b.log" 2>&1
    echo "safety restore and cleanup exit=$?" >> "$STATE/phase-b.log"
fi
date -u > "$STATE/phase-b.DONE"
remove_job
