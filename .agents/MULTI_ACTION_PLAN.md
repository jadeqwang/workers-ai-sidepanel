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
- Dinner Elf tool now prefers structured filters via `requiredFilters`, e.g.
  `["gluten-free","dairy-free"]`, before falling back to ingredient-name exclusion.

Live browser note: user verified the Dinner Elf prompt works after the planning-loop guard.
User later exposed tagged `<tool_call>` fallback shapes; parser smoke tests pass for
arg-pair and parenthesized forms, but parenthesized parsing still needs one live retry after
reloading the extension.
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
