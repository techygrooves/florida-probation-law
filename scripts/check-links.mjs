#!/usr/bin/env node
/**
 * Internal linking audit.
 *
 * Two questions, neither of which is answerable by eye across 48 pages:
 *
 *   1. Does every internal link resolve to a file that exists?
 *   2. Do the page types actually reference each other, or does the site only
 *      look connected because the header and footer link everywhere?
 *
 * The second is the one that matters for SEO, so chrome is excluded. Header,
 * footer, breadcrumbs, contents, sibling navigation and the shared CTA are all
 * generated on every page; counting them would score any site 100% and tell
 * nobody anything. What is measured here is links a reader could follow from
 * the body of the page — the ones that carry topical meaning.
 *
 *   node scripts/check-links.mjs
 *   node scripts/check-links.mjs --matrix   print the full type x type grid
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX = process.argv.includes("--matrix");
const site = JSON.parse(readFileSync(join(ROOT, "data/site.json"), "utf8"));
const nav = JSON.parse(readFileSync(join(ROOT, "data/nav.json"), "utf8"));
const BASE = (site.basePath || "").replace(/\/+$/, "");

/* Routes that are permanently noindex are reached by their own mechanism —
   /thank-you/ only after a form submission — so having no inbound link is the
   correct state for them, not a defect. */
const NOINDEX = new Set(
  [...nav.primary, ...nav.legal, ...(nav.utility || [])]
    .flatMap((i) => [i, ...(i.children || [])])
    .filter((i) => i.noindex)
    .map((i) => i.href)
);

const IGNORE = new Set([
  "node_modules", ".git", "docs", "scripts", "data", "src",
  "templates", "partials", "styleguide",
]);

/* ---- page types ----------------------------------------------------------
 * The groups the brief names, in the order a visitor moves through them.
 * ------------------------------------------------------------------------ */

const TYPES = [
  ["home", (h) => h === "/"],
  ["pillar", (h) => h === "/early-termination-of-probation/"],
  ["eligibility", (h) => h === "/early-termination-of-probation/eligibility/" ||
                         h === "/early-termination-of-probation/50-percent-rule/" ||
                         h === "/early-termination-of-probation/reasons-for-denial/"],
  ["early-termination", (h) => h.startsWith("/early-termination-of-probation/")],
  ["process", (h) => h.startsWith("/probation-termination-process/")],
  ["service", (h) => h.startsWith("/probation-services/")],
  ["law", (h) => h.startsWith("/florida-probation-law/")],
  ["county", (h) => /^\/locations\/.+\//.test(h)],
  ["locations", (h) => h === "/locations/"],
  ["conversion", (h) => h === "/contact/" || h === "/probation-eligibility-assessment/"],
  ["about", (h) => h.startsWith("/about/")],
  ["resources", (h) => h.startsWith("/resources/") || h.startsWith("/blog/")],
];

const typeOf = (href) => TYPES.find(([, test]) => test(href))?.[0] ?? "other";

/* ---- collect pages -------------------------------------------------------- */

const pages = new Map(); // href -> { file, type, body }

(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs);
    else if (entry === "index.html" || entry === "404.html") {
      const rel = relative(ROOT, abs);
      const href = rel === "index.html" ? "/" : "/" + rel.replace(/index\.html$/, "");
      pages.set(href, { file: rel, type: typeOf(href), html: readFileSync(abs, "utf8") });
    }
  }
})(ROOT);

/* ---- body extraction -----------------------------------------------------
 * Everything inside <main>, minus the regions the build generates. Those are
 * identical on every page of a section, so they say nothing about this page's
 * relationships.
 * ------------------------------------------------------------------------ */

const CHROME = ["breadcrumbs", "toc", "siblings", "cta", "page-disclaimer", "call-bar"];

function bodyOf(html) {
  let main = html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);
  for (const region of CHROME) {
    main = main.replace(
      new RegExp(`<!--\\s*@include:${region}\\s*-->[\\s\\S]*?<!--\\s*@end:${region}\\s*-->`, "g"),
      " "
    );
  }
  return main;
}

/* ---- link graph ----------------------------------------------------------- */

const outbound = new Map(); // href -> Set(href)
const inbound = new Map(); // href -> Set(href)
const broken = [];

