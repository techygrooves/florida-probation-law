#!/usr/bin/env node
/**
 * Static site assembler.
 *
 * There is no template engine in this stack, so shared chrome would
 * otherwise be copy-pasted into every page and drift apart. Instead each
 * page marks regions the build owns:
 *
 *     <!-- @include:header -->  …generated…  <!-- @end:header -->
 *
 * This script rewrites those regions in place from partials/, scaffolds any
 * route in data/nav.json that has no page file yet, and regenerates
 * sitemap.xml. Everything outside a managed region is hand-authored and is
 * never touched.
 *
 *   node scripts/build.mjs           assemble
 *   node scripts/build.mjs --check   fail if any page is out of sync (CI)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const readJSON = (p) => JSON.parse(read(p));

const site = readJSON("data/site.json");
const nav = readJSON("data/nav.json");

const partials = {
  head: read("partials/head.html"),
  header: read("partials/header.html"),
  footer: read("partials/footer.html"),
  "call-bar": read("partials/call-bar.html"),
};

/* ---- helpers ------------------------------------------------------------ */

const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Route "/a/b/" -> "a/b/index.html"; "/" -> "index.html" */
const routeToFile = (href) =>
  href === "/" ? "index.html" : `${href.replace(/^\/|\/$/g, "")}/index.html`;

const slugId = (href) =>
  href.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";

/* ---- route collection ---------------------------------------------------
 * Walks the nav tree into a flat, de-duplicated list. Several nav entries
 * deliberately point at the same route ("Overview" and "All Locations" are
 * their section's index), so first definition wins and the duplicate is
 * dropped rather than generating the page twice.
 * ------------------------------------------------------------------------ */

const routes = new Map();

function addRoute(item, section) {
  if (!item.href || routes.has(item.href)) return;
  routes.set(item.href, {
    href: item.href,
    label: item.label,
    title: item.title || item.label,
    description: item.description || "",
    placeholder: item.placeholder === true,
    draft: item.draft === true,
    section,
  });
}

for (const top of nav.primary) {
  addRoute(top, top.label);
  for (const child of top.children || []) addRoute(child, top.label);
}
for (const item of nav.legal) addRoute(item, "Legal");

/* ---- phone --------------------------------------------------------------
 * The firm's number is not confirmed yet. Until `tel` is filled in, the
 * number renders as inert text rather than a live tel: link — a wrong or
 * placeholder number that actually dials is worse than no link at all.
 * ------------------------------------------------------------------------ */

const hasPhone = Boolean(site.phone.tel);

const phoneHeader = hasPhone
  ? `<a class="header-phone" href="tel:${esc(site.phone.tel)}">
          <span class="header-phone-label">Call now</span>
          <span class="header-phone-number">${esc(site.phone.display)}</span>
        </a>`
  : `<span class="header-phone">
          <span class="header-phone-label">Call now</span>
          <span class="header-phone-number">${esc(site.phone.display)}</span>
        </span>`;

const phoneMobile = hasPhone
  ? `<a class="btn btn-secondary btn-block" href="tel:${esc(site.phone.tel)}" style="margin-bottom:.75rem">Call ${esc(site.phone.display)}</a>`
  : `<p class="text-meta" style="margin-bottom:.75rem">Call ${esc(site.phone.display)}</p>`;

const phoneCallButton = hasPhone
  ? `<a class="btn btn-primary" href="tel:${esc(site.phone.tel)}">Call</a>`
  : `<a class="btn btn-primary" href="/contact/">Call</a>`;

/* ---- navigation rendering ----------------------------------------------- */

/** A top-level item is active on its own page and anywhere beneath it. */
const isActiveSection = (item, current) =>
  item.href === current ||
  (item.href !== "/" && current.startsWith(item.href));

