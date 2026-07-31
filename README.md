# FloridaProbationLaw.com

Static site for Hoffman Legal. Hand-authored HTML styled with Tailwind CSS —
no framework, no component runtime, no hydration.

Full build plan: [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)

## Status

Stage 1 of 7 — **global design system**. Page templates and site content
have not been built yet.

## Getting started

```bash
npm install
npm run build     # compile CSS + verify colour contrast
npm run dev       # rebuild CSS on change
```

| Script | What it does |
| --- | --- |
| `npm run build` | `build:css` then `check:contrast` |
| `npm run build:css` | Tailwind CLI → `css/styles.css`, minified |
| `npm run dev` | Same, in watch mode |
| `npm run check:contrast` | Verifies every colour pair against WCAG 2.2 AA |

### Viewing pages locally

Serve over HTTP rather than opening files directly — browsers block
`@font-face` requests over `file://`, so the self-hosted fonts silently fall
back to system defaults:

```bash
python3 -m http.server 8000
# then open http://127.0.0.1:8000/styleguide/
```

## Layout

```
src/input.css     design tokens + component classes — the source of truth
css/styles.css    generated and committed, so the site renders with no tooling
fonts/            self-hosted, latin subset (92 KB total)
styleguide/       every reusable style, rendered. noindex, not part of the site
scripts/          build-time checks
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
