// Dependency-free checks for legacy/fallback tool-call parsing.
//
// Run: node scripts/test-tool-parser.mjs

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import vm from "node:vm";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const BACKGROUND_PATH = join(ROOT, "background.js");

let failures = 0;
const assert = (label, condition) => {
  if (condition) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
};

function extractParserSource(source) {
  const start = source.indexOf("function parseToolCall");
  if (start < 0) throw new Error("Could not find parser start in background.js");
  const end = source.indexOf("\nasync function executeBrowserTool", start);
  if (end < 0) throw new Error("Could not find parser end in background.js");
  return source.slice(start, end).trim();
}

const background = await readFile(BACKGROUND_PATH, "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${extractParserSource(background)}\nthis.parseToolCall = parseToolCall;`, sandbox);

console.log("Tool-call parser:");

const jsonCall = sandbox.parseToolCall('{"tool":"read_page","arguments":{"limit":1000}}');
assert("parses JSON fallback tool call", jsonCall?.tool === "read_page" && jsonCall.arguments.limit === 1000);

const bareCall = sandbox.parseToolCall('read_page({"offset": 10, "limit": 1000})');
assert("parses bare function call", bareCall?.tool === "read_page" && bareCall.arguments.offset === 10);

const taggedCall = sandbox.parseToolCall("<tool_call>read_page</arg_key>{}</tool_call>");
assert("recovers malformed closing arg_key tag", taggedCall?.tool === "read_page" && Object.keys(taggedCall.arguments).length === 0);

const taggedWithArgs = sandbox.parseToolCall("<tool_call>read_page</arg_key>{\"limit\":8000}</tool_call>");
assert("recovers malformed closing arg_key tag with JSON args", taggedWithArgs?.tool === "read_page" && taggedWithArgs.arguments.limit === 8000);

const blocked = sandbox.parseToolCall("<tool_call>unknown_tool</arg_key>{}</tool_call>");
assert("still rejects unknown tools", blocked === null);

console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"}`);
process.exit(failures ? 1 : 0);
