# Hybrid vision plan — GLM 5.2 (text) + Kimi K2.7 (vision)

Goal: let the side-panel copilot **see** the page for visual puzzles, without giving up the
text-only GLM 5.2 setup that already works from mainland China. This unblocks visual puzzle
design for the escape-room / playable-poetry experience demoed to family in China.

## Why this shape (decisions already made with the user, jadewang@gmail.com)

- **Use case**: human + AI co-op puzzles that unlock plot. The **human clicks to advance**
  (intentional interaction) — so the AI needs **vision, not computer use**. We are NOT adding
  an agent action loop for the vision path; vision turns are conversational single-shots.
- **Architecture A — hybrid, end-to-end vision (chosen over a two-stage caption hop).**
  - Text puzzles → **GLM 5.2** (`glm-5.2`), already validated.
  - Visual puzzles → **Kimi K2.7** (`@cf/moonshotai/kimi-k2.7-code`) **end-to-end**: the
    screenshot + conversation go to Kimi directly, so the model sees the pixels and reasons
    over them in one call. **Do NOT** caption the screenshot with a vision model and feed text
    to GLM — a puzzle's solution often hinges on the exact detail a generic caption discards,
    and a screenshot (unlike a web page) has no lossless DOM channel to fall back on.
- **Why Kimi specifically**: it is the only Chinese-origin multimodal model on Workers AI
  (no GLM/Zhipu or Qwen vision variant exists in the catalog — verified 2026-06-29). Running
  the open weights on Cloudflare means **no provider-side moderation classifier** in front of
  it, matching the GLM 5.2 pipeline-control rationale. Closest cultural/linguistic sensibility
  to GLM for Chinese poetry/memory. 262K context; $0.95/$4.00 per M input/output tokens.
- **Persona consistency**: both providers receive the **same `systemPrompt`** (the character
  spec) so the copilot reads as one character across the GLM↔Kimi seam. Because the human
  clicks to advance, puzzles are discrete units, so a per-puzzle model switch is far less
  jarring than mid-conversation switching.

## Blocking validation (do this BEFORE relying on Kimi for sensitive puzzles)

The entire pipeline-control rationale rests on a finding the user *earned by testing*: GLM 5.2's
censorship lives in the provider **classifier**, not the **weights**, so the hosted open model
handles the Beijing-youth-hostel poems faithfully. **That finding does NOT transfer to Kimi**
(different lab, different alignment baked into weights). Before shipping any visual puzzle that
touches sensitive themes, probe Kimi K2.7's **core-model** behavior on the same material the way
GLM was probed. If Kimi self-censors in the weights, keep sensitive material on the GLM-voiced
text track and design visual puzzles around non-sensitive content.

## Current architecture (what we're extending)

- Config in `chrome.storage.local` (`background.js` DEFAULTS + `options.js`): a **primary**
  provider (`endpoint`/`model`/`bearerToken` + optional CF Access `accessClientId/Secret`) and a
  capacity-only **fallback** (`fallbackEndpoint`/`fallbackModel`/`fallbackBearerToken`).
- `getPrimaryProvider`/`getFallbackProvider` → provider objects; `requestModelWithFallback`
  tries primary, then fallback **only on transient capacity errors**. The vision provider is a
  THIRD, independent provider — not the capacity fallback — selected by routing, not by error.
- `buildRequestBody` builds OpenAI-style bodies. `shouldSendThinkingFlag` sends
  `thinking:{type:"disabled"}` only for `/glm/i` models — Kimi won't match, which is correct;
  confirm Kimi doesn't need a different flag and doesn't leak `<think>` (we already
  `stripLeakedThinking`).
- `requestCompletion(messages, pageContext, stream)` is the entry. With no `pageContext.tabId`
  it's a plain chat; with a tab it runs the browser tool loop. Messages are OpenAI chat shape.
- Screenshots already work: `captureToolStepScreenshot(tabId)` uses
  `chrome.tabs.captureVisibleTab(windowId,{format:"png"})` and returns a data URL. Today
  screenshots are user-confirmation only and kept OUT of model messages.
- Side panel (`sidepanel.js`/`.html`) has a page-context bar with a **Control** toggle
  (`#control-page` → `pageContext.browserControl`). The Vision toggle mirrors this exactly.

## Status (2026-06-29)
Phases **V1–V4 implemented and merged** into the working tree (`vision.js` + edits to
`background.js`/`options.*`/`sidepanel.*`; `scripts/test-vision.mjs` passes). Image-input
contract **confirmed** as OpenAI `image_url` (user verified the model's input schema:
`messages[].content` Option 2 array → `image_url{url,detail}`) — no Worker-side translation
needed. **Deferred:** V3 screenshot thumbnail (toggle + routing only). **Still pending:** live
extension reload + curl wire-test, and the blocking Kimi core-model censorship probe below.

## Implementation plan

### Phase V1 — Vision provider config
- `background.js` DEFAULTS + `options.js` DEFAULTS + `options.html`: add `visionEndpoint`,
  `visionModel` (default `@cf/moonshotai/kimi-k2.7-code`), `visionBearerToken`. Reuse the
  existing CF Access fields (`accessClientId`/`accessClientSecret`) — the vision Worker sits
  behind the same Access app, so no new Access fields needed; just thread them into the vision
  provider headers like the primary does.
