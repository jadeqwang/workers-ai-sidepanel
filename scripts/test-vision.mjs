// Dependency-free checks for the hybrid vision helpers (Phases V1-V2).
//
// Run: node scripts/test-vision.mjs
//
// Scope: the two PURE helpers that back the vision path —
//   (a) selectVisionProvider: the THIRD-provider routing selection (returns null
//       unless visionEndpoint+visionModel are set; threads the shared CF Access
//       credentials, not the fallback's bearer-only pattern), and
//   (b) buildVisionMessages: OpenAI message assembly with the screenshot attached
//       to the LAST user message as an image_url content array.
// Live capture/streaming behavior is browser-only (no jsdom/package.json in repo).

import { selectVisionProvider, buildVisionMessages } from "../vision.js";

let failures = 0;
const assert = (label, condition) => {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
};

console.log("Vision provider selection:");

assert("null when nothing configured", selectVisionProvider({}) === null);
assert(
  "null when only endpoint is set (both-or-neither)",
  selectVisionProvider({ visionEndpoint: "https://x/v1/chat/completions" }) === null
);
assert(
  "null when only model is set",
  selectVisionProvider({ visionModel: "@cf/moonshotai/kimi-k2.7-code" }) === null
);

const provider = selectVisionProvider({
  visionEndpoint: "https://api.example.com/v1/chat/completions",
  visionModel: "@cf/moonshotai/kimi-k2.7-code",
  visionBearerToken: "vis-token",
  accessClientId: "cf-id",
  accessClientSecret: "cf-secret",
  fallbackBearerToken: "should-not-be-used",
  temperature: "0.4"
});

assert("returns a provider when endpoint+model set", provider !== null);
assert("uses the vision endpoint", provider.endpoint === "https://api.example.com/v1/chat/completions");
assert("uses the vision model", provider.model === "@cf/moonshotai/kimi-k2.7-code");
assert("coerces temperature to a number", provider.temperature === 0.4);
assert("threads the vision bearer token", provider.credentials.bearerToken === "vis-token");
assert("reuses CF Access client id", provider.credentials.accessClientId === "cf-id");
assert("reuses CF Access client secret", provider.credentials.accessClientSecret === "cf-secret");
assert(
  "does not borrow the fallback bearer token",
  provider.credentials.bearerToken !== "should-not-be-used"
);

console.log("\nVision message assembly:");

const DATA_URL = "data:image/png;base64,AAAA";
const SYSTEM = "You are the narrator.";
const history = [
  { role: "user", content: "first" },
  { role: "assistant", content: "ok" },
  { role: "user", content: "what is in this image?" }
];

const built = buildVisionMessages(SYSTEM, history, DATA_URL);

assert("leads with the system message", built[0].role === "system" && built[0].content === SYSTEM);
assert("keeps full history (system + 3 turns)", built.length === 4);
assert("earlier user turn stays plain text", built[1].role === "user" && built[1].content === "first");
assert("assistant turn stays plain text", built[2].role === "assistant" && built[2].content === "ok");

const lastUser = built[3];
assert("last message is the user turn", lastUser.role === "user");
assert("last user content is an array", Array.isArray(lastUser.content));
assert("text part preserves the user text", lastUser.content[0].type === "text" && lastUser.content[0].text === "what is in this image?");
assert("image part uses image_url with the data URL", lastUser.content[1].type === "image_url" && lastUser.content[1].image_url.url === DATA_URL);
assert(
  "only the last user turn carries the image",
  built.filter((m) => Array.isArray(m.content)).length === 1
);

// No system prompt → no leading system message.
const noSystem = buildVisionMessages("", [{ role: "user", content: "hi" }], DATA_URL);
assert("omits system message when prompt is empty", noSystem.every((m) => m.role !== "system"));
assert("still attaches image to the lone user turn", Array.isArray(noSystem[0].content) && noSystem[0].content[1].image_url.url === DATA_URL);

// Filters out non user/assistant roles and coerces content to string.
const dirty = buildVisionMessages(SYSTEM, [
  { role: "system", content: "leaked" },
  { role: "tool", content: "x" },
  { role: "user", content: 42 }
], DATA_URL);
assert("drops stray roles, keeps one user turn", dirty.length === 2);
assert("coerces user content to string in the text part", dirty[1].content[0].text === "42");

console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"}`);
process.exit(failures ? 1 : 0);
