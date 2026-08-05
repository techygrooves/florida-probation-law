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
import { buildSchema, buildRobotsTxt, buildSitemap, buildTitle } from "./seo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const readJSON = (p) => JSON.parse(read(p));

const site = readJSON("data/site.json");
const nav = readJSON("data/nav.json");
const locations = readJSON("data/locations.json");

const partials = {
  head: read("partials/head.html"),
  header: read("partials/header.html"),
  footer: read("partials/footer.html"),
  "call-bar": read("partials/call-bar.html"),
  cta: read("partials/cta.html"),
  "page-disclaimer": read("partials/page-disclaimer.html"),
};

/* ---- base path ----------------------------------------------------------
 * The site is authored with root-relative URLs ("/contact/"), which is what a
 * site served from its own domain wants. A GitHub Pages project site is served
 * from <user>.github.io/<repo>/ instead, so those URLs resolve to the domain
 * root and 404 — assets included, which is why an unbased build renders with no
 * CSS at all. Every internal href/src is therefore rewritten at build time.
 *
 * Precedence: BASE_PATH env var, then site.basePath, then none.
 * ------------------------------------------------------------------------ */

const BASE = (process.env.BASE_PATH ?? site.basePath ?? "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/^(?!\/)(.+)/, "/$1");

const BASE_MARKER = /\n?<!-- built-with-base:([^\s>]*) -->/;
const URL_ATTR = '(?:href|src)="';

/**
 * Returns a page to canonical root-relative URLs.
 *
 * The trailing marker records which prefix was last written, and exactly one
 * leading occurrence of it is removed. Both halves matter when a route's own
 * path begins with the base string — /florida-probation-law/ is exactly that
 * case here. In a based file that route reads
 * /florida-probation-law/florida-probation-law/…, so removing one occurrence
 * is correct; guessing without the marker would collapse it to the site root.
 */
function stripBase(html) {
  const applied = BASE_MARKER.exec(html)?.[1] || "";
  html = html.replace(BASE_MARKER, "");
  if (!applied) return html;
  return html.replace(new RegExp(`(${URL_ATTR})${applied}/`, "g"), "$1/");
}

/**
 * Prefixes every internal URL and records what was applied. Absolute URLs
 * (canonical, og:url), fragments, tel: and mailto: links are left alone.
 *
 * Must run on a document that is entirely canonical — see the build loop,
 * which strips before stitching for exactly that reason.
 */
function addBase(html) {
  if (!BASE) return html;
  return (
    html.replace(new RegExp(`(${URL_ATTR})/(?!/)`, "g"), `$1${BASE}/`) +
    `\n<!-- built-with-base:${BASE} -->`
  );
}

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
    // Optional override for the <title> tag where the H1 is too long to serve
    // as one. See buildTitle() in scripts/seo.mjs.
    titleTag: item.titleTag || "",
    description: item.description || "",
    placeholder: item.placeholder === true,
    draft: item.draft === true,
    noindex: item.noindex === true,
    section,
  });
}

for (const top of nav.primary) {
  addRoute(top, top.label);
  for (const child of top.children || []) addRoute(child, top.label);
}
for (const item of nav.legal) addRoute(item, "Legal");
// Routes that exist but are deliberately absent from the navigation.
for (const item of nav.utility || []) addRoute(item, "Site");

/* ---- phone --------------------------------------------------------------
 * The number is live everywhere once `tel` is set. It stays conditional
 * because the failure mode it guards against is real: a placeholder number
 * that actually dials reaches a stranger, so an unset number renders as inert
 * text rather than a link.
 * ------------------------------------------------------------------------ */

const hasPhone = Boolean(site.phone.tel);
const telHref = `tel:${esc(site.phone.tel)}`;

const phoneHeader = hasPhone
  ? `<a class="header-phone" href="${telHref}">
          <span class="header-phone-label">Call 24/7</span>
          <span class="header-phone-number">${esc(site.phone.display)}</span>
        </a>`
  : `<span class="header-phone">
          <span class="header-phone-label">Call now</span>
          <span class="header-phone-number">${esc(site.phone.display)}</span>
        </span>`;

