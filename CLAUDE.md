# jellyfin-web

A fork of [jellyfin/jellyfin-web](https://github.com/jellyfin/jellyfin-web). `master` carries
local changes on top of upstream and is what gets deployed.

## Commits

Every commit made in this fork uses [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<optional scope>): <description>
```

Types in use here: `feat`, `fix`, `refactor`, `perf`, `docs`, `chore`, `test`, `build`.
Scope is the area touched — `player`, `subtitles`, `deploy` — and is omitted when a change is
broad. The description is lower case, imperative, and has no trailing full stop. Explain the
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
