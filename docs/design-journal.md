# Design journal

One entry per module, in Christopher's words. Three sentences:

1. This module hides ___ behind the interface ___.
2. It maintains the invariant ___, and ___ owns the relevant state.
3. We rejected ___ because ___; we should reconsider if ___.

Update an entry when the design changes. If no alternative was considered, say so.

<!-- Entries below. Owed, not yet written: page (Page/PlaywrightPage/FakePage), rules. -->

## Overlay

Christopher's words, 2026-09-14 (assisted discussion):

1. This module hides how we find candidates, select their controls, or verify dismissal operations behind the interface dismissOverlays.
2. we never report an Overlay as dismissed merely because we clicked its control.. Overlay owns the dismissal attempt results; Page owns access to the live page state, and Report presents the outcomes.
3. We rejected pausing the audit on a failed overlay dissmisal because a faild overlay dismissal is a valid finding that needs to be reported because is effcts user experience;

No reconsideration condition has been specified.
