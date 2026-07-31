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

All 43 routes exist and resolve. 23 are still empty placeholders; 19 have
content but are `draft`, awaiting review by a Florida attorney. Every page
currently carries `noindex` — see [Publishing gates](#publishing-gates).

## Getting started

```bash
npm install
npm run build     # assemble pages, compile CSS, run checks
npm run serve     # http://127.0.0.1:8000
```

| Script | What it does |
| --- | --- |
| `npm run build` | Full build: HTML, CSS, then both checks |
| `npm run build:html` | Stitch shared regions, scaffold new routes, write `sitemap.xml` |
| `npm run build:css` | Tailwind CLI → `css/styles.css`, minified |
| `npm run dev` | CSS in watch mode |
| `npm run check` | CI gate: pages in sync with partials, contrast passes |
| `npm run check:contrast` | Every colour pair against WCAG 2.2 AA |
| `npm run check:placeholders` | Reports outstanding firm details and empty routes |
| `npm run check:launch` | Same, but **fails** — run before going live |
| `npm run serve` | Preview server, mounted at the configured base path |

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
partials/         shared chrome: head, header, footer, call bar
templates/        scaffolds for newly created pages
src/input.css     design tokens + component classes — the styling source of truth
css/styles.css    generated and committed, so the site renders with no tooling
js/main.js        ~2 KB: mobile panel, desktop dropdowns. Enhancement only
fonts/            self-hosted, latin subset (92 KB total)
styleguide/       every reusable style, rendered. noindex, not part of the site
scripts/          build and pre-launch checks
docs/             implementation plan
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
