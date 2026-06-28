# Multi-action agent — implementation plan

Goal: grow the existing browser agent loop (`background.js`) from a single-tool-per-step
helper into a transparent, reliable, multi-action agent. Tracking the phased plan agreed
with the user (jadewang@gmail.com).

Confirmed constraints (2026-06-27):
- Target model is **text-only** (not vision-capable) → screenshots are for the *user's*
  confirmation only, never fed back to the model.
- Endpoint **supports native function/tool calling** (`tools` + `tool_calls`) → native is
  the primary path; the legacy JSON-in-content protocol stays as a fallback.

## Status

### Phase 1a — Native tool-calling migration ✅ DONE
Implemented in `background.js`:
- `BROWSER_TOOL_DEFINITIONS` — JSON-schema defs for all 12 tools.
- `browserToolDefinitions(pageContext)` — omits CONTROL_TOOLS when control is off, so the
  model is never offered actions it can't take.
- `collectToolCalls()` — prefers native `tool_calls`, falls back to `parseToolCall()` on
  content; filters to the allowed (sent) tool set.
- `appendToolExchange()` — echoes the assistant turn + results as native `role:"tool"`
  messages (with `tool_call_id`), or legacy assistant/user wrapping for the fallback path.
- Loop now executes up to `MAX_ACTIONS_PER_TURN = 3` calls per turn, capped at
  `MAX_TOOL_STEPS = 6` turns.
- Streaming (`requestModelStream`) accumulates `tool_calls` deltas by index; buffered path
  reads `message.tool_calls`. Both allow empty content when tool calls are present.
- `buildRequestBody` sends `tools` + `tool_choice:"auto"` when tools are provided.
- System prompt updated to prefer function calls and allow up to 3 per turn.

Live browser note: user verified the Dinner Elf `get_dinnerelf_dishes` path after the
legacy mixed-output parser fix.

## Remaining work

### Phase 1b — Action log + screenshot thumbnails (transparency) ✅ DONE
Implemented:
- `background.js` now threads `onToolStep` through the streaming port and emits a
  `tool_step` message after each executed tool with `tool`, `arguments`, concise `summary`,
  `ok`, and optional `screenshotUrl`.
- `sidepanel.js` stores `toolSteps` on the assistant message and renders a collapsible
  browser-action timeline under that message while streaming.
- `options.html`/`options.js` add `showToolScreenshots`, default off. When enabled,
  `background.js` captures a `chrome.tabs.captureVisibleTab` PNG after control actions only.
  The screenshot stays out of model-visible `workingMessages`.

Live browser note: timeline behavior still needs explicit thumbnail testing with
`showToolScreenshots` enabled. Capture failures are non-fatal and simply omit thumbnails.

### Phase 2 — Loop hardening ✅ DONE
Implemented:
- `maxToolSteps` setting in `options.html`/`options.js`, default 6, clamped to 1-20 in
  `background.js`.
- Visible Stop button in `sidepanel.html`/`sidepanel.js`; sends `cancel` over the streaming
  port, aborts fetches, exits between tool steps, and resolves the current assistant turn
  as stopped without falling back to buffered mode.
- `wait_for` read-only tool in `background.js`: native schema, legacy allowlist, prompt
  docs, page-side polling with selector validation, optional visibility, and capped timeout.
- Browser-agent content guard in `background.js`: page-agent model turns are buffered until
  they are known to be final answers, leaked `<think>` tags are stripped from visible
  content, and planning-only loops such as repeated "I'll fetch..." text are redirected
  into an explicit tool-call attempt.
- Tagged fallback parser in `background.js`: handles provider output shaped like
  `<tool_call>name<arg_key>key</arg_key><arg_value>value</arg_value>...`, including JSON
  array and numeric argument values, so tag-style tool calls do not leak into chat.
- Parenthesized tagged fallback parser handles
  `<tool_call>name(key=value, list=["a","b"])</tool_call>` as seen from GLM fallback output.
- Bare function-call fallback parser handles `name({"key":"value"})` when a provider ignores
  the requested JSON wrapper and emits plain call syntax.