- `options.js` submit: add the vision endpoint origin to the `chrome.permissions.request`
  origins set (same pattern as `fallbackEndpoint`). Validate: if any vision field is set, require
  `visionEndpoint` + `visionModel` both (mirror the fallback validation in
  `validateConfig`/options).
- `background.js`: add `getVisionProvider(config)` → returns null unless
  `visionEndpoint`+`visionModel` are set; headers via `buildHeaders` including CF Access.

### Phase V2 — Capture + attach screenshot, route to vision provider
- `background.js`: add `captureVisibleTabDataUrl(tabId)` (factor out of
  `captureToolStepScreenshot`, which can call it).
- Routing signal: a per-turn `useVision` flag from the side panel (Phase V3). Plumb it through
  the chat port message (`message.useVision`) into `requestCompletion`.
- New path in `requestCompletion` when `useVision` is true:
  1. Require a `getVisionProvider(config)`; if missing, throw a clear "configure the vision
     model in options" error.
  2. Capture `captureVisibleTabDataUrl(pageContext.tabId)`.
  3. Build messages: `[{role:"system", content: config.systemPrompt}, ...history]`, and attach
     the image to the LAST user message as an OpenAI content array:
     `content: [{type:"text", text: <user text>}, {type:"image_url", image_url:{url: <dataUrl>}}]`.
  4. Call the vision provider directly via `requestModel(visionProvider, messages, maxTokens,
     {stream...})` — **no browser tools, no tool loop** (human clicks to advance). Stream the
     answer back like the no-tab chat path.
  - Keep `max_tokens` at the full `config.maxTokens` for vision turns (puzzle reasoning), not
    the 768 cap used inside the tool loop.
- Do NOT send `tools`/`tool_choice` on vision turns.

### Phase V3 — Side-panel Vision toggle + thumbnail
- `sidepanel.html`: add a `#vision-page` button in the page-context bar next to `#control-page`.
- `sidepanel.js`: mirror the Control toggle — track `pageContext.useVision`, render
  "Vision on/off", and include `useVision: pageContext.useVision` in the `chat` port
  `postMessage` (both streaming and buffered send sites, ~lines 550/705/713).
- Optional but nice: show the captured screenshot thumbnail inline on the user turn when Vision
  was on, so the human sees exactly what the AI saw (reuse the timeline thumbnail rendering from
  Phase 1b). Keep it out of model-visible history for GLM turns.
- Vision and Control are independent: Vision can be on with Control off (the common puzzle
  case). If both are on, prefer the vision single-shot path for now (document this; a
  vision-in-the-loop mode is out of scope).

### Phase V4 — Persona + prompt
- Ensure the **same `config.systemPrompt`** is the system message on both the GLM tool-loop path
  (`buildBrowserAgentPrompt` already wraps it) and the new vision path (use it raw, like the
  no-tab chat path). Do not bake puzzle/persona text into code — it stays user-configured.
- If voice drift shows up in testing, the lever is the shared system prompt, not code.

## Cloudflare-side requirements (the user owns these; see response for step-by-step)
1. Ensure the account/Worker can serve `@cf/moonshotai/kimi-k2.7-code` (Workers AI catalog).
2. The vision endpoint must accept OpenAI-style **image content arrays**. If the existing GLM
   Worker is a thin pass-through to Workers AI `/v1/chat/completions`, it may already work by
   just sending `model:"@cf/moonshotai/kimi-k2.7-code"` with image content. If the Worker
   transforms/validates bodies, it must be updated to forward `image_url` content untouched.
3. **OPEN QUESTION to verify empirically**: whether Workers AI's OpenAI-compatible
   `/v1/chat/completions` accepts `{type:"image_url", image_url:{url:"data:image/png;base64,..."}}`
   for this model, vs. requiring the native-binding `image: [bytes]` shape. Docs don't confirm.
   Verify with a curl before wiring the extension (see response). If image_url is unsupported,
   the vision Worker must translate the data URL into the native binding format server-side; the
   extension keeps sending OpenAI image_url either way.

## Validation
- Add a dependency-free node smoke test under `scripts/` for the new pure helpers (provider
  selection / message-with-image assembly), matching the existing `scripts/test-*.mjs` style.
  DOM/live behavior is browser-only (no jsdom/package.json in repo).
- Live: reload unpacked extension → attach a page → Vision on, Control off → ask about something
  only visible in the screenshot → confirm Kimi answers from the image, GLM path unaffected when
  Vision off, persona voice consistent, no `<think>` leakage.
- Run the Kimi core-model censorship probe (blocking validation above) before sensitive puzzles.

## Next-instance checklist
1. Branch off `main` (current work branch: `generalize-structured-label-filtering`).
2. Implement V1→V4 in order; keep the legacy text paths untouched (GLM-off-Vision must behave
   exactly as today).
3. Wait for the user's Cloudflare confirmation of the image-input format before declaring the
   live path verified; until then, implement to the OpenAI `image_url` contract (most likely).
4. Add the smoke test; run `node scripts/test-extract-records.mjs` to confirm no regression in
   existing tests.
5. Do NOT open a PR or push unless asked (`gh` is now installed; auth may be pending).
