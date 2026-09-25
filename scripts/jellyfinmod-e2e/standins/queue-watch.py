#!/usr/bin/env python3
"""Samples the live instance's queue, browse projection and the client at once, N times: shows that the three agree.
  queue-watch.py ENTRY_ID SAMPLES INTERVAL_SECONDS"""
import json, subprocess, sys, time, os
sys.path.insert(0, os.path.dirname(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location("jf", os.path.join(os.path.dirname(__file__), "live-jf.py"))
jf = importlib.util.module_from_spec(spec); spec.loader.exec_module(jf)

entry, samples, every = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
for i in range(samples):
    s, q = jf.call("GET", f"/JellyfinMod/Queue?entryId={entry}")
    s2, e = jf.call("GET", f"/JellyfinMod/Entries/{entry}")
    q, e = json.loads(q), json.loads(e)
    row = q["items"][0] if q["items"] else {}
    acq = e.get("acquisition") or {}
    print(time.strftime("%H:%M:%S"), "queue:", row.get("state"), row.get("importState"), row.get("reason"),
          "p=%s" % (round(row["progress"], 4) if row.get("progress") is not None else None), "obs=" + str(row.get("observedAt"))[11:19],
          "| client reachable=%s" % q["clientStatus"]["reachable"], "| entry:", e.get("state"), acq.get("state"),
          "p=%s" % (round(acq["progress"], 4) if acq.get("progress") is not None else None), flush=True)
    if i + 1 < samples:
        time.sleep(every)
