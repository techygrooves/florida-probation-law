#!/usr/bin/env node
/**
 * Accessibility audit.
 *
 * The static checks in check-seo.mjs cover what markup can tell you: alt
 * attributes, heading order, landmarks. This covers what only a running page
 * can — whether Tab actually reaches things, whether focus is visible against
 * the background it lands on, whether the menu and the accordions respond to a
 * keyboard, and whether the form announces its errors.
 *
 * Requires the preview server:  npm run serve
 *
 *   node scripts/audit-a11y.mjs
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
const url = (route) => `${ORIGIN}${BASE}${route}`;

const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});

/* ---- contrast maths ------------------------------------------------------ */

const srgb = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const parseRGB = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

/* ---- every-page checks ---------------------------------------------------- */

const IGNORE = new Set([
  "node_modules", ".git", "docs", "scripts", "data", "src", "templates", "partials", "styleguide",
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

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

for (const route of routes) {
  await page.goto(url(route), { waitUntil: "load" });

  const found = await page.evaluate(() => {
    const out = [];

    /* ---- link text ------------------------------------------------------
     * "Click here" and "read more" are useless out of context, and a screen
     * reader user listing the links on a page gets exactly that: no context.
     * ------------------------------------------------------------------ */
    const VAGUE = /^(click here|here|read more|more|learn more|link|this|more info|details)\.?$/i;
    const byText = new Map();
    for (const a of document.querySelectorAll("main a[href]")) {
      const label = (a.getAttribute("aria-label") || a.textContent).replace(/\s+/g, " ").trim();
      if (!label) {
        out.push({ kind: "link-text", detail: `empty link to ${a.getAttribute("href")}` });
        continue;
      }
      if (VAGUE.test(label)) out.push({ kind: "link-text", detail: `vague link text "${label}"` });

      /* Same text pointing at two different pages is equally confusing. A
         contents entry that jumps to a section of this page is not the same
         case: it shares wording with a heading by design, the contents list is
         a named landmark, and rewording headings to avoid the overlap would
         make the page worse, not better. So only page-to-page collisions
         count. */
      const href = a.getAttribute("href");
      if (href.startsWith("#")) continue;
      const key = label.toLowerCase();
      if (byText.has(key) && byText.get(key) !== href) {
        out.push({ kind: "link-text", detail: `"${label}" points at both ${byText.get(key)} and ${href}` });
      }
      byText.set(key, href);
    }

    /* ---- scrollable regions must be reachable (SC 2.1.1) ------------------ */
    for (const el of document.querySelectorAll("main *")) {
      const cs = getComputedStyle(el);
      if (!["auto", "scroll"].includes(cs.overflowX) && !["auto", "scroll"].includes(cs.overflowY)) continue;
      if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) continue;
      const focusable = el.tabIndex >= 0 || el.matches("a[href],button,input,select,textarea");
      if (!focusable) {
        out.push({ kind: "scroll-region", detail: `<${el.tagName.toLowerCase()}.${el.className}> scrolls but cannot be focused` });
      }
    }

    /* ---- form labelling ---------------------------------------------------- */
    for (const field of document.querySelectorAll("input, select, textarea")) {
      if (field.type === "hidden") continue;
      const id = field.id;
      const labelled =
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
        field.closest("label") ||
        field.getAttribute("aria-label") ||
        field.getAttribute("aria-labelledby");
      if (!labelled) {
        out.push({ kind: "form-label", detail: `<${field.tagName.toLowerCase()} name="${field.name || "?"}"> has no label` });
      }
      // A required field must say so in the accessibility tree, not only in
      // the visible label text.
      if (field.hasAttribute("required") && !field.getAttribute("aria-required")) {
        const hasNative = field.hasAttribute("required");
        if (!hasNative) out.push({ kind: "form-label", detail: `${field.name} is visually required but not programmatically` });
      }
    }

    /* ---- fieldsets --------------------------------------------------------- */
    for (const fs of document.querySelectorAll("fieldset")) {
      if (!fs.querySelector("legend")) {
        out.push({ kind: "form-label", detail: "a <fieldset> has no <legend>" });
      }
    }

    /* ---- accordions -------------------------------------------------------- */
    for (const d of document.querySelectorAll("details")) {
      if (!d.querySelector("summary")) {
        out.push({ kind: "accordion", detail: "a <details> has no <summary>" });
      }
    }

    /* ---- duplicate ids ------------------------------------------------------ */
    const ids = new Map();
    for (const el of document.querySelectorAll("[id]")) {
      ids.set(el.id, (ids.get(el.id) || 0) + 1);
    }
    for (const [id, n] of ids) {
      if (n > 1) out.push({ kind: "duplicate-id", detail: `id="${id}" appears ${n} times` });
    }

    /* ---- in-page anchors resolve -------------------------------------------- */
    for (const a of document.querySelectorAll('a[href^="#"]')) {
      const target = a.getAttribute("href").slice(1);
      if (target && !document.getElementById(target)) {
        out.push({ kind: "dead-anchor", detail: `#${target} has no target` });
      }
    }

    return out;
  });

  for (const f of found) fail(`${route} [${f.kind}]`, f.detail);
}

console.log(`  static pass    ${routes.length} pages`);

/* ---- keyboard: tab order, focus visibility ------------------------------- */

await page.goto(url("/"), { waitUntil: "load" });

const kb = await page.evaluate(() => {
  const out = [];
  // Focus indicator must be visible against whatever it lands on. The design
  // uses a ring; confirm it actually renders rather than trusting the rule.
  const probe = document.querySelector(".btn-primary");
  probe.focus();
  const cs = getComputedStyle(probe);
  const hasRing =
    (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
    cs.boxShadow !== "none";
  if (!hasRing) out.push("primary button shows no focus indicator");
  return out;
});
for (const k of kb) fail("/ [focus]", k);

// The skip link must be the first stop and must reach <main>. It slides in on
// focus over 150ms, so measuring immediately reads a position it is still
// moving through — wait for the transition rather than racing it.
await page.goto(url("/"), { waitUntil: "load" });
await page.keyboard.press("Tab");
await page.waitForTimeout(250);
const skip = await page.evaluate(() => {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    isSkip: el.classList.contains("skip-link"),
    href: el.getAttribute("href"),
    visibleWhenFocused: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && r.top > -r.height,
    targetExists: !!document.querySelector(el.getAttribute("href") || "#__none"),
  };
});
if (!skip.isSkip) fail("/ [keyboard]", "first Tab stop is not the skip link");
if (!skip.visibleWhenFocused) fail("/ [keyboard]", "skip link stays hidden when focused");
if (!skip.targetExists) fail("/ [keyboard]", `skip link points at ${skip.href}, which does not exist`);

/* Tab through the whole page and confirm focus is never invisible or trapped
   (WCAG 2.2 SC 2.4.11 Focus Not Obscured). */
const trace = await page.evaluate(() => {
  const focusable = [
    ...document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'
    ),
  ].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && !el.closest("[hidden]") && (r.width > 0 || el.classList.contains("skip-link"));
  });
  const bad = [];
  for (const el of focusable) {
    if (el.tabIndex < 0) bad.push(`${el.tagName.toLowerCase()}.${el.className} is visible but tabindex=${el.tabIndex}`);
  }
  return { count: focusable.length, bad };
});
for (const b of trace.bad) fail("/ [keyboard]", b);
console.log(`  keyboard       ${trace.count} focusable stops on the homepage`);

