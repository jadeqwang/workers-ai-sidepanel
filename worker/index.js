// glm-extension-proxy — thin OpenAI-compatible proxy for the Workers AI Sidepanel extension.
//
// Auth: the extension sends `Authorization: Bearer <EXTENSION_TOKEN>`; we compare it
// constant-time against the EXTENSION_TOKEN secret. Upstream calls to Workers AI use a
// SEPARATE WORKERS_AI_TOKEN (a Cloudflare API token with Workers AI Read/Run).
//
// VISION FIX (why this forwards to the OpenAI endpoint instead of env.AI.run):
// the Workers AI native binding `env.AI.run(model, { messages })` does NOT accept OpenAI
// `image_url` content arrays — it silently strips the image and injects a "you don't have
// multi-modal input ability" reminder, so the model never sees the screenshot. It also
// ignored the per-request model and always used env.MODEL. Cloudflare's OpenAI-compatible
// endpoint accepts `image_url` (base64 data URLs) for vision models AND honors `body.model`,
// so both vision turns and per-turn model switching work. Requires ACCOUNT_ID + WORKERS_AI_TOKEN.

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return json({
        ok: true,
        service: "glm-workers-ai-proxy",
        model: env.MODEL || "Not configured",
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (!env.ACCOUNT_ID || !env.WORKERS_AI_TOKEN || !env.MODEL || !env.EXTENSION_TOKEN) {
      return json(
        {
          error:
            "Configure the ACCOUNT_ID and MODEL vars plus the WORKERS_AI_TOKEN and EXTENSION_TOKEN secrets.",
        },
        500,
      );
    }

    const authorization = request.headers.get("Authorization") || "";
    const suppliedToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!(await secretsMatch(suppliedToken, env.EXTENSION_TOKEN))) {
      return json({ error: "Unauthorized" }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be JSON" }, 400);
    }

    if (!Array.isArray(body.messages)) {
      return json({ error: "messages must be an array" }, 400);
    }

    try {
      // Forward to Cloudflare's OpenAI-compatible endpoint. messages are passed UNTOUCHED so
      // image_url content survives; the per-request model is honored (falling back to MODEL).
      const upstream = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/ai/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.WORKERS_AI_TOKEN}`,
          },
          body: JSON.stringify({
            model: body.model || env.MODEL,
            messages: body.messages,
            temperature: numberOrDefault(body.temperature, 0.7),
            max_tokens: numberOrDefault(body.max_tokens, 2048),
          }),
        },
      );

      const text = await upstream.text();
      if (!upstream.ok) {
        return json(
          {
            error: "Workers AI request failed",
            status: upstream.status,
            detail: text.slice(0, 500),
          },
          502,
        );
      }

      // The OpenAI-compatible endpoint already returns the OpenAI response shape
      // ({ choices: [{ message }] }); pass it through verbatim.
      return new Response(text, { status: 200, headers: JSON_HEADERS });
    } catch (error) {
      return json(
        {
          error: "Workers AI request failed",
          detail: error instanceof Error ? error.message : String(error),
        },
        502,
      );
    }
  },
};

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: JSON_HEADERS,
  });
}

async function secretsMatch(left, right) {
  if (!left || !right) return false;

  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);

  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);

  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a[index] ^ b[index];
  }

  return difference === 0;
}
