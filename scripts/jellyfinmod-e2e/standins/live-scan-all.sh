#!/usr/bin/env bash
# Runs every case of the scan-wait live E2E (live-scan.py) on the live instance, with the entries live-scan-setup.py
# made. Runs on the test host from <state root>/standins/bin; takes about 45 minutes. Each case logs to
# <state root>/standins/state/scan-logs/<case>.log; the summary prints one "<case> exit=<code>" line per case.
# series-siblings needs the Shows library's real-time monitoring: it is switched on (with a container restart) for
# that case only and switched off again (with a restart) afterwards. Exits 0 only when every case passed and an unknown
# case name was refused with exit 2.
set -uo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
state=../state
logs=$state/scan-logs
mkdir -p "$logs"
ids=$state/scan-ids.json
[ -f "$ids" ] || { echo "no $ids: run live-scan-setup.py first"; exit 1; }
id() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d[sys.argv[2]] if len(sys.argv) < 4 else d[sys.argv[2] + "-episodes"][sys.argv[3]])' "$ids" "$@"; }
failed=0
run() { # run <log name> <case> <args...>
    local name=$1; shift
    timeout 2400 python3 live-scan.py "$@" > "$logs/$name.log" 2>&1
    local code=$?
    echo "$name exit=$code"
    [ $code -eq 0 ] || failed=1
}
realtime() { # realtime on|off, then restart the container and sign in again
    python3 - "$1" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("a8", "live-a8.py"); a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)
shows = [f for f in a8.call("GET", "/Library/VirtualFolders")[1] if f["Name"] == "Shows"][0]
status, _ = a8.call("POST", "/Library/VirtualFolders/LibraryOptions",
                    {"Id": shows["ItemId"], "LibraryOptions": dict(shows["LibraryOptions"], EnableRealtimeMonitor=(sys.argv[1] == "on"))})
print("Shows real-time monitoring", sys.argv[1], "->", status)
PY
    docker restart -t 30 jellyfinmod-live > /dev/null
    for _ in $(seq 60); do [ "$(curl -s http://127.0.0.1:48096/health)" = Healthy ] && break; sleep 3; done
    sleep 10
    python3 live-jf.py login > /dev/null 2>&1
}

python3 live-jf.py login > /dev/null 2>&1
run ordinary ordinary "$(id 700020)"
run overlapping overlapping "$(id 800005)" "$(id 800005 E01)" "$(id 800005 E02)"
run delay delay "$(id 700021)" 120
run restart restart "$(id 700022)"
run cancel cancel "$(id 700023)"
run cancel-later cancel-later "$(id 800005)" "$(id 800005 E03)" "$(id 800005 E04)"
stream=()
for e in 01 02 03 04 05 06 07 08 09 10 11 12; do stream+=("$(id 800002 E$e)"); done
run related-stream related-stream "$(id 800002)" "${stream[@]}"
realtime on
run series-siblings series-siblings "$(id 800003)" "$(id 800003 E01)" "$(id 800004)" "$(id 800004 E01)"
realtime off
python3 live-scan.py unrelated-stream > "$logs/unknown-case.log" 2>&1
code=$?
echo "unknown-case exit=$code ($(tail -1 "$logs/unknown-case.log" | cut -c1-40))"
[ $code -eq 2 ] || failed=1
[ $failed -eq 0 ] && echo "ALL SCAN CASES PASSED" || echo "SOME SCAN CASES FAILED"
exit $failed
