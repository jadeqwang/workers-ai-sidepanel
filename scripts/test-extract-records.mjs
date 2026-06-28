// Dependency-free checks for the structured-record extraction layer (Phase 4, Layer 2/3).
//
// Run: node scripts/test-extract-records.mjs
//
// Scope: this validates (a) that SITE_PRESETS is structured-clone-safe — the hard
// requirement for passing presets through chrome.scripting.executeScript args — and
// (b) the structured-label-vs-keyword filtering rules. DOM-level extraction
// (querySelectorAll against real markup) is covered by the live checklist in
// .agents/MULTI_ACTION_PLAN.md, using scripts/fixtures/dinnerelf-menu.html.

import { SITE_PRESETS, findPresetForHostname } from "../site-presets.js";

let failures = 0;
const assert = (label, condition) => {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
};

console.log("Preset clone-safety and shape:");
// structuredClone throws on functions/RegExp/etc., catching presets that would
// silently fail to cross the executeScript boundary.
let cloned = null;
try {
  cloned = structuredClone(SITE_PRESETS);
  assert("SITE_PRESETS is structured-clone-safe", true);
} catch (error) {
  assert(`SITE_PRESETS is structured-clone-safe (${error.message})`, false);
}
assert("clone deep-equals original", JSON.stringify(cloned) === JSON.stringify(SITE_PRESETS));

for (const preset of SITE_PRESETS) {
  assert(`${preset.id}: has hostnameSuffix`, typeof preset.hostnameSuffix === "string" && preset.hostnameSuffix);
  assert(`${preset.id}: has container`, typeof preset.container === "string" && preset.container);
  assert(`${preset.id}: fields are named objects`, Array.isArray(preset.fields) && preset.fields.every((f) => f && typeof f.name === "string" && f.name));
  if (preset.labelField) assert(`${preset.id}: labelField is a declared field`, preset.fields.some((f) => f.name === preset.labelField));
  if (preset.keywordField) assert(`${preset.id}: keywordField is a declared field`, preset.fields.some((f) => f.name === preset.keywordField));
}

assert("findPresetForHostname matches subdomains", findPresetForHostname("www.dinnerelf.com")?.id === "dinnerelf");
assert("findPresetForHostname returns null for unknown hosts", findPresetForHostname("example.com") === null);

// Reference implementation of the filtering/dedupe decision rules in
// background.js runBrowserTool > extractRecords. Kept in sync deliberately: this
// is the behavioral spec the shipped rules must satisfy.
const DIETARY_DIMENSIONS = [
  { name: "dairy-free", filter: /dairy[\s-]*free/, keywords: ["milk", "cream", "butter", "cheese", "whey", "casein"] },
  { name: "gluten-free", filter: /gluten[\s-]*free/, keywords: ["wheat", "flour", "bread"] },
  { name: "nut-free", filter: /(?:tree[\s-]*)?nut[\s-]*free/, keywords: ["almond", "peanut", "cashew"] }
];

function filterRecords(records, { requireLabels = [], excludeLabels = [], excludeKeywords = [], labelField = "filters", keywordField = "ingredients" } = {}) {
  const req = requireLabels.map((s) => s.toLowerCase());
  const exL = excludeLabels.map((s) => s.toLowerCase());
  const exK = excludeKeywords.map((s) => s.toLowerCase());
  const satisfied = DIETARY_DIMENSIONS.filter((d) => req.some((label) => d.filter.test(label)));
  const covered = new Set(satisfied.flatMap((d) => d.keywords));
  const activeKeywords = exK.filter((t) => !covered.has(t));
  const kept = records.filter((rec) => {
    const labelText = String(rec[labelField] || "").toLowerCase();
    const keywordText = String(rec[keywordField] || "").toLowerCase();
    if (req.length && req.some((l) => !labelText.includes(l))) return false;
    if (exL.length && exL.some((l) => labelText.includes(l))) return false;
    if (activeKeywords.length && activeKeywords.some((t) => keywordText.includes(t))) return false;
    return true;
  });
  return { kept: kept.map((r) => r.name), structuralDimensions: satisfied.map((d) => d.name), activeKeywords };
}

const menu = [
  { name: "Dairy-Free Mash", filters: "gluten-free, dairy-free", ingredients: "potato, butter substitute, salt" },
  { name: "Cheesy Pasta", filters: "vegetarian", ingredients: "wheat pasta, cheese, cream" },
  { name: "Peanut Noodles", filters: "dairy-free", ingredients: "rice noodles, peanut, soy" },
  { name: "Plain Rice", filters: "gluten-free, dairy-free, nut-free", ingredients: "rice, salt" }
];

console.log("\nFiltering rules:");

// Structured label wins: a dairy-free dish that lists a non-dairy "butter substitute"
// is kept, because the dairy-free label dedupes the dairy keyword exclusion.
const r1 = filterRecords(menu, { requireLabels: ["dairy-free"], excludeKeywords: ["milk", "butter", "cream"] });
assert("dairy-free label keeps the butter-substitute dish", r1.kept.includes("Dairy-Free Mash"));
assert("dairy-free keyword exclusions are deduped away", r1.activeKeywords.length === 0);
assert("dairy-free dimension reported as structural", r1.structuralDimensions.includes("dairy-free"));

// Cross-dimension keyword survives: gluten-free covers flour/wheat, but a peanut
// keyword exclusion (a different dimension) is still applied.
const r2 = filterRecords(menu, { requireLabels: ["gluten-free", "dairy-free"], excludeKeywords: ["wheat", "peanut"] });
assert("gluten/dairy + peanut excludes the peanut dish", !r2.kept.includes("Peanut Noodles"));
assert("structured-covered 'wheat' is deduped, 'peanut' stays active", r2.activeKeywords.join() === "peanut");
assert("gluten+dairy keeps fully-labeled Plain Rice", r2.kept.includes("Plain Rice"));

// excludeLabels drops by structured label.
const r3 = filterRecords(menu, { excludeLabels: ["vegetarian"] });
assert("excludeLabels drops the vegetarian dish", !r3.kept.includes("Cheesy Pasta"));

// No structured filter: keyword screening applies in full (legacy fallback).
const r4 = filterRecords(menu, { excludeKeywords: ["cheese"] });
assert("keyword-only fallback drops the cheese dish", !r4.kept.includes("Cheesy Pasta"));
assert("keyword-only fallback keeps non-cheese dishes", r4.kept.includes("Plain Rice"));

console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"}`);
process.exit(failures ? 1 : 0);
