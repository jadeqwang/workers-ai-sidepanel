import { SITE_PRESETS } from "./site-presets.js";

const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#chat-form");
const promptEl = document.querySelector("#prompt");
const sendButton = document.querySelector("#send");
const stopButton = document.querySelector("#stop");
const modelLabel = document.querySelector("#model-label");
const addPageButton = document.querySelector("#add-page");
const pageContextBar = document.querySelector("#page-context-bar");
const pageContextLabel = document.querySelector("#page-context-label");
const controlPageButton = document.querySelector("#control-page");
const visionPageButton = document.querySelector("#vision-page");
let messages = [];
let busy = false;
let pageContext = null;
let activePort = null;
const hoverDetails = new Map();

init();

async function init() {
  const stored = await chrome.storage.local.get({ conversation: [], model: "", endpoint: "" });
  messages = Array.isArray(stored.conversation) ? stored.conversation : [];
  modelLabel.textContent = stored.endpoint ? stored.model || "Configured" : "Not configured";
  render();
  promptEl.focus();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = promptEl.value.trim();
  if (!content || busy) return;

  messages = messages.filter((item) => item.role !== "error");
  messages.push({ role: "user", content });
  const assistantMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    reasoningContent: "",
    toolSteps: [],
    pendingApproval: null,
    pending: true
  };
  messages.push(assistantMessage);
  promptEl.value = "";
  setBusy(true);
  render();
  await persist();

  try {
    await streamAssistantResponse(assistantMessage, pageContext);
  } catch (error) {
    messages = messages.filter((message) => message !== assistantMessage);
    messages.push({ role: "error", content: error.message });
  } finally {
    assistantMessage.pending = false;
    setBusy(false);
    render();
    await persist();
    promptEl.focus();
  }
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelector("#clear").addEventListener("click", async () => {
  messages = [];
  pageContext = null;
  hoverDetails.clear();
  await persist();
  render();
  renderPageContext();
});

document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

stopButton.addEventListener("click", () => {
  if (!activePort) return;
  stopButton.disabled = true;
  activePort.stopRequested = true;
  try {
    activePort.postMessage({ type: "cancel" });
  } catch {
    activePort.disconnect();
  }
});