function renderDesktopNav(current) {
  return nav.primary
    .map((item) => {
      const active = isActiveSection(item, current);
      const cls = ["nav-item", item.children && "nav-item-has-menu", active && "nav-item-active"]
        .filter(Boolean)
        .join(" ");
      const aria = item.href === current ? ' aria-current="page"' : "";

      if (!item.children) {
        return `        <li class="${cls}"><a class="nav-link" href="${item.href}"${aria}>${esc(item.label)}</a></li>`;
      }

      const id = `menu-${slugId(item.href)}`;
      const links = item.children
        .map((c) => {
          const ca = c.href === current ? ' aria-current="page"' : "";
          return `            <li><a class="nav-menu-link" href="${c.href}"${ca}>${esc(c.label)}</a></li>`;
        })
        .join("\n");

      return `        <li class="${cls}">
          <a class="nav-link" href="${item.href}"${aria}>${esc(item.label)}</a>
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="${id}">
            <span class="sr-only">${esc(item.label)} menu</span>
            <svg class="nav-toggle-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>
          </button>
          <ul class="nav-menu" id="${id}" hidden>
${links}
          </ul>
        </li>`;
    })
    .join("\n");
}

function renderMobileNav(current) {
  return nav.primary
    .map((item) => {
      const aria = item.href === current ? ' aria-current="page"' : "";

      if (!item.children) {
        return `          <li class="mobile-nav-item"><a class="mobile-nav-link" href="${item.href}"${aria}>${esc(item.label)}</a></li>`;
      }

      // Native <details>: the mobile menu stays fully operable even if
      // main.js never loads.
      const open = isActiveSection(item, current) ? " open" : "";

      // Several sections already list their own index as a child ("Overview",
      // "All Locations"). Only synthesise a link to it where they do not.
      const hasOwnIndex = item.children.some((c) => c.href === item.href);
      const overview = hasOwnIndex
        ? ""
        : `                <li><a href="${item.href}"${aria}>${esc(item.label)} overview</a></li>\n`;

      const links = item.children
        .map((c) => {
          const ca = c.href === current ? ' aria-current="page"' : "";
          return `                <li><a href="${c.href}"${ca}>${esc(c.label)}</a></li>`;
        })
        .join("\n");

      return `          <li class="mobile-nav-item">
            <details class="mobile-nav-group"${open}>
              <summary class="mobile-nav-summary">
                ${esc(item.label)}
                <svg class="mobile-nav-summary-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>
              </summary>
              <ul class="mobile-nav-sub">
${overview}${links}
              </ul>
            </details>
          </li>`;
    })
    .join("\n");
}

/* ---- footer rendering ---------------------------------------------------- */

function renderFooterColumns() {
  return nav.footerColumns
    .map((col) => {
      let items;
      if (col.items) {
        items = col.items;
      } else if (col.source === "legal") {
        items = nav.legal;
      } else {
        const parent = nav.primary.find((p) => p.href === col.source);
        items = parent?.children || [];
      }

      const links = items
        .map((i) => `          <li><a href="${i.href}">${esc(i.label)}</a></li>`)
        .join("\n");

      return `      <div>
        <h2 class="footer-heading">${esc(col.heading)}</h2>
        <ul class="footer-links">
${links}
        </ul>
      </div>`;
    })
    .join("\n");
}

/** Renders a firm detail, or an explicit pending note when it is unknown. */
function fact(label, value, { href } = {}) {
  const body = value
    ? `<p class="footer-fact-value">${href ? `<a href="${esc(href)}">${esc(value)}</a>` : esc(value)}</p>`
    : `<p class="footer-fact-pending">To be supplied by ${esc(site.firm)}</p>`;
  return `        <div>
          <p class="footer-fact-label">${esc(label)}</p>
          ${body}
        </div>`;
}

