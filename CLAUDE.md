# Jellyfin Web rules

## Scope and planning

- Treat `master` as the production fork of upstream Jellyfin Web. Keep JellyfinMod phase work on separate branches/worktrees.
- Read workspace rules, `docs/jellyfinmod/PLAN.md`, the current `PHASE*.md`, and `README.md` before mod work; read `UX.md` before UI changes.
- Follow accepted decisions and task dependencies. Preserve unrelated edits and other agents' work.
- Scope JellyfinMod to movies and TV, with library-scoped entries that may lack files.
- Extend existing browse routes; do not add a separate catalog section or redirect Movies/TV.
- Keep changes additive and narrowly mounted so upstream rebases remain manageable.

## Styling

- Never edit existing selectors or existing `.scss` files for mod features.
- Put new styles in feature-local files. Prefix new classes with `jfmod-`; never repurpose upstream classes.
- The accepted Phase 1 top-bar/Home-hero redesign is the only styling exception; use feature-local styles and preserve existing navigation/actions.
- Reuse values from `themes/_base/theme.ts`, `card.scss` and `librarybrowser.scss`; do not invent a theme, palette or font.
- Preserve base values: ground `#101010`, paper `#202020`, primary `#00a4dc`, error `#c62828`, star `#f2b01e`, Noto Sans, card radius `0.2em`, secondary card text `86%`.
- Size feature styles in `em`; account for TV's 125% and mobile's 90% root sizing.
- Use `layoutManager` affordances: TV buttons, mobile `CardOverlayButtons`, desktop `CardHoverMenu`.
- Reserve top-right for stock `.cardIndicators`, top-left for file state, bottom-right for mobile overlays.
- Resolve design conflicts in `UX.md`; do not bypass these rules with `!important`.

## Testing

- Test built functionality through a real browser and running server; use integration/E2E tests, never unit tests.
- Use only the isolated instance for JellyfinMod work. Keep production fixes separate as required by workspace rules.
- Cover desktop, mobile and TV; use arrow keys, Enter and Back for TV navigation.
- Set TV layout with `localStorage.setItem('layout','tv'); location.reload()`; viewport size alone does not enable it.
- Test TV at 1920×1080 and the narrower 1280×720 layout. The `100em` breakpoint changes header structure.
- Restore automatic layout with `localStorage.removeItem('layout')`.
- Do not equate desktop TV emulation with physical-device verification. Verify deployed layout changes on the real device and report missing evidence.
- Preserve older webOS compatibility: CSS `min()`/`max()` may fail, including through `var()`. Use media queries or the existing `conditional-max` mixin where appropriate.

## Deployment

- Inspect target configuration before deploying. Mod work must target the isolated service; never restart or mutate production for phase testing.
- Jellyfin bind-mounts this checkout's `dist/`; preserve that directory's identity when deploying.
- Use `./jellyfin-sync --local` for local builds or `ssh <host> '<web-checkout>/jellyfin-sync'` for host builds, with the correct target configuration.
- Host builds check out the deployment revision, run `npm ci`, build and restart. Preserve dirty work if deployment refuses it; do not discard edits to proceed.
- Use `--no-build` only with a verified complete bundle; `--no-restart` leaves the service running. Consult `--help` for target overrides.
- Keep machine settings in ignored `jellyfin-sync.env`, based on `jellyfin-sync.env.example`; never publish host paths.
- Fully close and reopen resident TV/mobile apps after deployment; restarting the server does not reload their bundles.
- Verify the deployed app, not just a successful build or HTTP status.

## Commits

- Commit validated slices regularly using Conventional Commits; stage explicit files and preserve unrelated work.
- For mod work use lowercase `type(component,phase.task): description`, such as `fix(search,p1.w4): restore focus after adding`.
- Use plan task IDs without spaces around commas. Abbreviate consecutive same-phase/task-series ranges: `catalog,p1.p5-6`.
- List nonconsecutive tasks or different phases separately; prefer separate task commits for new work.
- Use `feat`, `fix`, `refactor`, `perf`, `docs`, `chore`, `test` or `build`; keep descriptions imperative without a trailing full stop. Put rationale in the body.
- Retain normal component scopes for unrelated Jellyfin fixes, such as `fix(player): ...`.
- Never add a Codex/GPT co-author or commit secrets. Never rename upstream commits.
- Rewrite published history only when explicitly authorized; verify remote tips, use explicit force-with-lease, then verify pushed commits.
