#!/usr/bin/env python3
"""What an administrator does by hand in the separate Transmission's web interface, for the I3 cases, limited to torrents
this live instance owns: remove one (keeping or deleting its data), or add a .torrent file with no labels.
  tx-hand.py remove HASH [--delete-data]     (refuses a torrent without the jellyfinmod-live label)
  tx-hand.py add FILE.torrent DOWNLOAD_DIR"""
import base64, json, sys, urllib.request, urllib.error

URL = "http://127.0.0.1:29091/transmission/rpc"


def rpc(body, session=""):
    request = urllib.request.Request(URL, json.dumps(body).encode(), {"X-Transmission-Session-Id": session})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 409:
            return rpc(body, error.headers["X-Transmission-Session-Id"])
        raise


if sys.argv[1] == "remove":
    ident = sys.argv[2]
    found = rpc({"method": "torrent-get", "arguments": {"ids": [ident], "fields": ["hashString", "labels"]}})["arguments"]["torrents"]
    if not found or not {"jellyfinmod-live", "jellyfinmod-live-unrelated"} & set(found[0]["labels"]):
        sys.exit("refusing: not a torrent of this live instance")
    print(rpc({"method": "torrent-remove", "arguments": {"ids": [ident], "delete-local-data": "--delete-data" in sys.argv}})["result"])
elif sys.argv[1] == "add":
    metainfo = base64.b64encode(open(sys.argv[2], "rb").read()).decode()
    print(json.dumps(rpc({"method": "torrent-add", "arguments": {"metainfo": metainfo, "download-dir": sys.argv[3]}})))
