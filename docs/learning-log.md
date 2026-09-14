# Learning log

## Module index

| Module | Last studied | Status |
|---|---|---|
| Shopping journey | 2026-09-14 | Assistant implementation verified with controlled browser; live model and independent learning checks deferred; review 2026-09-28 |
| Overlay / Page presence | 2026-09-14 | Assisted implementation verified; independent extension deferred; review 2026-09-28 |
| Findings / evidence | 2026-09-14 | Auto implementation verified; learning check deferred; review 2026-09-28 |
| Model judgments / calibration | 2026-09-14 | Auto implementation verified without live API call; learning check deferred; review 2026-09-28 |

## Task entries

### 2026-09-14 — Replace custom Chrome/CDP with Playwright
- request: completely remove custom Chrome/CDP browser control and replace it with Playwright to reduce code.
- mode: Full with the existing "just write it" override. The Page boundary remains intact; the browser implementation changes wholesale.
- implementation: added `playwright` and `src/page/playwright.ts`; sessions now launch Playwright-managed Chromium in a fresh isolated context. ARIA snapshots supply frame-local locator handles, including iframe controls. Playwright owns actionability checks, auto-scrolling, waiting, browser launch, and teardown. Product text is preserved from ARIA snapshot text fields for price and delivery evaluation.
- removal: deleted `src/page/cdp.ts`, `src/page/transport.ts`, and `src/page/chrome.ts` (about 680 lines). The replacement adapter is about 150 lines, a net reduction of roughly 530 browser-control lines. Removed Chrome executable and debugging-port configuration. `axe-core`, previously reported unused by Fallow, was removed from dependencies during lockfile update.
- contract changes: CSS-hidden controls are absent from the Playwright accessibility snapshot rather than emitted as unrendered targets. Existing Page-level journey, overlay, measurement, screenshot, and report callers remain unchanged. Browser tests always use managed Chromium rather than conditionally skipping when a system browser is absent.
- files: new `src/page/playwright.ts`; deleted the three custom browser files; updated `src/sessions.ts`, browser tests, `package.json`, `bun.lock`, `tsconfig.json`, README, Page ADR, design-journal placeholder, and this log.
- verification: full suite passed 116 tests across 11 files, including the shared Page contract, direct iframe action, verified iframe overlay dismissal, and complete search-to-cart browser journey. The browser fixture confirms ordinary listed-price and delivery text are visible to the journey. Typecheck and diff checks passed. Fallow found no introduced dead code, no unused dependencies, and no duplication; its audit still exits 1 for the inherited `FakePage.highlights` finding and reports existing complexity hotspots. Live Ashley journey not rerun.
- deferred understanding check: explain why frame-local Playwright locators remove the coordinate/ref translation work previously owned by CdpPage.

### 2026-09-14 — New Mother budget and delivery deadline
- user-specified constraints: `$1,500` and `October 15, 2026`.
- mode: Full with the existing "just write it" override; learning exercise deferred.
- behavior: New Mother now requires an easy-to-clean sofa whose listed item price is no more than $1,500 and whose delivery is available by October 15, 2026. Both require current page evidence before Add to cart. Explicit violations cause another selection or a blocked outcome; unavailable details require reasonable inspection before blocking. Taxes and delivery fees remain unknown unless shown before checkout.
- files: `src/journey.ts`, `src/journey-agent.ts`, `src/audit.ts`, `src/journey-agent.test.ts`, new `src/persona.test.ts`, `README.md`, and this log.
- verification: all 120 tests across 11 files passed, including headless Chrome; TypeScript and diff checks passed. Live Ashley journey not rerun.
- deferred understanding check: explain why the listed-price constraint can be verified before checkout while a final total often cannot.

