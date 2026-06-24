# Workers AI Sidepanel

A dependency-free Manifest V3 Chrome side-panel extension for OpenAI-compatible chat endpoints, with optional fallback routing for transient model capacity failures.

The extension works well with Cloudflare Workers AI's OpenAI-compatible `/chat/completions` endpoint. It stores settings in the local Chrome profile and does not bundle any API credentials.

## Features

- Side-panel chat UI
- Streaming assistant responses
- Optional fallback endpoint for transient 502/503/504 capacity errors
- Current-page context sharing after explicit permission
- Optional browser-control tools for attached pages
- No build step or npm install required

## Install

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this directory.
5. Open the extension's **Details**, then **Extension options**.
6. Enter your endpoint, model, and authentication values.
7. Pin the extension and click its toolbar icon to open the side panel.

## Cloudflare Workers AI Setup

Use Cloudflare's OpenAI-compatible Workers AI endpoint:

```text
https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1/chat/completions
```

Create a Workers AI API token in the Cloudflare dashboard, then enter it as the bearer token.

Example primary model:

```text
@cf/zai/glm-4.5-air
```

Example Kimi fallback model:

```text
@cf/moonshotai/kimi-k2.7-code
```

If you configure a fallback endpoint, the extension only uses it for transient capacity-style failures such as `3040: Capacity temporarily exceeded`.

## Expected API Contract

The extension sends OpenAI-compatible chat completion requests:

```json
{
  "model": "@cf/example/model",
  "messages": [{ "role": "user", "content": "Hello" }],
  "temperature": 0.7,
  "max_tokens": 2048,
  "stream": true
}
```

For GLM model IDs, the extension also sends:

```json
{
  "thinking": { "type": "disabled" }
}
```

It expects streaming SSE chunks with `choices[0].delta.content` for answer text. It also has a non-streaming fallback path for endpoints that return `choices[0].message.content`.

## Page Context

To discuss the active tab, click **+ Page** in the side panel and grant access to that site's origin when Chrome asks. The extension reads visible text plus available tooltip and accessibility metadata only after that explicit action.

While a page is attached, the model can request bounded read-only browser tools such as reading page text, finding text, inspecting selectors, and hovering elements. Browser control tools are disabled unless you explicitly turn on **Control** in the page attachment bar.

## Security

Chrome local storage is not a secret vault. This is appropriate for personal or small-group unpacked use. For broader distribution, keep provider credentials in a server-side Worker and authenticate users with revocable, short-lived credentials.

The extension requests endpoint host permissions only when settings are saved, and page host permissions only when you attach a page.

## Development

Regenerate icons after editing `icons/icon.svg` or `scripts/generate-icons.js`:

```bash
node scripts/generate-icons.js
```

Syntax-check scripts:

```bash
node --check background.js
node --check sidepanel.js
node --check options.js
```