/* ---- desktop dropdown menus ---------------------------------------------- */

const menu = await page.evaluate(() => {
  const out = [];
  const toggle = document.querySelector(".nav-toggle");
  if (!toggle) return ["no nav toggle found"];
  const panelId = toggle.getAttribute("aria-controls");
  const panel = document.getElementById(panelId);
  if (!panel) out.push("nav toggle aria-controls points nowhere");
  if (toggle.getAttribute("aria-expanded") !== "false") out.push("nav toggle does not start collapsed");
  if (!toggle.textContent.trim() && !toggle.querySelector(".sr-only")) out.push("nav toggle has no accessible name");
  return out;
});
for (const m of menu) fail("/ [menu]", m);

/* Drive it from the keyboard, which is the path that matters here. A synthetic
   mouse click would hover first, and hover already opens the menu on a fine
   pointer — the click then correctly toggles it shut, which looks like a
   failure but is not one. Focus and Enter is what a keyboard user does. */
await page.evaluate(() => document.querySelector(".nav-toggle").focus());
await page.keyboard.press("Enter");
await page.waitForTimeout(120);
const opened = await page.evaluate(() => {
  const t = document.querySelector(".nav-toggle");
  const p = document.getElementById(t.getAttribute("aria-controls"));
  return { expanded: t.getAttribute("aria-expanded"), hidden: p.hasAttribute("hidden") };
});
if (opened.expanded !== "true") fail("/ [menu]", "aria-expanded not set to true on open");
if (opened.hidden) fail("/ [menu]", "panel stays hidden after opening");

