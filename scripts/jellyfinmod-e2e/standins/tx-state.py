#!/usr/bin/env python3
"""Read-only view of the separate Transmission (torrent-get only): the torrents this live instance owns (label
jellyfinmod-live), or all of them with --all. Prints hash prefix, state, progress, dir, labels and seed modes."""
import json, sys, urllib.request, urllib.error

URL = "http://127.0.0.1:29091/transmission/rpc"
FIELDS = ["hashString", "name", "downloadDir", "labels", "percentDone", "status", "uploadRatio", "secondsSeeding",
          "seedRatioMode", "seedIdleMode", "rateDownload", "error", "errorString", "totalSize", "files"]


def rpc(body, session=""):
    request = urllib.request.Request(URL, json.dumps(body).encode(), {"X-Transmission-Session-Id": session})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 409:
            return rpc(body, error.headers["X-Transmission-Session-Id"])
        raise


torrents = rpc({"method": "torrent-get", "arguments": {"fields": FIELDS}})["arguments"]["torrents"]
show_all = "--all" in sys.argv
for t in torrents:
    if not show_all and "jellyfinmod-live" not in t["labels"]:
        continue
    print(t["hashString"], "status=%d" % t["status"], "done=%.3f" % t["percentDone"], "rate=%dkB/s" % (t["rateDownload"] // 1024),
          t["downloadDir"], ",".join(t["labels"]), "ratioMode=%d idleMode=%d" % (t["seedRatioMode"], t["seedIdleMode"]),
          "ratio=%.2f seeding=%ds" % (t["uploadRatio"], t["secondsSeeding"]), "files=%d" % len(t["files"]),
          "err=%s" % (t["errorString"] or "-"), "|", t["name"][:70])
print("torrents in client: %d (shown %s)" % (len(torrents), "all" if show_all else "jellyfinmod-live only"))
