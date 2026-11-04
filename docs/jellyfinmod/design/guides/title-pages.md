# Title pages and art ground

**Status:** rd3, approved rulebook §§2/5/7 (D208–D213, D225–D227, D230, D243); built, not accepted.
Code: `integration/titlePage.ts`, `shell/titlePages.scss`, `components/TitlePoster.tsx`, `components/LibraryUndo.tsx`.

Movie, series, season, episode, person and TMDB browse pages keep upstream's template, IDs, controls and controllers.
Only those item types acquire `jfmod-titlePage`, under the active signed-in mod chrome. Dashboard, mod settings,
setup wizard and other native detail types retain their presentation. Existing routes, selection, action permissions,
links and playback parameters stay authoritative.

The head has a poster left of one column: **27.6% / remainder**, **1em** between, **1.618em** vertical padding and upstream
**3.3%** gutters. Phone: poster centered at **61.8%**, **5%** gutters, **1em** before the centered column. Title **2.618em**
(1.618em phone), 600. Reading pitch **1.618**. Season cards/episode lists and Next Up occupy the full-width secondary
section. Person's original localized birth/death/place nodes move into the head, retaining IDs and link behavior.

Art is a single static image from existing item/discovery data, no extra API read. Filter **40px/.4/1.1** from tablet
up, **22px/.45/1.1** phone (blur/brightness/saturation); light **1.25/.8** at **55%**. The bottom **38.2%** fades into
#101010 / light #f2f2f2. An absent image leaves plain ground. TV uses this static art but every floating control is solid,
without backdrop blur. Glass recipes are capability guarded and use the existing light tokens.

Every head poster owns a **2:3** box and every episode still **16:9**, including loading, missing and failed images.
`TitlePoster` removes a failed img and reveals its stock Material movie icon; native cards keep their existing icon,
and an empty native slot gets the movie/person icon. Episode placeholders keep their episode number. There is no
layout change on an error. Corners **.618em**. Shadow **0 .618em 1.618em** (black .6, light .3).

The action pill, pickers, download block, pending entry and ratings follow their own updated guides. Played keeps its
countdown, kept infinity is primary, and Episode Retention/History remain closed disclosures. A visit-local Add notice
offers Undo only for the administrator's new entry, never a duplicate or racing Add; existing removal/invalidation is reused.

Rows: still width **17.94em**, height derived at **9/16**; **1em** padding/gap, .618em corners, title 600,
reading pitch 1.618 and overview up to three lines. Phone still **38.2%**, gap .618em, vertical padding .618em; the synopsis spans the row below it.
React rows render that read-only text directly; native rows mirror their existing synopsis without moving controls,
and disconnect their observer on hide/destroy. Missing/failed browse stills keep their numbered fallback.
Person cells have **6.854em** portraits plus **2 × 1em** cell padding = **8.854em**.

Named exceptions retained from the mockup/guides: content ratios; 27.6/72.4 proportion rounding; upstream gutters,
3em icon boxes/1.6em glyphs/3em action radius; title pitch 1.2; art filters, **8% overscan /116%** image, opacity .55;
shadow alphas .6/.3; 1px paper outline; glass recipes and ink; Play .854 fill/.96 press/TV 1.08 focus; .135em pointer ring;
picker 17.8/13.2/11.7/24em widths and thresholds; media/pending typography and row actions; 4em/phone-scaled ring,
.28em progress bar; ratings stacks .6/.1/1.04/.78/1.15/.45em, popup .764/1.382/.809em and .944/.472em caret geometry;
caption .72em, disclosure .8em/.06em tracking; existing colour, weight, z-index and animation constants. These are
approved content, optical, touch or inherited values rather than new scale steps.

Validation: `scripts/jellyfinmod-e2e/rd3-title-pages.mjs` uses the real template/components/styles in offline Chromium,
blocks requests, and starts no server. Live data, remote-key navigation on physical webOS and device performance
still need acceptance against the isolated instance; offline checks do not claim that evidence.
