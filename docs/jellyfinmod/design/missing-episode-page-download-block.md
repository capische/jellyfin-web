# Missing-episode page: download block and metadata — APPROVED 2026-10-13 (artifact v2)

**User:** "Looks good besides I see no sense in download cloud over the episode card in episode page, too much information." So: **no disc / cloud / mark on the still** on the episode page — the download block carries the state; the still is plain, as a downloaded episode's is. (The disc stays on cards and rows elsewhere, as approved.) Everything else below stands; the open decisions default to the recommendations unless the user says otherwise.

Session: Row Icon State Designs (local_0162f905…). Interactive artifact: https://claude.ai/artifact/1Fu8eWkkNgzobkRimgHfHS (v2, still without the mark); file `missing-episode-page-download-block.html` (self-contained), screenshots `missing-episode-page-*.png`.

User's request: "Episode page: design progress going on here. It got nothing although I expect there supposed to be tags, and more stuff. Probably in the area for Video / Audio / Subtitle — it would be a good place for download progress."

## The proposal in one paragraph

Upstream's episode page stays the layout; the mod fills the two places upstream leaves empty for an episode without a file. The **track-selector slot** (where Video / Audio / Subtitle sit on a downloaded episode) holds one **download block**: a paper panel with the approved ring at 4em on the left (percent inside — there is room here, and the same ring at 1.6em stays on the still) and, on the right, the state word with its figures ("Downloading **42% · 12 min left · 3.1 MB/s · 1.9 of 4.6 GB**"), the release name in a small monospace line, its marks (1080P WEB-DL H.264 DD+ 5.1 EN · 38.2 GB · TorrentGalaxy as a link · Open Transmission icon for administrators), the pack line ("Season 1 pack · this episode is file 6 of 10" with a ten-dot strip: green imported, amber downloading with a ring, grey waiting), a 0.28em bar, and the actions: *View Queue* link for everyone, *Cancel Download* (grey) for administrators. When the import finishes the block **becomes upstream's Video / Audio / Subtitle selectors** and Play appears in the header — the "imported (after)" state on the page shows the transition. The **misc line** gains the series' certification (TV-MA) and the page gains upstream's **genres line** (Comedy, Drama, Sport) from the series' stored metadata; no other metadata is added.

## States (toggle on the page; the still carries no mark)

| state | ring | state line | lines below | actions |
|---|---|---|---|---|
| downloading | 42 % inside, amber arc | Downloading · 42% · 12 min left · 3.1 MB/s · 1.9 of 4.6 GB | release, marks, pack, bar | View Queue · Cancel Download (admin) |
| stalled | 42 % dimmed, arc dimmed | Stalled · 42% · no seeders for 20 min | same, bar dimmed | same |
| queued | clock | Queued · 2 ahead in Transmission | release, marks, pack (all grey) | same |
| importing | spinner | Importing · linking into the library… | release, marks, breathing full bar | View Queue |
| failed | red ! | Failed · no space left on the download disk (red) | release, marks | **Search Again** (red, admin) · View Queue |
| not downloaded | amber cloud | Not Downloaded | — | **Get a Release** (blue, admin; as built); ordinary users see "no release chosen yet" |
| unaired | clock | Unaired · airs 19 May 2027 · in 7 months | — | — |
| imported | — | the block is upstream's Video / Audio / Subtitle selectors; Play, Played, Favourite, Get Another Quality (admin), More in the header | | |

Countdown: "in N days" under 30 days, else "in N months"; the full date is always there, so the countdown is a convenience, not a second clock.

## Layouts

- **Desktop:** still left, names and buttons right (as built); the block spans the primary column (max 60em).
- **Phone 360:** still full width, then names; the block keeps the ring on the left at 3.2em with the state line beside it and the figures wrapping under the word; everything else stacks.
- **TV 125 %:** the same page at 20 px root. Focus order: header *Get a Release* → More → (in the block) TorrentGalaxy link → Open Transmission → View Queue → Cancel Download / Search Again / Get a Release → Cast & Crew cards. The ring, the marks and the pack strip are not stops. The white double ring marks focus (shown on the first header button in the TV frame).
- Dark and light both drawn; the panel is the theme's paper on the ground, like upstream's cards.

## Where each field comes from (also on the page)

| on the page | source | state |
|---|---|---|
| series, "Season 1 – 1. Pilot", still, overview | entry + episode (TMDB, stored) | built |
| air date, runtime, ★ rating | `episode.airDate`, `runtimeMinutes`, `metadata.episodeRatings` | built |
| certification on the misc line | `metadata.certifications` (series) | proposed, no plugin change |
| genres line | `metadata.genres` (series) | proposed, no plugin change |
| Director / Writer lines, Cast & Crew, Guest Stars | `episode.credits`, `metadata.cast` | built |
| state, %, time left, rate, size, message | `QueueRow` (`progress`, `etaSeconds`, `downloadRateBytes`, `sizeBytes`, `downloadedBytes`, `message`) | no plugin change |
| release name | `QueueRow.releaseTitle` / `AcquisitionSummary.releaseTitle` | no plugin change |
| marks 1080p · WEB-DL · H.264 · DD+ 5.1 · EN | `ReleaseParser` on the name | **plugin:** add `parsed` to `QueueRow` (the picker's parser) |
| indexer name as link, release page | `GrabOperation.indexerName`; `detailsUrl` is not kept after the grab | **plugin:** keep `indexerName` + `detailsUrl` on the grab (admins); until then the name is plain text |
| Open Transmission | `QueueClient.openUrl` (admins) | no plugin change |
| pack: file N of M, per-episode strip | rows of the same `grabId`; per-file progress | **plugin:** per-file progress on a pack's rows (Phase 5 reports one figure per torrent) — without it the strip shows done / downloading / waiting from each episode's state and the ring shows the torrent's figure |
| seeders at grab time, tags/keywords, networks, production code | not stored (TMDB has keywords, networks, production_code) | **not proposed:** rarely read; each is a plugin field and a metadata refresh |
| media info, chapters, Video / Audio / Subtitle | need a file | absent until imported; no empty-state rows (upstream hides them too) |

## Do-not-over-engineer

Built for the three common states: downloading, not downloaded, unaired. The block is one component with one layout; the rarer states only change the ring, the state line and which button shows. No new section, no tags system, no network/keyword fields. "Tags" as the user expected them do not exist for an episode in upstream either (Jellyfin episodes carry no tags; the series page shows the series' genres), so the genres line is the honest equivalent.

## Build cost

One component `DownloadBlock` (≈ 150 lines TSX + 80 SCSS) mounted into `.trackSelections`' slot by `EntryEpisodeDetails` (the same `mount()` pattern), reusing `DownloadStateMark` (size `page`, 4em, number inside) and `useQueueRowFor`. The misc-line certification and genres line are two more `mount()`s. The imported transition is upstream's own page (the mod's page is replaced by Jellyfin's item page once the item exists), so nothing to build for it beyond the reload the queue hook already does. Plugin additions (optional, small): `parsed` on `QueueRow`; `indexerName` + `detailsUrl` on the grab.

## The user must decide

1. The block as drawn (recommended), or the lighter "queue line" that exists today plus a bar.
2. Percent inside the 4em ring on the page (recommended; cards and rows keep the arrow as approved).
3. Which plugin additions to take: `parsed` marks (recommended — the marks are the one thing the user asked for by name), indexer link (nice, rare), per-file pack progress (only if packs are common).
4. Certification + genres on the page (recommended, free) — and confirm that keywords / networks / production code stay out.