function renderFooterFacts() {
  // `state` is pre-filled with "FL", so joining blindly would render a bare
  // "FL" and hide the fact that the address is still missing. The city is
  // what Fla. Bar Rule 4-7.12 actually requires, so treat it as the gate.
  const office = site.office.city
    ? [site.office.street, site.office.city, site.office.state, site.office.zip]
        .filter(Boolean)
        .join(", ")
    : "";
  const hours = [site.hours.weekday, site.hours.weekend].filter(Boolean).join(" · ");
  const attorney = [site.attorney.name, site.attorney.barNumber && `Fla. Bar No. ${site.attorney.barNumber}`]
    .filter(Boolean)
    .join(" — ");

  return [
    fact("Responsible attorney", attorney),
    fact("Phone", hasPhone ? site.phone.display : "", { href: `tel:${site.phone.tel}` }),
    fact("Email", site.email.display, { href: `mailto:${site.email.display}` }),
    fact("Office", office),
    fact("Business hours", hours),
    fact("Florida Bar", site.bar.admission),
  ].join("\n");
}

/* ---- breadcrumbs --------------------------------------------------------- */

function renderBreadcrumbs(route) {
  if (route.href === "/") return "";

  const crumbs = [{ label: "Home", href: "/" }];
  const parent = nav.primary.find(
    (p) => p.href !== "/" && p.href !== route.href && route.href.startsWith(p.href)
  );
  if (parent) crumbs.push({ label: parent.label, href: parent.href });

  const items = crumbs
    .map((c) => `          <li class="breadcrumb-item"><a href="${c.href}">${esc(c.label)}</a></li>`)
    .join("\n");

  return `      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <ol>
${items}
          <li class="breadcrumb-item"><span class="breadcrumb-current" aria-current="page">${esc(route.label || route.title)}</span></li>
        </ol>
      </nav>`;
}

/* ---- HTML sitemap -------------------------------------------------------- */

function renderSitemap() {
  const sections = nav.primary
    .filter((p) => p.children)
    .map((p) => {
      const links = p.children
        .map((c) => `          <li><a class="btn-link" href="${c.href}">${esc(c.label)}</a></li>`)
        .join("\n");
      return `      <div>
        <h2 class="h4">${esc(p.label)}</h2>
        <ul class="footer-links" style="margin-top:.5rem">
${links}
        </ul>
      </div>`;
    });

  const flat = nav.primary
    .filter((p) => !p.children)
    .map((p) => `          <li><a class="btn-link" href="${p.href}">${esc(p.label)}</a></li>`)
    .join("\n");

  const legal = nav.legal
    .map((p) => `          <li><a class="btn-link" href="${p.href}">${esc(p.label)}</a></li>`)
    .join("\n");

  return `    <div class="stack-lg">
${sections.join("\n")}
      <div>
        <h2 class="h4">Site</h2>
        <ul class="footer-links" style="margin-top:.5rem">
${flat}
        </ul>
      </div>
      <div>
        <h2 class="h4">Legal</h2>
        <ul class="footer-links" style="margin-top:.5rem">
${legal}
        </ul>
      </div>
    </div>`;
}

/* ---- region stitching ---------------------------------------------------- */

function render(tpl, ctx) {
  return tpl.replace(/\{\{([a-z0-9._]+)\}\}/gi, (m, key) => {
    const val = key.split(".").reduce((o, k) => (o == null ? o : o[k]), ctx);
    return val == null ? m : String(val);
  });
}

function contextFor(route) {
  const canonical = site.url.replace(/\/$/, "") + route.href;
  const titleTag =
    route.href === "/" ? `${route.title} | ${site.firm}` : `${route.title} | ${site.siteName}`;

  return {
    site: { ...site, attributionLine: `${site.siteName} is operated by ${site.firm}.` },
    year: new Date().getFullYear(),
    page: {
      ...route,
      titleTag,
      canonical,
      eyebrow: route.section === route.label ? site.siteName : route.section,
      h1: route.title,
      // Empty routes stay out of the index because 37 thin pages would be a
      // liability, not an asset. Draft routes stay out because publishing
      // legal content no Florida attorney has reviewed is worse than
      // publishing nothing.
      robots:
        route.placeholder || route.draft
          ? '<meta name="robots" content="noindex, follow">'
          : '<meta name="robots" content="index, follow">',
    },
    nav: { desktop: renderDesktopNav(route.href), mobile: renderMobileNav(route.href) },
    footer: { columns: renderFooterColumns(), facts: renderFooterFacts() },
    phone: { header: phoneHeader, mobile: phoneMobile, callButton: phoneCallButton },
  };
}

