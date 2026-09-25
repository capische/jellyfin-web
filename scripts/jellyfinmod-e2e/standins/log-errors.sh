#!/usr/bin/env bash
# Lists the ERR and FTL lines of a Jellyfin container's log, less the one known-harmless start-up line (P7.Q16).
# Run on the test host:  ssh <host> bash -s -- <container> < log-errors.sh
#
# Allowed, and only this: at each start of a JellyfinMod image, before that start's "Core startup complete", ONE
#   [ERR] [<thread>] Emby.Server.Implementations.Updates.InstallationManager: An error occurred while accessing the plugin manifest: http://localhost:8096/JellyfinMod/Repository
# whose exception, on the next line, is exactly
#   System.Net.Http.HttpRequestException: Response status code does not indicate success: 503 (Service Unavailable).
# Jellyfin's plugin-update task fires 3 s after start, while the server still answers 503 "loading" (plugin README,
# Troubleshooting). A second such line in the same start, the line after "Core startup complete", with another
# exception or status (a "503" further down a stack trace does not count), or from another logger or URL is reported
# like every other ERR/FTL line.
# Also allowed, counted apart as upstream: `[ERR] … ExceptionMiddleware: Error processing request: Token is required.
# URL GET /socket.` and `… Invalid token. URL GET /socket.` Jellyfin Web 12.0.0 itself opens the socket while a fresh
# page that is not signed in yet loads, and retries it with the revoked token after a sign-out while the page stays
# open. A probe on the disposable container counted the same with the stock client (takeover off) as with the
# JellyfinMod client: two "Token is required" per page load, three "Invalid token" per sign-out (PHASE7 Q16
# evidence, review/socket-probe.json). Any other ERR on /socket is reported.
# Prints each reported line (ids replaced by <id>), then "allowed: N, upstream socket: U, reported: M"; exits 1 when M > 0.
set -euo pipefail
container=${1:?container name}
docker logs "$container" 2>&1 | awk '
    # The one allowed line: exact level, logger, message and URL; its exception must be the next line, exactly.
    function flush() {
        if (pending == "") return
        if (pendingEarly && allowedThisStart == 0 &&
            pendingException ~ /^System\.Net\.Http\.HttpRequestException: Response status code does not indicate success: 503 \(Service Unavailable\)\.$/) {
            allowed++; allowedThisStart++
        } else { reported++; print pending }
        pending = ""; pendingException = ""; pendingLines = 0
    }
    /^\[/ { flush() }
    /Main: Jellyfin version/ { started = 0; allowedThisStart = 0 }
    /Core startup complete/ { started = 1 }
    /^\[[^]]*\] \[(ERR|FTL)\] / {
        line = $0; gsub(/[0-9a-f]{32}/, "<id>", line)
        if ($0 ~ /ExceptionMiddleware: Error processing request: (Token is required|Invalid token)\. URL GET \/socket\.$/) { socket++; next }
        if ($0 ~ /^\[[^]]*\] \[ERR\] \[[0-9]+\] Emby\.Server\.Implementations\.Updates\.InstallationManager: An error occurred while accessing the plugin manifest: http:\/\/localhost:8096\/JellyfinMod\/Repository$/) {
            pending = line; pendingEarly = !started; next
        }
        reported++; print line; next
    }
    pending != "" && !/^\[/ { if (pendingLines++ == 0) pendingException = $0 }
    END { flush(); printf "allowed: %d, upstream socket: %d, reported: %d\n", allowed, socket, reported; exit (reported > 0) }
'
