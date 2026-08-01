#!/usr/bin/env node
/**
 * Content compliance gate.
 *
 * A law firm site is regulated speech. Florida Bar Rules 4-7.13 and 4-7.14
 * prohibit deceptive, misleading, and unsubstantiated claims, and the usual
 * way those get onto a site is not malice — it is a phrase borrowed from a
 * template, or a statistic nobody can source, or a superlative that reads as
 * marketing to the person who wrote it and as a promise to the person who
 * reads it.
 *
 * This scans the rendered text of every page for the categories that matter,
 * with negation handling, because legal writing legitimately says "there is no
 * guarantee" and "this is not the best route" — the opposite of the claim.
 *
 *   node scripts/check-content.mjs
 *   node scripts/check-content.mjs --verbose   show every match, not a summary
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { plain } from "./seo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");
const site = JSON.parse(readFileSync(join(ROOT, "data/site.json"), "utf8"));

const IGNORE = new Set([
  "node_modules", ".git", "docs", "scripts", "data", "src", "templates", "partials",
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

/* ---- what counts as a claim ----------------------------------------------
 * Each rule carries the reason it exists, so a future editor removing one has
 * to decide against a stated position rather than against an opaque regex.
 * `allow` marks contexts where the phrase is the negation of the claim, or is
 * quoting the prohibition itself.
 * ------------------------------------------------------------------------ */

/* Negation is checked across the whole sentence, not a fixed character window.
 * Legal writing puts the denial wherever the sentence needs it — "What you will
 * not find on this site is … a claim about being the best at anything" carries
 * its negator 95 characters ahead of the phrase — so a window of any size is
 * the wrong instrument.
 *
 * The second group is the one that matters most on a site like this: pages
 * whose job is to warn a reader away from exactly these claims. Quoting a
 * promise in order to call it a promise is the opposite of making one. */
const NEGATORS = new RegExp(
  "\\b(" +
    "no|not|never|cannot|can't|without|nothing|neither|nobody|none|avoid|" +
    "prohibit\\w*|doesn't|don't|isn't|aren't|won't|rather than|instead of|refus\\w*|" +
    // warning and myth-busting constructions
    "wary|beware|myth|misconception|misleading|wrongly|incorrect\\w*|" +
    "no one|nobody|anyone suggesting|should not|must not|does not mean|" +
    "is wrong|are wrong|untrue|false|do not assume|not a guarantee|not guaranteed" +
    ")\\b",
  "i"
);

/** The sentence a match sits in, so negation is judged over the whole thought. */
function sentenceAround(text, at, length) {
  const from = Math.max(0, text.lastIndexOf(".", at - 1) + 1);
  let to = text.indexOf(".", at + length);
  if (to === -1) to = text.length;
  // A "sentence" longer than this is usually a list rendered without stops;
  // fall back to a generous window rather than swallowing the whole page.
  if (to - from > 400) return text.slice(Math.max(0, at - 200), at + length + 200);
  return text.slice(from, to + 1);
}