### 2026-09-14 — Recover from unrendered journey targets
- trigger: Ashley run `2026-09-14T16-44-16-015Z-4de2f1a2` failed at step 5 because the model selected `Performance Fabric sofas` a second time; the link remained in the accessibility snapshot but was no longer rendered or attached for clicking.
- mode: Full, continuing the user's "just write it" MVP override. Independent exercises remain deferred.
- behavior: rendered/attachment failures from click and search typing are recorded on the step and as coverage notices, then the loop captures a fresh state for another decision. The error is supplied in model history. Other browser errors remain fatal. A failed Add to cart click does not set the post-cart stop flag; that flag changes only after a successful click.
- files: `src/journey.ts`, `src/journey-agent.ts`, `src/journey.test.ts`, `README.md`, and this log.
- verification: focused tests reproduce an unrendered Performance Fabric link, select an alternate product, and complete verified cart addition. A separate regression proves failed Add to cart does not trigger the post-cart stop. All 119 tests across 10 files passed, including headless browser tests; typecheck and diff checks passed. Live Ashley run not repeated.
- deferred understanding check: explain why snapshot membership does not guarantee a rendered action target and why the cart-attempt state changes only after click success.

### 2026-09-14 — Keep review inconsistency from aborting shopping
- trigger: user live run `2026-09-14T16-38-40-478Z-d89ea2f1` stopped on its first proposed modal dismissal because an Issue assessment had no linked finding/recommendation. This was a coupling error in the assistant's implementation.
- mode: Full, continuing the MVP's "just write it" override. Learning exercises deferred.
- contract correction: invalid action/success evidence and restricted controls remain hard gates. Invalid observations are excluded individually; valid observations survive. Invalid or inconsistent heuristic assessments are excluded from scoring, with per-step warnings and coverage notices. Raw unverified review output is retained in JSON for diagnosis and never rendered as verified findings or used for scores.
- actual files: `src/journey.ts`, `src/audit.ts`, `src/journey.test.ts`, `src/journey-evaluation.test.ts`, `README.md`, and this log. Terminal actions now say Proposed to avoid implying that a pre-validation decision executed.
- focused verification: regression reproduces an orphan heuristic issue on modal dismissal, executes the valid action, then completes cart addition. Separate tests retain hard stops for checkout, invalid target, and invalid action evidence; another preserves a valid finding beside invalid review data.
- validation: all 117 tests across 10 files passed, including headless browser tests; typecheck and diff checks passed. Live Ashley journey not rerun.
- deferred understanding check: distinguish action authorization/evidence from report completeness, and explain why incomplete review data must not contribute to the journey score.

### 2026-09-14 — User-supplied per-step UX evaluation
- request: "Use this to evaluate each step", referencing `/Users/CPowe/Downloads/skill.json`. Continuing the MVP's explicit "just write it" override; independent exercises deferred.
- scope: copied the original source to `config/journey-evaluator.json`; model instructions use its evaluation text only. Existing action and transaction-stop policy remains authoritative. No new dependency or second per-step model call.
- implementation: `src/journey-evaluation.ts` defines the structured assessment, finding details, evidence checks, and rendering. Each model decision includes task-based review and all ten heuristic assessments. Findings carry severity, category, recommendation, root-cause hypothesis, effort, priority, and qualitative metric hypotheses. Reports include step-level screenshot evidence, summary, prioritized action plan, and an explicitly labeled mean of subjective observed-step scores.
- evidence rules: each heuristic appears exactly once; both issues and no-issue judgments require current evidence. Unassessable heuristics explicitly say insufficient evidence. An issue needs a corresponding actionable finding. No scored step is accepted when every heuristic lacks evidence. Unvisited stages and numeric uplift are not estimated. Scores and business effects are expert judgments, not analytics.
- actual files: new `config/journey-evaluator.json`, `src/journey-evaluation.ts`, and `src/journey-evaluation.test.ts`; updated `src/journey-agent.ts`, `src/journey.ts`, `src/journey-agent.test.ts`, `README.md`, and this log. Other existing changes are outside this task.
- validation: all 113 tests across 10 files passed, including headless browser regressions. Focused tests cover rubric delivery to the provider, screenshot preservation, missing/duplicate/stale evidence, unsupported scores, actionable findings, and report/JSON fields. TypeScript and diff checks passed. The copied rubric matches the user source byte-for-byte.
- deferred check: explain why "no issue observed" needs evidence and why an observed-step score is not a measured conversion or whole-journey score. No live model run or historical report re-evaluation was performed.