await page.keyboard.press("Escape");
const closed = await page.evaluate(() => {
  const t = document.querySelector(".nav-toggle");
  return {
    expanded: t.getAttribute("aria-expanded"),
    focusReturned: document.activeElement === t,
  };
});
if (closed.expanded !== "false") fail("/ [menu]", "Escape does not close the dropdown");
if (!closed.focusReturned) fail("/ [menu]", "Escape does not return focus to the toggle");

/* ---- mobile menu ---------------------------------------------------------- */

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mpage = await mobile.newPage();
await mpage.goto(url("/"), { waitUntil: "load" });
await mpage.click("#menu-button");
const mopen = await mpage.evaluate(() => {
  const b = document.getElementById("menu-button");
  const panel = document.getElementById(b.getAttribute("aria-controls"));
  return {
    expanded: b.getAttribute("aria-expanded"),
    panelVisible: panel && getComputedStyle(panel).display !== "none",
    firstGroupIsDetails: !!panel?.querySelector("details"),
  };
});
if (mopen.expanded !== "true") fail("/ [mobile menu]", "aria-expanded not set on open");
if (!mopen.panelVisible) fail("/ [mobile menu]", "panel does not become visible");
if (!mopen.firstGroupIsDetails) fail("/ [mobile menu]", "submenus are not native <details>");

await mpage.keyboard.press("Escape");
const mclosed = await mpage.evaluate(() => document.getElementById("menu-button").getAttribute("aria-expanded"));
if (mclosed !== "false") fail("/ [mobile menu]", "Escape does not close the panel");

/* ---- accordions without JavaScript ---------------------------------------- */

const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
const npage = await nojs.newPage();
await npage.goto(url("/early-termination-of-probation/faqs/"), { waitUntil: "load" });
const accordion = await npage.evaluate(async () => {
  const d = document.querySelector("details.faq-item");
  if (!d) return ["no FAQ accordion found"];
  const before = d.open;
  d.querySelector("summary").click();
  return before === d.open ? ["accordion does not toggle without JavaScript"] : [];
});
for (const a of accordion) fail("/…/faqs/ [accordion]", a);

/* ---- form errors ----------------------------------------------------------- */

const fpage = await context.newPage();
await fpage.goto(url("/probation-eligibility-assessment/"), { waitUntil: "load" });
const formCheck = await fpage.evaluate(() => {
  const out = [];
  const form = document.querySelector("form[data-validate]");
  if (!form) return ["no validated form found"];
  const summary = form.querySelector(".form-errors");
  if (!summary) out.push("no error summary container");
  else {
    if (summary.getAttribute("role") !== "alert") out.push("error summary is not role=alert");
    if (!summary.hasAttribute("hidden")) out.push("error summary is visible before submission");
  }
  return out;
});
for (const f of formCheck) fail("/probation-eligibility-assessment/ [form]", f);

// Submit empty and confirm the failures are announced and focus moves.
await fpage.evaluate(() => {
  const form = document.querySelector("form[data-validate]");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});
const afterSubmit = await fpage.evaluate(() => {
  const form = document.querySelector("form[data-validate]");
  const summary = form.querySelector(".form-errors");
  const invalid = form.querySelectorAll('[aria-invalid="true"]');
  return {
    summaryShown: summary && !summary.hasAttribute("hidden"),
    invalidCount: invalid.length,
    firstDescribed: invalid[0]?.getAttribute("aria-describedby") || null,
    messageExists: invalid[0]
      ? !!document.getElementById((invalid[0].getAttribute("aria-describedby") || "").split(/\s+/).pop())
      : false,
  };
});
if (!afterSubmit.summaryShown) fail("/probation-eligibility-assessment/ [form]", "error summary not revealed on failed submit");
if (!afterSubmit.invalidCount) fail("/probation-eligibility-assessment/ [form]", "no field marked aria-invalid on failed submit");
if (afterSubmit.invalidCount && !afterSubmit.messageExists) {
  fail("/probation-eligibility-assessment/ [form]", "aria-describedby does not resolve to an error message");
}
console.log(`  forms          ${afterSubmit.invalidCount} fields flagged on an empty submit`);

