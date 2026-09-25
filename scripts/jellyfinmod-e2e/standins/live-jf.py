#!/usr/bin/env python3
"""API helper for the live acceptance instance only (port 48096). Tokens stay in 0600 files and are never printed.

  live-jf.py login [user]                        signs in with an empty password (oleksii by default)
  live-jf.py logout [user]
  live-jf.py [-u user] [-a] METHOD PATH [JSON]   prints the status and the body; -a sends no token (anonymous)
  live-jf.py [-u user] secret METHOD PATH JSON FILE NAME
                                                 replaces the string "__SECRET__" in JSON with NAME's value from the
                                                 KEY=VALUE file FILE, then sends it; the value never reaches argv or output
"""
import json, os, sys, urllib.request, urllib.error

BASE = "http://127.0.0.1:48096"
# The helper runs from <state root>/standins/bin on the test host; the 0600 files live in <state root>/secrets.
SECRETS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "secrets")
MERGE_FIELDS = {
    "Indexers": ["name", "baseUrl", "enabled", "automateTitleMatches", "categories", "priority", "downloadHosts",
                 "minimumSeedRatio", "minimumSeedMinutes", "minIntervalSeconds", "dailyQueryBudget"],
    "DownloadClients": ["name", "kind", "baseUrl", "username", "enabled", "label", "downloadDirectory", "localDirectory",
                        "openUrl"],
    "QualityProfiles": ["name", "qualities", "minimumBytesPerHour", "maximumBytesPerHour", "cutoff", "upgradeAllowed",
                        "upgradeMode", "minimumAutoScore", "minimumSeeders"],
}


def token_file(user):
    return os.path.join(SECRETS, f".token-{user}")


def call(method, path, body=None, user="oleksii", anonymous=False):
    header = f'MediaBrowser Client="JellyfinMod live", Device="pi", DeviceId="jfmod-live-{user}", Version="1.0"'
    if not anonymous:
        header += f', Token="{open(token_file(user)).read().strip()}"'
    data = body.encode() if isinstance(body, str) else (json.dumps(body).encode() if body is not None else None)
    request = urllib.request.Request(BASE + path, data=data, method=method,
                                     headers={"Content-Type": "application/json", "Authorization": header})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()[:2000]


def show(status, text):
    print(status)
    try:
        print(json.dumps(json.loads(text), indent=1))
    except ValueError:
        print(text)


def main(argv):
    user, anonymous = "oleksii", False
    while argv and argv[0] in ("-u", "-a"):
        if argv[0] == "-u":
            user, argv = argv[1], argv[2:]
        else:
            anonymous, argv = True, argv[1:]
    command = argv[0]
    if command == "login":
        user = argv[1] if len(argv) > 1 else user
        status, text = call("POST", "/Users/AuthenticateByName", {"Username": user, "Pw": ""}, user=user, anonymous=True)
        if status != 200:
            sys.exit(f"login failed {status}")
        result = json.loads(text)
        fd = os.open(token_file(user), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.write(fd, result["AccessToken"].encode())
        os.close(fd)
        print("logged in as", result["User"]["Name"], result["User"]["Id"], "admin", result["User"]["Policy"]["IsAdministrator"])
    elif command == "logout":
        user = argv[1] if len(argv) > 1 else user
        call("POST", "/Sessions/Logout", user=user)
        os.remove(token_file(user))
        print("logged out", user)
    elif command == "qsum":
        # One line per queue row: id prefix, state, stored state, reason, progress, observedAt, seeding summary.
        status, text = call("GET", "/JellyfinMod/Queue", user=user)
        data = json.loads(text)
        for row in data["items"]:
            seed = row.get("seeding") or {}
            print(row["id"][:8], (row.get("entry") or {}).get("title"), (row.get("episode") or {}).get("label") or "",
                  row["state"], row["importState"], row.get("reason"), row.get("progress"), str(row.get("observedAt"))[11:19],
                  "seed:" + str(seed.get("state")) + "/" + str(seed.get("reason")) + "/" + ",".join(seed.get("waitingFor") or []))
        print("rows", data["totalRecordCount"], "client reachable", data["clientStatus"]["reachable"], "automation", data.get("automation"))
    elif command == "hist":
        status, text = call("GET", f"/JellyfinMod/Entries/{argv[1]}", user=user)
        data = json.loads(text)
        print(data["entry"]["state"], data["entry"].get("jellyfinItemId"))
        for event in data["history"]:
            print(" ", event["createdAt"][:19], event["eventType"], event["summary"][:110], event.get("episodeId") or "")
    elif command == "merge":
        # merge KIND ID JSON: PATCH a settings record with its current values plus JSON, keeping the secret unchanged.
        kind, ident, overrides = argv[1], argv[2], json.loads(argv[3])
        fields = MERGE_FIELDS[kind]
        status, text = call("GET", f"/JellyfinMod/Settings/{kind}", user=user)
        current = next(item for item in json.loads(text) if item["id"] == ident)
        body = {name: current.get(name) for name in fields if name in current}
        if kind == "Indexers":
            body["apiKey"] = {"action": "unchanged", "value": None}
        if kind == "DownloadClients":
            body["password"] = {"action": "unchanged", "value": None}
        body.update(overrides)
        body["revision"] = current["revision"]
        show(*call("PATCH", f"/JellyfinMod/Settings/{kind}/{ident}", body, user=user))
    elif command == "secret":
        method, path, template, file, name = argv[1:6]
        values = dict(line.rstrip("\n").split("=", 1) for line in open(file) if "=" in line)
        if not values.get(name):
            sys.exit(f"{name} is not set in the secrets file")
        body = template.replace("__SECRET__", json.dumps(values[name])[1:-1])
        status, text = call(method, path, body, user=user)
        print(status)
        print("(response withheld: it followed a secret write)" if status < 300 else text[:300])
    else:
        method, path = command, argv[1]
        show(*call(method, path, argv[2] if len(argv) > 2 else None, user=user, anonymous=anonymous))


if __name__ == "__main__":
    main(sys.argv[1:])
