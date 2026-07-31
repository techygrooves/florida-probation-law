# FloridaProbationLaw.com

Static site for Hoffman Legal. Hand-authored HTML styled with Tailwind CSS —
no framework, no component runtime, no hydration.

Full build plan: [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)

## Status

Stages 1–2 of 7 — **design system** and the **shared shell** (header,
navigation, footer, mobile call bar). All 37 routes exist and resolve, but
every one is an empty placeholder carrying `noindex`. Page content has not
been written yet.

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
| `npm run serve` | Static server on port 8000 |

Serve over HTTP rather than opening files directly. Pages use root-relative
paths, and browsers block `@font-face` over `file://`.

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
