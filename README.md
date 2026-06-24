# Workers AI Sidepanel

A dependency-free Manifest V3 Chrome side-panel extension for **any OpenAI-compatible chat endpoint**, with optional fallback routing for transient model-capacity failures.

It is named for Cloudflare Workers AI (which it works with out of the box), but it talks plain OpenAI `/chat/completions`, so it works with anything that speaks that format — including OpenAI's hosted models and Anthropic's Claude models through their OpenAI-compatibility layer. Settings are stored in your local Chrome profile, and no API credentials are bundled with the extension.

Use it when you want a browser-side AI panel without handing a model provider blanket access to your browser profile. You choose the endpoint, token, and model, so you can route through providers that work better in geographically restricted regions, keep credentials under your own control, and grant page access only when you explicitly attach a tab.

## Why this exists

I built this while working on [Spaces Left Blank](https://spacesleftblank.com/), my science-fiction memoirs in verse and AI-playable art/poetry experience, plus an expansion work: an escape-room-adjacent adventure for a human and an AI to copilot together. In both works, the AI is part of the experience of the piece, including making the puzzles possible to solve. "View Source" and "The Console Dialogues" follows a cast of characters who are familiar command line sigils (e.g., the narrator › , $, #, %, ~) who you, the player, inhabit by typing their next action.

I wanted to demo that experience to my parents when visiting them in Shanghai over the summer, but frontier models are region-locked. I considered the option of recording a video demo, but it would literally suck the soul out of the experience. So I made a "bring your own robot friend" option: a local side panel that can point at whichever model provider is reachable for the person using it.

This extension is the general version of the fix for the browser extension necessary for playing the escape room experience. I also created a "bring your own robot friend" option for the original trilogy: [Spaces Left Blank](https://spacesleftblank.com/run-it-yourself).

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
6. Enter your endpoint, model, and authentication values (see the provider guides below).
7. Pin the extension and click its toolbar icon to open the side panel.

## What you need to configure

Every provider needs the same three things in the options page:

| Field | What it is |
| --- | --- |
| **Endpoint URL** | The full `/chat/completions` URL for your provider |
| **Model** | The exact model ID string the provider expects |
| **Bearer token** | An API token/key for that provider |

The two walkthroughs below fill those in for Cloudflare Workers AI and for closed-model providers such as OpenAI and Anthropic. Pick whichever you want (or set one as the primary and the other as the fallback).

---

## Guide 1 — Cloudflare Workers AI (GLM and Kimi)

Workers AI hosts models like Zhipu's **GLM** and Moonshot's **Kimi** and serves them from a single OpenAI-compatible endpoint. You don't "spin up" or deploy anything — the models already run in Cloudflare's catalog, and you just call them by ID. You only need three things: your **Account ID**, an **API token**, and the **model ID**.

### Step 1 — Create a free Cloudflare account

Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up (the free plan includes a Workers AI allowance).

### Step 2 — Get your Account ID and an API token

1. In the dashboard sidebar, open **AI → Workers AI**.
2. Click **Use REST API** (Cloudflare shows this to help you call models from outside a Worker).
3. Cloudflare displays your account-specific endpoint, which contains your **Account ID** — it looks like:

   ```text
   https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/...
   ```

   Copy the `YOUR_ACCOUNT_ID` value (a long string of letters and numbers).
4. On the same screen, choose **Create a Workers AI API Token** (or go to **My Profile → API Tokens → Create Token** and use the **Workers AI** template). Create it and **copy the token now** — Cloudflare only shows it once.

### Step 3 — Build your endpoint URL

Take the Account ID from Step 2 and plug it into this exact URL:

```text
https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1/chat/completions
```

That `/ai/v1/chat/completions` path is the OpenAI-compatible one — make sure it ends exactly like that.

### Step 4 — Pick your model IDs

Cloudflare model IDs always start with `@cf/`. Use the **full** ID, including the prefix — a bare name like `glm-5.2` will not work.

| Use | Model ID |
| --- | --- |
| GLM (general chat) | `@cf/zai-org/glm-5.2` |
| Kimi (general chat) | `@cf/moonshotai/kimi-k2.6` |
| Kimi (coding) | `@cf/moonshotai/kimi-k2.7-code` |

Model IDs and versions change over time. The authoritative list is the [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/) — open a model's page and copy the ID shown there.

### Step 5 — Fill in the options page

- **Endpoint URL:** the URL from Step 3
- **Model:** e.g. `@cf/zai-org/glm-5.2`
- **Bearer token:** the API token from Step 2

Click **Save settings**, open the side panel, and send a message.

> **Tip — GLM + Kimi together.** A nice setup is GLM as the **primary** model and Kimi as the **fallback** (same endpoint URL and token, different model ID), so that if GLM is briefly at capacity the extension automatically retries on Kimi. See [Fallback routing](#fallback-routing-optional).

---

## Guide 2 — Closed models (OpenAI and Claude)

Closed-model providers work as long as they expose the OpenAI Chat Completions shape that this extension uses. OpenAI's own endpoint works directly, and Claude works through Anthropic's OpenAI-compatibility layer.

### Option A — OpenAI

Use this when you want to call OpenAI-hosted models with an OpenAI API key.

1. Create an API key in the [OpenAI platform dashboard](https://platform.openai.com/api-keys). Copy it now; you will not be able to view the full key again later.
2. Fill in the extension options:

   - **Endpoint URL:**

     ```text
     https://api.openai.com/v1/chat/completions
     ```

   - **Model:** an OpenAI Chat Completions model ID, for example:

     | Use | Model ID |
     | --- | --- |
     | Latest flagship chat | `gpt-5.4` |
     | Small, fast chat | `gpt-4o-mini` |

     Model availability changes over time and can depend on your project. The authoritative source is the [OpenAI model list](https://platform.openai.com/docs/models), or the `/v1/models` API for your account.

   - **Bearer token:** your OpenAI API key

3. Click **Save settings**, open the side panel, and send a message.

The extension uses OpenAI's Chat Completions endpoint, not the newer Responses API. That is intentional: the extension is designed around the widely supported OpenAI-compatible `/chat/completions` contract.

### Option B — Claude (Anthropic)

Anthropic does not use the OpenAI format natively, but it provides an OpenAI-compatibility layer: you point any OpenAI-style client at Anthropic's base URL and use a Claude model name. This extension is exactly such a client.

1. Create an API key in the [Anthropic Console](https://console.anthropic.com/settings/keys). Copy it; it starts with `sk-ant-...`.
2. Fill in the extension options:

   - **Endpoint URL:**

     ```text
     https://api.anthropic.com/v1/chat/completions
     ```

   - **Model:** a Claude model ID, for example:

     | Use | Model ID |
     | --- | --- |
     | Most capable | `claude-opus-4-8` |
     | Balanced speed/cost | `claude-sonnet-4-6` |
     | Fastest/cheapest | `claude-haiku-4-5` |

     Model IDs change over time. Copy the exact ID from Anthropic's current model documentation or console.

   - **Bearer token:** your `sk-ant-...` key

3. Click **Save settings** and start chatting.

### Claude compatibility notes

Anthropic positions the OpenAI-compatibility layer as a way to **test and compare** Claude through OpenAI-format tooling, not as a long-term production path. For everyday side-panel chat it works well; just be aware of these behaviors:

- Prompt caching and Claude's detailed extended-thinking output are not exposed through this layer (they're available in Anthropic's native API).
- Multiple system messages are concatenated into one at the start of the conversation.
- `temperature` is accepted between 0 and 1; higher values are capped at 1.

None of these require any change to the extension — they're just differences from the native Claude API.

---

## Fallback routing (optional)

If you configure a **fallback endpoint** and **fallback model**, the extension uses them **only** for transient capacity-style failures from the primary — HTTP 502/503/504 and errors like `3040: Capacity temporarily exceeded`. Normal errors (bad token, wrong model ID, etc.) are surfaced directly and are not retried on the fallback.

The fallback has its own endpoint URL, model, and bearer token, so you can fall back to a different model on the same provider (e.g. GLM → Kimi) or to an entirely different provider (e.g. Cloudflare → OpenAI or Claude).

## Expected API contract

The extension sends standard OpenAI-compatible chat completion requests:

```json
{
  "model": "@cf/zai-org/glm-5.2",
  "messages": [{ "role": "user", "content": "Hello" }],
  "temperature": 0.7,
  "max_tokens": 2048,
  "stream": true
}
```

For GLM model IDs only, it also adds a flag to suppress GLM's separate reasoning channel:

```json
{
  "thinking": { "type": "disabled" }
}
```

This flag is sent only when the model ID contains `glm`, so it has no effect on Kimi, OpenAI, Claude, or other providers.

It expects streaming SSE chunks with `choices[0].delta.content` for answer text, and also has a non-streaming fallback path for endpoints that return `choices[0].message.content`.

## Page context

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

## Credits

Built with assistance from OpenAI Codex.
