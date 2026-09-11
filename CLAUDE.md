# jellyfin-web

A fork of [jellyfin/jellyfin-web](https://github.com/jellyfin/jellyfin-web). `master` carries
local changes on top of upstream and is what gets deployed.

## JellyfinMod

This fork is the UI half of **JellyfinMod**: a catalog-first layer over Jellyfin that tracks
what you want to watch whether or not the file exists, acquires it, and reclaims the disk
once you are done with it. The other half is `JellyfinMod.Catalog`, a Jellyfin server plugin.

**Read `docs/jellyfinmod/README.md` before doing any catalog, torrent, retention or
discovery work.** It carries the architecture verdict, the plugin target, the data model,
the phased roadmap and a dated decision log — including several questions that are settled
and should not be reopened without new evidence. For anything that touches the interface —
the catalog grid, search, detail pages, state badges or D-pad behaviour — read
`docs/jellyfinmod/UX.md` alongside it; it holds the screen-by-screen design, the component
inventory and its own decision log.

**Work is tracked in [`docs/jellyfinmod/PLAN.md`](docs/jellyfinmod/PLAN.md)** — numbered,
self-contained tasks with dependencies and acceptance checks, written to be handed to an agent.
Start there rather than inventing a task order.

For Phase 1, also read `docs/jellyfinmod/PHASE1.md`: it records accepted permissions and Home
scope and the integration gates that must be resolved before the original web tasks can run.

The short version: a title is **one entry** that may or may not have a media file behind it yet,
and `/movies` already *is* that list — there is no separate catalog section and no redirect.
Scope is movies and TV only. Keep every change here additive so the fork stays rebasable.

## Styling rules for this fork

**User-approved exception, 2026-09-06:** Phase 1 includes the top-bar redesign and new Home hero
specified in `docs/jellyfinmod/UX.md` §7.3. Keep their styles in new files under the JellyfinMod
feature and use `jfmod-` classes with narrow integration mounts. Existing navigation destinations
and actions remain available. This exception overrides the no-restyling rule only for that
top-bar/hero scope; existing `.scss` files and other upstream surfaces remain protected.

**Preserve upstream's CSS. This is the hardest rule in the repo.**

The point of the fork is a few new capabilities inside an app that still looks and behaves like
Jellyfin. A diff that restyles the app is a worse fork than one that adds nothing at all, because
every restyled rule is a conflict on the next rebase and a surprise for anyone who has used
Jellyfin before.

1. **Never edit an existing selector.** Not the value, not the unit, not "just the padding".
   If an upstream rule is wrong for a catalog feature, the catalog feature is wrong.
2. **Never edit an existing `.scss` file.** New styles go in new files under the feature folder
   they belong to, imported by the component that needs them.
3. **New class names are namespaced `jfmod-`.** One prefix, greppable, removable in one command.
   Never reuse or extend an upstream class name to mean something new.
4. **Take values from upstream, do not invent them.** Radii, spacing, type scale and colour come
   from `themes/_base/theme.ts`, `card.scss` and `librarybrowser.scss` — read the value and use
   the same one. Notably: `#101010` ground, `#202020` paper, `#00a4dc` primary, `#c62828` error,
   `#f2b01e` star, Noto Sans, card radius `0.2em`, `.cardText-secondary` at `86%`.
5. **Everything sizes in `em`.** `.layout-tv` sets the root to 125% and `.layout-mobile` to 90%;
   a `px` value silently breaks both. Check any new component in all three layout modes.
6. **Respect the three layout modes.** `layoutManager` decides the card's affordances — TV gets a
   `<button>`, mobile gets `CardOverlayButtons`, desktop gets `CardHoverMenu`. Additions must slot
   into all three, not assume a mouse.
7. **Corners are spoken for.** `.cardIndicators` owns **top-right**. File state takes **top-left**.
   Mobile overlay buttons own **bottom-right**. Do not put anything in a corner that is taken.
8. **No new theme, no new palette, no new font.** Colour that carries meaning reuses the theme's
   semantic slots.

If a change cannot be made under these rules, it is a design problem, not a CSS problem — take it
back to `docs/jellyfinmod/UX.md` rather than reaching for `!important`.

## Commits

Every commit made in this fork uses [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<component>,<phase>.<task>): <description>
```

Types in use here: `feat`, `fix`, `refactor`, `perf`, `docs`, `chore`, `test`, `build`.
For JellyfinMod work, use a lowercase component and phase/task ID from the plan, separated
by a comma without spaces: `feat(catalog,p2.r1): reconcile native library bindings`,
`fix(search,p1.w4): restore focus after adding`, or `docs(retention,p3.plan): define expiry policy`.
Commit validated slices regularly. For existing combined commits, list their tasks after the
component in the scope; prefer separate task commits for new work. Unrelated Jellyfin fixes retain their
normal area scopes such as `player` or `subtitles`. Never add a Codex/GPT co-author or commit
secrets. Rewrite published history only when explicitly authorized; verify the remote tip,
use an explicit force-with-lease, and verify the pushed commit.
The description is lower case, imperative, and has no trailing full stop. Explain the
reasoning in the body; the subject line is not the place for it.

This applies to commits authored here. Commits merged from upstream keep their original
messages — do not rewrite them.

## Deploying

The Jellyfin host serves the built bundle straight out of this checkout's `dist/`, which the
Jellyfin container bind-mounts. Deploying therefore means getting a fresh `dist/` onto the
host and restarting the container — there is no install step and nothing to copy elsewhere.

`./jellyfin-sync` does both. It has two modes.

### Build locally, ship the result (preferred)

```bash
./jellyfin-sync --local
```

Builds `dist/` here and rsyncs it to the host. The bundle is plain JS/CSS/wasm with nothing
host-specific in it, so a workstation build runs correctly on the host whatever its
architecture. This is the fast path: a webpack build takes roughly 80s on a laptop against
roughly 330s on a Raspberry Pi, and the host build pays an `npm ci` on top of that.

Content-hashed filenames mean unchanged chunks are skipped, so repeat deploys transfer very
little — the wall time is almost entirely the build.

Useful flags:

| Flag | Effect |
| --- | --- |
| `--no-build` | Sync the existing `dist/` without rebuilding |
| `--no-restart` | Leave the container alone after syncing |
| `--host HOST` | Override the SSH host |
| `--path PATH` | Override the web checkout on the host |

### Build on the host

```bash
ssh <host> '<web-checkout>/jellyfin-sync'
```

Resets the checkout to the deployment branch, runs `npm ci`, builds, and restarts. Needs
nothing installed locally, but it is slow on low-powered hardware. Use it when the local
toolchain is unavailable, or to confirm the host builds a commit cleanly from scratch.

It refuses to run if the host checkout has tracked changes — commit or discard them first.

### Configuration

Everything host-specific lives in `jellyfin-sync.env`, which is **not tracked**. Copy the
example and fill in what differs from the defaults:

```bash
cp jellyfin-sync.env.example jellyfin-sync.env
```

Paths default to being relative to the deploy account's home directory, so the same values
work whether the script runs on the host or drives it over SSH. Nothing about the deployment
layout belongs in a tracked file — this repo is a public fork.

## After deploying

`index.html` is served `no-cache`, so a client that asks for it gets the new build. But
**clients that stay resident never ask**. A TV app left open keeps running whatever bundle it
started with, no matter how many times the container restarts. Fully close and reopen the app
on TVs and phones before concluding a change did not work.

## Verifying a change on a TV

The TV layout is driven by the `layout` key in `localStorage`, not by viewport size, so it can
be exercised in a desktop browser:

```bash
localStorage.setItem('layout','tv'); location.reload()
```

Use a **1920x1080 viewport**, and drive it with arrow keys and Enter — some bugs are only
reachable by D-pad. `localStorage.removeItem('layout')` restores auto.

The viewport matters more than it looks. The TV reports 1920x1080, which is past the
`min-width: 100em` breakpoint in `styles/librarybrowser.scss`, and that breakpoint rearranges
the header: the section tabs move up beside the header buttons into a single row, and the
strip becomes a fixed fraction of the width that scrolls when the tabs outgrow it. A 1280x720
viewport gets the two row header instead — a layout the TV never shows — so header work
verified there can be aimed at the wrong thing entirely. Check 1280x720 as the narrower case,
not as the TV.

This gets you close, but it does not reproduce the TV's browser engine. webOS ships an older
Chromium than a current desktop browser: **CSS `min()` and `max()` may be unsupported**, and a
`var()` that substitutes an unparseable value is invalid at computed-value time — the property
falls back to its *initial* value, not to a previous declaration. `width` and `right` becoming
`auto` collapses layout in ways that never appear in testing. `styles/_mixins.scss` has a
`conditional-max` mixin for cases that need `max()`; otherwise prefer plain values with media
queries. Verify layout changes against the deployed build on the real device.