const phoneMobile = hasPhone
  ? `<a class="btn btn-secondary btn-block" href="${telHref}" style="margin-bottom:.75rem">Call ${esc(site.phone.display)}</a>`
  : `<p class="text-meta" style="margin-bottom:.75rem">Call ${esc(site.phone.display)}</p>`;

const phoneCallButton = hasPhone
  ? `<a class="btn btn-primary" href="${telHref}">Call</a>`
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
        // A stale source used to render a heading with nothing under it, which
        // is easy to miss. Renaming a section should break the build instead.
        if (!parent?.children?.length) {
          console.error(
            `\n  Footer column "${col.heading}" points at "${col.source}", which is not a\n` +
              `  primary nav item with children. Fix data/nav.json.\n`
          );
          process.exit(1);
        }
        items = parent.children;
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

/* The office address, written the one way it is written everywhere. `state` is
   pre-filled with "FL", so joining blindly would render a bare "FL" and make an
   empty address look populated — the city is what Fla. Bar Rule 4-7.12 actually
   requires, so it gates the whole thing. */
const officeLines = site.office.city
  ? [site.office.street, `${site.office.city}, ${site.office.state} ${site.office.zip}`.trim()]
  : [];
const officeOneLine = officeLines.join(", ");

function renderFooterFacts() {
  return [
    fact("Responsible attorney", site.attorney.name),
    fact("Phone", hasPhone ? site.phone.display : "", { href: `tel:${site.phone.tel}` }),
    fact("Email", site.email.display, { href: `mailto:${site.email.display}` }),
    fact("Office", officeOneLine),
    fact("Consultation", site.availability.consultation),
    fact("Telephone availability", site.availability.phone),
  ].join("\n");
}

/* ---- firm identification -------------------------------------------------
 * Fla. Bar Rule 4-7.12: the name of the lawyer or firm responsible for the
 * content, and the city of at least one bona fide office. Generated in one
 * place so it cannot drift between 48 pages, and so the address is byte-for-byte
 * identical everywhere it appears.
 * ------------------------------------------------------------------------ */

function renderFirmIdentity() {
  const address = officeLines.length
    ? `        <p class="firm-identity-address">
${officeLines.map((l) => `          ${esc(l)}<br>`).join("\n").replace(/<br>$/, "")}
        </p>`
    : "";

  const phone = hasPhone
    ? `<a href="${telHref}">${esc(site.phone.display)}</a>`
    : esc(site.phone.display);

  return `      <p class="firm-identity-name">${esc(site.firmLegalName)}</p>
      <p class="firm-identity-note">${esc(site.disclosure)}</p>
${address}
      <p class="firm-identity-line">Attorney ${esc(site.attorney.name)}</p>
      <p class="firm-identity-line">Phone: ${phone}</p>
      <p class="firm-identity-line">Email: <a href="mailto:${esc(site.email.display)}">${esc(site.email.display)}</a></p>
      <p class="firm-identity-line">${esc(site.availability.consultation)}s</p>
      <p class="firm-identity-line">${esc(site.availability.phone)}</p>`;
}

/* ---- contact block --------------------------------------------------------
 * The same details in running-page form, for the contact and attorney pages.
 * ------------------------------------------------------------------------ */

function renderContactDetails() {
  const address = officeLines
    .map((l) => `          ${esc(l)}<br>`)
    .join("\n")
    .replace(/<br>$/, "");

  return `      <div class="contact-details">
        <div class="contact-detail">
          <p class="contact-detail-label">Telephone</p>
          <p class="contact-detail-value">
            ${hasPhone ? `<a href="${telHref}">${esc(site.phone.display)}</a>` : esc(site.phone.display)}
          </p>
        </div>
        <div class="contact-detail">
          <p class="contact-detail-label">Email</p>
          <p class="contact-detail-value">
            <a href="mailto:${esc(site.email.display)}">${esc(site.email.display)}</a>
          </p>
        </div>
        <div class="contact-detail">
          <p class="contact-detail-label">Office</p>
          <p class="contact-detail-value">
${address}
          </p>
        </div>
        <div class="contact-detail">
          <p class="contact-detail-label">Consultation availability</p>
          <p class="contact-detail-value">
            ${esc(site.availability.consultation)}s<br>
            ${esc(site.availability.phone)}
          </p>
        </div>
      </div>`;
}

