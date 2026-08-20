#!/usr/bin/env node
/**
 * Generates the Open Graph card and the favicons.
 *
 * These are the only raster assets on the site, and they are built rather than
 * hand-made so they stay in step with the design: the colours come from
 * src/input.css and the type from the same two families the pages use. Re-run
 * it after a palette or wordmark change and the card follows.
 *
 * The SVG favicon is written directly. The PNGs are rendered through the
 * headless browser already used by the audits, which avoids adding an image
 * library for two files.
 *
 *   node scripts/make-social-assets.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "\n  Generating the social assets needs Playwright:\n" +
      "    npm install\n    npx playwright install chromium\n"
  );
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(readFileSync(join(ROOT, "data/site.json"), "utf8"));
const css = readFileSync(join(ROOT, "src/input.css"), "utf8");

/** Pull a colour straight out of the stylesheet so there is one source. */
const token = (name, fallback) =>
  (new RegExp(`--color-${name}:\\s*([^;]+);`).exec(css)?.[1] || fallback).trim();

const NAVY = token("navy-900", "#132845");
const NAVY_MID = token("navy-800", "#1c3a63");
const TEAL = token("teal-500", "#1f7a75");
const MIST = token("mist-100", "#f1f5fa");

const fonts = {
  serif: readFileSync(join(ROOT, "fonts/source-serif-4-latin-700.woff2")).toString("base64"),
  sans: readFileSync(join(ROOT, "fonts/inter-latin-var.woff2")).toString("base64"),
};

/* ---- Open Graph card ------------------------------------------------------
 * 1200x630 is the size every major consumer crops to. The wordmark is the
 * site name, not the firm name, because that is what the link is to — the firm
 * is named underneath, which is also what Fla. Bar Rule 4-7.12 expects of a
 * standalone piece of firm marketing.
 * ------------------------------------------------------------------------ */

const card = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: "Source Serif 4"; src: url(data:font/woff2;base64,${fonts.serif}) format("woff2"); font-weight: 700; }
  @font-face { font-family: "Inter"; src: url(data:font/woff2;base64,${fonts.sans}) format("woff2"); font-weight: 400 700; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: ${NAVY}; color: #fff;
         font-family: Inter, sans-serif; display: flex; flex-direction: column;
         justify-content: space-between; padding: 72px 80px; position: relative; overflow: hidden; }
  .glow { position: absolute; right: -180px; top: -180px; width: 620px; height: 620px;
          border-radius: 50%; background: ${NAVY_MID}; opacity: .55; }
  .rule { width: 84px; height: 5px; background: ${TEAL}; border-radius: 999px; }
  .eyebrow { font-size: 21px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
             color: ${TEAL}; margin-bottom: 26px; position: relative; }
  h1 { font-family: "Source Serif 4", Georgia, serif; font-weight: 700; font-size: 82px;
       line-height: 1.06; letter-spacing: -.022em; max-width: 20ch; position: relative; }
  p { font-size: 27px; line-height: 1.5; color: ${MIST}; margin-top: 28px; max-width: 34ch; position: relative; }
  footer { display: flex; align-items: baseline; gap: 18px; position: relative; }
  .firm { font-family: "Source Serif 4", Georgia, serif; font-size: 31px; font-weight: 700; }
  .domain { font-size: 23px; color: ${MIST}; opacity: .82; }
</style></head><body>
  <div class="glow"></div>
  <div>
    <div class="eyebrow">Florida Probation Law</div>
    <h1>Early Termination of Probation in Florida</h1>
    <p>Eligibility, the 50% rule, the motion and the hearing — explained.</p>
  </div>
  <div>
    <div class="rule" style="margin-bottom:22px"></div>
    <footer><span class="firm">${site.firmLegalName}</span><span class="domain">${site.domain}</span></footer>
  </div>
</body></html>`;

/* ---- favicon --------------------------------------------------------------
 * A monogram rather than an icon: at 16px a scales-of-justice glyph is an
 * indistinct smudge, while two letters stay readable. The SVG is what modern
 * browsers use; the PNGs cover older ones and the iOS home screen.
 * ------------------------------------------------------------------------ */

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Florida Probation Law">
  <rect width="64" height="64" rx="12" fill="${NAVY}"/>
  <rect x="8" y="46" width="48" height="4" rx="2" fill="${TEAL}"/>
  <text x="32" y="40" text-anchor="middle" fill="#ffffff"
        font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="30">FP</text>
</svg>
`;
writeFileSync(join(ROOT, "favicon.svg"), faviconSvg);

const iconPage = (px) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0} body{width:${px}px;height:${px}px}
  svg{width:${px}px;height:${px}px;display:block}
</style></head><body>${faviconSvg}</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});

async function shot(html, width, height, out) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(ROOT, out), type: "png" });
  await ctx.close();
  console.log(`  ${out.padEnd(24)} ${width}x${height}`);
}

await shot(card, 1200, 630, "og-image.png");
await shot(iconPage(180), 180, 180, "apple-touch-icon.png");
await shot(iconPage(32), 32, 32, "favicon-32.png");

await browser.close();
console.log("  favicon.svg              vector\n");