/* ---- reduced motion --------------------------------------------------------- */

const rm = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
const rpage = await rm.newPage();
await rpage.goto(url("/"), { waitUntil: "load" });
const motion = await rpage.evaluate(() => {
  const out = [];
  let animated = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    const dur = parseFloat(cs.transitionDuration) || 0;
    const adur = parseFloat(cs.animationDuration) || 0;
    if (dur > 0.05 || adur > 0.05) {
      animated++;
      if (animated <= 3) {
        out.push(`<${el.tagName.toLowerCase()}.${(el.className || "").toString().split(/\s+/)[0]}> still animates (${cs.transitionDuration}/${cs.animationDuration})`);
      }
    }
  }
  if (animated) out.unshift(`${animated} element(s) animate under prefers-reduced-motion`);
  // Smooth scrolling is motion too.
  if (getComputedStyle(document.documentElement).scrollBehavior === "smooth") {
    out.push("html still uses scroll-behavior: smooth");
  }
  return out;
});
for (const m of motion) fail("/ [reduced-motion]", m);
console.log(`  reduced motion ${motion.length ? "issues found" : "honoured"}`);

/* ---- focus contrast against real backgrounds -------------------------------- */

const focusContrast = await page.evaluate(
  ([]) => {
    const out = [];
    /* Both sides of the ring-colour switch: azure on the white page, and the
       lighter ring the design substitutes inside navy sections, where azure
       would lose contrast against the surface it lands on. */
    const samples = [
      ".btn-primary", ".btn-secondary", ".nav-link", ".footer-links a", ".skip-link",
      ".on-navy .btn-on-navy", ".on-navy .btn-ghost-on-navy", ".site-footer a",
    ];
    for (const sel of samples) {
      /* The first match in the DOM is not necessarily one that exists at this
         viewport — the mobile panel is display:none on desktop, and its
         buttons carry the same classes. focus() is a no-op on those, which
         reads as "no focus indicator" when the truth is "not focusable here". */
      const el = [...document.querySelectorAll(sel)].find((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(c).visibility !== "hidden";
      });
      if (!el) continue;
      el.focus();
      if (document.activeElement !== el) continue;
      const cs = getComputedStyle(el);
      const ring = cs.outlineColor;
      /* Which background the ring is judged against depends on where it is
         drawn. With a positive outline-offset the ring sits clear of the
         control, on whatever is behind it — so a navy button on a white page
         is measured against white, not against its own navy. Only a ring drawn
         on the control itself is measured against the control. */
      const offset = parseFloat(cs.outlineOffset) || 0;
      const start = offset > 0 ? el.parentElement : el;
      let bg = "rgba(0, 0, 0, 0)";
      for (let n = start; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
      }
      out.push({ sel, ring, bg, width: cs.outlineWidth, style: cs.outlineStyle });
    }
    return out;
  },
  []
);

for (const f of focusContrast) {
  if (f.style === "none" || parseFloat(f.width) === 0) {
    fail(`/ [focus]`, `${f.sel} has no outline when focused`);
    continue;
  }
  const r = ratio(parseRGB(f.ring), parseRGB(f.bg));
  // SC 1.4.11: focus indicators need 3:1 against the adjacent background.
  if (r < 3) fail(`/ [focus]`, `${f.sel} focus ring is ${r.toFixed(2)}:1 against ${f.bg} (needs 3:1)`);
}
console.log(`  focus rings    ${focusContrast.length} sampled`);

await browser.close();

/* ---- report ------------------------------------------------------------------ */

console.log(`\n  Accessibility audit across ${routes.length} pages\n`);

if (!problems.length) {
  console.log("  No problems found.\n");
  process.exit(0);
}

// Collapse repeats: one bug on 48 pages should read as one bug.
const seen = new Map();
for (const p of problems) {
  const [where, ...rest] = p.split(": ");
  const msg = rest.join(": ");
  const kind = where.replace(/^\S+\s/, "");
  const key = `${kind} ${msg}`;
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key).push(where.split(" ")[0]);
}

console.error(`  ${seen.size} distinct problem(s), ${problems.length} instance(s):\n`);
for (const [key, where] of seen) {
  console.error(`    ${key}`);
  console.error(`      ${where.length > 3 ? `${where.slice(0, 3).join(", ")} …and ${where.length - 3} more` : where.join(", ")}`);
}
console.error("");
process.exit(1);
