#!/usr/bin/env python3
"""Removes every fixture of the live acceptance from the live instance (runs on the test host from <state root>/standins/bin):
open queue rows with their torrents and data (only torrents this instance added), every catalog entry, every torrent in
the separate Transmission labelled for this instance (or the unrelated-torrent fixture, or listed by hash on the command
line), and every file under this instance's shared media and download folders; then asks Jellyfin to rescan the libraries
and proves the catalog, the libraries and the client are empty of this instance's fixtures. Nothing outside this instance
is touched.
  live-cleanup.py SHARED_DIR [EXTRA_HASH...]
Order: queue rows and their torrents, remaining torrents, files, a library rescan, then the entries (an entry whose media is
still in the library refuses removal)."""
import importlib.util, json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("a8", os.path.join(HERE, "live-a8.py"))
a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)
call = a8.call
shared, extra = sys.argv[1], set(sys.argv[2:])
if not shared.rstrip("/").endswith("live48096"):
    raise SystemExit("refusing: the shared folder must be this instance's own")

for row in call("GET", "/JellyfinMod/Queue")[1]["items"]:
    status, _ = call("DELETE", f"/JellyfinMod/Queue/{row['id']}", {"removeFromClient": True, "blocklist": False})
    print("queue row", row["entry"]["title"], status)


def rpc(body):
    import urllib.request, urllib.error
    def send(session=""):
        request = urllib.request.Request("http://127.0.0.1:29091/transmission/rpc", json.dumps(body).encode(), {"X-Transmission-Session-Id": session})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 409:
                return send(error.headers["X-Transmission-Session-Id"])
            raise
    return send()


torrents = rpc({"method": "torrent-get", "arguments": {"fields": ["hashString", "labels", "downloadDir", "name"]}})["arguments"]["torrents"]
mine = [t for t in torrents if t["downloadDir"].startswith("/accept/live48096/") and
        ({"jellyfinmod-live", "jellyfinmod-live-unrelated"} & set(t["labels"]) or t["hashString"] in extra or not t["labels"])]
if mine:
    rpc({"method": "torrent-remove", "arguments": {"ids": [t["hashString"] for t in mine], "delete-local-data": True}})
print("torrents removed", len(mine), [t["hashString"][:8] for t in mine])
time.sleep(5)

for folder in ("media/movies", "media/movies-b", "media/tv", "media-alt/movies", "downloads"):
    path = os.path.join(shared, folder)
    for name in os.listdir(path) if os.path.isdir(path) else []:
        target = os.path.join(path, name)
        shutil.rmtree(target) if os.path.isdir(target) and not os.path.islink(target) else os.remove(target)
# Jellyfin keeps the items of an empty library root (it cannot tell an emptied folder from an unmounted one), so each
# root holds a placeholder while the rescan removes the missing items; the placeholders go at the end. A loose file does
# not count (the root is still "inaccessible or empty"), and an ordinary folder becomes a title, so the placeholder is a
# folder the host ignores by name.
roots = [os.path.join(shared, folder) for folder in ("media/movies", "media/movies-b", "media/tv", "media-alt/movies")]
PLACEHOLDER = "#recycle"
for root in roots:
    if os.path.isdir(root):
        os.makedirs(os.path.join(root, PLACEHOLDER), exist_ok=True)
        with open(os.path.join(root, PLACEHOLDER, "keep.txt"), "w") as handle:
            handle.write("keep\n")
call("POST", "/Library/Refresh")
for _ in range(30):
    time.sleep(10)
    if call("GET", "/Items?Recursive=true&IncludeItemTypes=Movie,Series,Episode&Limit=0")[1]["TotalRecordCount"] == 0:
        break

# Entries go last: an entry with media still in the library refuses removal (it would come back without its settings).
for _ in range(10):
    remaining = call("GET", "/JellyfinMod/Entries?limit=200")[1]["items"]
    for entry in remaining:
        status, body = call("DELETE", f"/JellyfinMod/Entries/{entry['id']}")
        if status >= 300:
            print("entry", entry["title"], status, json.dumps(body)[:100])
    if not remaining:
        break
    call("POST", "/Library/Refresh")
    time.sleep(30)
for root in roots:
    placeholder = os.path.join(root, PLACEHOLDER)
    if os.path.isdir(placeholder):
        shutil.rmtree(placeholder)
entries = call("GET", "/JellyfinMod/Entries?limit=200")[1]["totalRecordCount"]
items = call("GET", "/Items?Recursive=true&IncludeItemTypes=Movie,Series,Episode&Limit=0")[1]["TotalRecordCount"]
left = [t for t in rpc({"method": "torrent-get", "arguments": {"fields": ["hashString", "downloadDir"]}})["arguments"]["torrents"]
        if t["downloadDir"].startswith("/accept/live48096/")]
files = sum(len(files) for _, _, files in os.walk(shared))
print("after cleanup: catalog entries", entries, "native movies/series/episodes", items, "torrents of this instance", len(left), "files", files)
sys.exit(0 if entries == 0 and items == 0 and not left and files == 0 else 1)