### 2026-09-14 — Ashley modal clicks and image warnings
- trigger: user supplied the first live journey output, ending at step 9 with `Unsupported click target: StaticText` after three Close Modal clicks. Inspected the saved decisions and screenshot in `out/journeys/2026-09-14T16-13-54-248Z-61b5df53/`.
- mode: Full, continuing the explicit "just write it" override for the MVP. Independent exercises remain deferred.
- diagnosis: a controlled scrolled-page iframe fixture reproduced a missed Close Modal click. CDP viewport coordinates were being treated as document coordinates, then scroll was subtracted again. Corrected the conversion within CdpPage while preserving Page's document-coordinate contract. Shared adapter tests now check stable non-fixed boxes after scrolling. [CDP mouse events use viewport coordinates](https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent).
- journey fix: StaticText/InlineTextBox selections may resolve only to an enclosing supported control via snapshot depth, never a sibling or a control outside the document. Both selected label and containing control pass restricted-action checks; disabled parents are rejected. Reports/history record the actual executed ref. Prompt includes depth and guidance on repeated unsuccessful dismissal.
- SDK fix: screenshot content now uses `file`, `mediaType: image/png`, and raw data according to the installed SDK types. An intercepted-provider test confirms two PNG inputs and no SDK warnings without contacting an external API.
- actual files: `src/page/cdp.ts`, `src/page/page.contract.test.ts`, `src/journey.ts`, `src/journey-agent.ts`, `src/journey.test.ts`, `src/journey.browser.test.ts`, new `src/journey-agent.test.ts`, and this log. Existing unrelated edits are preserved.
- checks: full suite passed 108 tests across 9 files. The iframe regression failed before the coordinate fix and passed afterwards. TypeScript and diff checks passed. No live Ashley rerun was performed by the assistant.
- deferred understanding check: trace viewport-to-document conversion through measurement and click, and explain why a text label may resolve to a parent but not a sibling.

### 2026-09-14 — Minimal shopping journey
- scope: one CLI shopping attempt using a predefined persona, a desktop browser, a 20-action limit, and a Markdown/JSON report with screenshots. Existing uncommitted changes are the baseline and are preserved.
- mode: Full with explicit user override: "just write it". User predictions, implementation exercise, and authored design-journal entry are deferred.
- implementation: `src/journey.ts` owns the loop, restricted-action checks, stopping outcomes, evidence, and report rendering; `src/journey-agent.ts` supplies structured model decisions; `src/audit.ts` connects the browser and per-run files. Existing Page interface and older audit commands are reused without redesign.
- contract: stop immediately after inspecting the first cart attempt; success requires cited current confirmation text. Never intentionally execute checkout or payment controls. Search typing only. No heuristic scoring yet. Screenshot and automation failures are coverage/operational information, not UX defects.
- limitation: label-based action checks cannot guarantee transaction isolation on arbitrary sites. English controls and explicit cart confirmations are the current supported subset.
- deferred understanding check: explain why clicking Add to cart is not enough to mark a run successful, and how the final observation differs from an extra action.
- actual files: new `src/audit.ts`, `src/journey.ts`, `src/journey-agent.ts`, `src/journey.test.ts`, and `src/journey.browser.test.ts`; updated `package.json`, `README.md`, and this log. Other dirty files predate this task. No dependencies or Page interface changes were introduced.
- observations: the real browser fixture exposed that the existing default snapshot excludes ordinary product text. The journey now requests `snapshot({ all: true })` so product details and plain-text cart feedback remain available as evidence. Stale and negative cart confirmation text are rejected. Final browser smoke report and screenshots are in `out/journeys/browser-smoke/`; decisions in that fixture are scripted, not model-generated.
- validation: final `bun test` passed 100 tests across 8 files, including 22 journey policy/evidence tests and one complete headless browser journey. The browser fixture typed a query, searched, recorded missing delivery information, added a sofa, verified confirmation, and never clicked Checkout. Screenshot PNG signatures and report links were checked; the step-3 screenshot was visually inspected. `bunx tsc --noEmit` and `git diff --check` passed. The CLI correctly exits with setup instructions when its API key is absent.
- Fallow: `guard` found no configured boundary rules. `review --base HEAD --brief` included existing uncommitted work and identified inherited unused `axe-core`/`FakePage.highlights` findings plus complexity hotspots in the new journey loop/report. No commit was made.
- limits: `OPENAI_API_KEY` is absent, so no live model/provider or public-storefront run was verified. Model behavior and independent understanding remain deferred; browser execution/report behavior is verified.

