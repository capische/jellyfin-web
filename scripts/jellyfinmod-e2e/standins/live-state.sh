#!/usr/bin/env bash
# Prints the live instance's state for the final re-run checklist, read-only (runs on the test host from
# <state root>/standins/bin). Signs in as oleksii with an empty password; prints no token or secret. One fact per line:
#   health <version> <ok> bundle <bundle id>
#   automation enabled <bool>
#   JellyfinMod items <n> entries <n>        (native items titled "JellyfinMod …", catalog entries)
#   timing LibraryMonitorDelay <s> importPollSeconds <s> real-time on <library names or none>
#   migration <id>                            (the two newest migrations the checklist names)
#   plugin folder <name>                      (every JellyfinMod* folder under plugins/)
#   leftovers upgrade container <n> upgrade copy <n> scan fixtures <n> catalog backup <n>
#   started <container> <time>                (the shared Transmission and the acceptance instance, to prove no restart)
set -uo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
ROOT=$(cd ../.. && pwd)
python3 - <<'PY'
import importlib.util
spec = importlib.util.spec_from_file_location("a8", "live-a8.py"); a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)
low = lambda d: {k.lower(): v for k, v in (d or {}).items()}
health = low(a8.call("GET", "/JellyfinMod/Health")[1]); web = low(health.get("web"))
print("health", health.get("version"), health.get("ok"), "bundle", web.get("bundleid"))
print("automation enabled", a8.call("GET", "/JellyfinMod/Settings/Automation")[1].get("automationEnabled"))
items = a8.call("GET", "/Items?Recursive=true&SearchTerm=JellyfinMod")[1]["TotalRecordCount"]
entries = a8.call("GET", "/JellyfinMod/Entries")[1]
entries = entries if isinstance(entries, list) else low(entries).get("items", [])
print("JellyfinMod items", items, "entries", len(entries))
folders = a8.call("GET", "/Library/VirtualFolders")[1]
on = [f["Name"] for f in folders if f["LibraryOptions"].get("EnableRealtimeMonitor")]
print("timing LibraryMonitorDelay", a8.call("GET", "/System/Configuration")[1]["LibraryMonitorDelay"],
      "importPollSeconds", a8.call("GET", "/JellyfinMod/Settings/Import")[1]["importPollSeconds"],
      "real-time on", ", ".join(on) or "none")
PY
sqlite3 "$ROOT/config/data/jellyfinmod/jellyfinmod.db" "SELECT MigrationId FROM __EFMigrationsHistory WHERE MigrationId LIKE '%\_PhaseFiveScanAnchor' ESCAPE '\\' OR MigrationId LIKE '%\_PhaseSevenTraktObservations' ESCAPE '\\' ORDER BY 1" \
    | sed 's/^/migration /'
for folder in "$ROOT"/config/plugins/JellyfinMod*; do [ -e "$folder" ] && echo "plugin folder $(basename "$folder")"; done
echo "leftovers upgrade container $(docker ps -a --format '{{.Names}}' | grep -cx jellyfinmod-upgrade)" \
    "upgrade copy $(ls -d "$ROOT/upgrade-scratch" 2>/dev/null | wc -l)" \
    "scan fixtures $(ls -d "$ROOT"/staging/fx-scan-* "$ROOT"/webseed/fx-scan-* 2>/dev/null | wc -l)" \
    "catalog backup $(ls "$ROOT/catalog.before-scan.json" 2>/dev/null | wc -l)"
docker inspect -f '{{.Name}} {{.State.StartedAt}}' transmission-acceptance jellyfinmod-acceptance | sed 's#^/#started #'
