# ux-audit

A command-line tool that attempts a shopping task as a predefined persona and reports the journey with screenshots. The MVP stops after an add-to-cart attempt, before checkout.

## Shopping journey MVP

Requires Bun, Playwright's Chromium browser, and `OPENAI_API_KEY` in your environment or `.env` file.

```bash
bun install
bunx playwright install chromium
bun run audit https://www.ashleyfurniture.com/ "buy a sofa" --persona "New Mother"
```

Choose `New Mother` (limited time, easy cleaning, listed item price at or below $1,500, and delivery by October 15, 2026) or `Careful Shopper` (product details, total price, delivery, returns). The run uses one desktop viewport and at most 20 actions. It can click, type into empty search fields, and scroll. Progress is printed in the terminal; Playwright's Chromium window is visible unless `UXA_HEADLESS=1` is set.

For `New Mother`, price and delivery are hard selection constraints. The agent must find current page evidence for both before adding an item to the cart. If a product violates either constraint, or the details remain unavailable after reasonable inspection, it must choose another product or stop blocked. Since the MVP does not enter checkout, taxes and delivery fees remain unknown unless the product journey shows them explicitly.

Each run writes a unique `out/journeys/<run>/` directory containing `report.md`, `report.json`, and step screenshots. Open `report.md` in a Markdown preview to view the images. Reports preserve the attempted journey when the agent gets stuck or its API call fails. Screenshots are captured before each decision and after the final action; screenshot failures are disclosed.

An explicit observed add-to-cart confirmation is required for success. The tool stops after the first add-to-cart attempt even if it cannot verify success. Other outcomes are blocked, step limit, or automation error. Automation errors are separate from UX findings.

Every model decision now includes a step evaluation using the supplied [UX Journey Evaluator](config/journey-evaluator.json). The original `skill.json` is copied into this project; only its evaluation text is used, not tool-trigger metadata. Edit that file to revise the rubric. No additional model call is made for evaluation.

Each step records intent, information needs, decisions, assumptions, first-time/experienced-user friction, and an assessment of all ten Nielsen Norman heuristics. Findings include screenshot context, cited page evidence, category, severity, recommended improvement, estimated effort, priority, and relevant metric-impact hypotheses. The report includes an executive summary and a prioritized action table. Repeated findings with the same description are grouped in the summary, while each step retains its own evidence.

Missing evidence is reported as `Insufficient evidence`, not a pass or violation. Persona effects, business goals, root causes, effort, and predicted metric effects are expert hypotheses rather than observed analytics. No numerical uplift is predicted. Step scores are subjective expert judgments, with rationale, and may be unavailable. The final score is the explicitly labeled unweighted mean of assessed states, not a score for unvisited checkout or the complete website. Existing reports are not retroactively re-evaluated; rerun `audit` to use the rubric.

An inconsistent heuristic review does not stop an otherwise valid shopping action. Unsupported findings are excluded individually; an invalid heuristic assessment is excluded from scoring. The report explains these evaluation limitations, preserves valid findings and screenshots, and keeps the unverified review in JSON for diagnosis. Invalid action targets, action evidence, and restricted controls still stop execution. Terminal action messages describe proposals; the report records which actions actually executed.

If a proposed click or search target remains in the accessibility snapshot but is no longer rendered, the failed action is recorded and the agent receives a fresh page state so it can choose another route. A failed Add to cart click is not considered a cart attempt. Other browser failures still stop the run as automation errors.

The action policy rejects recognizable checkout, payment, purchase, login, and account controls, and permits typing only in search fields. It uses a fresh browser profile without your saved login or payment details. This is a conservative English-language MVP, not a transaction sandbox: arbitrary websites can attach unexpected behavior to innocently named controls. Test on a known storefront. Login, CAPTCHA, search requiring Enter, prefilled search fields, and unrecognized cart confirmations may stop the attempt. The model sees page screenshots and accessibility snapshots via the configured OpenAI API; `UXA_MODEL` retains the existing model override.

The commands below are earlier inspection tools; `audit` is the MVP entry point.

## Setup

Requires Bun and Playwright's managed Chromium browser. Install it with `bunx playwright install chromium`.

From the project directory:

```bash
bun install
bun run measure https://www.ashleyfurniture.com/ --report
```

This opens a temporary browser profile, audits the desktop Page, and writes `out/report/report.md` and screenshots. Subsequent reports use the same output directory, so copy any report you want to keep before running another audit.

Reports keep unavailable geometry under **Audit coverage**, outside UX Finding severity counts. A Finding receives a screenshot link only when its recorded box intersects the Page's actual viewport after scrolling; otherwise the report says that verified screenshot placement was unavailable.

`index.ts` is a starter placeholder; the commands below are the tool's entry points.

## Commands

```bash
# Inspect a Snapshot and save out/peek.png
bun run peek https://example.com

# Include roles normally filtered from the Snapshot
bun run peek https://example.com --all

# Measure the mobile Page and generate a report
bun run measure https://example.com --mobile --report

# Print measurements and Findings as JSON
bun run measure https://example.com --json

# Audit without a visible browser window
UXA_HEADLESS=1 bun run measure https://example.com --report
```

All four commands support `--mobile` (390×844); the default desktop viewport is 1440×900. `peek` and `measure` do not require an API key.

### Model-assisted actions

`probe` chooses and clicks one Node, then compares the outcome with its stated expectation. `calibrate` repeats choices and reflections to check consistency; it performs one click using the first choice.

Set `OPENAI_API_KEY` in your environment or a local `.env` file, which Bun loads automatically:

```dotenv
OPENAI_API_KEY=your-api-key
```

```bash
bun run probe https://example.com "Find the search control" --mobile
bun run calibrate https://example.com "Find the search control" --mobile --runs=10
```

`probe` appends validated results and their resolved evidence rows to `out/observations.jsonl`. `calibrate` defaults to 10 runs and saves a reproducible JSON record under `out/calibrations/` containing the viewport, model, before and after Snapshots, choices, selected action and timing, reflections, and cited evidence rows. Model-selected action refs and cited evidence refs must exist in their respective Snapshots or the command fails instead of recording unsupported evidence.

The actual viewport is included in both model prompts. Desktop runs are described as desktop and mobile runs as mobile.

## Configuration

| Variable | Purpose |
|---|---|
| `UXA_HEADLESS=1` | Run without a visible browser window |
| `OPENAI_API_KEY` | API key for `probe` and `calibrate` |
| `UXA_MODEL` | Override the model used by `probe` and `calibrate` |

## Development checks

```bash
bunx tsc --noEmit
bun test
```

The tests cover Overlay handling and the shared Page contract. Browser contract tests launch Playwright's managed Chromium in an isolated context.

See [AGENTS.md](AGENTS.md) for Fallow checks, [CONTEXT.md](CONTEXT.md) for domain vocabulary, and the [Page architecture decision](docs/adr/0001-page-has-no-evaluate-escape-hatch.md) before adding browser capabilities.
