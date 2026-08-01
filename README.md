# FloridaProbationLaw.com

Static site for Hoffman Legal. Hand-authored HTML styled with Tailwind CSS —
no framework, no component runtime, no hydration.

Full build plan: [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)

## Status

Design system, shared shell (header, navigation, footer, mobile call bar),
homepage, and three written content clusters:

| Cluster | Pages |
| --- | --- |
| `/early-termination-of-probation/` | 6 |
| `/probation-termination-process/` | 6 |
| `/florida-probation-law/` | 6 |
| `/probation-services/` | 8 |
| `/locations/` | 7 |
| `/about/`, `/resources/`, `/blog/`, contact, forms, legal | 13 |

**All 48 routes now have written content.** None are empty placeholders; all
are `draft`, awaiting review by a Florida attorney, so every page carries
`noindex` — see [Publishing gates](#publishing-gates).

## Forms

Two intake forms: a short one on `/contact/` and the full
`/probation-eligibility-assessment/`.

**Neither is connected to anything.** `site.formEndpoint` is empty because no
submission service is configured, and the build will not invent one. While it
is empty the submit control is replaced by a visible notice explaining that
nothing typed would reach the firm — a form that silently discards a
prospective client's case details is worse than one that says it is not ready.
Setting `formEndpoint` flips both forms to a live submit on the next build.

A successful submission is routed to `/thank-you/` by a hidden field carrying
`site.formRedirect`, emitted only alongside a real endpoint. `formRedirectField`
is the parameter name the endpoint reads — `_next` suits Formspree and Basin;
set it to whatever a first-party endpoint expects, or the visitor lands on the
endpoint's own response page instead. `/thank-you/` is permanently `noindex`,
independent of the draft gate.

Validation in `js/main.js` is progressive enhancement: it sets `aria-invalid`,
renders inline errors tied to each field, and focuses a summary of failures.
Every rule must also be enforced server-side when an endpoint is added —
client-side checks stop honest mistakes and nothing else.

Spam handling follows the same logic. The honeypot and the elapsed-time field
are recorded for a server to weigh; the client blocks only on the honeypot. A
bot that POSTs directly never runs this script, so blocking client-side on
elapsed time would only ever penalise fast humans.

## Location pages

County pages are the easiest thing on a legal site to get wrong. Two rules are
enforced rather than trusted:

- **No local detail is invented.** Courthouse names and addresses, judges,
  division assignments, filing procedures and hearing schedules appear nowhere
  in `data/locations.json` and nowhere on a county page. Each page carries a
  marked placeholder block and a `LOCAL VERIFICATION REQUIRED` source comment.
  Only stable public facts — circuit, county seat, which counties share the
  circuit, which counties border it — are recorded, and those are what make
  each page genuinely different.
- **`areaServed` structured data is gated.** A county page emits it only if the
  county slug appears in `site.servedCounties`, which is empty. Asserting a
  service area the firm has not confirmed is both a Rule 4-7.13 problem and the
  signal that turns a location page into a doorway page.

`templates/location.html` documents the required section order and carries
both rules as comments for whoever adds the next county.

## Getting started

```bash
npm install
npm run build     # assemble pages, compile CSS, run checks
npm run serve     # http://127.0.0.1:8000
```

| Script | What it does |
| --- | --- |
| `npm run build` | Full build: HTML, CSS, then every check |
| `npm run build:html` | Stitch shared regions, scaffold new routes, write `sitemap.xml`, `robots.txt`, `_redirects` |
| `npm run build:css` | Tailwind CLI → `css/styles.css`, minified |
| `npm run build:production` | Same, with no base path — for the site's own domain |
| `npm run dev` | CSS in watch mode |
| `npm run check` | CI gate: lint, sync, contrast, SEO, links, content |
| `npm run lint` | Scripts parse, data keys present, managed regions balanced |
| `npm run check:contrast` | Every colour pair against WCAG 2.2 AA |
| `npm run check:seo` | Metadata, structured data and page semantics |
| `npm run check:links` | Internal linking: broken links, orphans, type coverage |
| `npm run check:content` | Bar-rule content compliance and doorway-page overlap |
| `npm run check:placeholders` | Reports outstanding firm details and empty routes |
| `npm run check:launch` | Same, but **fails** — run before going live |
| `npm run audit` | Responsive + accessibility, in a real browser (needs `npm run serve`) |
| `npm run serve` | Preview server, mounted at the configured base path |

The `audit:*` scripts drive Chromium through Playwright and are opt-in: they
need a preview server running and a browser installed
(`npx playwright install chromium`). Everything in `check` and `build` is
dependency-free Node and runs anywhere.

Serve over HTTP rather than opening files directly — browsers block
`@font-face` over `file://`. Use `npm run serve` rather than a plain static
server, so the site is served under the same base path it was built for.

## Where the site is served from

Pages are authored with root-relative URLs (`/contact/`), which is what a site
on its own domain wants. A **GitHub Pages project site** is served from
`<user>.github.io/<repo>/` instead, so those URLs resolve to the domain root
and 404 — including the stylesheet, which is why an unbased build renders as
raw unstyled HTML.

`data/site.json` therefore carries a `basePath`, applied to every internal
`href` and `src` at build time:

| Deploy target | `basePath` |
| --- | --- |
| GitHub Pages project site (current) | `/florida-probation-law` |
| floridaprobationlaw.com, or Pages with a `CNAME` | `""` |

Change it and re-run `npm run build`; the rewrite is idempotent, so switching
back and forth converges rather than stacking prefixes. A one-off build can
override it: `BASE_PATH= npm run build`.

Each built page ends with a `<!-- built-with-base:… -->` marker recording the
prefix that was applied. The build strips exactly one occurrence of that
recorded prefix before re-applying, which is what makes the round trip safe
when a **route's own path begins with the base string** — `/florida-probation-law/`
is exactly that case here. Two consequences worth knowing:

- Never hand-edit those markers, and never apply a bulk find-and-replace to
  URLs in built pages. Change `data/nav.json` and rebuild instead.
- Generated regions are always emitted with canonical URLs, so the build
  strips *before* stitching. Doing it the other way round leaves a document
  half-based and corrupts the generated half.

Canonical and `og:url` are absolute and always use `url` from `site.json`, so
a preview deploy never canonicalises to itself.

## How pages are assembled

There is no template engine, so shared chrome would otherwise be copy-pasted
into 37 files and drift apart — and the footer carries Bar-required firm
identification, which makes drift a compliance problem rather than a cosmetic
one. Instead, each page marks regions the build owns:

```html
<!-- @include:header -->  …generated…  <!-- @end:header -->
```

`npm run build:html` rewrites those regions from `partials/`. Everything
outside them is hand-authored and never touched. `npm run check` re-runs the
stitcher and fails if any page has drifted, so a hand-edit to generated chrome
cannot ship.

**Adding a route:** add it to `data/nav.json` and run the build. The page file
is scaffolded, and the header, mobile menu, footer and sitemap all pick it up —
there is no second place to update.

### Managed regions

| Region | Filled with |
| --- | --- |
| `head` `header` `footer` `call-bar` | The matching file in `partials/` |
| `cta` `page-disclaimer` | Shared consultation CTA and legal disclaimer |
| `breadcrumbs` | Derived from the route's position in `nav.json` |
| `siblings` | Links to every other page in the same nav section |
| `toc` | The page's own `<h2 … data-toc>` headings; omitted below three |

`toc` and `siblings` are why cluster pages stay wired together: rename a
heading and the contents list follows it, add a page to a section and every
sibling links to it on the next build.

### Publishing gates

A route in `nav.json` may carry either flag, and both force `noindex` and
exclusion from `sitemap.xml`:

- `placeholder` — the page has no content yet. 37 thin pages indexed would be
  a liability for a new domain, not an asset.
- `draft` — the page is written but no Florida attorney has reviewed it.
  Unreviewed legal content on a YMYL site is worse than no content.

Remove the flag to publish. `npm run check:launch` fails while any remain.

## SEO and structured data

No page carries a hand-written meta tag or a hand-written JSON-LD block.
`scripts/seo.mjs` generates all of it from the route record in `data/nav.json`
and injects it through `partials/head.html`, which means a page cannot disagree
with its own metadata.

Every page gets: `<title>`, meta description, absolute canonical, robots
directive, five Open Graph tags, three Twitter tags, and one JSON-LD `@graph`.

### What the schema asserts

The graph is deliberately small, because every node is a claim someone could
rely on:

| Node | Emitted |
| --- | --- |
| `LegalService` | Always — one organisation, `@id`-referenced from every page |
| `WebSite` | Always |
| `WebPage` | Always, linked to its `BreadcrumbList` |
| `BreadcrumbList` | Every page except the homepage |
| `FAQPage` | Only where the page has two or more real `<details class="faq-item">` blocks |
| `Attorney` | Only once `site.attorney.name` is filled in |
| `Article` | Blog posts only, and without an `author` until a real one exists |

And what is never emitted, enforced by `check:seo`:

- **No `review` or `aggregateRating`.** There are no verified reviews to cite.
- **No `address` or `telephone`** while those are placeholders in `site.json` —
  a consumer would treat a placeholder as real.
- **No `LocalBusiness`, anywhere.** In particular, a county page emits the same
  root-level `LegalService` every other page does. It does not describe a local
  office, because there isn't one. County `areaServed` is separately gated on
  `site.servedCounties` (see [Location pages](#location-pages)).
- **No FAQ that isn't on the page.** FAQ entries are parsed out of the page's
  own rendered markup, so marking marketing copy as an FAQ is not possible by
  construction, and schema drifting from visible content is not either.

### Titles

A page's `<h1>` and its `<title>` serve different surfaces. Appending
` | Florida Probation Law` costs 24 of the ~60 characters a result listing
shows, which pushed the descriptive titles this site depends on past the limit.
`buildTitle()` adds the brand suffix only when the result still fits, and drops
it otherwise — the brand is the least valuable part of a title. A route may set
`titleTag` in `nav.json` to override both; the homepage does.

### Generated files

| File | Notes |
| --- | --- |
| `sitemap.xml` | Publishable routes only. Currently none, so it carries an explanatory comment rather than a bare `urlset`. |
| `robots.txt` | Crawling stays **allowed** while everything is `noindex` — a crawler has to fetch a page to read that directive, so disallowing here would leave pages indexable on inbound links alone. `/styleguide/` is disallowed. |
| `_redirects` | Generated from `data/redirects.json`, in Netlify/Cloudflare format. **GitHub Pages ignores it.** Acceptable only because nothing was ever indexed; specific rules must stay above their wildcards, since first match wins. |

Both `robots.txt` and `sitemap.xml` are written to the repository root, which
serves them at the domain root on the production host. On the current GitHub
Pages project deploy they sit under `/florida-probation-law/` where crawlers do
not look for them — another reason nothing should be indexed until the site
moves to its own domain.

### Internal linking

`npm run check:links` builds a link graph and fails on broken internal links,
orphaned pages, or a missing path between page types. It counts only links in
page body copy: header, footer, breadcrumbs, contents, sibling navigation and
the shared CTA are generated on every page, so counting them would score any
site 100% and prove nothing. Currently 315 contextual links across 48 pages,
with all 20 required type-to-type paths present.

Permanently-`noindex` routes are exempt from the orphan check — `/thank-you/`
is reached after a submission, not from a link.

## Quality gates

Six checks run on every build, and two audits run on demand. They exist
because this is a site nobody can eyeball in full: 48 pages × 6 viewports is
288 layouts, and a Bar-rule problem is one borrowed sentence.

| Check | What it proves |
| --- | --- |
| `lint` | Scripts parse, data files carry the keys the build reads, managed regions are balanced |
| `check:contrast` | All 39 colour pairs meet their WCAG 2.2 AA threshold |
| `check:seo` | Unique metadata, valid schema, no forbidden claims, one `h1`, no heading skips |
| `check:links` | No broken internal links, no unintended orphans, all 20 required type-to-type paths present |
| `check:content` | No guarantees, superlatives, fabricated statistics, fake credentials, testimonials, leaked placeholders, unrelated practice areas, or firm-name variants — and county pages below the doorway-page overlap threshold |
| `check:placeholders` | Lists every outstanding firm detail; `check:launch` fails on them |
| `audit:responsive` | 48 routes at 320/390/768/1024/1440/1920: no horizontal scroll, no text overflow, no oversized headings, no undersized tap targets |
| `audit:a11y` | Tab order, focus visibility against real backgrounds, menu and accordion keyboard operation, form error association, reduced-motion compliance |

`check:content` handles negation at sentence level, because pages here
legitimately say "used as a promise … it is wrong" and "be wary of a promised
timeframe". A regex that flagged those would be turned off within a week. The
styleguide is exempt from the copy rules and not from the identity rules: its
job is to render the empty states, including the testimonial placeholder that
exists so no fake one is ever needed.

### Content-review markers

Statements that need verification against current Florida law carry a source
comment beginning `CONTENT REVIEW —`, naming what to confirm. Find them with:

```bash
grep -rn "CONTENT REVIEW" --include=*.html .
```

Where the uncertainty affects what a reader might rely on, it is also stated
on the page in a `.review-notice` block rather than left in the source.

## Layout

```
data/site.json    firm details — one source of truth, seeded with TODOs
data/nav.json     site structure; drives nav, footer, sitemap, page scaffolding
data/redirects.json  URL changes made during the build → _redirects
partials/         shared chrome: head, header, footer, call bar
templates/        scaffolds for newly created pages
src/input.css     design tokens + component classes — the styling source of truth
css/styles.css    generated and committed, so the site renders with no tooling
js/main.js        ~2 KB: mobile panel, desktop dropdowns. Enhancement only
fonts/            self-hosted, latin subset (92 KB total)
styleguide/       every reusable style, rendered. noindex, not part of the site
scripts/          build, quality gates, and the two browser audits
docs/             implementation plan, launch checklist
```

`css/styles.css` is generated. Edit `src/input.css` and rebuild — never edit
the compiled file.

## Design system

Two typefaces: **Source Serif 4** for headings, **Inter** for body. Colour is
navy (authority) and azure (interaction) on a predominantly white page, with
teal reserved for small accents. Navy surfaces are for compact CTA bands and
the footer only.

Reusable classes cover containers, section spacing, headings, paragraphs,
buttons, cards, badges, form fields, breadcrumbs, FAQ accordions, testimonial
placeholders, callout panels, location cards, and disclaimer boxes. The
[styleguide](styleguide/index.html) renders all of them.

### Accessibility

Targeting WCAG 2.2 AA. `npm run check:contrast` parses the tokens out of
`src/input.css` and fails the build if any pair drops below its threshold —
4.5:1 for text, 3:1 for UI boundaries and focus indicators. All 39 pairs
currently pass.

Interactive controls are at least 44 px tall, focus is always visible,
accordions are native `<details>` elements, and the whole system works with
JavaScript disabled.

`npm run audit:a11y` verifies the parts a stylesheet cannot: that Tab reaches
what it should, that the focus ring clears 3:1 against whatever it actually
lands on (azure on the white page, a lighter ring inside navy sections), that
the dropdowns and the mobile panel respond to Enter and Escape and return
focus, that the FAQ accordions still toggle with JavaScript switched off, and
that a failed form submit marks each field `aria-invalid` and points
`aria-describedby` at its message — the live region announces the error as it
appears, but a field reached later has to describe itself.

The comparison table on `/florida-probation-law/948-04-vs-948-05/` scrolls
horizontally on a phone, so it carries `tabindex="0"` and `role="region"` with
its caption as the accessible name. A scrollable box that is not focusable can
be reached by a mouse and a finger and by nothing else (SC 2.1.1).

## Ground rules

Two constraints shape the code, not just the content:

1. **Nothing is invented.** No case results, testimonials, reviews, awards,
   ratings, or attorney credentials get placeholder values. Testimonial slots
   render as visible empty states until real, attributable content exists.
2. **Attorney advertising rules apply.** The site is regulated under Florida
   Bar Rules 4-7.11–4-7.22. Firm identification, bona fide office disclosure,
   and disclaimers are structural requirements, and all legal content needs
   named attorney review before publication.

## Pending

Real firm data is required before any page ships: legal entity name, office
address, phone, attorney names and Bar numbers, and the counties the firm
actually serves.