/* ---- breadcrumbs --------------------------------------------------------- */

/**
 * The route's trail through the navigation. Used for both the visible
 * breadcrumbs and the BreadcrumbList node in the head's schema graph, so the
 * two describe the same path by construction.
 */
function crumbsFor(route) {
  if (route.href === "/") return [];
  const crumbs = [{ label: "Home", href: "/" }];
  const parent = nav.primary.find(
    (p) => p.href !== "/" && p.href !== route.href && route.href.startsWith(p.href)
  );
  if (parent) crumbs.push({ label: parent.label, href: parent.href });
  crumbs.push({ label: route.label || route.title, href: route.href });
  return crumbs;
}

function renderBreadcrumbs(route) {
  const crumbs = crumbsFor(route);
  if (!crumbs.length) return "";

  const items = crumbs
    .slice(0, -1)
    .map((c) => `          <li class="breadcrumb-item"><a href="${c.href}">${esc(c.label)}</a></li>`)
    .join("\n");
  const current = crumbs[crumbs.length - 1].label;

  return `      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <ol>
${items}
          <li class="breadcrumb-item"><span class="breadcrumb-current" aria-current="page">${esc(current)}</span></li>
        </ol>
      </nav>`;
}

/* ---- county service area -------------------------------------------------
 * A county page describes a place the firm practises in. It is not an office
 * and must never read as one: there is one office, in Dania Beach, and it is
 * stated on every page by the footer.
 *
 * The machine-readable side of this lives entirely on the single organisation
 * node in the schema graph — one LegalService, one address, areaServed listing
 * Florida and the three primary counties. No county page emits an organisation,
 * a LocalBusiness or an address of its own. A per-county business entity is how
 * a location page becomes a doorway page, and how a firm ends up asserting an
 * office it does not have.
 *
 * What a county page does carry is this visible statement, generated so the
 * wording is identical across all six and cannot drift into a claim.
 * ------------------------------------------------------------------------ */

function renderLocationServiceArea(route) {
  const county = locations.counties.find((c) => route.href === `/locations/${c.slug}/`);
  if (!county) return "";

  const primary = (site.servedCounties || []).includes(county.slug);
  const body = primary ? site.serviceArea.statement : site.serviceArea.outsidePrimary;

  return `      <!-- Generated from site.serviceArea. Structured data for the service area
           lives on the one organisation node in the head; this page asserts no
           business entity and no address of its own. -->
      <div class="callout" style="margin-top:1.5rem">
        <svg class="callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.686 7-11a7 7 0 10-14 0c0 5.314 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
        <div>
          <p class="callout-title">${primary ? "Primary service area" : "No office in this county"}</p>
          <p>${esc(body)}</p>
        </div>
      </div>`;
}

/* ---- table of contents --------------------------------------------------
 * Generated from the page's own headings rather than hand-written, so a
 * renamed or reordered section can never leave a stale entry behind. Only
 * headings explicitly marked `data-toc` are collected, which keeps the
 * headings inside generated regions (the CTA, the footer) out of it.
 * ------------------------------------------------------------------------ */

function renderToc(html) {
  const items = [];
  for (const [, attrs, inner] of html.matchAll(/<h2([^>]*)>([\s\S]*?)<\/h2>/g)) {
    if (!/\bdata-toc\b/.test(attrs)) continue;
    const id = /id="([^"]+)"/.exec(attrs)?.[1];
    if (!id) continue;
    const text = inner.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    items.push({ id, text });
  }

  // Short pages do not need one; a two-entry contents list is just noise.
  if (items.length < 3) return "";

  const links = items
    .map((i) => `          <li><a href="#${i.id}">${esc(i.text)}</a></li>`)
    .join("\n");

  return `      <nav class="toc" aria-labelledby="toc-heading">
        <p class="toc-heading" id="toc-heading">On this page</p>
        <ol class="toc-list">
${links}
        </ol>
      </nav>`;
}

/* ---- sibling links ------------------------------------------------------
 * Every page in a cluster links to the rest of it, generated from nav.json so
 * adding a page to the section wires it into all the others automatically.
 * ------------------------------------------------------------------------ */