const RULES = [
  {
    id: "guaranteed-outcome",
    why: "No lawyer can promise a result. Fla. Bar Rule 4-7.13(b)(3) treats a prediction of success as inherently misleading.",
    re: /\b(guarantee[sd]?|guaranteeing|assured?|promise[sd]?|certain to (?:win|succeed|be granted)|will (?:be granted|win|succeed)|always (?:works|succeeds|granted)|100% success)\b/gi,
  },
  {
    id: "superlative",
    why: "Unverifiable comparative claims. Fla. Bar Rule 4-7.14(a)(2) prohibits comparisons that cannot be factually substantiated.",
    /* Only the marketing sense. "Work best done with the documents in front of
       you" and "capable of leading to a warrant" are ordinary English; it is
       "the best probation lawyer" and "a leading firm" that make a claim. */
    re: new RegExp(
      "\\b(?:the\\s+)?best\\s+(?:probation\\s+|criminal\\s+|defense\\s+)?(?:lawyer|attorney|firm|law\\s+firm|choice|option|representation)\\b" +
        "|\\bbest\\s+in\\s+(?:florida|the\\s+state|town)\\b" +
        "|\\b(?:a|the|state'?s|florida'?s)\\s+leading\\s+(?:lawyer|attorney|firm|law\\s+firm|practice|authority)\\b" +
        "|\\b(?:top[- ]rated|#\\s?1|number one|premier|most experienced|unmatched|unparalleled|foremost|elite|world[- ]class|award[- ]winning|highest[- ]rated|renowned)\\b",
      "gi"
    ),
  },
  {
    id: "specialist-claim",
    why: "Fla. Bar Rule 4-7.14(a)(4): 'specialist', 'expert' and 'certified' are restricted unless the lawyer holds the certification.",
    re: /\b(board[- ]certified|certified specialist|legal expert|expert attorney|specialis[ts]\b)/gi,
  },
  {
    id: "fabricated-statistic",
    why: "A number nobody can source is the easiest thing on a legal site to be wrong about.",
    // A percentage or count attached to a success/experience claim.
    re: /\b\d{1,3}(?:\.\d+)?%\s*(?:of\s+)?(?:our\s+)?(?:cases|clients|success|granted|approved|won)\b|\b(?:over|more than|nearly)\s+\d[\d,]*\+?\s*(?:cases|clients|motions|years of experience|successful)\b|\b\d[\d,]*\+\s*(?:cases|clients|motions)\b/gi,
  },
  {
    id: "fake-credential",
    why: "Rating and award marks may only appear if genuinely held and verifiable.",
    re: /\b(super lawyers|avvo|martindale|av[- ]rated|rising stars?|best lawyers|lead counsel|national trial lawyers|top 100|10 best|client'?s choice|badge)\b/gi,
  },
  {
    id: "testimonial",
    why: "Testimonials must be genuine, attributable, and carry the required disclaimers. None exist yet.",
    re: /\b(testimonial|client review|five[- ]star|5[- ]star|what our clients say|verified review)\b/gi,
  },
  {
    id: "placeholder-leak",
    why: "Template scaffolding that reached a rendered page.",
    re: /\b(lorem ipsum|dolor sit amet|TODO|FIXME|XXX|TBD|\[insert[^\]]*\]|\{\{[a-z.]+\}\}|PLACEHOLDER|your firm name|company name here|example law)\b/gi,
    // Placeholder leakage is never acceptable, negated or not.
    ignoreNegation: true,
  },
  {
    id: "unrelated-practice",
    why: "This site is about Florida probation. Copy borrowed from a general practice template shows up as an unrelated practice area.",
    re: /\b(personal injury|car accident|slip and fall|wrongful death|medical malpractice|divorce|child custody|bankruptcy|chapter 7|chapter 13|immigration|green card|estate planning|living trust|workers'? comp\w*|real estate closing|patent|trademark)\b/gi,
  },
  {
    id: "other-business",
    why: "Names from a template that were never replaced.",
    re: /\b(acme|lorem law|smith (?:&|and) associates|doe (?:&|and)|john doe|jane doe|your company|yourcompany|example\.com|lawfirm\.com|sample law)\b/gi,
    ignoreNegation: true,
  },
];

/* ---- firm identity --------------------------------------------------------
 * The brief is explicit: the website is FloridaProbationLaw.com and the
 * operator is Hoffman Legal. The site must not read as though "Florida
 * Probation Law" were itself a firm.
 * ------------------------------------------------------------------------ */

const FIRM = site.firm; // "Hoffman Legal"
const SITE_NAME = site.siteName; // "Florida Probation Law"

const IDENTITY = [
  {
    id: "site-as-firm",
    why: `"${SITE_NAME}" is a website operated by ${FIRM}, not a law firm. Presenting it as one is a Rule 4-7.12 identification problem.`,
    re: new RegExp(
      `${SITE_NAME}\\s+(?:is a |is an )?(?:law firm|attorneys?|lawyers?|law office|firm)\\b|\\b(?:at|contact|retain|hire)\\s+${SITE_NAME}\\b(?!\\.com)`,
      "gi"
    ),
  },
  {
    id: "firm-name-variant",
    why: `The operator is "${FIRM}" everywhere. A variant reads as a different entity.`,
    re: /\bHoffman (?:Law(?:\s+(?:Firm|Group|Office|Offices))?|Legal Group|& Associates|and Associates|Attorneys|LLC|LLP|P\.?A\.?)\b/gi,
  },
];

/* ---- run ------------------------------------------------------------------ */

const findings = [];

/* The styleguide is the design-system reference, not public copy: it is
   noindex, nofollow, disallowed in robots.txt, and its whole purpose is to
   render the empty states — including the testimonial placeholder that exists
   precisely so no fake one is ever needed. Copy rules do not apply to it. The
   identity rules still do: the firm's name must be right everywhere. */
const isReference = (rel) => rel.startsWith("styleguide/");

for (const file of pages) {
  const rel = relative(ROOT, file);
  const html = readFileSync(file, "utf8");

  // Only the part a visitor reads: skip the head, and skip source comments —
  // "TODO" in a build note is a note, not leaked copy.
  const bodyStart = html.indexOf("<body");
  const body = bodyStart === -1 ? html : html.slice(bodyStart);
  const text = plain(body);

  const applicable = isReference(rel) ? IDENTITY : [...RULES, ...IDENTITY];

  for (const rule of applicable) {
    rule.re.lastIndex = 0;
    for (const match of text.matchAll(rule.re)) {
      const at = match.index;
      const sentence = sentenceAround(text, at, match[0].length);
      // A claim inside a sentence that denies it is the opposite of the claim.
      if (!rule.ignoreNegation && NEGATORS.test(sentence)) continue;
      findings.push({ file: rel, rule, phrase: match[0], window: sentence });
    }
  }
}

/* ---- duplicate location content -------------------------------------------
 * The doorway-page test: strip the county names and see how much of the page
 * is the same words in the same proportions as another county's page.
 * ------------------------------------------------------------------------ */

const countyPages = pages.filter((p) => /locations[/\\][^/\\]+[/\\]index\.html$/.test(p));
const countyText = new Map();

for (const file of countyPages) {
  const html = readFileSync(file, "utf8");
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);
  // Remove the generated chrome, which is identical everywhere by design.
  const stripped = main.replace(
    /<!--\s*@include:(breadcrumbs|toc|siblings|cta|page-disclaimer)\s*-->[\s\S]*?<!--\s*@end:\1\s*-->/g,
    " "
  );
  const words = plain(stripped)
    .toLowerCase()
    // County and circuit names are the legitimate difference; removing them
    // makes the test measure the writing rather than the substitutions.
    .replace(/\b(miami-dade|broward|palm beach|orange|hillsborough|duval|jacksonville|tampa|orlando|fort lauderdale|miami|west palm beach|seventeenth|eleventh|fifteenth|ninth|thirteenth|fourth)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  countyText.set(relative(ROOT, file), new Set(words));
}

const overlaps = [];
const names = [...countyText.keys()];
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = countyText.get(names[i]);
    const b = countyText.get(names[j]);
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    const jaccard = shared / (a.size + b.size - shared);
    overlaps.push({ a: names[i], b: names[j], jaccard });
  }
}
overlaps.sort((x, y) => y.jaccard - x.jaccard);

