#!/usr/bin/env node
/**
 * WCAG 2.2 contrast verification for the design system.
 *
 * Parses the colour tokens straight out of src/input.css and checks every
 * foreground/background pair the system actually uses, so the palette can
 * never drift away from its accessibility claims. Run by `npm run build`.
 *
 * Thresholds (WCAG 2.2 AA):
 *   4.5  normal text (SC 1.4.3)
 *   3.0  large text — 24px+, or 18.66px+ bold (SC 1.4.3)
 *   3.0  UI component boundaries and state indicators (SC 1.4.11)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/input.css"), "utf8");

/* ---- token parsing ------------------------------------------------------ */

const tokens = { white: "#ffffff" };
for (const [, name, hex] of css.matchAll(
  /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g
)) {
  tokens[name] = hex;
}

/* ---- contrast maths ----------------------------------------------------- */

function toRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* ---- the pairs the design system relies on ------------------------------ */
/* [foreground, background, minimum, description] */

const checks = [
  // --- Body copy on white -------------------------------------------------
  ["ink-700", "white", 4.5, "body text"],
  ["ink-600", "white", 4.5, "card text / lede"],
  ["ink-500", "white", 4.5, "muted + meta text"],
  ["ink-400", "white", 4.5, "input placeholder"],

  // --- Headings and links on white ---------------------------------------
  ["navy-900", "white", 4.5, "headings"],
  ["navy-800", "white", 4.5, "brand text"],
  ["azure-700", "white", 4.5, "link text"],
  ["teal-700", "white", 4.5, "eyebrow / accent text"],
  ["gold-700", "white", 4.5, "gold accent text"],
  ["danger-700", "white", 4.5, "form error text"],

  // --- Copy on pale sections ---------------------------------------------
  ["ink-700", "mist-100", 4.5, "body on light section"],
  ["ink-600", "mist-100", 4.5, "muted on light section"],
  ["ink-500", "mist-100", 4.5, "meta on light section"],
  ["navy-900", "mist-100", 4.5, "heading on light section"],
  ["ink-600", "mist-50", 4.5, "body on soft section"],

  // --- Reversed: compact navy bands --------------------------------------
  ["white", "navy-800", 4.5, "primary button label"],
  ["white", "navy-900", 4.5, "text on navy band"],
  ["white", "navy-950", 4.5, "primary button label (active)"],
  ["navy-100", "navy-900", 4.5, "body text on navy band"],
  ["navy-200", "navy-900", 4.5, "footer disclaimer on navy"],
  ["teal-300", "navy-900", 4.5, "eyebrow on navy band"],
  ["white", "teal-700", 4.5, "accent button label"],

  // --- Badges -------------------------------------------------------------
  ["navy-800", "navy-50", 4.5, "navy badge"],
  ["teal-700", "teal-50", 4.5, "teal badge"],
  ["ink-600", "mist-100", 4.5, "neutral badge"],
  ["gold-700", "gold-100", 4.5, "gold badge"],

  // --- Callout panels -----------------------------------------------------
  ["ink-700", "navy-50", 4.5, "info callout body"],
  ["ink-700", "teal-50", 4.5, "accent callout body"],
  ["ink-800", "gold-100", 4.5, "urgent callout body"],
  ["navy-900", "navy-50", 4.5, "callout title"],
  ["danger-700", "danger-50", 4.5, "form status message"],

  // --- Non-text: UI boundaries and focus indicators (SC 1.4.11) ----------
  ["azure-500", "white", 3.0, "focus ring on white"],
  ["azure-500", "mist-100", 3.0, "focus ring on light section"],
  ["teal-200", "navy-900", 3.0, "focus ring on navy band"],
  ["line-400", "white", 3.0, "form field border"],
  ["line-400", "mist-100", 3.0, "form field border on light section"],
  ["danger-600", "white", 3.0, "invalid field border"],
  ["teal-500", "white", 3.0, "heading accent rule"],
  ["navy-800", "white", 3.0, "feature card top border"],
];

/* ---- run ---------------------------------------------------------------- */

let failed = 0;
const rows = [];

for (const [fg, bg, min, label] of checks) {
  if (!tokens[fg] || !tokens[bg]) {
    console.error(`  MISSING TOKEN  ${!tokens[fg] ? fg : bg}  (${label})`);
    failed++;
    continue;
  }
  const r = ratio(tokens[fg], tokens[bg]);
  const pass = r >= min;
  if (!pass) failed++;
  rows.push({
    pass,
    label,
    pair: `${fg} on ${bg}`,
    got: r.toFixed(2),
    min: min.toFixed(1),
  });
}

const w = Math.max(...rows.map((r) => r.pair.length));
console.log("\n  WCAG 2.2 AA contrast — design tokens\n");
for (const r of rows) {
  console.log(
    `  ${r.pass ? "PASS" : "FAIL"}  ${r.pair.padEnd(w)}  ${r.got.padStart(6)}:1  (min ${r.min})  ${r.label}`
  );
}

console.log(
  `\n  ${rows.length - failed}/${rows.length} pairs pass.${failed ? `  ${failed} FAILING.` : ""}\n`
);

process.exit(failed ? 1 : 0);
