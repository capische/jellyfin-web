# Sign-in

**Status:** dsB, approved mockup D221–D224 and the user's 2026-11-04 native-markup instruction; built, not accepted.
Code: `design/SignIn.tsx`, `routes/SignInPage.tsx`, `integration/signInActions.js`. [Complete CSS/behavior inventory](../dsB.md).

`signin.onart > art` with `signbox` or `users`. The source glass sheet is 29.03em, max-width 90%, padding
1.618em/2.618em/2.618em (phone 1.618em); 1.618em corners. Native text/password inputs replace decorative `.v` spans
inside `.fld > .box`, retaining label, focus, invalid outline and help. Remember Me is the source switch with a real checkbox.
The source stacked buttons share the widest label's width. Root sizes and themes come from the live app markers.

Wrong password retains User, clears Password, displays the original translated error under it and returns focus there.
The public-user list draws `usr > avatar2 + b`, lazy real avatars and the source person/plus glyphs; a failed avatar keeps the
circle and fallback. A passwordless user takes the original authentication path. Other User opens the empty form; Cancel
returns to the list. Quick Connect, Forgot Password, Change Server, remembered login and sanitized branding links retain their
original actions. The original Quick Connect poll is disposed on leaving. The stock login controller shares those same actions.

The outer page has no duplicate header spacer. The sheet is solid without both glass capabilities and on TV; no new values
or upstream field/card/button restyling are used. Computer, tablet, phone and TV dark/light component checks passed; live-server
and physical-webOS acceptance remain unrun.
