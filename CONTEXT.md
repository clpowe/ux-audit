# ux-audit

Audits a live website's usability by driving a real browser, perceiving the page the way assistive technology does, and turning measurements into Findings.

## Language

**Page**:
One loaded URL at a chosen Viewport, as the audit perceives and acts on it: its Snapshot, its layout, and the actions (click, scroll) a user could take.
_Avoid_: session, tab, target, browser

**Snapshot**:
The filtered accessibility tree of a Page at one moment, as an ordered list of Nodes, optionally with each Node's on-screen box.
_Avoid_: AX tree, DOM dump

**Node**:
One perceivable element in a Snapshot: its ref, role, accessible name, and depth. A ref is only meaningful within the Snapshot it came from.
_Avoid_: element, AxNode

**Overlay**:
A dialog that blocks the first view of a Page (cookie banner, consent wall) and is dismissed before auditing.
_Avoid_: popup, modal, banner

**Highlight**:
An outline drawn onto a Page marking where a Finding sits, captured in report screenshots.
_Avoid_: overlay, annotation, mark