### 2026-09-14 — Findings, evidence, and model judgment validation
- baseline / scope: uncommitted project state after Overlay work. User explicitly requested auto mode for stronger Finding evidence and validated model judgments.
- mode: Full with the "just write it" learning override inferred from "auto mode"; no prediction, chosen-unit exercise, or user-authored design-journal entry was requested.
- implementation: Page geometry now distinguishes measured, observed not-rendered, and unavailable outcomes. Rules emit unavailable geometry as Audit notices outside Finding severity counts. Grouping says "similar elements" because parent identity is unavailable. Screenshot association checks the actual viewport after scrolling and the report discloses when placement could not be verified.
- model judgment implementation: action and reflection prompts receive the actual desktop or mobile viewport. Choice refs are validated against the before Snapshot; cited refs are validated against the after Snapshot; heuristics without a reported gap are rejected. Probe records resolved evidence rows. Calibration saves a versioned JSON artifact with viewport, model, before/after Snapshots, choices, selected action timing, reflections, and resolved cited evidence.
- additional observation: the live Ashley `--report --json` check exposed binary screenshots expanding into millions of JSON fields. JSON reporting now records screenshot presence and byte size while keeping PNG bytes in report files. A second live `--json` run produced a 24,557-byte document with 28 Findings, zero coverage notices, and two screenshot summaries containing byte counts but no raw `shot` fields.
- actual files: `src/page/page.ts`, `src/page/cdp.ts`, `src/page/fake.ts`, `src/page/page.contract.test.ts`, `src/rules.ts`, `src/group.ts`, `src/annotate.ts`, `src/report.ts`, `src/measure.ts`, `src/agent.ts`, `src/probe.ts`, `src/calibrate.ts`, new `src/calibration-record.ts`, and new focused tests in `src/evidence.test.ts`, `src/agent.test.ts`, and `src/calibration-record.test.ts`; documentation in `README.md`, `CONTEXT.md`, and this log.
- predictions vs observations: no file prediction was collected because auto mode skipped learning exercises. The live report confirmed "similar elements," verified screenshot omissions, 22 Findings with verified evidence across 8 screenshots, and successful report generation.
- checks: `bun test` passed 77 tests across 6 files including headless Chrome; `bunx tsc --noEmit` and `git diff --check` passed. Focused evidence, model-boundary, calibration-record, and Overlay-report tests passed. Fallow guard found no configured boundary or policy rules. `fallow audit` reported zero introduced dead code and no duplication, but exited 1 because two dead-code errors are inherited from the base (`axe-core` and `FakePage.highlights`); it also identified touched complexity hotspots, including `runRules`.
- assistance needed: fully assistant-implemented at the user's request. Software behavior is verified; independent understanding is not demonstrated.
- deferred checks: user-authored design-journal entries for Page, rules/evidence, and model judgment ownership; live `probe`/`calibrate` API execution was intentionally skipped to avoid spending API credits during deterministic verification.
- next review date: 2026-09-28.