/* ---- report ---------------------------------------------------------------- */

console.log(`\n  Content review across ${pages.length} pages\n`);

const byRule = new Map();
for (const f of findings) {
  if (!byRule.has(f.rule.id)) byRule.set(f.rule.id, []);
  byRule.get(f.rule.id).push(f);
}

for (const rule of [...RULES, ...IDENTITY]) {
  const hits = byRule.get(rule.id) || [];
  console.log(`    ${hits.length ? "FLAG" : "  ok"}  ${rule.id.padEnd(22)} ${hits.length} match(es)`);
}

const worst = overlaps[0];
console.log(
  `\n    ${worst && worst.jaccard > 0.6 ? "FLAG" : "  ok"}  county-page overlap    ` +
    `max ${worst ? (worst.jaccard * 100).toFixed(1) : 0}% shared vocabulary ` +
    `(${countyPages.length} pages, threshold 60%)`
);

if (VERBOSE || findings.length) {
  for (const [id, hits] of byRule) {
    const rule = [...RULES, ...IDENTITY].find((r) => r.id === id);
    console.log(`\n  ${id} — ${hits.length}`);
    console.log(`    ${rule.why}`);
    const shown = VERBOSE ? hits : hits.slice(0, 8);
    for (const h of shown) {
      console.log(`    ${h.file}`);
      console.log(`      …${h.window.replace(/\s+/g, " ").trim()}…`);
    }
    if (hits.length > shown.length) console.log(`    …and ${hits.length - shown.length} more`);
  }
}

if (VERBOSE) {
  console.log("\n  County page pairwise overlap:");
  for (const o of overlaps.slice(0, 6)) {
    console.log(`    ${(o.jaccard * 100).toFixed(1)}%  ${o.a} vs ${o.b}`);
  }
}

console.log("");

if (findings.length || (worst && worst.jaccard > 0.6)) process.exit(1);
console.log("  No problems found.\n");
