#!/bin/bash
# The real retention window's positive half (PHASE10 E5/E6, RET2), as a reboot-safe cron job on the isolated instance's
# host. Cron runs this every few minutes; it does nothing before the target time, runs `retention-live.py phase-b` once
# at or after it (so a reboot or an outage only delays the run), and removes its own crontab line only once the instance
# is proven safe.
#
#   retention-phase-b-cron.sh ENV_FILE DRIVER TARGET_UTC      TARGET_UTC as YYYYmmddHHMM, for example 202609251330
#
# ENV_FILE exports the driver's JFMOD_* settings (JFMOD_STATE_DIR included). Fail-safe (RET3-R1):
#   - phase-b runs at most once: phase-b.STARTED is written before it starts.
#   - After phase-b, and on every later tick until it succeeds, `safe-finish` restores the saved settings and removes
#     every fixture, each with retries, then verifies from the instance that retention is off, the saved settings are
#     back and no fixture is left; only then does it write safe.OK.
#   - phase-b.DONE is written, and the crontab line removed, only when that tick's safe-finish wrote safe.OK. Otherwise
#     phase-b.FAILED counts the failed attempts, the log and syslog say so loudly, and the job stays armed.
# The test verdict is phase-b.RESULT (phase-b's exit code); DONE means only that the instance is safe.
# JFMOD_CRONTAB_FILE (optional) makes the job edit that file instead of the user crontab, for rehearsing this script.
set -u
ENV_FILE=$1
DRIVER=$2
TARGET=$3
source "$ENV_FILE"
STATE=$JFMOD_STATE_DIR
LOG=$STATE/phase-b.log

crontab_read() {
    if [ -n "${JFMOD_CRONTAB_FILE:-}" ]; then cat "$JFMOD_CRONTAB_FILE" 2>/dev/null; else crontab -l 2>/dev/null; fi
}

crontab_write() {
    if [ -n "${JFMOD_CRONTAB_FILE:-}" ]; then cat > "$JFMOD_CRONTAB_FILE"; else crontab -; fi
}

remove_job() {
    crontab_read | grep -v -F "retention-phase-b-cron.sh $ENV_FILE" | crontab_write
}

loud() {
    echo "!!! $* ($(date -u +%FT%TZ))" >> "$LOG"
    logger -t jellyfinmod-retention "$*" 2>/dev/null || true
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
if [ "$code" != 401 ] && [ "$code" != 200 ]; then
    if [ -e "$STATE/phase-b.STARTED" ]; then
        loud "instance not answering (Health $code); safe-finish not yet done, retrying at the next tick"
    fi
    exit 0
fi

if [ ! -e "$STATE/phase-b.STARTED" ]; then
    date -u > "$STATE/phase-b.STARTED"
    echo "phase-b started $(date -u +%FT%TZ)" >> "$LOG"
    python3 "$DRIVER" seed-server > "$STATE/seed-server-phaseb.log" 2>&1 &
    SEED=$!
    sleep 3
    python3 "$DRIVER" phase-b >> "$LOG" 2>&1
    rc=$?
    echo "exit=$rc" >> "$LOG"
    echo "$rc" > "$STATE/phase-b.RESULT"
    kill "$SEED" 2>/dev/null
fi

# Whatever phase-b did, the instance must end with retention off, the settings restored and no fixture left.
rm -f "$STATE/safe.OK"
echo "safe-finish started $(date -u +%FT%TZ)" >> "$LOG"
python3 "$DRIVER" safe-finish >> "$LOG" 2>&1
safe=$?
echo "safe-finish exit=$safe" >> "$LOG"
if [ "$safe" -eq 0 ] && [ -s "$STATE/safe.OK" ]; then
    date -u > "$STATE/phase-b.DONE"
    rm -f "$STATE/phase-b.FAILED"
    echo "phase-b DONE: retention verified off, settings restored, no fixture left; crontab line removed" >> "$LOG"
    remove_job
else
    failures=$(( $(cat "$STATE/phase-b.FAILED" 2>/dev/null || echo 0) + 1 ))
    echo "$failures" > "$STATE/phase-b.FAILED"
    loud "SAFETY PATH FAILED (attempt $failures): retention may still be ON or fixtures present on $JFMOD_BASE; the job stays armed and retries at the next tick"
fi