function regionsFor(route, ctx) {
  return {
    head: render(partials.head, ctx),
    header: render(partials.header, ctx),
    footer: render(partials.footer, ctx),
    "call-bar": render(partials["call-bar"], ctx),
    breadcrumbs: renderBreadcrumbs(route),
    sitemap: route.href === "/sitemap/" ? renderSitemap() : null,
  };
}

function stitch(html, regions) {
  for (const [name, body] of Object.entries(regions)) {
    if (body == null) continue;
    const re = new RegExp(
      `(<!--\\s*@include:${name}\\s*-->)[\\s\\S]*?(<!--\\s*@end:${name}\\s*-->)`,
      "g"
    );
    html = html.replace(re, `$1\n${body}\n$2`);
  }
  return html;
}

/* ---- run ----------------------------------------------------------------- */

const templates = {
  page: read("templates/page.html"),
  sitemap: read("templates/sitemap.html"),
};

/** The HTML sitemap carries a generated listing, so it needs its own shell. */
const templateFor = (route) =>
  route.href === "/sitemap/" ? templates.sitemap : templates.page;

let created = 0;
let updated = 0;
const drifted = [];

// 404 is not in the nav but still needs the full shell.
const allRoutes = [
  ...routes.values(),
  {
    href: "/404.html",
    label: "Page not found",
    title: "Page not found",
    description: "That page does not exist. Use the navigation or the sitemap to find what you need.",
    placeholder: true,
    section: "Site",
    file: "404.html",
  },
];

for (const route of allRoutes) {
  const file = route.file || routeToFile(route.href);
  const abs = join(ROOT, file);
  const ctx = contextFor(route);
  const isNew = !existsSync(abs);

  if (isNew && CHECK) {
    drifted.push(`${file} (missing)`);
    continue;
  }

  const source = isNew ? render(templateFor(route), ctx) : readFileSync(abs, "utf8");
  const next = stitch(source, regionsFor(route, ctx));

  if (isNew) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, next);
    created++;
  } else if (next !== source) {
    if (CHECK) drifted.push(file);
    else {
      writeFileSync(abs, next);
      updated++;
    }
  }
}

/* ---- sitemap.xml --------------------------------------------------------- */

const indexable = [...routes.values()].filter((r) => !r.placeholder && !r.draft);

if (!CHECK) {
  const urls = indexable
    .map((r) => `  <url><loc>${site.url.replace(/\/$/, "")}${r.href}</loc></url>`)
    .join("\n");
  writeFileSync(
    join(ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
}

/* ---- report -------------------------------------------------------------- */

if (CHECK) {
  if (drifted.length) {
    console.error(`\n  Pages out of sync with partials/ — run \`npm run build\`:\n`);
    for (const f of drifted) console.error(`    ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(`\n  All ${allRoutes.length} pages in sync with partials/.\n`);
} else {
  console.log(
    `\n  ${allRoutes.length} routes · ${created} created · ${updated} updated · ${indexable.length} indexable in sitemap.xml`
  );
  if (!indexable.length) {
    const drafts = [...routes.values()].filter((r) => r.draft).length;
    console.log(
      `  Note: no route is publishable yet — ${routes.size - drafts} empty, ${drafts} awaiting\n` +
        `  attorney review — so every page carries noindex and sitemap.xml is empty.`
    );
  }
  console.log("");
}
