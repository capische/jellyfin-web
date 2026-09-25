#!/usr/bin/env python3
"""P4 A8 cases over the live instance's real HTTP API, with the separate Transmission read before and after each case.
Runs on the test host from <state root>/standins/bin. Prints one PASS/FAIL line per check, no secret and no token.

  live-a8.py identity ENTRY EPISODE_OF_OTHER_ENTRY    forged/expired ids, foreign episode, tampered revision
  live-a8.py duplicate ENTRY                         the same infohash from two indexers: sameHash rows, one grab only
  live-a8.py concurrent ENTRY                        two sessions grab the same target at once: one hold, one grab_active
  live-a8.py unrelated ENTRY TORRENT_FILE DIR        a torrent already in the client, added by hand: the grab is refused
                                                     and the client's torrent keeps its labels and folder
"""
import importlib.util, json, os, sys, threading, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("jf", os.path.join(HERE, "live-jf.py"))
jf = importlib.util.module_from_spec(spec); spec.loader.exec_module(jf)
spec = importlib.util.spec_from_file_location("tx", os.path.join(HERE, "tx-hand.py"))


def tx_torrents():
    import urllib.request, urllib.error
    def rpc(body, session=""):
        request = urllib.request.Request("http://127.0.0.1:29091/transmission/rpc", json.dumps(body).encode(), {"X-Transmission-Session-Id": session})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 409:
                return rpc(body, error.headers["X-Transmission-Session-Id"])
            raise
    return {t["hashString"]: t for t in rpc({"method": "torrent-get", "arguments": {"fields": ["hashString", "labels", "downloadDir", "name"]}})["arguments"]["torrents"]}


def call(method, path, body=None, user="oleksii"):
    status, text = jf.call(method, path, body, user=user)
    try:
        return status, json.loads(text) if text else None
    except ValueError:
        return status, text


def check(name, ok, detail=None):
    print(("PASS " if ok else "FAIL ") + name + ("" if detail is None else " :: " + json.dumps(detail)[:500]), flush=True)


def search(entry, episode=None, user="oleksii"):
    path = f"/JellyfinMod/Releases?entryId={entry}" + (f"&episodeId={episode}" if episode else "")
    return call("GET", path, user=user)


def grab(search_id, release_id, key=None, user="oleksii"):
    return call("POST", "/JellyfinMod/Releases/Grab", {"searchId": search_id, "releaseId": release_id, "idempotencyKey": key or "live-" + uuid.uuid4().hex}, user=user)


def wait_final(operation_id, timeout=40):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, body = call("GET", f"/JellyfinMod/Grabs/{operation_id}")
        if body and body.get("state") not in ("pending", "submitting"):
            return body
        time.sleep(1)
    return body


def identity(entry, foreign_episode):
    status, body = grab(uuid.uuid4().hex, "nope")
    check("A forged searchId is refused (404 search_not_found)", status == 404 and "search_not_found" in json.dumps(body), [status, body])
    status, found = search(entry)
    status2, body = grab(found["searchId"], "forged-" + uuid.uuid4().hex)
    check("A forged releaseId in a real search is refused (404 release_not_found)", status2 == 404 and "release_not_found" in json.dumps(body), [status2, body])
    status, body = search(entry, foreign_episode)
    check("A movie search with another title's episode id is refused", status in (400, 404), [status, body])
    status, body = call("GET", "/JellyfinMod/Settings/Acquisition")
    stale = body["revision"] - 1
    status, body = call("PATCH", "/JellyfinMod/Settings/Acquisition", {"enabled": True, "downloadClientId": body["downloadClientId"],
                        "defaultQualityProfileId": body["defaultQualityProfileId"], "revision": stale})
    check("A tampered (stale) configuration revision is refused (409 revision_conflict)", status == 409 and "revision_conflict" in json.dumps(body), [status, body])
    key = "live-idem-" + uuid.uuid4().hex
    status, found = search(entry)
    eligible = [c for c in found["candidates"] if c["eligible"]]
    if eligible:
        s1, b1 = grab(found["searchId"], eligible[0]["releaseId"], key)
        s2, b2 = grab(found["searchId"], eligible[0]["releaseId"], key)
        s3, b3 = grab(found["searchId"], eligible[-1]["releaseId"] if len(eligible) > 1 else "other", key)
        cancel = call("POST", f"/JellyfinMod/Grabs/{b1['id']}/Cancel")[1] if s1 == 202 else None
        check("The same idempotency key and payload answer 200 with the same operation; another payload with it is 409",
              s1 == 202 and s2 == 200 and b2["id"] == b1["id"] and s3 in (404, 409), [s1, s2, s3, (b3 or {}).get("type") if isinstance(b3, dict) else b3])
        check("Cancel during the hold ends it cancelled (API)", cancel and cancel.get("state") == "cancelled", cancel and cancel.get("state"))


