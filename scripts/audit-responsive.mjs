#!/usr/bin/env node
/**
 * Responsive layout audit.
 *
 * Renders every page at five viewports and measures what a browser actually
 * produced. Reading the stylesheet cannot tell you that a heading overflows at
 * 320px or that a table forces the document 40px wider than the screen — only
 * layout can, so this drives a real one.
 *
 * Requires the preview server:  npm run serve
 *
 *   node scripts/audit-responsive.mjs
 *   node scripts/audit-responsive.mjs --viewport=320   just one width
 */

/* Playwright is a development dependency and the audits are opt-in, so say
   plainly what is missing rather than failing with a module resolution error. */
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "\n  This audit drives a real browser and needs Playwright:\n" +
      "    npm install\n" +
      "    npx playwright install chromium\n"
  );
  process.exit(2);
}
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(readFileSync(join(ROOT, "data/site.json"), "utf8"));
const ORIGIN = process.env.PREVIEW_ORIGIN || "http://127.0.0.1:8000";
const BASE = (site.basePath || "").replace(/\/+$/, "");

const only = process.argv.find((a) => a.startsWith("--viewport="))?.split("=")[1];

/* Real device classes, not round numbers: 320 is the narrowest phone still in
   use, 360 the modal Android, 390 the modal iPhone, 768/1024 the iPad in both
   orientations, 1440 a laptop, 1920 a desktop. */
const VIEWPORTS = [
  { name: "small mobile", width: 320, height: 640 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "desktop", width: 1920, height: 1080 },
].filter((v) => !only || String(v.width) === only);

const IGNORE = new Set([
  "node_modules", ".git", "docs", "scripts", "data", "src", "templates", "partials",
]);

const routes = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs);
    else if (entry === "index.html") {
      const rel = relative(ROOT, abs);
      routes.push(rel === "index.html" ? "/" : "/" + rel.replace(/index\.html$/, ""));
    }
  }
})(ROOT);
routes.sort();

const problems = [];

