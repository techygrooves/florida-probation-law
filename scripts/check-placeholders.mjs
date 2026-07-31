#!/usr/bin/env node
/**
 * Blocks unfinished content from reaching production.
 *
 * The site carries deliberate placeholders — an unconfirmed phone number,
 * empty firm details, pages with no copy. That is fine during the build and
 * fatal at launch, so this reports them on every run and only exits non-zero
 * when a production build is requested:
 *
 *   node scripts/check-placeholders.mjs           report, always exit 0
 *   node scripts/check-placeholders.mjs --strict  fail if anything is pending
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");

const site = JSON.parse(readFileSync(join(ROOT, "data/site.json"), "utf8"));
const nav = JSON.parse(readFileSync(join(ROOT, "data/nav.json"), "utf8"));

const pending = [];

/* ---- firm details -------------------------------------------------------- */

if (!site.phone.tel) {
  pending.push([
    "phone",
    `Number is unconfirmed (${site.phone.display}). Rendered as inert text, not a tel: link, and the mobile Call button routes to /contact/ instead of dialling.`,
  ]);
}
if (!site.email.display) pending.push(["email", "Intake inbox address not set."]);
if (!site.attorney.name)
  pending.push(["attorney", "Responsible attorney name not set — required by Fla. Bar Rule 4-7.12."]);
if (!site.attorney.barNumber) pending.push(["attorney", "Florida Bar number not set."]);
if (!site.office.city)
  pending.push(["office", "Bona fide office location not set — required by Fla. Bar Rule 4-7.12."]);
if (!site.hours.weekday) pending.push(["hours", "Business hours not set."]);
if (!site.bar.admission) pending.push(["bar", "Florida Bar membership details not set."]);

/* ---- placeholder routes -------------------------------------------------- */

const placeholderRoutes = [];
const walk = (items) => {
  for (const item of items || []) {
    if (item.placeholder && item.href) placeholderRoutes.push(item.href);
    walk(item.children);
  }
};
walk(nav.primary);
walk(nav.legal);

/* ---- stray TODO markers in shipped HTML ---------------------------------- */

const IGNORE = new Set(["node_modules", ".git", "docs", "scripts", "data", "templates", "partials"]);
const htmlFiles = [];

(function collect(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) collect(abs);
    else if (entry.endsWith(".html")) htmlFiles.push(abs);
  }
})(ROOT);

const todoFiles = htmlFiles.filter((f) => /\bTODO\b/.test(readFileSync(f, "utf8")));
for (const f of todoFiles) pending.push(["content", `Stray TODO marker in ${relative(ROOT, f)}`]);

/* ---- report -------------------------------------------------------------- */

console.log("\n  Pre-launch checklist\n");

if (pending.length) {
  const width = Math.max(...pending.map(([k]) => k.length));
  for (const [key, note] of pending) console.log(`    ${key.padEnd(width)}  ${note}`);
} else {
  console.log("    All firm details supplied.");
}

console.log(
  `\n    routes    ${placeholderRoutes.length} of ${placeholderRoutes.length} routes still have no content; ` +
    `all carry noindex\n`
);

if (STRICT && (pending.length || placeholderRoutes.length)) {
  console.error(
    `  Refusing a production build: ${pending.length} unresolved item(s) and ` +
      `${placeholderRoutes.length} empty route(s).\n`
  );
  process.exit(1);
}

console.log("  Not a production build — these are expected at this stage.\n");