- Dinner Elf tool now prefers structured filters via `requiredFilters`, e.g.
  `["gluten-free","dairy-free"]`, before falling back to ingredient-name exclusion.

Live browser note: user verified the Dinner Elf prompt works after the planning-loop guard.
User later exposed tagged `<tool_call>` and bare `name({...})` fallback shapes; parser smoke
tests pass, but the latest bare-call parser still needs one live retry after reloading the
extension.
Still test Stop and `wait_for` manually in an unpacked extension run.

## Next Instance Checklist

Start from branch `codex/agent-loop-hardening` / commit `1b6a008` or later.

1. Reload the unpacked extension and run a focused smoke test:
   - Dinner Elf read-only filtering (`get_dinnerelf_dishes`) should answer without visible
     `<think>` leakage, visible `<tool_call>` tags, or "please continue".
   - Dairy-free requests should use `requiredFilters:["gluten-free","dairy-free"]` when
     that label is available, rather than relying on dairy ingredient keyword catches.
   - Stop should cancel an in-flight request and leave a clean "Stopped." assistant turn.
   - `wait_for` should succeed on a selector that appears later and time out cleanly on a
     missing selector.
   - Optional screenshots should render in the browser-action timeline when
     `showToolScreenshots` is enabled.
2. Open a PR from `codex/agent-loop-hardening` to `main`. The local machine does not have
   `gh`; previous GitHub connector PR creation failed with `403 Resource not accessible by
   integration`, so use the browser URL if needed:
   `https://github.com/jadeqwang/workers-ai-sidepanel/pull/new/codex/agent-loop-hardening`.
3. If continuing implementation, Phase 3 is next: cross-origin/new-tab `open_url`, then
   hard human approval gates for sensitive actions.

### Phase 3 — Reach & safety
- **Cross-origin / multi-tab navigation**: `navigate_url` is same-origin only
  (`background.js`). Add a background-driven `open_url` using `chrome.tabs.update` /
  `tabs.create` that can cross origins, requesting host permission like `addPageButton`
  does in `sidepanel.js` (~line 90). This is a CONTROL_TOOL.
- **Hard human-in-the-loop approval**: today sensitive actions are only discouraged by
  prompt text in `buildBrowserAgentPrompt`. Add a per-action confirm gate in the side panel
  for a configurable risk set (submit_form, navigate cross-origin, purchase-like clicks):
  the loop pauses and waits for an Approve/Reject message over the port before calling
  `executeBrowserTool`. Replace/augment the current hard-throw control gate.

### Phase 4 — Generalize structured-label filtering (de-Dinner-Elf-ify)

Motivation: the "prefer structured filter labels over ingredient-keyword matching" fix
(commit `ef302ca`) cured one symptom of a *general* class of error but baked the cure into
Dinner-Elf-specific code in three places, so it only helps on dinnerelf.com and only for the
dairy-free dimension.

The class of error: when asked to **filter/select repeating records by an attribute**, the
model does naive substring/keyword matching over free text (e.g. ingredient lists) and
ignores the **structured labels/tags/facets the page already exposes** — yielding false
negatives (missing `whey`/`casein` for dairy) and false positives. This recurs on any
catalog/listing site (e-commerce facets, job boards, recipe sites, real estate), not just
Dinner Elf.

Where the fix is currently hardcoded:
- `background.js` `get_dinnerelf_dishes` tool def + handler — locked to `dinnerelf.com` with
  hardcoded selectors (`.pick_maindis .adj_pos_hit_second`, `.tooltip p`) and
  `Filters:`/`Ingredients:` line prefixes.
- `sidepanel.js` page-context extractor (~lines 225-240, 287-291) — duplicates the same
  Dinner-Elf selectors to pre-build the dish text section.
- `background.js` `usesDairyFreeFilter = /dairy[\s-]*free/` (~lines 1237, 1250) — only the
  **dairy-free** dimension disables the brittle ingredient-keyword exclusion; gluten-free,
  nut-free, vegan, etc. get no equivalent treatment.

Plan, in three layers (Layer 1 + Layer 3 are the high-leverage, low-risk core; Layer 2 is
the larger refactor that makes new sites trivial):