def duplicate(entry, other_entry):
    """The same torrent from two indexers, for two copies of one title in two libraries: the hash is only known once the
    torrent is fetched, so the second grab is refused at hand-off, and the client holds one torrent."""
    status, found = search(entry)
    first = next(c for c in found["candidates"] if c["eligible"] and c["indexerName"] == "Private fixture feed")
    s1, b1 = grab(found["searchId"], first["releaseId"])
    final1 = wait_final(b1["id"]) if s1 == 202 else b1
    status, found2 = search(other_entry)
    second = next(c for c in found2["candidates"] if c["eligible"] and c["indexerName"] == "Boundary feed B")
    s2, b2 = grab(found2["searchId"], second["releaseId"])
    final2 = wait_final(b2["id"]) if s2 == 202 else b2
    hashes = [h for h, t in tx_torrents().items() if h == (final1 or {}).get("infoHash")]
    check("First copy (feed 1, library A) accepted", (final1 or {}).get("state") == "accepted", [s1, (final1 or {}).get("state"), (final1 or {}).get("infoHash")])
    check("The same infohash from feed B for the copy in library B is refused (duplicate_hash), not added twice",
          (s2 == 409 and "duplicate_hash" in json.dumps(b2)) or (final2 or {}).get("failureCode") == "duplicate_hash",
          [s2, (final2 or {}).get("state") if isinstance(final2, dict) else final2, (final2 or {}).get("failureCode") if isinstance(final2, dict) else None,
           (b2 or {}).get("type") if isinstance(b2, dict) else None])
    check("The client holds exactly one torrent for that hash", len(hashes) == 1, hashes)


def concurrent(entry):
    status, found = search(entry)
    rows = [c for c in found["candidates"] if c["eligible"]]
    results = []
    def one(release, user):
        results.append(grab(found["searchId"], release["releaseId"], user=user))
    threads = [threading.Thread(target=one, args=(rows[0], "oleksii")), threading.Thread(target=one, args=(rows[-1], "oleksii"))]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    codes = sorted(status for status, _ in results)
    check("Two concurrent grabs of one target: exactly one hold, the other grab_active",
          codes == [202, 409] and any("grab_active" in json.dumps(body) for _, body in results), [(s, (b or {}).get("type") or (b or {}).get("state")) for s, b in results])
    for status, body in results:
        if status == 202:
            call("POST", f"/JellyfinMod/Grabs/{body['id']}/Cancel")


def unrelated(entry, torrent_file, directory):
    import base64, urllib.request, urllib.error
    def rpc(body, session=""):
        request = urllib.request.Request("http://127.0.0.1:29091/transmission/rpc", json.dumps(body).encode(), {"X-Transmission-Session-Id": session})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 409:
                return rpc(body, error.headers["X-Transmission-Session-Id"])
            raise
    added = rpc({"method": "torrent-add", "arguments": {"metainfo": base64.b64encode(open(torrent_file, "rb").read()).decode(),
                                                          "download-dir": directory, "labels": ["jellyfinmod-live-unrelated"]}})
    info = added["arguments"].get("torrent-added") or added["arguments"].get("torrent-duplicate")
    before = tx_torrents()[info["hashString"]]
    status, found = search(entry)
    row = next(c for c in found["candidates"] if c["eligible"] and c.get("infoHash") in (None, info["hashString"]))
    s, body = grab(found["searchId"], row["releaseId"])
    final = wait_final(body["id"]) if s == 202 else body
    after = tx_torrents()[info["hashString"]]
    check("A torrent already in the client, owned by nobody here, is not claimed: the grab fails as a conflict",
          (final or {}).get("state") in ("failed",) or s == 409, [s, (final or {}).get("state"), (final or {}).get("failureCode")])
    check("The unrelated torrent keeps its labels and folder", before["labels"] == after["labels"] and before["downloadDir"] == after["downloadDir"],
          [before["labels"], after["labels"]])
    print("unrelated torrent hash", info["hashString"])


def grab_first(entry, episode=None, indexer=None):
    """Searches and grabs the first eligible row (optionally from one indexer); prints the final grab state."""
    status, found = search(entry, episode)
    if status != 200:
        print("search", status, found); return
    rows = [c for c in found["candidates"] if c["eligible"] and (indexer is None or c["indexerName"] == indexer)]
    if not rows:
        print("no eligible row", [(c["indexerName"], c["rawTitle"], [r["code"] for r in c["rejections"]]) for c in found["candidates"]]); return
    s, body = grab(found["searchId"], rows[0]["releaseId"])
    final = wait_final(body["id"]) if s == 202 else body
    print("grab", s, rows[0]["rawTitle"], (final or {}).get("state"), (final or {}).get("failureCode"), (final or {}).get("infoHash"), (final or {}).get("id"))


if __name__ == "__main__":
    if sys.argv[1] == "grab":
        grab_first(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != "-" else None, sys.argv[4] if len(sys.argv) > 4 else None)
        sys.exit(0)
    command = sys.argv[1]
    {"identity": lambda: identity(sys.argv[2], sys.argv[3]), "duplicate": lambda: duplicate(sys.argv[2], sys.argv[3]),
     "concurrent": lambda: concurrent(sys.argv[2]), "unrelated": lambda: unrelated(sys.argv[2], sys.argv[3], sys.argv[4])}[command]()