### 2026-09-14 — Overlay detection and dismissal
- baseline / scope: HEAD `8b877fd` plus pre-existing uncommitted baseline fixes, frame handling, README, and skill installation. This task covers unrelated control selection, dismissal verification, and reporting unsuccessful dismissal.
- mode: Full, Phase 3; no delayed retrieval drill because the module index has no history.
- chosen implementation unit: Christopher chose "dissmissal verification."
- predicted files: Christopher: "page and overlay I think we probly also need to update report"
- predicted reasons: not yet supplied; report changes marked uncertain in the original prediction.
- agreed behavior: Christopher: "The audit should continue. It should be noted in the final report"
- actual files: implementation in `src/overlay.ts`, `src/page/page.ts`, `src/page/cdp.ts`, `src/page/fake.ts`, `src/measure.ts`, and `src/rules.ts`; tests in `src/overlay.test.ts`, `src/page/page.contract.test.ts`, and new `src/overlay-report.test.ts`; an evidence-comment correction in `src/annotate.ts`; records in this log, `docs/design-journal.md`, and `docs/exercises/dismissal-verification.md`. Pre-existing baseline, frame, README, and skill edits are excluded.
- predictions vs observations: Page and Overlay matched the prediction. Reporting required changes in `measure.ts` (pass attempts and avoid repeat attempts after failure) and `rules.ts` (convert outcomes into truthful Findings). `report.ts` and `group.ts` already carry the needed text and evidence, so their earlier baseline edits are not part of this task. Tests span adapter behavior, dismissal, and report/evidence integration.
- assistance needed: assistant explained the current selection and verification defects; understanding has not yet been independently checked.
- design journal: Christopher supplied an Overlay entry after an assisted explanation; saved verbatim. It states the dismissal invariant and continue-and-report rationale. Christopher explicitly adopted: "Overlay owns the dismissal attempt results; Page owns access to the live page state, and Report presents the outcomes." Ownership is settled; no reconsideration condition has been specified.
- agreed contracts: Christopher accepted `Page.isPresent(originalNode): Promise<boolean>` (inspection failures throw) and an ordered `DismissalResult[]` with name, attemptedWith, pre-click shot, and dismissed/remained/unverified status; unverified carries a reason. The agreed result contract is now integrated into the audit and reporting pipeline.
- implementation support: Page presence inspection added to both adapters; FakePage tracks original fixture identity for this operation (reuse a fixture object across states to preserve identity). Control selection now stops at the end of a candidate's descendants. Contract tests and unrelated-control regressions are authored.
- implementation assistance: Christopher requested the complete verification code, then requested placement and integration. The assistant-supplied body was integrated; error formatting also handles thrown values that cannot be converted to strings. This is assisted completion, not independent implementation.
- prediction before runtime checks: Christopher: "status remained the report should be generated" for a click that only changes focus while the Overlay remains rendered.
- observations: real Page contract checks confirm presence after a non-dismissing click; Overlay checks record remained once; report integration generates output and preserves pre-click bytes for dismissed, remained, and unverified outcomes. The prediction matched these checks.
- checks: `bun test` passed 63 tests across 3 files, including headless Chrome; the focused Overlay suite passed 16 tests; `bunx tsc --noEmit` and `git diff --check` passed. Fallow guard found no configured boundary or policy rules. No live-site audit was rerun for this task.
- extension: at Christopher's explicit request, the assistant added the mixed-outcome regression. It verifies a confirmed first dismissal followed by a remaining second Overlay, ordered results, distinct pre-click evidence, two screenshot captures, and the final Page state.
- verification status: implementation verified; discussion, implementation, and extension assisted; prediction demonstrated; independent implementation and retained understanding not yet demonstrated.
- deferred checks: independent extension was deferred when Christopher asked the assistant to write it; delayed retrieval is scheduled for a later eligible session, not a background reminder.
- next review date: 2026-09-28.


### 2026-09-14 — Unnamed Playwright product links
- baseline / scope: Playwright migration plus the user's Ashley run ending at an unnamed product-link target.
- mode: Full with the standing "just write it" override; implementation remained assistant-owned.
- observation: Playwright returned the product anchor as an unnamed link and its product heading as a named descendant. The model selected the correct anchor ref, but journey validation rejected it before Playwright acted.
- implementation: action target resolution now retains the anchor locator and borrows the first named descendant for policy checks and reporting. Missing, disabled, and unnamed failures are reported distinctly.
- checks: `bun test` passed 117 tests across 11 files, including the Playwright browser contract and complete search-to-cart fixture; `bunx tsc --noEmit` and `git diff --check` passed.
- assistance needed: fully assistant-implemented at the user's request.

### 2026-09-14 — New Mother profile and style
- baseline / scope: existing New Mother shopping constraints plus the user's requested demographic and style details.
- mode: Quick; this is a localized persona-data and documentation change under the standing "just write it" override.
- implementation: the persona is 34, married, and based in Atlanta, with a warm contemporary family-friendly preference, soft shapes, an uncluttered look, and no required color. Exact address and ZIP remain unknown, and demographics cannot be used to infer needs or abilities.
- actual files: `src/journey.ts`, `src/persona.test.ts`, `README.md`, and this log.
- assistance needed: fully assistant-implemented at the user's request.

<!--
### <date> — <task>
- baseline / scope:
- mode:
- chosen implementation unit:
- predicted files:
- actual files:
- predictions vs observations:
- assistance needed:
- deferred checks:
- next review date:
-->
