# Info tip: the (i) and its popover

**Status:** approved 2026-10-26 (user, revision 2 of `reviews/picker-failure-info/` in the workspace, with the tooltip placed above
the (i) and "drop the sources part" of the status line). Built on `feat/failure-info` (P4.FU25, built, not accepted). Code: web
`components/InfoPopover.tsx`, `components/infoPopover.scss`; the picker's (i) in `components/ReleaseSources.tsx` (`FailureInfo`)
and `components/releaseSources.scss`. Used by: the release picker's Sources checklist (an indexer's failure,
[release-picker-sources.md](release-picker-sources.md)); the Queue page's state discs on the phone (P4.FU28, approved 2026-10-26,
workspace `reviews/queue-state-icons/`; `components/QueuePage.tsx`, [download-state-mark.md](download-state-mark.md)).

## What it is

A small round (i) that explains a short state (`failed`) with the longer text behind it, without a third line or a red banner. On
a computer the text shows on hover; a click, a tap or the remote's Enter opens it in a popover.

## The (i)

- Material `InfoOutlined`, **1.15em**, in the state's colour (a failure: `#ff7b72` on dark, `#c62828` on light).
- A round **transparent 2.5em** MUI icon button (`.jfmod-infoButton`, the row-action size of
  [buttons-and-row-actions.md](buttons-and-row-actions.md)), **0.4em** after the text it explains, with negative vertical margins
  (`-0.6em`) so its line keeps its height; MUI's grey hover veil, no ripple.
- `aria-label` says what it answers: *Why EN. 0Magnet failed*. The line it sits on carries the text as its `aria-description`.
- A click on it never acts on its line (the click stops at the button), and a pointer press leaves focus on the line, so the
  line's own Enter keeps working.
- **Computer:** hover shows the text in the product's MUI tooltip (grey `rgba(97,97,97,.92)`, white, 4 px radius) **above** the
  (i) (`placement="top"`; MUI flips it below only when there is no room), over the menus (`.jfmod-infoTipPopper`, z-index
  1000001). While the popover is open the tooltip gives way.
- **TV:** a D-pad focus stop (never `data-jfmod-dpad-skip`): Right from its line lands on it, Left goes back, Up/Down move as its
  line does. Focused it is the primary fill of every MUI icon button in a pop-up (`shell/dpadModals.scss`) with the picker's white
  ring (`0 0 0 .12em` paper, `0 0 0 .28em #fff`; `#222` on light). On the focused line it takes the line's ink. No tooltip on the
  TV or the phone.

## The popover (`InfoPopover`)

- The file history popover's look (`FileHistoryPopover`): an MUI Popover on the paper, `max-width 30em`, padding `.8em 1em`; a
  head row with the **title** (what the (i) belongs to, 600) and a round **Close** (`material-icons close`, `aria-label` Close),
  then the **text** at 92 %, 86 % opacity. Nothing else: no short reason repeated.
- **Lines and a link** (`message` as a list, `link`; the Queue page): one paragraph per fact, 0.35em apart, then an optional
  `Open <name>` link in the primary `#00a4dc` at 600 and full opacity, underlined under the pointer and for the keyboard, opening
  in a new tab. The Queue page's title is the state word (`Seeding`), its lines the facts, its link the administrator's client.
- Opens under the (i), left-aligned. **Phone:** the full width under the (i)'s row (`row` prop), 8 px from each edge.
- On the TV Close takes focus when it opens (elsewhere MUI focuses the popover). Back, Escape, Close or a click outside closes it; MUI returns focus to what had it (the (i) on
  the TV, the line after a pointer press). Over the menus (z-index 1000001).
- Rendered outside the menu in React's tree, so its keys and clicks never reach the menu's list or a line.

## Copy

- The text is the source's own full message; when there is none (a timeout) the short state reason (`timed out`).

## Do not

- Put the reason back on the line, or add a banner for it.
- Make the (i) a pointer-only control on the TV, or let a click on it act on its line.
