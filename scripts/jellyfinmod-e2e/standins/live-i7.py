#!/usr/bin/env python3
"""P5 I7/I9.5 over the live instance's real HTTP API. Runs on the test host from <state root>/standins/bin.
  live-i7.py remove TITLE_FRAGMENT [removeFromClient] [blocklist]   removes the blocked queue row whose title/reason matches
  live-i7.py access                                                  ordinary user and no-library user against queue routes
  live-i7.py poll SECONDS                                            two sessions poll the queue every 3 s; prints request count
"""
import importlib.util, json, os, subprocess, sys, threading, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("jf", os.path.join(HERE, "live-jf.py"))
jf = importlib.util.module_from_spec(spec); spec.loader.exec_module(jf)
spec = importlib.util.spec_from_file_location("a8", os.path.join(HERE, "live-a8.py"))
a8 = importlib.util.module_from_spec(spec); spec.loader.exec_module(a8)
call, check = a8.call, a8.check


def rows():
    return call("GET", "/JellyfinMod/Queue")[1]["items"]


def remove(fragment, remove_from_client=False, blocklist=False):
    row = next(r for r in rows() if fragment in (r.get("reason") or "") or fragment in r["releaseTitle"])
    info_hash = row["admin"]["infoHash"]
    before = a8.tx_torrents()
    status, body = call("DELETE", f"/JellyfinMod/Queue/{row['id']}", {"removeFromClient": remove_from_client, "blocklist": blocklist})
    time.sleep(3)
    after = a8.tx_torrents()
    gone = row["id"] not in [r["id"] for r in rows()]
    check(f"DELETE /Queue ({row['reason']}, removeFromClient={remove_from_client}, blocklist={blocklist}) answers 2xx and the row is gone",
          200 <= status < 300 and gone, [status, body])
    check("The torrent is " + ("removed from the client" if remove_from_client else "left in the client"),
          (info_hash in before) and ((info_hash not in after) if remove_from_client else (info_hash in after)), info_hash)
    if blocklist:
        entry = row["entry"]["id"]
        episode = (row.get("episode") or {}).get("id")
        status, found = a8.search(entry, episode)
        hit = [c for c in found["candidates"] if c["rawTitle"] == row["releaseTitle"]]
        check("A fresh search rejects the blocklisted release as blocklisted",
              bool(hit) and any(r["code"] == "blocklisted" for r in hit[0]["rejections"]), [(c["rawTitle"], [r["code"] for r in c["rejections"]]) for c in hit])
    print("removed", row["id"], info_hash)


def access():
    # Disposable users with no password, as the S11 security sweep does: one ordinary user with every library, one with none.
    made = []
    try:
        for name, folders in (("JellyfinMod Live ordinary " + uuid.uuid4().hex[:6], True), ("JellyfinMod Live nolib " + uuid.uuid4().hex[:6], False)):
            status, user = call("POST", "/Users/New", {"Name": name})
            made.append(user["Id"])
            if not folders:
                policy = call("GET", f"/Users/{user['Id']}")[1]["Policy"]
                policy.update({"EnableAllFolders": False, "EnabledFolders": []})
                call("POST", f"/Users/{user['Id']}/Policy", policy)
            subprocess.run([sys.executable, os.path.join(HERE, "live-jf.py"), "login", name], check=True, capture_output=True)
        ordinary, nolib = [call("GET", f"/Users/{i}")[1]["Name"] for i in made]
        import_id = next(r for r in rows())["id"]
        status, body = call("GET", "/JellyfinMod/Queue", user=ordinary)
        check("Ordinary user: GET /Queue is 403 queue_admin_only (queue visibility off by default)", status == 403 and "queue_admin_only" in json.dumps(body), [status, body])
        for method, path in (("DELETE", f"/JellyfinMod/Queue/{import_id}"), ("POST", f"/JellyfinMod/Imports/{import_id}/Retry"), ("GET", "/JellyfinMod/Seeding")):
            status, body = call(method, path, user=ordinary)
            check(f"Ordinary user: {method} {path.split('/')[2]} is 403", status == 403, status)
        # With queue visibility on, the ordinary user sees rows of libraries they can read; the no-library user sees none
        # and gets the concealed 404 on an import.
        settings = call("GET", "/JellyfinMod/Settings/Import")[1]
        settings["queueVisibleToUsers"] = True
        call("PATCH", "/JellyfinMod/Settings/Import", settings)
        s1, b1 = call("GET", "/JellyfinMod/Queue", user=ordinary)
        s2, b2 = call("GET", "/JellyfinMod/Queue", user=nolib)
        s3, b3 = call("GET", f"/JellyfinMod/Imports/{import_id}", user=nolib)
        s4, b4 = call("GET", f"/JellyfinMod/Imports/{uuid.uuid4().hex}", user=nolib)
        check("Queue visible to users: the ordinary user sees rows without the admin block", s1 == 200 and b1["items"] and all("admin" not in r or r["admin"] is None for r in b1["items"]),
              [s1, len(b1.get("items", [])) if isinstance(b1, dict) else b1])
        check("A user without library access sees no row", s2 == 200 and b2["items"] == [], [s2, len(b2.get("items", [])) if isinstance(b2, dict) else b2])
        strip = lambda body: {k: v for k, v in body.items() if k != "traceId"} if isinstance(body, dict) else body
        check("A user without library access gets the concealed 404 on GET /Imports/{id}, identical to an unknown id (traceId aside)",
              s3 == 404 and s4 == 404 and strip(b3) == strip(b4), [s3, strip(b3), s4, strip(b4)])
        settings = call("GET", "/JellyfinMod/Settings/Import")[1]
        settings["queueVisibleToUsers"] = False
        call("PATCH", "/JellyfinMod/Settings/Import", settings)
    finally:
        for user_id in made:
            name = call("GET", f"/Users/{user_id}")[1]["Name"]
            try:
                os.remove(jf.token_file(name))
            except OSError:
                pass
            status, _ = call("DELETE", f"/Users/{user_id}")
            print("deleted disposable user", status)


def poll(seconds):
    count = [0]
    def one():
        deadline = time.time() + seconds
        while time.time() < deadline:
            call("GET", "/JellyfinMod/Queue")
            count[0] += 1
            time.sleep(3)
    threads = [threading.Thread(target=one) for _ in range(2)]
    start = time.strftime("%H:%M:%S")
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    print("queue requests", count[0], "from", start, "to", time.strftime("%H:%M:%S"))


if __name__ == "__main__":
    command = sys.argv[1]
    if command == "remove":
        remove(sys.argv[2], "removeFromClient" in sys.argv, "blocklist" in sys.argv)
    elif command == "access":
        access()
    elif command == "poll":
        poll(int(sys.argv[2]))