function renderSiblings(route) {
  const parent = nav.primary.find(
    (p) => p.children && p.href !== "/" && route.href.startsWith(p.href)
  );
  if (!parent) return "";

  const seen = new Set([route.href]);
  const items = [];
  for (const child of parent.children) {
    if (seen.has(child.href)) continue;
    seen.add(child.href);
    items.push(child);
  }
  if (!items.length) return "";

  const cards = items
    .map(
      (i) => `        <li>
          <a class="related-item" href="${i.href}">
            <span class="related-item-title">${esc(i.label)}</span>
            <svg class="related-item-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4"/></svg>
          </a>
        </li>`
    )
    .join("\n");

  return `    <nav class="related" aria-labelledby="related-heading">
      <p class="related-heading" id="related-heading">More on ${esc(parent.label.toLowerCase())}</p>
      <ul class="related-list">
${cards}
      </ul>
    </nav>`;
}

/* ---- analytics -----------------------------------------------------------
 * The standard GA4 tag, emitted into the shared head so every route carries it
 * — the six county pages included — without a page ever holding a copy.
 *
 * Clearing site.analytics.measurementId removes it everywhere on the next
 * build, and js/main.js checks for gtag before firing, so the event calls
 * become no-ops rather than errors when the tag is absent or blocked.
 *
 * `anonymize_ip` is not set: GA4 discards the full IP before storage as a
 * matter of course, and the parameter is ignored. Passing it would only
 * suggest a control that is not doing anything.
 * ------------------------------------------------------------------------ */

function renderAnalytics() {
  const id = site.analytics?.measurementId;
  if (!id) return "<!-- Analytics disabled: no measurementId in data/site.json. -->";

  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(id)}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${esc(id)}');
