// Site presets for structured-record extraction.
//
// These objects are passed into page-injected functions via
// chrome.scripting.executeScript({ func, args }), so every value here MUST be
// structured-clone-safe: plain strings, numbers, booleans, arrays, and plain
// objects only. No functions and no RegExp (use string selectors/prefixes).
//
// Each preset teaches the generic extractor how to read a repeating record on a
// known site, and which extracted field carries authoritative structured labels
// (labelField) versus free text that may be keyword-screened as a fallback
// (keywordField). New sites are added by appending an entry here — no new code.
export const SITE_PRESETS = [
  {
    id: "dinnerelf",
    hostnameSuffix: "dinnerelf.com",
    // Only treat the page as a record listing on the menu route (optimization
    // for sidepanel pre-extraction; the tool handler also guards by hostname).
    requireHash: "#/main_swap",
    recordNoun: "dish",
    recordNounPlural: "dishes",
    sectionLabel: "DINNER ELF DISH DETAILS",
    container: ".pick_maindis .adj_pos_hit_second",
    nameSelector: ".pro_img_txt .taphover",
    lineSelector: ".tooltip p",
    fields: [
      { name: "filters", prefix: "Filters:" },
      { name: "ingredients", prefix: "Ingredients:" }
    ],
    labelField: "filters",
    keywordField: "ingredients"
  }
];

// Module-scope helper for non-injected callers. Injected functions cannot use
// this (no closures cross the executeScript boundary) and must inline the same
// host.endsWith(preset.hostnameSuffix) check against their presets argument.
export function findPresetForHostname(hostname, presets = SITE_PRESETS) {
  const host = String(hostname || "");
  return presets.find((preset) => host.endsWith(preset.hostnameSuffix)) || null;
}
