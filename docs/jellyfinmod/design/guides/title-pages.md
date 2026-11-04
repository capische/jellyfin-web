# Title pages and art ground

**dsD (2026-11-04): built, not accepted.** The user's native-markup instruction supersedes the earlier rd3 restyling.
Approved source: workspace design-system `head`, `actbar`, `sect`, `cell`, season/episode rows and title pages.
[Complete CSS delta, behavior, retained upstream infrastructure and runner inventory](../dsD.md).

`design/TitlePage.tsx`, `Head.tsx`, `TitleRow.tsx`, `TrackField.tsx`, `DlBlock.tsx`, `Pending.tsx`, `Ratings.tsx` and
`BrowsePage.tsx` own the visible movie, series, season, episode, person and TMDB browse markup under `.jfds`.
They output source elements/classes with the copied source stylesheets nested at import. They do not restyle the legacy template.
The original template remains hidden as the controller's data/select/command host. Upstream and mod data/actions remain owners.
Dashboard, mod settings, wizard and other native detail types retain their existing presentation.

The source head has the poster and one column (27.6% / remainder, 1em gap). Phone: centered poster at 61.8%, title and metadata,
then the action pill and 5% content gutters. The source art ground, static image/filter/fade, Noto title/reading text, Inter dense
controls, white Play, glass pickers and solid TV/capability fallback values are unchanged. Root observes real layout/theme markers
without a reload. A shared upstream heading rule is neutralized so it cannot truncate titles or replace the source phone size.

Real images stay lazy. Missing/failed images retain 2:3 poster or 16:9 still boxes and the source fallback glyph. Corners follow the
source .618em. Native cells hold three caption lines even when empty. Row/still focus and hover rings stay outside the art box;
no card paint containment is introduced. Lists and histories scroll to their final entry.

Actions dispatch the existing controller handlers. Play reads the same original source/audio/subtitle selects and resume mode;
card Play forwards the original shortcut command. Played/Favourite still click their existing custom controls. More carries the
real painted opener and retains mod registrations, deletion warnings/return and permissions. Get a Release uses the same picker.
The existing playback black screen and spinner clean up on every success/error/cancel/rejection/navigation path.

Original titles, taglines, metadata/tag/external links, series air time and secondary facts remain. Native extra card sections keep
their original loaders and commands; missing seasons/episodes keep their ordering and import replacement. Person birth/death/place
facts and their links are read from the existing controller. Chapter playback keeps its position and sort context. A TMDB person
with no native destination remains an inert, reachable person cell. No fixture-only recommendations or ratings are invented.

Versions, tracks, download/pending states, retention badges/disclosures, per-file history, Trakt, Add/Undo and ratings preferences
follow their guides' dsD sections. Earlier `.jfmod-titlePage`/`titlePages.scss` visual measurements are superseded by the source CSS.

Verification uses the offline dsD/dsC browser runners with real components, original controller functions, source styles and blocked
network. Compiler/linter results are recorded with the slice. Server-backed and physical webOS acceptance remain unrun under the
user's environment restriction; this page documents a built slice, not accepted or deployed behavior.
