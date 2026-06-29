// Hybrid vision helpers (Kimi K2.7 end-to-end vision path).
//
// These are pure, browser-free functions so they can be unit-tested in node
// (see scripts/test-vision.mjs). background.js wraps selectVisionProvider with
// the shared buildHeaders (CF Access reuse) to form the final provider object,
// and uses buildVisionMessages to attach a screenshot to the conversation.
//
// The vision provider is a THIRD, independent provider chosen by per-turn
// routing (a useVision flag from the side panel), NOT the capacity fallback.

// Select the vision provider purely from config. Returns null unless BOTH
// visionEndpoint and visionModel are set (mirrors the fallback "both-or-neither"
// rule). The returned credentials reuse the shared Cloudflare Access fields, so
// the vision Worker can sit behind the same Access app as the primary provider.
export function selectVisionProvider(config = {}) {
  if (!config.visionEndpoint || !config.visionModel) return null;
  return {
    endpoint: config.visionEndpoint,
    model: config.visionModel,
    temperature: Number(config.temperature),
    credentials: {
      bearerToken: config.visionBearerToken,
      accessClientId: config.accessClientId,
      accessClientSecret: config.accessClientSecret
    }
  };
}

// Build the OpenAI-style messages for a vision turn: a leading system message
// (the shared persona prompt) followed by the conversation history, with the
// screenshot attached to the LAST user message as an OpenAI content array:
//   content: [{type:"text", text}, {type:"image_url", image_url:{url}}]
// history is expected to be already-normalized {role, content} entries.
export function buildVisionMessages(systemPrompt, history, imageDataUrl) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });

  const chat = (Array.isArray(history) ? history : [])
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({ role: message.role, content: String(message.content || "") }));

  let lastUserIndex = -1;
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  chat.forEach((message, index) => {
    if (index === lastUserIndex && imageDataUrl) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: message.content },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ]
      });
    } else {
      messages.push(message);
    }
  });

  return messages;
}
