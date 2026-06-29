// Dependency-free DOM smoke test for the shipped extract_records browser tool.
//
// Run: node scripts/test-extract-records-dom.mjs
//
// This launches headless Chrome, loads a non-Dinner-Elf fixture, injects the
// actual runBrowserTool function source from background.js, and calls
// runBrowserTool("extract_records", ...). It intentionally avoids jsdom or
// package.json so the repository remains install-free.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const BACKGROUND_PATH = join(ROOT, "background.js");
const FIXTURE_URL = `file://${join(ROOT, "scripts/fixtures/non-dinner-catalog.html")}`;

let failures = 0;
const assert = (label, condition) => {
  if (condition) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
};

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const waitForExit = (child) => new Promise((resolveExit) => {
  if (!child || child.exitCode !== null) {
    resolveExit();
    return;
  }
  child.once("exit", resolveExit);
});

function extractFunctionSource(source, name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Could not find ${name} in background.js`);
  const nextTopLevelFunction = "\nfunction validateConfig";
  const end = source.indexOf(nextTopLevelFunction, start);
  if (end < 0) throw new Error(`Could not find end of ${name}`);
  return source.slice(start, end).trim();
}

async function startChrome(userDataDir) {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--no-sandbox",
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-port=0",
    "about:blank"
  ];
  const chrome = spawn("google-chrome", args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const devtoolsFile = join(userDataDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const [port] = (await readFile(devtoolsFile, "utf8")).trim().split("\n");
      return { chrome, port };
    } catch {
      if (chrome.exitCode !== null) throw new Error(`Chrome exited early: ${stderr}`);
      await delay(100);
    }
  }
  chrome.kill();
  throw new Error(`Timed out waiting for Chrome DevTools port: ${stderr}`);
}

let nextId = 1;
function cdpSocket(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolveMessage, rejectMessage } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectMessage(new Error(message.error.message));
    else resolveMessage(message.result);
  });
  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });

  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId++;
      const response = new Promise((resolveMessage, rejectMessage) => pending.set(id, { resolveMessage, rejectMessage }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    close() {
      socket.close();
    }
  };
}

async function main() {
  const background = await readFile(BACKGROUND_PATH, "utf8");
  const runBrowserToolSource = extractFunctionSource(background, "runBrowserTool");
  const userDataDir = await mkdtemp(join(tmpdir(), "chrome-ext-dom-test-"));
  let chrome;
  let socket;

  try {
    const started = await startChrome(userDataDir);
    chrome = started.chrome;
    const target = await fetch(`http://127.0.0.1:${started.port}/json/new?${encodeURIComponent(FIXTURE_URL)}`, { method: "PUT" }).then((response) => response.json());
    socket = cdpSocket(target.webSocketDebuggerUrl);
    await socket.send("Runtime.enable");
    await socket.send("Page.enable");
    await delay(500);

    const args = {
      container: ".product-card",
      nameSelector: ".product-title",
      fields: [
        { name: "labels", selector: ".badges" },
        { name: "description", selector: ".details" }
      ],
      labelField: "labels",
      keywordField: "description",
      requireLabels: ["women", "recycled"],
      excludeLabels: ["clearance"],
      excludeKeywords: ["leather"],
      recordNoun: "product",
      limit: 10
    };
    const expression = `
      ${runBrowserToolSource}
      runBrowserTool("extract_records", ${JSON.stringify(args)}, []);
    `;
    const result = await socket.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    const value = result.result.value;

    console.log("Non-Dinner-Elf extract_records smoke:");
    assert("source is custom", value.source === "custom");
    assert("record noun is preserved", value.recordNoun === "product");
    assert("uses structured labels + keyword screening", value.screeningMode === "structured labels + keyword screening");
    assert("returns one matching product", value.returned.length === 1);
    assert("keeps Alpine Rain Shell", value.returned[0]?.name === "Alpine Rain Shell");
    assert("filters out clearance by structured label", !value.returned.some((record) => record.name === "Ridge Fleece Hoodie"));
    assert("filters out leather by keyword fallback", !value.returned.some((record) => record.name === "Canvas Camp Duffel"));
    assert("does not require a site preset", value.totalMatched === 1 && value.source === "custom");
    console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"}`);
    process.exitCode = failures ? 1 : 0;
  } finally {
    socket?.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
      await waitForExit(chrome);
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(userDataDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await delay(100);
      }
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