addPageButton.addEventListener("click", async () => {
  addPageButton.disabled = true;
  addPageButton.textContent = "Reading…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active web page was found.");
    if (!tab.url || !/^https?:/.test(tab.url)) {
      throw new Error("Chrome does not allow extensions to read this page.");
    }

    const originPattern = `${new URL(tab.url).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) throw new Error("Page access was not granted.");

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContext,
      args: [SITE_PRESETS]
    });
    if (!injection?.result?.text) throw new Error("No readable page text was found.");

    pageContext = { ...injection.result, tabId: tab.id };
    hoverDetails.clear();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: installHoverRecorder
    });
    renderPageContext();
  } catch (error) {
    messages.push({
      role: "error",
      content: error.message
    });
    render();
  } finally {
    addPageButton.disabled = false;
    if (!pageContext) addPageButton.textContent = "＋ Page";
  }
});

document.querySelector("#remove-page").addEventListener("click", () => {
  pageContext = null;
  hoverDetails.clear();
  renderPageContext();
});

controlPageButton.addEventListener("click", () => {
  if (!pageContext) return;
  pageContext.browserControl = !pageContext.browserControl;
  renderPageContext();
});

// Vision is independent of Control: the common puzzle case is Vision on with
// Control off. When on, this turn is routed end-to-end to the vision model.
visionPageButton.addEventListener("click", () => {
  if (!pageContext) return;
  pageContext.useVision = !pageContext.useVision;
  renderPageContext();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "page-hover-detail" || !pageContext) return;
  const target = String(message.target || "Hovered item").slice(0, 1000);
  const detail = String(message.detail || "").slice(0, 3000);
  if (!detail) return;

  hoverDetails.set(`${target}\n${detail}`, { target, detail });
  pageContext.hoverDetails = Array.from(hoverDetails.values()).slice(-100);
  renderPageContext();
});

function installHoverRecorder() {
  if (globalThis.__privateGlmHoverRecorderInstalled) return;
  globalThis.__privateGlmHoverRecorderInstalled = true;

  const normalize = (value) => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const baselineLines = new Set(
    normalize(document.body?.innerText).split("\n").filter((line) => line.length > 1)
  );
  let timer;

  document.addEventListener("mouseover", (event) => {
    clearTimeout(timer);
    const hovered = event.target instanceof Element ? event.target : null;
    if (!hovered) return;

    timer = setTimeout(() => {
      const container = hovered.closest(
        "article, li, [role='listitem'], [data-testid*='card'], [class*='card'], [class*='item']"
      ) || hovered;
      const target = normalize(
        container.innerText ||
        container.getAttribute("aria-label") ||
        container.getAttribute("title") ||
        hovered.getAttribute("alt")
      ).slice(0, 1000);

      const details = new Set();
      const currentLines = normalize(document.body?.innerText)
        .split("\n")
        .filter((line) => line.length > 1 && !baselineLines.has(line));
      for (const line of currentLines) details.add(line);

      const tooltipSelectors = [
        "[role='tooltip']",
        "[data-radix-popper-content-wrapper]",
        "[class*='tooltip']",
        "[class*='popover']"
      ].join(",");
      for (const element of document.querySelectorAll(tooltipSelectors)) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || !rect.width || !rect.height) continue;
        const text = normalize(element.innerText || element.textContent);
        if (text) details.add(text);
      }

      const detail = Array.from(details).join("\n").slice(0, 3000);
      if (!detail) return;
      chrome.runtime.sendMessage({
        type: "page-hover-detail",
        target: target || "Hovered item",
        detail
      }).catch(() => {});
    }, 500);
  }, true);
}

function extractPageContext(presets) {
  const maximumLength = 30000;
  const normalize = (value) => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const visibleText = normalize(document.body?.innerText);
  // Preset-driven structured-record pre-extraction. Presets are passed in (plain
  // data) because this function is injected via executeScript and cannot close
  // over module imports. Matches the same hostname/requireHash gate the tools use.
  const preset = (Array.isArray(presets) ? presets : []).find((entry) =>
    location.hostname.endsWith(entry.hostnameSuffix) &&
    (!entry.requireHash || location.hash.startsWith(entry.requireHash)));
  const presetRecords = [];

  if (preset) {
    const noun = String(preset.recordNoun || "record");
    const nounTitle = noun.charAt(0).toUpperCase() + noun.slice(1);
    for (const card of document.querySelectorAll(preset.container)) {
      const name = preset.nameSelector
        ? normalize(card.querySelector(preset.nameSelector)?.textContent)
        : normalize(card.innerText).split("\n")[0];
      const lines = preset.lineSelector
        ? Array.from(card.querySelectorAll(preset.lineSelector)).map((element) => normalize(element.textContent))
        : [];
      const fieldLines = (Array.isArray(preset.fields) ? preset.fields : []).map((field) => {
        if (field.prefix) {
          const prefix = String(field.prefix);
          return lines.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase())) || "";
        }
        if (field.selector) return normalize(card.querySelector(field.selector)?.textContent);
        return "";
      }).filter(Boolean);
      if (name && fieldLines.length) {
        presetRecords.push([`${nounTitle}: ${name}`, ...fieldLines].join("\n"));
      }
    }
  }
  const supplemental = [];
  const seen = new Set();
  const addSupplemental = (label, value) => {
    const text = normalize(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    supplemental.push(`${label}: ${text.slice(0, 1000)}`);
  };

  const metadataNames = new Set(["title", "aria-label", "aria-description", "alt"]);
  const relevantDataName = /(tooltip|tip|tag|filter|diet|allergen|ingredient|description|category|cuisine)/i;
  const elements = document.querySelectorAll("*");

  for (const element of elements) {
    for (const attribute of element.attributes) {
      if (metadataNames.has(attribute.name) ||
          (attribute.name.startsWith("data-") && relevantDataName.test(attribute.name))) {
        addSupplemental(`${element.tagName.toLowerCase()} ${attribute.name}`, attribute.value);
      }
    }

    const role = element.getAttribute("role");
    if (role === "tooltip" || role === "menu" || role === "listbox") {
      addSupplemental(`${role} text`, element.textContent);
    }

    if (element.shadowRoot) {
      addSupplemental("shadow DOM text", element.shadowRoot.textContent);
    }
  }

  for (const element of document.querySelectorAll("[hidden], [aria-hidden='true']")) {
    const parent = element.parentElement;
    if (parent?.closest("[hidden], [aria-hidden='true']")) continue;
    addSupplemental("hidden page text", element.textContent);
  }

  for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
    addSupplemental("structured page data", script.textContent);
  }

  const supplementalText = supplemental.join("\n");
  const presetText = presetRecords.join("\n\n");
  let combinedText;
  let truncated;

  if (preset && presetText) {
    const recordLimit = 8000;
    const nounPlural = String(preset.recordNounPlural || `${preset.recordNoun || "record"}s`);
    const sectionLabel = String(preset.sectionLabel || `${nounPlural.toUpperCase()} DETAILS`);
    const recordSection = `${sectionLabel} (${presetRecords.length} ${nounPlural}):\n${presetText}`;
    combinedText = recordSection.slice(0, recordLimit);
    truncated = recordSection.length > recordLimit;
  } else {
    const visibleLimit = 20000;
    combinedText = [
      "VISIBLE PAGE TEXT:\n" + visibleText.slice(0, visibleLimit),
      supplementalText ? "TOOLTIPS AND PAGE METADATA:\n" + supplementalText : ""
    ].filter(Boolean).join("\n\n").slice(0, maximumLength);
    truncated = visibleText.length > visibleLimit || combinedText.length >= maximumLength;
  }

  return {
    title: document.title || "Untitled page",
    url: location.href,
    text: combinedText,
    truncated,
    extractedRecordCount: presetRecords.length,
    extractedRecordNoun: preset ? String(preset.recordNounPlural || `${preset.recordNoun || "record"}s`) : ""
  };
}

function renderPageContext() {
  pageContextBar.hidden = !pageContext;
  addPageButton.setAttribute("aria-pressed", String(Boolean(pageContext)));
  addPageButton.textContent = pageContext ? "✓ Page" : "＋ Page";
  controlPageButton.hidden = !pageContext;
  controlPageButton.setAttribute("aria-pressed", String(Boolean(pageContext?.browserControl)));
  controlPageButton.textContent = pageContext?.browserControl ? "Control on" : "Control off";
  visionPageButton.hidden = !pageContext;
  visionPageButton.setAttribute("aria-pressed", String(Boolean(pageContext?.useVision)));
  visionPageButton.textContent = pageContext?.useVision ? "Vision on" : "Vision off";
  pageContextLabel.textContent = pageContext
    ? `${pageContext.extractedRecordCount ? `${pageContext.extractedRecordCount} ${pageContext.extractedRecordNoun || "records"} · ` : hoverDetails.size ? `${hoverDetails.size} hover capture${hoverDetails.size === 1 ? "" : "s"} · ` : ""}${pageContext.title}${pageContext.truncated ? " (excerpt)" : ""}`
    : "";
}

function render() {
  messagesEl.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<strong>Workers AI Sidepanel</strong><span>Configure your endpoint in Settings, then start a conversation.</span>";
    messagesEl.append(empty);
    return;
  }
  for (const message of messages) {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;
    if (message.id) article.dataset.messageId = message.id;
    const header = document.createElement("div");
    header.className = "message-header";
    const label = document.createElement("strong");
    label.textContent = message.role === "user" ? "You" : message.role === "error" ? "Error" : "AI";
    header.append(label, createMessageActions(message));
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = message.content || (message.pending ? "Thinking…" : "");
    article.append(header, content);
    if (message.role === "assistant" && message.reasoningContent) {
      article.append(createThinkingDisclosure(message.reasoningContent, message.pending));
    }
    if (message.role === "assistant" && Array.isArray(message.toolSteps) && message.toolSteps.length) {
      article.append(createToolTimeline(message.toolSteps));
    }
    if (message.role === "assistant" && message.pendingApproval) {
      article.append(createApprovalCard(message.pendingApproval));
    }
    messagesEl.append(article);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function createMessageActions(message) {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  if (message.role !== "user" && message.role !== "assistant") return actions;

  const copy = createMessageActionButton("Copy", "Copy message", () => copyMessage(message, copy));
  actions.append(copy);

  if (message.role === "user") {
    actions.append(createMessageActionButton("Edit", "Edit prompt", () => editPrompt(message)));
  }

  return actions;
}

function createMessageActionButton(text, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action";
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

async function copyMessage(message, button) {
  const text = String(message.content || "");
  if (!text) return;
  const original = button.textContent;
  button.disabled = true;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Failed";
  } finally {
    window.setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 900);
  }
}

function editPrompt(message) {
  if (busy) return;
  promptEl.value = String(message.content || "");
  promptEl.focus();
  promptEl.setSelectionRange(promptEl.value.length, promptEl.value.length);
}

function createThinkingDisclosure(reasoningContent, pending = false) {
  const details = document.createElement("details");
  details.className = "thinking-disclosure";

  const summary = document.createElement("summary");
  summary.className = "thinking-summary";
  summary.textContent = getThinkingSummary(reasoningContent, pending);

  const content = document.createElement("div");
  content.className = "thinking-content";
  content.textContent = reasoningContent || "Waiting for model thinking…";

  details.append(summary, content);
  return details;
}

function createToolTimeline(toolSteps, open = false) {
  const details = document.createElement("details");
  details.className = "tool-timeline";
  details.open = open || toolSteps.some((step) => !step.ok);

  const summary = document.createElement("summary");
  summary.className = "tool-timeline-summary";
  summary.textContent = `${toolSteps.length.toLocaleString()} browser action${toolSteps.length === 1 ? "" : "s"}`;

  const list = document.createElement("ol");
  list.className = "tool-step-list";
  for (const step of toolSteps) {
    const item = document.createElement("li");
    item.className = `tool-step ${step.ok ? "ok" : "error"}`;

    const header = document.createElement("div");
    header.className = "tool-step-header";
    const status = document.createElement("span");
    status.className = "tool-step-status";
    status.textContent = step.ok ? "✓" : "!";
    const summary = document.createElement("span");
    summary.className = "tool-step-summary";
    summary.textContent = step.summary || step.tool || "Browser action";
    header.append(status, summary);
    item.append(header);

    if (step.screenshotUrl) {
      const image = document.createElement("img");
      image.className = "tool-step-screenshot";
      image.alt = "Page screenshot after browser action";
      image.src = step.screenshotUrl;
      item.append(image);
    }

    list.append(item);
  }

  details.append(summary, list);
  return details;
}

function updateToolTimeline(article, toolSteps) {
  let timeline = article.querySelector(".tool-timeline");
  if (!toolSteps?.length) {
    timeline?.remove();
    return;
  }
  const nextTimeline = createToolTimeline(toolSteps, Boolean(timeline?.open));
  if (timeline) timeline.replaceWith(nextTimeline);
  else article.append(nextTimeline);
}

function createApprovalCard(approval) {
  const card = document.createElement("section");
  card.className = "approval-card";

  const title = document.createElement("strong");
  title.className = "approval-title";
  title.textContent = approval.title || "Approve browser action";

  const detail = document.createElement("p");
  detail.className = "approval-detail";
  detail.textContent = approval.detail || "The assistant wants to run a browser action that needs your approval.";

  const actions = document.createElement("div");
  actions.className = "approval-actions";

  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "secondary-button";
  reject.textContent = "Reject";
  reject.addEventListener("click", () => respondToApproval(approval, false, card));

  const approve = document.createElement("button");
  approve.type = "button";
  approve.textContent = "Approve";
  approve.addEventListener("click", () => respondToApproval(approval, true, card));

  actions.append(reject, approve);
  card.append(title, detail, actions);
  return card;
}

async function respondToApproval(approval, approved, card) {
  if (!activePort || !approval?.id) return;
  const buttons = card.querySelectorAll("button");
  buttons.forEach((button) => {
    button.disabled = true;
  });

  let permissionGranted = true;
  let reason = "";
  if (approved && approval.permissionPattern) {
    try {
      permissionGranted = await chrome.permissions.request({ origins: [approval.permissionPattern] });
      if (!permissionGranted) reason = "Chrome permission was not granted.";
    } catch (error) {
      permissionGranted = false;
      reason = error.message || "Chrome permission request failed.";
    }
  }

  try {
    activePort.postMessage({
      type: "approval_response",
      id: approval.id,
      approved,
      permissionGranted,
      reason
    });
  } catch {}
}

function updateApprovalCard(article, approval) {
  let card = article.querySelector(".approval-card");
  if (!approval) {
    card?.remove();
    return;
  }
  const nextCard = createApprovalCard(approval);
  if (card) card.replaceWith(nextCard);
  else article.append(nextCard);
}

function getThinkingSummary(reasoningContent, pending = false) {
  const count = reasoningContent.length;
  if (count) return `Thinking${pending ? "…" : ""} ${count.toLocaleString()} chars`;
  return pending ? "Thinking…" : "Thinking";
}

function updateRenderedAssistant(message) {
  if (!message.id) return;
  const article = messagesEl.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  if (!article) return;

  const content = article.querySelector(".message-content");
  if (content) content.textContent = message.content || (message.pending ? "Thinking…" : "");

  let disclosure = article.querySelector(".thinking-disclosure");
  if (!disclosure && message.reasoningContent) {
    disclosure = createThinkingDisclosure(message.reasoningContent, message.pending);
    article.append(disclosure);
  }

  if (disclosure) {
    const summary = disclosure.querySelector(".thinking-summary");
    const thinkingContent = disclosure.querySelector(".thinking-content");
    if (summary) summary.textContent = getThinkingSummary(message.reasoningContent, message.pending);
    if (thinkingContent) {
      thinkingContent.textContent = message.reasoningContent || "Waiting for model thinking…";
      if (disclosure.open) thinkingContent.scrollTop = thinkingContent.scrollHeight;
    }
  }

  updateToolTimeline(article, message.toolSteps);
  updateApprovalCard(article, message.pendingApproval);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function streamAssistantResponse(assistantMessage, currentPageContext) {
  return new Promise((resolve, reject) => {
    const requestMessages = messages.filter((message) => message !== assistantMessage);
    const port = chrome.runtime.connect({ name: "chat-stream" });
    activePort = port;
    let settled = false;
    let stopRequested = false;

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      if (activePort === port) activePort = null;
      try {
        port.disconnect();
      } catch {}
      callback(value);
    };

    const finishStopped = () => {
      stopRequested = true;
      assistantMessage.pending = false;
      if (!assistantMessage.content.trim()) assistantMessage.content = "Stopped.";
      updateRenderedAssistant(assistantMessage);
      settle(resolve);
    };

    port.onMessage.addListener((message) => {
      if (message?.type === "reasoning_delta") {
        assistantMessage.reasoningContent += message.text || "";
        updateRenderedAssistant(assistantMessage);
        return;
      }
      if (message?.type === "content_delta") {
        assistantMessage.content += message.text || "";
        updateRenderedAssistant(assistantMessage);
        return;
      }
      if (message?.type === "tool_step") {
        assistantMessage.toolSteps ||= [];
        assistantMessage.pendingApproval = null;
        assistantMessage.toolSteps.push({
          tool: message.tool || "",
          arguments: message.arguments || {},
          summary: message.summary || "",
          ok: Boolean(message.ok),
          screenshotUrl: message.screenshotUrl || ""
        });
        updateRenderedAssistant(assistantMessage);
        return;
      }
      if (message?.type === "approval_request") {
        assistantMessage.pendingApproval = {
          id: message.id || "",
          title: message.title || "Approve browser action",
          detail: message.detail || "",
          tool: message.tool || "",
          arguments: message.arguments || {},
          permissionOrigin: message.permissionOrigin || "",
          permissionPattern: message.permissionPattern || ""
        };
        updateRenderedAssistant(assistantMessage);
        return;
      }
      if (message?.type === "done") {
        assistantMessage.pendingApproval = null;
        assistantMessage.content = message.content || assistantMessage.content;
        assistantMessage.reasoningContent = message.reasoningContent || assistantMessage.reasoningContent;
        assistantMessage.pending = false;
        updateRenderedAssistant(assistantMessage);
        settle(resolve);
        return;
      }
      if (message?.type === "stopped") {
        assistantMessage.pendingApproval = null;
        finishStopped();
        return;
      }
      if (message?.type === "error") {
        settle(reject, new Error(message.error || "No response from the extension worker."));
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      if (stopRequested || port.stopRequested) {
        finishStopped();
        return;
      }
      if (assistantMessage.content.trim()) {
        assistantMessage.pending = false;
        updateRenderedAssistant(assistantMessage);
        settle(resolve);
        return;
      }
      requestBufferedAssistantResponse(requestMessages, currentPageContext, assistantMessage)
        .then(() => settle(resolve))
        .catch((error) => settle(reject, error));
    });

    port.postMessage({ type: "chat", messages: requestMessages, pageContext: currentPageContext, useVision: Boolean(currentPageContext?.useVision) });
  });
}

async function requestBufferedAssistantResponse(requestMessages, currentPageContext, assistantMessage) {
  const response = await chrome.runtime.sendMessage({
    type: "chat",
    messages: requestMessages,
    pageContext: currentPageContext,
    useVision: Boolean(currentPageContext?.useVision)
  });
  if (!response?.ok) {
    throw new Error(response?.error || chrome.runtime.lastError?.message || "The streaming connection closed.");
  }
  assistantMessage.content = response.content || assistantMessage.content;
  assistantMessage.reasoningContent = response.reasoningContent || assistantMessage.reasoningContent;
  assistantMessage.pending = false;
  updateRenderedAssistant(assistantMessage);
}

function setBusy(value) {
  busy = value;
  sendButton.disabled = value;
  promptEl.disabled = value;
  stopButton.hidden = !value;
  stopButton.disabled = !value;
  if (!value && activePort) {
    activePort.disconnect();
    activePort = null;
  }
}

async function persist() {
  await chrome.storage.local.set({
    conversation: messages
      .filter((item) => item.role !== "error" && !item.pending)
      .map(({ pending, ...item }) => item)
  });
}
