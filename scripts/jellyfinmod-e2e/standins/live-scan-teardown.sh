#!/usr/bin/env bash
# Undoes live-scan-setup.py on the live instance (runs on the test host from <state root>/standins/bin):
# live-cleanup.py (queue, torrents, files, native items, entries), then the scan releases leave the private feed, the
# staged fixtures go, and the stand-in catalog is restored. Prints the timing settings the scan cases change.
#   live-scan-teardown.sh SHARED_DIR
# Exits 0 only when the cleanup reports all zeros and the catalog was restored.
set -uo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
root=$(cd ../.. && pwd)
python3 live-cleanup.py "$1" | tail -1
cleanup=${PIPESTATUS[0]}
python3 - "$root/standins/state/releases.json" <<'PY'
import json, sys, urllib.request
for release in json.load(open(sys.argv[1])):
    if release["id"].startswith("fx-scan-"):
        urllib.request.urlopen(f"http://127.0.0.1:48119/withdraw?id={release['id']}", timeout=30).read()
left = sum(release["id"].startswith("fx-scan-") for release in json.load(open(sys.argv[1])))
print("scan releases left on the feed:", left)
PY
rm -rf "$root"/staging/fx-scan-* "$root"/webseed/fx-scan-*
restored=1
if [ -f "$root/catalog.before-scan.json" ]; then
    mv "$root/catalog.before-scan.json" "$root/catalog.json" && restored=0
elif ! grep -q 'fx-scan-' "$root/catalog.json" 2>/dev/null; then
    restored=0  # already restored by an earlier run: no backup and no scan titles left
fi
echo "catalog restored: $([ $restored -eq 0 ] && echo yes || echo NO)"
python3 - <<'PY'
import importlib.util
spec = importlib.util.spec_from_file_location("a8", "live-a8.py"); a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)
realtime = [(f["Name"], f["LibraryOptions"].get("EnableRealtimeMonitor")) for f in a8.call("GET", "/Library/VirtualFolders")[1]]
print("LibraryMonitorDelay", a8.call("GET", "/System/Configuration")[1]["LibraryMonitorDelay"],
      "importPollSeconds", a8.call("GET", "/JellyfinMod/Settings/Import")[1]["importPollSeconds"], "real-time", realtime)
PY
[ $cleanup -eq 0 ] && [ $restored -eq 0 ]