for (const [href, page] of pages) {
  outbound.set(href, new Set());
  if (!inbound.has(href)) inbound.set(href, new Set());
}

for (const [href, page] of pages) {
  const body = bodyOf(page.html);
  for (const [, raw] of body.matchAll(/<a[^>]+href="([^"]+)"/g)) {
    if (/^(https?:|mailto:|tel:|#)/.test(raw)) continue;
    // Built pages carry the deploy base path; the route table does not.
    let target = BASE && raw.startsWith(BASE + "/") ? raw.slice(BASE.length) : raw;
    target = target.replace(/[?#].*$/, "");
    if (!target.startsWith("/")) continue;

    if (!pages.has(target)) {
      // A file may exist without being a page (assets, the XML sitemap).
      const asFile = join(ROOT, target.replace(/^\//, ""));
      if (!existsSync(asFile)) broken.push(`${page.file} -> ${raw}`);
      continue;
    }
    if (target === href) continue;
    outbound.get(href).add(target);
    inbound.get(target).add(href);
  }
}

/* ---- type coverage -------------------------------------------------------- */

const types = [...new Set([...pages.values()].map((p) => p.type))];
const grid = new Map(); // "from>to" -> count

for (const [href, page] of pages) {
  for (const target of outbound.get(href)) {
    const key = `${page.type}>${pages.get(target).type}`;
    grid.set(key, (grid.get(key) || 0) + 1);
  }
}

/* Pairs the brief calls for. Each must be reachable from page body copy, not
   only from the navigation. */
const REQUIRED = [
  ["home", "pillar"], ["home", "county"], ["home", "conversion"], ["home", "process"],
  ["pillar", "eligibility"], ["pillar", "process"], ["pillar", "conversion"],
  ["eligibility", "process"], ["eligibility", "conversion"],
  ["process", "pillar"], ["process", "law"],
  ["service", "pillar"], ["service", "conversion"],
  ["law", "pillar"], ["law", "process"],
  ["county", "pillar"], ["county", "conversion"], ["county", "locations"],
  ["locations", "county"],
  ["resources", "pillar"],
];

const missing = REQUIRED.filter(([from, to]) => !grid.get(`${from}>${to}`));

/* Orphans: pages nothing links to from body copy. Navigation still reaches
   them, so this is a signal about topical connection, not about crawlability. */
const orphans = [...pages.entries()]
  .filter(
    ([href]) =>
      href !== "/" && href !== "/404.html" && !NOINDEX.has(href) && !inbound.get(href).size
  )
  .map(([href]) => href);

/* ---- report --------------------------------------------------------------- */

const totalLinks = [...outbound.values()].reduce((n, s) => n + s.size, 0);

console.log(`\n  Internal linking across ${pages.size} pages\n`);
console.log(`    contextual links (excluding nav, footer, breadcrumbs, CTA)   ${totalLinks}`);
console.log(`    average per page                                            ${(totalLinks / pages.size).toFixed(1)}`);
console.log(`    required type-to-type paths present                         ${REQUIRED.length - missing.length}/${REQUIRED.length}`);

if (MATRIX) {
  const order = types.sort();
  const w = Math.max(...order.map((t) => t.length));
  console.log(`\n    ${"".padEnd(w)}  ${order.map((t) => t.slice(0, 5).padStart(6)).join("")}`);
  for (const from of order) {
    const row = order.map((to) => String(grid.get(`${from}>${to}`) || "·").padStart(6)).join("");
    console.log(`    ${from.padEnd(w)}  ${row}`);
  }
}

let failed = false;

if (broken.length) {
  failed = true;
  console.error(`\n  ${broken.length} broken internal link(s):\n`);
  for (const b of broken.slice(0, 20)) console.error(`    ${b}`);
}

if (missing.length) {
  failed = true;
  console.error(`\n  ${missing.length} required linking path(s) missing from body copy:\n`);
  for (const [from, to] of missing) console.error(`    ${from} -> ${to}`);
}

if (orphans.length) {
  failed = true;
  console.error(`\n  ${orphans.length} page(s) with no contextual inbound link:\n`);
  for (const o of orphans) console.error(`    ${o}`);
}

console.log("");
if (failed) process.exit(1);
console.log("  No problems found.\n");