/* The environment ships a Chromium build that may not match the Playwright
   version installed here, so point at it explicitly rather than downloading. */
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.width < 768,
    hasTouch: viewport.width < 768,
  });
  const page = await context.newPage();

  for (const route of routes) {
    await page.goto(`${ORIGIN}${BASE}${route}`, { waitUntil: "load" });

    const found = await page.evaluate((vw) => {
      const out = [];
      const doc = document.documentElement;

      /* ---- horizontal scrolling -------------------------------------------
       * The single most common responsive defect and the most damaging: it
       * makes a page feel broken on every phone. Reported with the widest
       * offending element so the cause is actionable.
       * ------------------------------------------------------------------ */
      if (doc.scrollWidth > vw + 1) {
        let worst = null;
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const style = getComputedStyle(el);
          if (style.position === "fixed") continue;
          const overhang = r.right - vw;
          if (overhang > 1 && (!worst || overhang > worst.overhang)) {
            // An element scrolling its own content is doing the right thing.
            const scrolls = ["auto", "scroll"].includes(style.overflowX);
            if (!scrolls) {
              worst = {
                overhang: Math.round(overhang),
                tag: el.tagName.toLowerCase(),
                cls: (el.className || "").toString().split(/\s+/).slice(0, 2).join("."),
              };
            }
          }
        }
        out.push({
          kind: "horizontal-scroll",
          detail: `document is ${doc.scrollWidth}px wide` +
            (worst ? ` — widest: <${worst.tag}${worst.cls ? "." + worst.cls : ""}> +${worst.overhang}px` : ""),
        });
      }

      /* ---- text overflowing its own box ---------------------------------- */
      for (const el of document.querySelectorAll("h1, h2, h3, h4, p, li, td, th, a, button, summary, label")) {
        if (!el.textContent.trim()) continue;
        const style = getComputedStyle(el);
        if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          out.push({
            kind: "text-overflow",
            detail: `<${el.tagName.toLowerCase()}> content ${el.scrollWidth}px in ${el.clientWidth}px box: "${el.textContent.trim().slice(0, 45)}"`,
          });
        }
      }

      /* ---- heading scale --------------------------------------------------
       * An h1 that eats a third of a small screen before the first sentence
       * is a design failure even when it wraps cleanly.
       * ------------------------------------------------------------------ */
      const h1 = document.querySelector("main h1");
      if (h1) {
        const size = parseFloat(getComputedStyle(h1).fontSize);
        const limit = vw <= 360 ? 34 : vw <= 480 ? 40 : 64;
        if (size > limit) {
          out.push({ kind: "heading-size", detail: `h1 renders at ${size}px (limit ${limit}px at ${vw}px)` });
        }
      }

      /* ---- tap targets, WCAG 2.2 SC 2.5.8 ---------------------------------
       * 24x24 CSS px minimum. Links inside a sentence are exempt under the
       * Inline exception, so those are skipped rather than reported.
       * ------------------------------------------------------------------ */
      if (vw < 768) {
        for (const el of document.querySelectorAll("a[href], button, input, select, summary")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (getComputedStyle(el).display === "inline") continue; // inline exception
          if (r.height < 24 || r.width < 24) {
            out.push({
              kind: "tap-target",
              detail: `<${el.tagName.toLowerCase()}> is ${Math.round(r.width)}x${Math.round(r.height)}: "${el.textContent.trim().slice(0, 30)}"`,
            });
          }
        }
      }

      /* ---- elements colliding with the viewport edge ---------------------- */
      for (const el of document.querySelectorAll("main table, main pre, main img, main .card")) {
        const r = el.getBoundingClientRect();
        if (r.width > vw + 1 && getComputedStyle(el.parentElement).overflowX !== "auto") {
          out.push({
            kind: "wider-than-screen",
            detail: `<${el.tagName.toLowerCase()}> is ${Math.round(r.width)}px on a ${vw}px screen`,
          });
        }
      }

      /* ---- sticky mobile CTA ---------------------------------------------- */
      const bar = document.querySelector(".call-bar");
      if (bar) {
        const style = getComputedStyle(bar);
        if (style.display !== "none") {
          const r = bar.getBoundingClientRect();
          if (Math.abs(r.bottom - window.innerHeight) > 1) {
            out.push({ kind: "call-bar", detail: `not flush to the bottom (bottom=${Math.round(r.bottom)}, vh=${window.innerHeight})` });
          }
          // It must not sit on top of the last thing on the page.
          const footer = document.querySelector(".site-footer");
          if (footer) {
            const pad = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
            if (pad < r.height - 1) {
              out.push({ kind: "call-bar", detail: `body padding-bottom ${Math.round(pad)}px is less than the bar's ${Math.round(r.height)}px — it covers page content` });
            }
          }
        }
      }

      return out;
    }, viewport.width);

    for (const f of found) {
      problems.push({ viewport: viewport.name, width: viewport.width, route, ...f });
    }
  }

  await context.close();
  console.log(`  ${viewport.name.padEnd(13)} ${String(viewport.width).padStart(4)}px  ${routes.length} pages checked`);
}

await browser.close();

/* ---- report --------------------------------------------------------------- */

console.log(`\n  Responsive audit: ${routes.length} routes x ${VIEWPORTS.length} viewports\n`);

if (!problems.length) {
  console.log("  No problems found.\n");
  process.exit(0);
}

// Group by kind then detail, so 48 instances of one bug read as one bug.
const byKind = new Map();
for (const p of problems) {
  const list = byKind.get(p.kind) || [];
  list.push(p);
  byKind.set(p.kind, list);
}

for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${kind} — ${list.length} instance(s)`);
  const seen = new Map();
  for (const p of list) {
    const key = `${p.width}|${p.detail}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(p.route);
  }
  for (const [key, rs] of [...seen].slice(0, 12)) {
    const [width, detail] = key.split("|");
    console.log(`    ${width}px  ${detail}`);
    console.log(`           ${rs.length > 3 ? `${rs.slice(0, 3).join(", ")} …and ${rs.length - 3} more` : rs.join(", ")}`);
  }
  if (seen.size > 12) console.log(`    …and ${seen.size - 12} more variants`);
  console.log("");
}

process.exit(1);
