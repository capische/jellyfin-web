# Phase 11 — notifications and the bell

**Future phase. Not scheduled. No entry gate is met.** Outline written 2026-09-24 so the request is
recorded; it becomes a full refinement (in the style of PHASE5–7) when it starts. Read
[PLAN.md](PLAN.md), [README.md](README.md), [UX.md](UX.md), [PHASE7.md](PHASE7.md) (the shell, the
settings area, `dpadModals`) and [PHASE10.md](PHASE10.md) (per-media retention) alongside it.
Everything here is **Proposed, not user-approved** except the accepted request below.

## Accepted user request — 2026-09-24

Verbatim: *"I feel like I will need notifications and a bell with unread notification which pops up
a list with messages."* The user asked for it to be planned as its own phase and **not implemented
now**.

It grew out of the Phase 10 decision that a user must be warned when a file's retention window
starts ("this file will be deleted on <date> unless kept"), including windows started by a watch
imported from Trakt. Phase 10 shows that warning on the title's detail page and in its History; this
phase gives such events one place to be seen without visiting each title.

## What the user sees (proposed)

- **A bell in the mod shell's top bar**, on every layout, with a badge showing the unread count
  (hidden at zero, capped as "9+").
- **Activating the bell opens a list** of messages, newest first: an icon for the kind, a one-line
  message, the title it concerns, a relative time, and read or unread styling. Each message links to
  what it is about (the title's detail page, the queue, the settings section). Actions where they are
  safe: **Keep** on a retention warning (admins only), **Open**, **Mark read**, **Mark all read**.
- **TV:** the bell is reachable by D-pad from the top bar; the list is a `dpadModals` pop-up, so Back
  closes it and returns focus to the bell. Sized in `em`, webOS 6–22 CSS limits respected.
- **Mobile:** the list opens as a full-width sheet.
- Messages are **per user**: each user has their own read state. What a user can see follows the
  existing library-access rules; admin-only events go to admins only.

## Events that produce a message (proposed first set)

| Event | Who is told | Source |
|---|---|---|
| A file's retention window started, with cause (local watch, Trakt import, mark played) and date | Everyone who can see the title | Phase 10 retention |
| A file will be deleted soon (for example 24 hours before) | Everyone who can see the title | Phase 10 retention |
| A file was reclaimed, and how much space was freed | Admins | Phase 3/10 runner |
| A deletion was blocked (read-only media, seeding, merged versions) | Admins | Phase 3/10 runner |
| A release was grabbed, imported, or failed to import | The user who asked for the title, and admins | Phase 4/5 |
| An upgrade to a better quality was found or replaced a file | Admins | Phase 6 |
| An indexer or Prowlarr sync failed, or an indexer was disabled | Admins | Phase 4, Phase 7 S9 |
| The interface was switched to or from stock, or recovery ran | Admins | Phase 7 S4 |

Each kind can be switched off per user in the settings area.

## Technical outline (proposed)

- **Storage:** a `notification` table in plugin SQLite (id, kind, severity, title or entry id, message
  parameters, created time) plus per-user read state; retention of old messages (for example 90 days)
  so the table cannot grow without bound. No secret or credential ever enters a message.
- **Producers** are the existing services: they already write History rows; notifications are
  written at the same points, from the same facts, never from a separate guess.
- **API:** `GET /JellyfinMod/Notifications` (paged, filtered to what the caller may see),
  `GET /JellyfinMod/Notifications/UnreadCount`, `POST …/{id}/Read`, `POST …/ReadAll`, plus per-user
  preferences. Authenticated; ordinary users see only their own and what their library access allows.
- **Delivery:** poll the unread count on a modest interval and when the app regains focus; push over
  Jellyfin's existing WebSocket session messages if the host supports it cleanly. Verify against the
  12.0.0 source which is sound, rather than assuming.
- **Relation to Jellyfin's own activity log:** admin events may also be written to the host's activity
  log so they appear in the Dashboard; the bell does not replace it.
- **Degrade when the plugin is absent:** no bell, no errors — the same rule as every mod feature.

## Acceptance (sketch)

Real HTTP host with authentication (anonymous, ordinary user, admin) and SQLite; each event produced
live on the isolated instance by the real producing service; the bell, badge and list driven in a real
browser (Chromium, then real Google Chrome) on desktop, mobile and TV by keyboard; read state
survives reload and is per user; a user never sees a message for a library they cannot access. No unit
tests.

## Open questions for the user

1. **Which events at first?** All of the table above (proposed), or only retention warnings to start?
2. **"Deleting soon" reminder:** how long before deletion (proposed 24 hours), and once or daily?
3. **Beyond the app:** in-app only (proposed), or also push to a phone, e-mail, or a chat service later?
4. **Who gets download messages:** the person who requested the title and admins (proposed), or
   admins only?
5. **How long to keep messages:** 90 days (proposed)?
