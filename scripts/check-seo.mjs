#!/usr/bin/env node
/**
 * SEO and semantics gate.
 *
 * Hand-written HTML has no schema layer to enforce metadata, so this replaces
 * it. It reads the built pages rather than the data that produced them, which
 * means it catches problems introduced anywhere in the pipeline — including in
 * the generator itself.
 *
 *   node scripts/check-seo.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { plain, extractFaqs } from "./seo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(readFileSync(join(ROOT, "data/site.json"), "utf8"));

const IGNORE = new Set([
  "node_modules", ".git", "docs", "scripts", "data", "src",
  "templates", "partials", "styleguide",
]);

const pages = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs);
    else if (entry.endsWith(".html")) pages.push(abs);
  }
})(ROOT);

const problems = [];
const titles = new Map();
const descriptions = new Map();
let faqPages = 0;
let schemaNodes = new Set();

const attr = (html, re) => (re.exec(html) || [])[1];

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Finds inline SVG that is exposed to assistive technology without a label.
 *
 * `aria-hidden="true"` removes an element's entire subtree from the
 * accessibility tree, so a decorative icon wrapped in a hidden span needs
 * nothing on the <svg> itself — repeating the attribute on the child would be
 * noise. Checking the tag in isolation therefore reports markup that is
 * already correct, which is why this walks the open-element stack instead.
 *
 * Returns the count of SVG elements that are neither hidden by themselves nor
 * by an ancestor, and carry no role="img".
 */
function unlabelledSvgCount(html) {
  const stack = []; // [{ name, hidden }]
  let hiddenDepth = 0;
  let count = 0;

  const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

  for (let m; (m = TAG.exec(html)); ) {
    if (m[0].startsWith("<!--")) continue;
    const [, closing, rawName, attrs, selfClosed] = m;
    const name = rawName.toLowerCase();

    if (closing) {
      // Unwind to the matching open tag; stray closers are ignored.
      let at = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { at = i; break; }
      }
      if (at === -1) continue;
      while (stack.length > at) if (stack.pop().hidden) hiddenDepth--;
      continue;
    }

    const hidden = /aria-hidden\s*=\s*"true"/.test(attrs);

    if (name === "svg") {
      if (!hidden && !hiddenDepth && !/role\s*=\s*"img"/.test(attrs)) count++;
      // SVG internals use their own vocabulary; skip past the close tag.
      const end = html.indexOf("</svg>", TAG.lastIndex);
      if (end !== -1) TAG.lastIndex = end + 6;
      continue;
    }

    if (VOID.has(name) || selfClosed) continue;
    stack.push({ name, hidden });
    if (hidden) hiddenDepth++;
  }

  return count;
}

