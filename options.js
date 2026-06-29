const DEFAULTS = {
  endpoint: "",
  model: "glm-5.2",
  bearerToken: "",
  fallbackEndpoint: "",
  fallbackModel: "",
  fallbackBearerToken: "",
  visionEndpoint: "",
  visionModel: "@cf/moonshotai/kimi-k2.7-code",
  visionBearerToken: "",
  accessClientId: "",
  accessClientSecret: "",
  systemPrompt: "You are a concise, accurate assistant.",
  temperature: 0.7,
  maxTokens: 2048,
  maxToolSteps: 6,
  showToolScreenshots: false
};
const fields = Object.keys(DEFAULTS);
const form = document.querySelector("#options-form");
const status = document.querySelector("#status");

load();

async function load() {
  const values = await chrome.storage.local.get(DEFAULTS);
  for (const key of fields) {
    const field = document.querySelector(`#${key}`);
    if (field.type === "checkbox") field.checked = Boolean(values[key]);
    else field.value = values[key];
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "";
  const endpoint = document.querySelector("#endpoint").value.trim();
  const fallbackEndpoint = document.querySelector("#fallbackEndpoint").value.trim();
  const fallbackModel = document.querySelector("#fallbackModel").value.trim();
  const visionEndpoint = document.querySelector("#visionEndpoint").value.trim();
  const visionModel = document.querySelector("#visionModel").value.trim();
  const visionBearerToken = document.querySelector("#visionBearerToken").value.trim();
  if ((fallbackEndpoint || fallbackModel) && (!fallbackEndpoint || !fallbackModel)) {
    status.textContent = "Set both fallback endpoint URL and fallback model, or leave both blank.";
    return;
  }
  if ((visionEndpoint || visionBearerToken) && (!visionEndpoint || !visionModel)) {
    status.textContent = "Set both vision endpoint URL and vision model, or leave the vision endpoint and token blank.";
    return;
  }

  const endpointPatterns = [];
  try {
    endpointPatterns.push(`${new URL(endpoint).origin}/*`);
    if (fallbackEndpoint) endpointPatterns.push(`${new URL(fallbackEndpoint).origin}/*`);
    if (visionEndpoint) endpointPatterns.push(`${new URL(visionEndpoint).origin}/*`);
  } catch {
    status.textContent = "Enter valid endpoint URLs.";
    return;
  }

  const granted = await chrome.permissions.request({ origins: Array.from(new Set(endpointPatterns)) });
  if (!granted) {
    status.textContent = "Chrome needs permission to contact the configured endpoint origins.";
    return;
  }

  const values = {};
  for (const key of fields) {
    const field = document.querySelector(`#${key}`);
    values[key] = field.type === "checkbox" ? field.checked : field.value.trim();
  }
  values.temperature = Number(values.temperature);
  values.maxTokens = Number(values.maxTokens);
  values.maxToolSteps = Number(values.maxToolSteps);
  await chrome.storage.local.set(values);
  status.textContent = "Saved.";
  setTimeout(() => { status.textContent = ""; }, 2500);
});
