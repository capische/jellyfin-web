# Finding Prowlarr and Transmission without knowing their names

Research note, 2026-10-15 (Opus 5.5, high). Question from the user: can the settings wizard find the
existing Prowlarr and Transmission by itself and offer them in a picker, given that their container
names vary? Research only; nothing here is built. Context: the wizard is
[PHASE7 §7 / S10](../PHASE7.md), native Prowlarr support is [PHASE7 §6 / S9](../PHASE7.md) and is
already built (`ProwlarrSync` calls `api/v1/system/status`, `health`, `indexer`, `indexerstatus`).

**Decision, 2026-10-15:** the user approved option 1 and asked for the Indexers (Prowlarr) step before the Download
Client step ("Then you should reorder and put Prowlarr before Download Client"). Built as P6.FU1 ([PLAN.md](../PLAN.md),
[UX.md](../UX.md) §12.2, [API.md](../API.md) *Settings*); option 2 is not approved.

## Recommendation

1. **Pre-fill the download client from Prowlarr (effort S).** The admin already types one Prowlarr
   URL and API key for the indexer sync. After that test passes, one more read of
   `GET /api/v1/downloadclient` returns every download client Prowlarr knows, with `implementation`
   (`Transmission`, `QBittorrent`, …) and the fields `host`, `port`, `useSsl`, `urlBase` and
   `username` in clear; `password` comes back as `********` (Prowlarr's `SchemaBuilder` masks every
   `Password`/`ApiKey` field, [source][pw-mask]; Transmission's fields, [source][tr-settings]). The
   wizard shows "Use Transmission from Prowlarr (host:port)", fills the form, the admin types the
   password if there is one, and the existing Transmission test decides.
   - *Fails when:* Prowlarr has no download client (common: Prowlarr needs one only for grabs from
     its own UI, so many users never add one); the host is written from Prowlarr's network view
     (`localhost` behind a VPN sidecar, a service name on a network Jellyfin is not on). On a failed
     test, retry the same port on Jellyfin's default gateway once, then leave the form for the
     admin.
   - *Admin still types:* the Prowlarr URL and key (already), the Transmission password.
   - *Security:* no new secret, no new request target beyond what the admin entered; the plugin never
     sees Transmission's password from Prowlarr.
   - *Real test:* the S9 disposable Prowlarr with a Transmission client added through its API, then
     the wizard in the browser against a real Transmission.
2. **Optional "Find on this network" button (effort M), only if (1) is not enough.** On demand, from
   inside the Jellyfin container: take its own IPv4 subnet and default gateway from
   `/proc/net/route` (RFC 1918 only, capped at a /24 around its own address), TCP-connect to an
   allow-list of ports on those addresses, fingerprint each open port by response shape, and show the
   hits with a display name from reverse DNS. Nothing is saved until the admin picks a hit and its
   normal test passes.
   - *Fails when:* Jellyfin is on its own network and the services publish no host port (only the
     gateway is reachable then); non-default ports; services on another machine. It finds the
     service, never its key.
   - *Security:* admin-only, button-triggered, never in the background; private ranges and the
     gateway only; fixed port list; `GET` only, no redirects, no credentials or cookies sent, bodies
     capped at 16 KiB; 400 ms connect and 1.5 s request timeouts, about 10 s overall; results are
     not cached. It is still a port scan of the admin's LAN segment, so the button says so.
   - *Real test:* a throwaway Docker network with real Transmission and Prowlarr images under
     arbitrary names, a Jellyfin container on the same network and one on a separate network.

Not recommended: the Docker socket (an extra mount, root-equivalent, and most installs will not give
it to Jellyfin), mDNS/SSDP (none of these services advertise; I found no evidence of it),
reading `config.xml` from a shared volume (an extra mount per service), and anything that harvests an
API key from another app's web UI bootstrap data instead of the admin pasting it.

## Probe list for (2)

| Service | Ports | Request | Match |
| --- | --- | --- | --- |
| Transmission | 9091 | `GET /transmission/rpc` | `409` with `X-Transmission-Session-Id` (also `Server: Transmission`, `X-Transmission-Rpc-Version`); with RPC auth on, `401` + `WWW-Authenticate` naming Transmission |
| qBittorrent | 8080 | `GET /` | `<title>qBittorrent WebUI</title>`; `/api/v2/app/version` may answer `403` |
| Prowlarr | 9696 | `GET /` then `GET /ping` | `<title>Prowlarr</title>`; `/ping` is `{"status":"OK"}` on every *arr, so the title tells them apart |
| Sonarr / Radarr | 8989 / 7878 | `GET /` | `<title>Sonarr</title>` / `<title>Radarr</title>` |
| Jackett | 9117 | `GET /UI/Dashboard` | `302` to `/UI/Login`, `Server: Kestrel` |

Observed on the Pi on 2026-10-15 with unauthenticated `GET`s, keys not sent. Deluge, NZBGet and
SABnzbd are out of scope: there is no driver for them.

## What I tested for real

- **Docker reverse DNS lists container names.** Mac, Docker 29.8.2, throwaway user-defined network,
  four Redis containers named `alpha-dl`, `my-indexer-x`, `zz-random`, `aliased-one` (alias
  `torrentbox`), probed from `jellyfinmod-local/jellyfin:12.0.0`: `getent hosts <ip>` returned
  `alpha-dl.jfmodprobe-net` and so on for every container, and the alias resolved forward. On the
  default `bridge` network there is no embedded DNS (no PTR, no names); from another network,
  nothing. Misses are slow (about 0.56 s each serially, 8 s for a parallel /24), so a scan connects
  first and asks PTR only for hits. The ARP table was empty until traffic flowed, so it is no
  inventory. `tasks.<name>` exists only in Swarm. All containers and the network were removed.
- **The real layout on the Pi** (read-only `docker ps`/`inspect`): the household Jellyfin shares one
  compose network with Prowlarr, Sonarr, Radarr, Jackett and a Transmission that runs inside a VPN
  image (so its name is not `transmission`). The mod instances sit on
  their own `<project>_default` networks; 28096 shares its network with `transmission-acceptance`,
  18096 shares none. So "same network" holds for a single-compose stack and not for a separately
  deployed Jellyfin, which reaches the others only through ports published on the gateway.
- **Fingerprints:** the table above, read on the Pi.
- **Prowlarr masking:** read in source, not exercised against a live Prowlarr.

## What other projects do

Every *arr-adjacent tool onboards by **typed host, port and API key plus a Test button**; none
scans:

- Sonarr, Radarr, Prowlarr: download clients and indexers are typed by hand and tested. Prowlarr's
  Applications sync asks for "Prowlarr Server", "Sonarr Server" and the Sonarr API key, with help
  text saying "as Sonarr sees it" ([source][app-settings]).
- Overseerr / Jellyseerr / Seerr: Settings → Services, hostname, port, key, URL base, Test, then it
  loads profiles and root folders ([guide][seerr]). Requestrr, Huntarr and Autobrr work the same way.
- Recyclarr: `base_url` and `api_key` in YAML or `secrets.yml` ([docs][recyclarr]); Notifiarr and
  Unpackerr: env vars such as `DN_SONARR_0_URL`/`_API_KEY` ([search][notifiarr]); cross-seed:
  copied Torznab URLs `http://prowlarr:9696/<id>/api?apikey=…` and `?apikey=` URLs
  ([docs][cross-seed]). Hosted stacks (QuickBox, Saltbox) pre-configure because their installer
  created the apps.
- Dashboards that do discover use the **Docker socket plus opt-in labels**: Homepage
  `homepage.*` ([docs][homepage]), Flame `flame.*` ([source][flame]), Homarr's container widget
  ([docs][homarr]), Traefik's Docker provider. Heimdall, Organizr and Dashy are manual. Even with
  the socket, the labels are typed by the admin per container.

Common complaints: `localhost` inside a container points at the container itself, so "Test failed"
is the most common support question and every guide tells users to type the service name or LAN
IP; the Docker socket is root-equivalent and `:ro` does not limit the API ([Netdata][sock],
[Uptime Kuma #4783][kuma]), so projects steer users to a filtering proxy such as
docker-socket-proxy with `POST=0`, which some users still distrust as one more privileged image;
labels have to be maintained per container.

[pw-mask]: https://github.com/Prowlarr/Prowlarr/blob/develop/src/Prowlarr.Http/ClientSchema/SchemaBuilder.cs
[tr-settings]: https://github.com/Prowlarr/Prowlarr/blob/develop/src/NzbDrone.Core/Download/Clients/Transmission/TransmissionSettings.cs
[app-settings]: https://github.com/Prowlarr/Prowlarr/blob/develop/src/NzbDrone.Core/Applications/Sonarr/SonarrSettings.cs
[seerr]: https://jellywatch.app/blog/seerr-installation-guide-docker-linux-unraid-windows-2026
[recyclarr]: https://recyclarr.dev/wiki/yaml/config-reference/basic/
[notifiarr]: https://hub.docker.com/r/golift/notifiarr
[cross-seed]: https://www.cross-seed.org/docs/basics/options
[homepage]: https://gethomepage.dev/configs/docker/
[flame]: https://github.com/pawelmalak/flame
[homarr]: https://homarr.dev/docs/integrations/docker/
[sock]: https://www.netdata.cloud/guides/docker/docker-socket-security/
[kuma]: https://github.com/louislam/uptime-kuma/issues/4783
