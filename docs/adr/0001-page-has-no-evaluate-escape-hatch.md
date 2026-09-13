# Page has no evaluate escape hatch

Everything that touches the browser goes through the Page interface, which offers only domain actions (snapshot, layout, click, scrollTo, prime, highlight, screenshot) and deliberately has no `evaluate(js)` or raw protocol `send`. An escape hatch would let callers pass JavaScript strings that FakePage cannot honour, so tests above the seam would silently stop describing real behaviour and the shared contract suite could no longer hold both adapters to the same interface. When a caller needs something new from the browser, add a named method to Page, implement it in both CdpPage and FakePage, and cover it in the contract suite.

## Considered Options

- **Domain methods plus `evaluate(expr)`**: rejected; FakePage cannot execute arbitrary JS, so the fake stops matching the real browser.
- **A typed wrapper over the browser protocol**: rejected; the interface stays as wide as the protocol, a shallow module with nothing hidden.
