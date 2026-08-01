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
if (!site.formEndpoint)
  pending.push([
    "forms",
    "No submission endpoint configured. Both intake forms validate but their submit control is replaced by a notice, so nothing can be sent.",
  ]);
if (!site.attorney.name)
  pending.push(["attorney", "Responsible attorney name not set — required by Fla. Bar Rule 4-7.12."]);
if (!site.office.city)
  pending.push(["office", "Bona fide office location not set — required by Fla. Bar Rule 4-7.12."]);
if (!site.bar.admission) pending.push(["bar", "Jurisdiction statement not set."]);

// The portrait is served from a host this repository does not control. It
// works, but it is an outbound dependency on someone else's uptime for the
// only image on the site, and it is the one asset a redesign would forget.
if (/^https?:/.test(site.attorney.image || "")) {
  pending.push([
    "image",
    `Attorney portrait is remote (${new URL(site.attorney.image).host}). Replace with a locally hosted optimized copy before production.`,
  ]);
}

/* ---- placeholder routes -------------------------------------------------- */

const placeholderRoutes = [];
const draftRoutes = [];
const walk = (items) => {
  for (const item of items || []) {
    if (item.href && item.placeholder) placeholderRoutes.push(item.href);
    if (item.href && item.draft) draftRoutes.push(item.href);
    walk(item.children);
  }
};
walk(nav.primary);
walk(nav.legal);

// Publishing a location page for a county the firm does not serve is both a
// doorway-page risk and, under Fla. Bar Rule 4-7.12, a misleading implication
// of presence. Counties outside the confirmed primary area are allowed to have
// pages — they carry serviceArea.outsidePrimary saying there is no office —
// but nothing may be confirmed that the firm has not confirmed.
const counties = (nav.primary.find((p) => p.href === "/locations/")?.children || [])
  .filter((c) => c.href !== "/locations/").length;
if (!(site.servedCounties || []).length) {
  pending.push([
    "coverage",
    `${counties} county pages exist but no primary service area is confirmed.`,
  ]);
}

/* ---- shipped TODO markers ------------------------------------------------
 * Distinguished from stray ones below: these are deliberate, and each names a
 * production step. They are reported so the list of what is outstanding stays
 * honest, not because they are mistakes.
 * ------------------------------------------------------------------------ */

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

/* TODO markers in shipped HTML. They live in source comments, so no visitor
   sees one — but each is a production step somebody has to take, and listing
   them here is the only thing that stops them being forgotten. */
const todoFiles = htmlFiles.filter((f) => /\bTODO\b/.test(readFileSync(f, "utf8")));
for (const f of todoFiles) pending.push(["todo", `Source TODO in ${relative(ROOT, f)}`]);

/* ---- report -------------------------------------------------------------- */

console.log("\n  Pre-launch checklist\n");

if (pending.length) {
  const width = Math.max(...pending.map(([k]) => k.length));
  for (const [key, note] of pending) console.log(`    ${key.padEnd(width)}  ${note}`);
} else {
  console.log("    All firm details supplied.");
}

console.log(
  `\n    routes    ${placeholderRoutes.length} with no content, ` +
    `${draftRoutes.length} written but awaiting Florida attorney review; all carry noindex\n`
);

if (STRICT && (pending.length || placeholderRoutes.length || draftRoutes.length)) {
  console.error(
    `  Refusing a production build: ${pending.length} unresolved item(s), ` +
      `${placeholderRoutes.length} empty route(s), ${draftRoutes.length} unreviewed route(s).\n`
  );
  process.exit(1);
}

console.log("  Not a production build — these are expected at this stage.\n");