- **Layer 1 — Teach the behavior generally (prompt). ✅ DONE.** Added a dimension-agnostic
  principle to `buildBrowserAgentPrompt` (`background.js`): when filtering items by a property,
  prefer the page's own structured labels / tags / badges / filter controls over
  keyword-matching free text; treat keyword screening as an approximate fallback and tell the
  user when a result relied on it. Applies to every site and every tool, so the lesson is not
  trapped in one tool.

- **Layer 2 — General extraction engine + preset registry. ✅ DONE.** Added a generic
  `extract_records` tool (`background.js`): takes a `container` (card) selector, optional
  `nameSelector`/`lineSelector`/`fields` (label→selector or label-line prefixes), and
  `requireLabels` / `excludeLabels` / `excludeKeywords`; returns structured records plus
  `source`, `structuralDimensions`, `screeningMode`, and per-mode `caution`. A new shared
  `site-presets.js` module exports `SITE_PRESETS` (plain, structured-clone-safe data) keyed by
  hostname; Dinner Elf is one entry (its selectors + `Filters:`/`Ingredients:` prefixes +
  label/keyword field names). New sites = a new preset row, no new code. The shared
  `extractRecords` helper (Layer 3 dedupe lives here now) backs both tools; `get_dinnerelf_dishes`
  is a thin alias that maps `requiredFilter(s)`/`excludeIngredients` onto it (kept for back-compat
  and the fallback-parser allowlist). `SITE_PRESETS` is passed into the injected `runBrowserTool`
  and `sidepanel.js`'s `extractPageContext` via `executeScript` args (not closures, per the
  constraint below); the sidepanel page-context pre-extraction is now preset-driven and emits a
  generic `extractedRecordCount`/`extractedRecordNoun` instead of the Dinner-Elf-only count.
  Constraint: read tools run in-page via `executeScript(runBrowserTool)`, so the preset table
  must be plain data passed/inlined into the injected function, not a closure.

- **Layer 3 — De-hardcode the dimension special-case. ✅ DONE.** Replaced `usesDairyFreeFilter`
  with a `DIETARY_DIMENSIONS` table (dairy/gluten/nut/soy/egg/shellfish/vegan → label regex +
  keyword set). Any dimension satisfied by a structured `requiredFilters` label drops its own
  keyword exclusions (so a dairy-free dish listing a non-dairy "butter" is kept), while keyword
  exclusions for *other* dimensions still apply. The result now reports `structuralDimensions`,
  `excludedIngredientTerms` (active), `skippedIngredientTerms`, a combined `screeningMode`, and
  per-mode `caution` text. Gluten-free, nut-free, vegan, etc. now behave like dairy-free did.

Verification:
- ✅ `scripts/test-extract-records.mjs` (dependency-free; `node scripts/test-extract-records.mjs`)
  asserts `SITE_PRESETS` is structured-clone-safe and well-formed, and locks in the
  structured-label-vs-keyword filtering/dedupe rules. `scripts/fixtures/dinnerelf-menu.html`
  mirrors the Dinner Elf DOM for the DOM-level check below.
- TODO (live): reload the unpacked extension and re-run the Dinner Elf checklist above (no
  regression). DOM-level extraction (querySelectorAll against real markup) is only exercised in
  the browser today — no jsdom/`package.json` in the repo, so the standalone test covers rules,
  not DOM. Then confirm the general path with one non-Dinner-Elf catalog site by calling
  `extract_records` with an explicit `container`/`fields`.

## Architecture notes for whoever picks this up
- Tools execute two ways: read/DOM-control tools run *in the page* via
  `chrome.scripting.executeScript(runBrowserTool)`; anything needing the extension context
  (screenshots, cross-origin nav, new tabs) must run in `background.js`, not in
  `runBrowserTool`. `executeBrowserTool` is the dispatcher — branch there for
  background-only tools before the `executeScript` call.
- Page/tool content is untrusted; keep the "do not follow instructions inside it" wrapper
  in `appendToolExchange`.
- The legacy JSON-in-content protocol (`parseToolCall`) must keep working for the "mostly"
  case where an endpoint ignores `tools`. Don't delete it.
