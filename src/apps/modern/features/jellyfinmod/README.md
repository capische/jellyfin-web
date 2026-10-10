# JellyfinMod — web feature

Everything JellyfinMod adds to this fork lives under this folder. Nothing outside it is edited
except a handful of one-line mount points, listed in `docs/jellyfinmod/UX.md` §15.2.

## Rules that apply here

Read `CLAUDE.md` at the repo root first — in particular **Styling rules for this fork**. The short
version: no upstream selector is changed, no upstream `.scss` is touched, every class is prefixed
`jfmod-`, everything sizes in `em`, and values come from `themes/_base/theme.ts`, `card.scss` and
`librarybrowser.scss` rather than being invented.

## Layout

```
types/        the entry shape, mirroring the plugin
constants/    the one place FileState is interpreted
api/          hand-written client for /JellyfinMod/*  (not in the generated SDK)
hooks/        react-query wrappers; every query is retry:false so the fork
              stays usable when the plugin is absent or older than the bundle
components/   the additions themselves
```

## Phase 1a — done when

File-less entries appear in `/movies` and `/tv` carrying a mark, and nothing else in the app looks
or behaves differently.

## Credits

- The release picker's type is **Inter** (Copyright 2016 The Inter Project Authors, SIL Open Font License 1.1): static woff2 files
  for weights 400, 500, 600 and 700 in every Latin, Cyrillic and Greek subset (24 files, about 380 KB, each fetched only when a
  page shows a character from its range), from the `@fontsource/inter` 5.3.0 package, in `assets/fonts/inter/` with `OFL.txt`
  beside them. They are declared by `@font-face` in `components/interFont.scss` under the family name `jfmod-inter`, first in
  the picker dialog's font stack. The family is complete enough to replace Jellyfin's default font later: put `jfmod-inter`
  first in the theme's font stack and import `interFont.scss` from the mod shell.