</script>`;
}

/* ---- form opening tag ----------------------------------------------------
 * The whole <form> tag is generated, not just its action attribute.
 *
 * The earlier version put the managed region *inside* the tag:
 *
 *     <form class="stack" data-validate novalidate<!-- @include:form-action -->
 *     <!-- @end:form-action -->>
 *
 * An HTML comment is never valid inside a start tag. A browser parses that as
 * three bogus attributes — `novalidate<!--`, `@include:form-action`, `--` —
 * closes the tag at the comment's own `>`, and renders the trailing `>` as a
 * stray character above the first field. Three things followed from that, in
 * increasing order of seriousness: a visible `>` on both intake pages;
 * `novalidate` never applied, so the browser's native bubbles competed with the
 * accessible inline errors; and — the reason this had to be fixed now — the
 * moment `formEndpoint` was set, `action` and `method` would have been written
 * inside the comment and silently ignored, posting a prospective client's case
 * details back to the page they were typed on.
 * ------------------------------------------------------------------------ */

/* A stable name per form, so analytics can tell the three apart without
   inferring anything from the URL. */
const FORM_NAMES = {
  "/": "homepage_consultation",
  "/contact/": "contact",
  "/probation-eligibility-assessment/": "eligibility_assessment",
};

function renderFormOpen(route) {
  const action = site.formEndpoint
    ? ` action="${esc(site.formEndpoint)}" method="post"`
    : "";
  const name = FORM_NAMES[route.href] || "form";
  return `      <form class="stack form-stack" data-validate novalidate data-form-name="${esc(name)}"${action}>`;
}

/* ---- form submit control ------------------------------------------------
 * No submission endpoint is configured, and this build will not invent one.
 * Rather than render a button that silently discards a prospective client's
 * case details, the control is replaced by a notice and a route to the phone.
 * Setting site.formEndpoint flips it to a live submit on the next build.
 * ------------------------------------------------------------------------ */

/* Each form asks for something different, so the button says what pressing it
   does. Keyed on route rather than passed in from the page, because the page
   cannot reach into a generated region. */
const SUBMIT_LABELS = {
  "/": "Request My Free Consultation",
  "/contact/": "Send Message",
  "/probation-eligibility-assessment/": "Send for Attorney Review",
};

function renderFormSubmit(route) {
  if (!site.formEndpoint) {
    // TODO: no submission endpoint is configured and none is invented here.
    // Set site.formEndpoint in data/site.json to a real endpoint and this
    // notice is replaced by a working submit control on the next build.
    const call = hasPhone
      ? `<a href="${telHref}">${esc(site.phone.display)}</a>`
      : esc(site.phone.display);
    return `        <div class="form-unavailable">
          <svg class="callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4M12 17h.01"/></svg>
          <div>
            <p class="callout-title">This form is not connected yet</p>
            <p>
              Online submission is not live on this site, so nothing typed above
              would reach ${esc(site.firm)}. We would rather tell you that than
              take your case details and lose them. Call ${call} — telephone
              enquiries are accepted 24/7 — or email
              <a href="mailto:${esc(site.email.display)}">${esc(site.email.display)}</a>.
            </p>
          </div>
        </div>`;
  }
  /* The redirect target rides with the submission so the visitor lands on
     /thank-you/ rather than on whatever the endpoint renders.

     It is written as the production URL, which is correct once the site is on
     its own domain. On a preview deploy that URL is not live yet, so js/main.js
     rewrites this to the origin actually being browsed before the POST — the
     path is carried in data-redirect-path for it to use. With JavaScript off,
     the production URL stands, which is the right fallback. */
  const redirect = site.formRedirect
    ? `        <input type="hidden" name="${esc(site.formRedirectField || "_next")}"
               value="${esc(site.url.replace(/\/$/, "") + site.formRedirect)}"
               data-redirect-path="${esc(site.formRedirect)}"
               data-redirect-base="${esc(BASE)}">\n`
    : "";

  /* Identifies the enquiry in the firm's inbox. Without it every notification
     arrives with the form service's generic subject. */
  const subject = site.formSubject
    ? `        <input type="hidden" name="_subject" value="${esc(site.formSubject)}">\n`
    : "";

  const label = SUBMIT_LABELS[route.href] || "Send for review";

  return `${subject}${redirect}        <button class="btn btn-primary btn-lg btn-block" type="submit">${esc(label)}</button>`;
}

/* ---- HTML sitemap -------------------------------------------------------- */

function renderSitemap() {
  const sections = nav.primary
    .filter((p) => p.children)
    .map((p) => {
      const links = p.children
        .map((c) => {
          /* Seven sections each labelled their index "Overview" reads fine
             under its heading and uselessly in a screen reader's list of
             links, where the headings are gone. The section name is right
             here, so qualify it. */
          const label = c.href === p.href ? `${p.label} overview` : c.label;
          return `          <li><a class="btn-link" href="${c.href}">${esc(label)}</a></li>`;
        })
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
  const titleTag = buildTitle({ route, site });

  return {
    site: { ...site, attributionLine: site.disclosure },
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
      // `noindex` is permanent (a thank-you page should never be indexed, even
      // once the site is live); placeholder and draft are temporary gates.
      robots:
        route.noindex || route.placeholder || route.draft
          ? '<meta name="robots" content="noindex, follow">'
          : '<meta name="robots" content="index, follow">',
    },
    nav: { desktop: renderDesktopNav(route.href), mobile: renderMobileNav(route.href) },
    footer: { columns: renderFooterColumns(), facts: renderFooterFacts() },
    phone: { header: phoneHeader, mobile: phoneMobile, callButton: phoneCallButton },
  };
}

function regionsFor(route, ctx, source) {
  // Schema depends on the page's own markup (FAQs are read from it), so it is
  // built here where the canonical source is available and injected into head.
  const schema = buildSchema({
    site,
    route: { ...route, crumbs: crumbsFor(route) },
    source,
    origin: site.url.replace(/\/$/, ""),
  });
  const ctxWithSchema = {
    ...ctx,
    page: { ...ctx.page, schema, analytics: renderAnalytics() },
  };

  return {
    head: render(partials.head, ctxWithSchema),
    header: render(partials.header, ctx),
    footer: render(partials.footer, ctx),
    "call-bar": render(partials["call-bar"], ctx),
    cta: render(partials.cta, ctx),
    "page-disclaimer": render(partials["page-disclaimer"], ctx),
    breadcrumbs: renderBreadcrumbs(route),
    // Depend on the page's own content, so they are derived from `source`.
    toc: renderToc(source),
    siblings: renderSiblings(route),
    "location-service-area": renderLocationServiceArea(route),
    "firm-identity": renderFirmIdentity(),
    "contact-details": renderContactDetails(),
    "form-submit": renderFormSubmit(route),
    "form-open": renderFormOpen(route),
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
  interior: read("templates/interior.html"),
  location: read("templates/location.html"),
};

/**
 * The HTML sitemap carries a generated listing, so it needs its own shell.
 * Content pages inside a nav section use the interior template — contents,
 * cluster links, CTA and disclaimer — rather than the bare placeholder shell.
 */
const templateFor = (route) => {
  if (route.href === "/sitemap/") return templates.sitemap;
  // County pages carry sections the generic interior template does not.
  if (/^\/locations\/.+\//.test(route.href)) return templates.location;
  const inCluster = nav.primary.some(
    (p) => p.children && p.href !== "/" && route.href.startsWith(p.href)
  );
  return inCluster ? templates.interior : templates.page;
};

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

  // Return the page to canonical URLs *before* stitching. Generated regions are
  // always emitted canonical, so stitching first would leave the document half
  // based and half not, and the strip would then corrupt the generated half.
  const canonical = stripBase(source);
  const next = addBase(stitch(canonical, regionsFor(route, ctx, canonical)));

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

const indexable = [...routes.values()].filter(
  (r) => !r.placeholder && !r.draft && !r.noindex
);

const origin = site.url.replace(/\/$/, "");

if (!CHECK) {
  writeFileSync(join(ROOT, "sitemap.xml"), buildSitemap({ origin, routes: indexable }));

  writeFileSync(
    join(ROOT, "robots.txt"),
    buildRobotsTxt({ site, origin, indexableCount: indexable.length })
  );

  /* Redirects for the URL changes made during the build, written twice from
     one source because hosts disagree about the format.

     `_redirects` is Netlify/Cloudflare. `.htaccess` is Apache and LiteSpeed,
     which is what the site is actually served by — so that is the file that
     does the work today, and it also gives the custom 404 page somewhere to
     be announced. Neither host reads the other's file, so both being present
     is harmless. */
  const redirects = readJSON("data/redirects.json");

  writeFileSync(
    join(ROOT, "_redirects"),
    `# Generated by scripts/build.mjs from data/redirects.json — do not edit.\n` +
      `# ${redirects._note}\n\n` +
      redirects.rules.map((r) => `${r.from.padEnd(52)} ${r.to} 301`).join("\n") +
      "\n"
  );

  /* Netlify's splat syntax has to be translated: `/old/*` -> `/new/:splat`
     becomes a RedirectMatch with a capture group. First match wins in Apache
     exactly as it does in Netlify, so the ordering in data/redirects.json —
     specific rules above the wildcard that shares their prefix — carries over
     unchanged. */
  const htaccessRules = redirects.rules.map((r) => {
    if (r.from.endsWith("/*")) {
      const prefix = r.from.slice(0, -1); // keep the trailing slash
      const target = r.to.replace(":splat", "$1");
      return `RedirectMatch 301 ^${prefix}(.*)$ ${target}`;
    }
    return `Redirect 301 ${r.from} ${r.to}`;
  });

  writeFileSync(
    join(ROOT, ".htaccess"),
    [
      "# Generated by scripts/build.mjs from data/redirects.json — do not edit.",
      "# Apache and LiteSpeed read this file; Netlify and Cloudflare read",
      "# _redirects instead. Both are written so a move between hosts does not",
      "# silently drop the redirect map.",
      "",
      "# Serve the site's own 404 page rather than the host's default. Without",
      "# this, a mistyped URL gets a generic error page with no way back.",
      "ErrorDocument 404 /404.html",
      "",
      "# No directory listings: a URL that resolves to a folder without an",
      "# index should 404, not enumerate what is in it.",
      "Options -Indexes",
      "",
      "# URL changes made while the site was being built.",
      ...htaccessRules,
      "",
    ].join("\n")
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
  console.log(
    BASE
      ? `  Base path: ${BASE} — internal links are prefixed for a sub-directory deploy.`
      : `  Base path: none — internal links are root-relative (own-domain deploy).`
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
