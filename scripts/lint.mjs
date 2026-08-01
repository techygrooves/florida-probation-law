#!/usr/bin/env node
/**
 * Source lint.
 *
 * No ESLint or Stylelint here — a static site with one 250-line script does
 * not need a rule engine, and an unconfigured one would report style opinions
 * rather than defects. What this checks instead is the small set of things
 * that are specific to how this repository is put together, and that would
 * otherwise fail silently:
 *
 *   - every script and data file parses;
 *   - data/site.json and data/nav.json still carry the keys the build reads;
 *   - managed-region markers are balanced and correctly nested, because an
 *     unclosed <!-- @include:x --> makes the stitcher swallow the rest of the
 *     page on the next build;
 *   - no stray build markers or control characters reached a page.
 *
 *   node scripts/lint.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const fail = (file, msg) => problems.push(`${file}: ${msg}`);

const IGNORE = new Set(["node_modules", ".git", "docs"]);

const files = { js: [], json: [], html: [] };
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs);
    else if (/\.m?js$/.test(entry)) files.js.push(abs);
    else if (entry.endsWith(".json")) files.json.push(abs);
    else if (entry.endsWith(".html")) files.html.push(abs);
  }
})(ROOT);

/* ---- scripts parse -------------------------------------------------------- */

for (const file of files.js) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    const message = String(error.stderr || error.message).split("\n").slice(0, 3).join(" ").trim();
    fail(relative(ROOT, file), `syntax error — ${message}`);
  }
}

/* ---- data parses and still has what the build reads ----------------------- */

for (const file of files.json) {
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(relative(ROOT, file), `invalid JSON — ${error.message}`);
  }
}

const REQUIRED = {
  "data/site.json": [
    "firm", "firmLegalName", "siteName", "domain", "url", "basePath", "disclosure",
    "phone", "email", "attorney", "office", "availability", "serviceArea", "bar",
  ],
  "data/nav.json": ["primary", "legal", "footerColumns"],
  "data/locations.json": ["counties"],
  "data/redirects.json": ["rules"],
};

for (const [rel, keys] of Object.entries(REQUIRED)) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch {
    fail(rel, "missing or unreadable");
    continue;
  }
  for (const key of keys) {
    if (!(key in data)) fail(rel, `missing required key "${key}"`);
  }
}

/* ---- managed regions ------------------------------------------------------
 * The stitcher matches @include:x … @end:x non-greedily. A missing @end, or a
 * region opened twice, silently changes what gets replaced on the next build —
 * which is exactly the kind of failure that only shows up as a page mangled
 * three commits later.
 * ------------------------------------------------------------------------ */

for (const file of files.html) {
  const rel = relative(ROOT, file);
  if (rel.startsWith("node_modules")) continue;
  const html = readFileSync(file, "utf8");

  const opens = [...html.matchAll(/<!--\s*@include:([\w-]+)\s*-->/g)].map((m) => m[1]);
  const closes = [...html.matchAll(/<!--\s*@end:([\w-]+)\s*-->/g)].map((m) => m[1]);

  const count = (list) =>
    list.reduce((acc, name) => acc.set(name, (acc.get(name) || 0) + 1), new Map());
  const o = count(opens);
  const c = count(closes);

  for (const [name, n] of o) {
    const closed = c.get(name) || 0;
    if (closed !== n) fail(rel, `region "${name}" opened ${n}x but closed ${closed}x`);
    if (n > 1) fail(rel, `region "${name}" is opened ${n} times — only the first is stitched`);
  }
  for (const [name] of c) {
    if (!o.has(name)) fail(rel, `region "${name}" is closed but never opened`);
  }

  // Order matters: @end must follow its @include.
  const sequence = [...html.matchAll(/<!--\s*@(include|end):([\w-]+)\s*-->/g)];
  const open = new Set();
  for (const [, kind, name] of sequence) {
    if (kind === "include") open.add(name);
    else if (!open.delete(name)) fail(rel, `"@end:${name}" appears before "@include:${name}"`);
  }

  /* ---- stray artefacts ---------------------------------------------------- */

  const markers = [...html.matchAll(/<!-- built-with-base:[^>]* -->/g)];
  if (markers.length > 1) fail(rel, `${markers.length} base markers — the build writes exactly one`);

  if (/\0/.test(html)) fail(rel, "contains a NUL byte");

  // Template tokens belong in partials/ and templates/ — that is what those
  // files are. Anywhere else means a page was rendered without its context.
  const isSource = rel.startsWith("partials/") || rel.startsWith("templates/");
  if (!isSource && /\{\{[a-z.]+\}\}/i.test(html)) {
    const token = /\{\{([a-z.]+)\}\}/i.exec(html)[1];
    fail(rel, `unresolved template token {{${token}}}`);
  }
}

/* ---- report ---------------------------------------------------------------- */

console.log(
  `\n  Lint: ${files.js.length} scripts, ${files.json.length} data files, ${files.html.length} pages\n`
);

if (problems.length) {
  console.error(`  ${problems.length} problem(s):\n`);
  for (const p of problems.slice(0, 30)) console.error(`    ${p}`);
  if (problems.length > 30) console.error(`    …and ${problems.length - 30} more`);
  console.error("");
  process.exit(1);
}

console.log("  No problems found.\n");
