# Page has no evaluate escape hatch

Everything that touches the browser goes through the Page interface, which offers only domain actions (snapshot, layout, click, scrollTo, prime, highlight, screenshot) and deliberately has no `evaluate(js)` or raw browser escape hatch. An escape hatch would let callers bypass PlaywrightPage behavior that FakePage cannot honour, so tests above the seam would silently stop describing real behaviour. When a caller needs something new from the browser, add a named method to Page, implement it in both adapters, and cover it in the contract suite.

## Considered Options

- **Domain methods plus `evaluate(expr)`**: rejected; FakePage cannot execute arbitrary JS, so the fake stops matching the real browser.
- **A typed wrapper over the browser protocol**: rejected; the interface stays as wide as the protocol, a shallow module with nothing hidden.
