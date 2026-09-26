#!/usr/bin/env python3
"""One check-in of the Phase 6 long run on the live instance (runs on the test host from <state root>/standins/bin):
memory, automation status and budgets, every run since the last check-in, their decisions, the queue, and the stand-in
feeds' query counters compared with the runs' reported query counts. Read-only.
  live-checkin.py [SINCE_ISO]"""
import importlib.util, json, os, sys, urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("jf", os.path.join(HERE, "live-jf.py"))
jf = importlib.util.module_from_spec(spec); spec.loader.exec_module(jf)


def get(path):
    status, text = jf.call("GET", path)
    return json.loads(text) if status == 200 else {"status": status, "text": text[:200]}


since = sys.argv[1] if len(sys.argv) > 1 else "1970-01-01"
mem = {line.split(":")[0]: int(line.split()[1]) // 1024 for line in open("/proc/meminfo") if line.startswith(("MemAvailable", "SwapFree", "SwapTotal"))}
print("memory MB", mem, "BELOW 1 GB FLOOR" if mem["MemAvailable"] < 1024 else "")
status = get("/JellyfinMod/Automation/Status")
print("automation enabled", status["enabled"], "paused", status["pausedReasons"], "running", status["running"], "next", status["nextRunAt"])
print("budgets", status["budgets"])
for indexer in status["indexers"]:
    if indexer["queriesUsedToday"] or indexer["breakerOpenUntil"]:
        print("  indexer", indexer["name"], "queries today", indexer["queriesUsedToday"], "/", indexer["dailyQueryBudget"], "breaker", indexer["breakerOpenUntil"])
last = status["lastRun"]
print("last run", {k: last.get(k) for k in ("trigger", "startedAt", "completedAt", "status", "targetsConsidered", "searched", "skipped", "grabbed", "detail")})
names = {i["id"]: i["name"] for i in status["indexers"]}
print("  queriesByIndexer", {names.get(k, k): v for k, v in (last.get("queriesByIndexer") or {}).items()})
decisions = get("/JellyfinMod/Automation/Decisions?limit=200")
items = [d for d in decisions.get("items", []) if (d.get("createdAt") or d.get("decidedAt") or "") >= since]
print("decisions since", since, len(items), Counter((d.get("kind"), d.get("reason")) for d in items))
for d in items[:40]:
    print("  ", (d.get("createdAt") or d.get("decidedAt") or "")[:19], d.get("kind"), d.get("reason"), d.get("title") or d.get("entryTitle") or (d.get("entryId") or "")[:8],
          d.get("episodeLabel") or (d.get("episodeId") or "")[:8], (d.get("detail") or d.get("message") or "")[:90])
queue = get("/JellyfinMod/Queue")
for row in queue.get("items", []):
    print("  queue", row["entry"]["title"], (row.get("episode") or {}).get("label") or "", row["state"], row["importState"], row.get("reason"), row.get("progress"))
print("  queue automation", queue.get("automation"), "client reachable", queue.get("clientStatus", {}).get("reachable"))
with urllib.request.urlopen("http://127.0.0.1:48119/state", timeout=10) as response:
    counters = json.load(response)["counters"]
print("stand-in counters", {k: v for k, v in counters.items() if k.startswith("torznab") or k in ("download", "webseed")})