for (const file of pages) {
  const rel = "/" + relative(ROOT, file);
  const html = readFileSync(file, "utf8");
  const fail = (msg) => problems.push(`${rel}: ${msg}`);

  /* ---- title and description ------------------------------------------- */
  const title = attr(html, /<title>([\s\S]*?)<\/title>/);
  if (!title) fail("no <title>");
  else {
    if (title.length > 70) fail(`title is ${title.length} chars (aim under 60)`);
    if (titles.has(title)) fail(`title duplicates ${titles.get(title)}`);
    titles.set(title, rel);
  }

  const desc = attr(html, /<meta name="description" content="([^"]*)"/);
  if (!desc) fail("no meta description");
  else {
    if (desc.length < 50) fail(`meta description is only ${desc.length} chars`);
    if (desc.length > 165) fail(`meta description is ${desc.length} chars (aim under 155)`);
    if (descriptions.has(desc)) fail(`meta description duplicates ${descriptions.get(desc)}`);
    descriptions.set(desc, rel);
  }

  /* ---- canonical, robots, social ---------------------------------------- */
  const canonical = attr(html, /<link rel="canonical" href="([^"]*)"/);
  if (!canonical) fail("no canonical link");
  else if (!canonical.startsWith(site.url)) fail(`canonical is not absolute: ${canonical}`);

  if (!/<meta name="robots"/.test(html)) fail("no robots directive");
  for (const tag of ["og:title", "og:description", "og:url", "og:type", "og:site_name"]) {
    if (!html.includes(`property="${tag}"`)) fail(`missing ${tag}`);
  }
  if (!html.includes('name="twitter:card"')) fail("missing twitter:card");

  /* ---- headings ---------------------------------------------------------- */
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);
  const h1s = [...main.matchAll(/<h1[\s>]/g)].length;
  if (h1s !== 1) fail(`${h1s} <h1> elements in <main> (expected 1)`);

  let previous = 0;
  for (const [, level] of main.matchAll(/<h([1-6])[\s>]/g)) {
    const n = Number(level);
    if (previous && n > previous + 1) fail(`heading jumps from h${previous} to h${n}`);
    previous = n;
  }

  /* ---- images ------------------------------------------------------------ */
  for (const [tag] of main.matchAll(/<img[^>]*>/g)) {
    if (!/\salt=/.test(tag)) fail("an <img> has no alt attribute");
  }
  // Decorative inline SVG must be hidden from assistive tech; meaningful SVG
  // must be labelled. Anything with neither is ambiguous.
  const unlabelled = unlabelledSvgCount(main);
  if (unlabelled) {
    fail(`${unlabelled} inline <svg> neither hidden (directly or by an ancestor) nor role=img`);
  }

  /* ---- structured data --------------------------------------------------- */
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) fail("no JSON-LD");
  for (const [, body] of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      fail(`JSON-LD does not parse: ${error.message}`);
      continue;
    }
    const nodes = parsed["@graph"] || [parsed];
    for (const node of nodes) {
      schemaNodes.add(node["@type"]);
      // Claims that must never appear without verified source data.
      if (node.aggregateRating) fail("aggregateRating present — no verified ratings exist");
      if (node.review) fail("review present — no verified reviews exist");
      if (node["@type"] === "LocalBusiness") fail("LocalBusiness used — no confirmed office");
      if (node.address && !site.office.street) fail("address emitted while unconfirmed");
      if (node.telephone && !site.phone.tel) fail("telephone emitted while unconfirmed");
      if (node["@type"] === "Attorney" && !site.attorney.name) fail("Attorney node without a name");
      if (node["@type"] === "FAQPage") {
        faqPages++;
        // Schema must reflect what a visitor can actually see.
        const visible = extractFaqs(html).map((f) => f.question);
        for (const entity of node.mainEntity || []) {
          if (!visible.includes(entity.name)) {
            fail(`FAQ "${entity.name.slice(0, 40)}…" is in schema but not on the page`);
          }
        }
      }
    }
  }

  /* ---- semantics --------------------------------------------------------- */
  if (!/<main[\s>]/.test(html)) fail("no <main> landmark");
  if (!/<html lang="/.test(html)) fail("no lang on <html>");
  if (!html.includes('class="skip-link"')) fail("no skip link");

  /* ---- analytics ----------------------------------------------------------
   * A page that quietly loses the tag is invisible in reports and gives no
   * sign of it — traffic simply appears lower. Checked per page rather than
   * trusted to the shared head, since the head is only shared while the page
   * stays in sync with it.
   * ---------------------------------------------------------------------- */
  const measurementId = site.analytics?.measurementId;
  if (measurementId && !html.includes(measurementId)) {
    fail(`analytics tag missing (expected ${measurementId})`);
  }
}

/* ---- report --------------------------------------------------------------- */

console.log(`\n  SEO checks across ${pages.length} pages\n`);
console.log(`    unique titles          ${titles.size}/${pages.length}`);
console.log(`    unique descriptions    ${descriptions.size}/${pages.length}`);
console.log(`    FAQPage blocks         ${faqPages}`);
console.log(`    schema types in use    ${[...schemaNodes].sort().join(", ")}`);

if (problems.length) {
  console.error(`\n  ${problems.length} problem(s):\n`);
  for (const problem of problems.slice(0, 40)) console.error(`    ${problem}`);
  if (problems.length > 40) console.error(`    …and ${problems.length - 40} more`);
  console.error("");
  process.exit(1);
}

console.log(`\n  No problems found.\n`);
