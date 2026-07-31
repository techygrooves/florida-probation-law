# FloridaProbationLaw.com — Implementation Plan

Operated by Hoffman Legal. Status: greenfield.
Stack: **static HTML + Tailwind CSS**, entry point `index.html`, WCAG 2.2 AA.

---

## 0. Repository assessment

| Item | Finding |
| --- | --- |
| Tracked files | `README.md`, `docs/IMPLEMENTATION-PLAN.md` |
| Commits | 2, on `claude/florida-probation-law-plan-bu7wml` |
| Build tooling | None — no `package.json`, config, CI, or `.gitignore` |
| Runtime available | Node 22.22.2 / npm 10.9.7, Python 3.11.15 |

Nothing to migrate. All decisions are open.

---

## 1. Stack — and the one problem it creates

The site is hand-authored HTML styled with Tailwind. No framework, no component runtime, no hydration. Every file in the repo is a complete, openable HTML document.

That is a good fit for a content site — but at ~47 pages it has one serious failure mode, and the plan is built around solving it.

### The duplication problem

Header, nav, footer, disclaimer, and CTA markup would otherwise be copy-pasted into 47 files. Changing the firm's phone number would mean 47 edits, and the 48th file someone forgets is the one showing a dead number to a prospective client. Three ways to handle it:

| Option | Verdict |
| --- | --- |
| Hand-copy chrome into every page | Rejected — guaranteed drift, and drift on Bar-required footer text is a compliance problem, not a cosmetic one |
| Client-side `fetch()` injection of partials | Rejected — chrome invisible to crawlers without JS, breaks the no-JS baseline, adds CLS |
| **Build-time include stitching** | **Recommended** |

**Recommendation: managed regions, rewritten in place.** Shared markup lives once in `partials/`. Each page marks where it goes:

```html
<!-- @include:header --> ... generated markup ... <!-- @end:header -->
```

`npm run build` re-stitches every managed region from the partials and regenerates `sitemap.xml`. The script is ~80 lines of Node with no dependencies.

Why in place rather than the conventional `src/` → `dist/`: the repo always contains the finished, working site. Anyone can open `index.html` in a browser or hand the folder to a host with no build step, and there is no source/output confusion for a non-developer maintaining copy later. The tradeoff is that managed regions are generated — they carry a `DO NOT EDIT` comment, and edits go to `partials/`.

### Tailwind: CLI, not CDN

Use the Tailwind CLI, not `<script src="cdn.tailwindcss.com">`. The CDN build is explicitly not for production — it ships ~100KB of JS, generates styles at runtime, and causes a flash of unstyled content, which would sink the Core Web Vitals this site competes on.

```bash
npx @tailwindcss/cli -i src/input.css -o css/styles.css --minify
```

Output is a single ~12KB gzipped stylesheet. Tailwind v4 is CSS-first — design tokens live in `@theme` inside `src/input.css`, so there is no `tailwind.config.js`. **`css/styles.css` is committed**, so the site renders with zero tooling installed; the build only needs to run when styles change.

Net JS shipped to visitors: ~3KB (`js/main.js` — nav toggle, form validation). Everything works with JS disabled.

### Blocking unknowns — business facts I will not invent

Centralized in `data/site.json` and injected at build time. Seeded with visible `TODO` markers so the site builds, but **nothing ships until these are verified**:

1. Firm NAP — legal entity name, bona fide office street address, phone, email.
2. Attorney roster — names, Florida Bar numbers, admission dates, education, bio copy.
3. Counties Hoffman Legal actually practices in (gates which location pages may exist).
4. Contact form backend and destination inbox.
5. Hosting/DNS target.

**No fabricated case results, testimonials, reviews, "years of experience," client counts, or credentials.** Those slots stay empty; `scripts/check-placeholders.mjs` fails the build if a `TODO` survives to production.

### Compliance constraints

Florida Bar Rules 4-7.11–4-7.22 govern this as attorney advertising, and it is YMYL content for search. Architectural consequences:

- Responsible firm/lawyer name and bona fide office city in every footer (Rule 4-7.12) — which is exactly why the footer is a single partial, not 47 copies.
- No guarantees, outcome predictions, or "specialist"/"expert" phrasing absent verified board certification (Rules 4-7.13, 4-7.14).
- Past-results and testimonial components ship disabled until real, verifiable content plus disclaimers exist.
- Contact form must not solicit confidential detail pre-conflict-check; no-attorney-client-relationship notice sits beside the submit button.
- Every legal page carries a visible attorney review byline and `data-reviewed-by` / `data-reviewed-on` attributes; `check-seo.mjs` fails any legal page missing them.

---

## 2. Global design

Urgent, credible, plain-language. A VOP warrant is a same-day emergency — the design optimizes for "call now, on a phone, at 11pm," not brochure browsing.

- **Tokens** (`@theme` in `src/input.css`): navy/slate primary, one warm accent reserved exclusively for CTAs, 4px spacing scale, `clamp()` fluid type, two font families max, self-hosted and subset with `font-display: swap`.
- **Layout:** 1200px max width, 68ch measure for article text, mobile-first, CSS Grid via Tailwind utilities.
- **Repeated patterns** get `@apply` component classes in `input.css` (`.btn-primary`, `.card`, `.prose-legal`) so partials stay readable and utility strings don't sprawl across 47 files.
- **Conversion furniture:** phone number in the header on every page; sticky mobile click-to-call bar; CTA band closing every page.
- **Performance budget:** ~12KB CSS, ~3KB JS, LCP < 2.0s on 4G, CLS < 0.05. All images AVIF/WebP with explicit `width`/`height` and `loading="lazy"` below the fold.

**Files:** `src/input.css`, `css/styles.css`, `js/main.js`, `data/site.json`

---

## 3. Accessibility (WCAG 2.2 AA)

Called out explicitly, and it carries real ADA demand-letter exposure for law firm sites. Hand-written HTML means no framework guardrails, so this is enforced by linting and tests rather than assumed.

**Structure**
- `lang="en"` on `<html>`; landmarks `<header> <nav> <main> <footer>`; skip link as the first focusable element.
- Exactly one `<h1>` per page, no skipped heading levels — asserted in CI.

**Interaction**
- FAQ accordions use native `<details>/<summary>` — keyboard-accessible with zero JS and zero ARIA.
- Mobile nav toggle is the only scripted control: `aria-expanded`, `aria-controls`, Esc to close, focus returned to the trigger. Falls back to a `<details>` nav when JS is off.
- Visible focus on everything — `focus-visible:` rings, never a bare `outline: none`.

**WCAG 2.2 additions that specifically bite this design**
- **2.4.11 Focus Not Obscured** — the sticky call bar can cover a focused element. Mitigated with `scroll-margin-block` on anchor targets and by keeping the bar out of the tab-order path.
- **2.5.8 Target Size (24×24 CSS px)** — applies to nav links, phone links, and footer links, which trend small on mobile.
- **3.2.6 Consistent Help** — the phone number must appear in the same relative position on every page; a single header partial gives this for free.

**Forms:** every input has a real `<label for>`, hints via `aria-describedby`, errors via `aria-invalid` plus inline text in an `aria-live="polite"` region. No placeholder-as-label.

**Also:** 4.5:1 text contrast (3:1 for large text and UI boundaries), meaningful `alt` (empty `alt=""` for decorative), `prefers-reduced-motion` respected, no color-only status signals.

---

## 4. Shared components (partials)

Nine partials own everything repeated across pages. Four templates seed new pages so structure never drifts.

**Partials:** `head-meta.html` (charset, viewport, canonical, OG/Twitter, JSON-LD slot) · `header.html` · `mobile-nav.html` · `footer.html` (Bar-required identification) · `breadcrumbs.html` · `cta-band.html` · `sticky-call-bar.html` · `contact-form.html` · `disclaimer.html`

**Templates:** `page.html` · `practice-area.html` · `florida-law.html` · `location.html`

`npm run new-page -- --type=practice-area --slug=...` scaffolds a page from its template with managed regions and metadata already wired.

---

## 5. Homepage — `index.html`

1. Hero — "Facing a Florida probation violation?" + click-to-call + "Request a case review."
2. Urgency strip — three plain facts: VOP warrants are often no-bond; the standard is preponderance, not beyond a reasonable doubt; time is short.
3. Practice-area grid — 6 cards into the pillar pages.
4. How we defend a VOP — 4 steps (warrant/arrest → bond motion → hearing prep → disposition).
5. Florida law teaser — 3 statute cards → `/florida-law/`.
6. Locations teaser → `/locations/`.
7. FAQ — 6 `<details>` items + `FAQPage` JSON-LD.
8. CTA band + short intake form.

Trust and results modules are built but render only when real data exists in `data/site.json`.

---

## 6. Practice-area pages

Directory-index URLs (`/practice-areas/violation-of-probation/`) — no `.html` in the address bar.

**Template:** H1 + one-sentence answer → what it means → penalties/exposure → defenses → timeline → related statutes → FAQ → related areas → CTA.

**12 pages:** `violation-of-probation` (pillar) · `technical-violations` · `new-law-violations` · `absconding-and-failure-to-report` · `failed-drug-test-violations` · `restitution-and-fines-violations` · `community-control-violations` · `dui-probation-violations` · `sex-offender-probation-violations` · `early-termination-of-probation` · `probation-modification` · `out-of-state-probation-transfer`

---

## 7. Florida law pages

The topical-authority layer — neutral statute and procedure explainers that earn links and rank for research intent, each funneling to its matching practice area.

**Template:** what the statute says → plain-English translation → how it plays out in court → exceptions → related statutes → "how this affects your case" CTA. Statutes are quoted and cited to Online Sunshine with an "accurate as of" date, never paraphrased as authoritative.

**12 pages:** `fl-stat-948-01` (when probation may be imposed) · `fl-stat-948-03` (terms and conditions) · `fl-stat-948-04` (period; early termination) · `fl-stat-948-06` (violation, revocation, modification — the anchor) · `fl-stat-948-09` (cost of supervision) · `fl-stat-948-10` (community control) · `rule-3-790-revocation-procedure` · `vop-hearing-process` · `vop-burden-of-proof` · `vop-arrest-and-bond` · `vop-sentencing-and-scoresheets` · `probation-vs-community-control`

---

## 8. Location pages

**The largest SEO risk in this build.** Near-duplicate county pages are doorway pages — they get filtered or penalized, and under Bar rules they can imply an office presence that does not exist. Two rules:

1. **Only counties Hoffman Legal actually serves get a page** — the list comes from the firm, not from population rankings.
2. **≥ 400 words of verifiable local substance per page** — county courthouse name and address, criminal division structure, the local FDC Probation & Parole office, county VOP scheduling practice, local diversion or drug-court programs. Shared boilerplate stays under 30% of the page, checked by `scripts/check-links.mjs`'s duplication pass.

Each emits `LegalService` + `areaServed` — **not** `LocalBusiness` with an address the firm does not occupy.

**Tier 1 (12), pending firm confirmation:** Miami-Dade · Broward · Palm Beach · Orange · Hillsborough · Duval · Pinellas · Lee · Polk · Brevard · Seminole · Volusia

---

## 9. About and contact pages

**`/about/`** — firm story, attorney cards (real credentials only, Bar numbers shown), approach to VOP defense, bona fide office disclosure. `Attorney` + `LegalService` JSON-LD.

**`/contact/`** — address, map link, click-to-call, hours, intake form.

**Form:** name, phone, email, county, urgency (warrant outstanding? in custody?), short message. Explicitly instructs the visitor *not* to send confidential detail before a conflict check, with the no-attorney-client-relationship notice beside the submit button. Honeypot + submission-timing check rather than third-party CAPTCHA (privacy, and CAPTCHA costs CLS).

**Backend — decision needed.** With no framework there is still no server. Recommendation: a Cloudflare Pages Function (a plain `/functions/contact.js`, works with a purely static site) so no third party holds prospective-client intake data. Formspree or Netlify Forms is the zero-infrastructure fallback. Success → `/thank-you/`, which is the conversion-tracking endpoint.

**Legal pages:** `/legal/disclaimer/`, `/legal/privacy-policy/`, `/legal/terms-of-use/`, linked from every footer.

---

## 10. SEO

Hand-written HTML has no schema layer to enforce metadata, so `scripts/check-seo.mjs` replaces it — scanning every page for a missing or duplicate `<title>`, missing/overlong meta description, missing canonical, multiple `<h1>`, and malformed JSON-LD. Metadata lives in `data/pages.json`, which also drives sitemap generation.

- **Technical:** self-referencing canonicals, generated `sitemap.xml`, `robots.txt`, trailing-slash consistency, `404.html`, security headers via `_headers`.
- **Structured data:** `LegalService` + `Attorney` sitewide · `BreadcrumbList` on nested pages · `FAQPage` where FAQs render · `Article` with `datePublished`/`dateModified`/`reviewedBy` on practice-area and Florida-law pages.
- **Internal linking:** hub-and-spoke — practice area ↔ statute ↔ location, three-way. `check-links.mjs` fails on orphans and internal 404s, which matters more without a framework's typed routes.
- **E-E-A-T:** visible attorney review byline and last-reviewed date on every legal page.
- **Analytics:** cookieless (Plausible or Cloudflare Web Analytics) — no consent banner, no CLS. Call and form-submit events.

---

## 11. Final testing

| Gate | Tool | Threshold |
| --- | --- | --- |
| HTML validity | `html-validate` | zero errors — the compiler this stack doesn't have |
| Accessibility | `@axe-core/playwright` | zero serious/critical, WCAG 2.2 AA |
| A11y structure | Playwright | skip link, one `<h1>`, no skipped levels, labeled inputs, focus visible |
| Keyboard | Playwright | full nav + form completion, no trap, Esc closes mobile nav |
| SEO | `check-seo.mjs` | unique title/description/canonical, valid JSON-LD |
| Links | `check-links.mjs` | zero internal 404s, zero orphans |
| Placeholders | `check-placeholders.mjs` | zero `TODO` in a production build |
| Includes | `build.mjs --check` | no page drifted from its partials |
| Performance | Lighthouse CI | Perf ≥ 95, A11y 100, SEO 100 on 4 sampled routes |

That last gate is specific to this architecture: CI re-runs the stitcher and fails if any page's managed region differs from the partial, catching hand-edits to generated chrome before they ship.

Manual pre-launch: real iOS/Android devices, click-to-call verified, screen-reader pass (VoiceOver + NVDA) on homepage/contact/one article, form submission end-to-end to the live inbox, and **attorney sign-off on 100% of legal content**.

---

## 12. Exact file manifest

`~` = modify. **87 new, 2 modified.**

```
~ README.md
~ docs/IMPLEMENTATION-PLAN.md

  index.html                    homepage / site entry point
  404.html
  package.json  .gitignore  .editorconfig  .prettierrc.json
  .htmlvalidate.json  playwright.config.js  lighthouserc.json  CLAUDE.md
  robots.txt  sitemap.xml  site.webmanifest  _headers  favicon.svg
  .github/workflows/ci.yml

src/input.css                   Tailwind source: @theme tokens + component classes
css/styles.css                  generated, committed — site works with no build
js/main.js                      ~3KB: nav toggle, form validation
fonts/                          self-hosted woff2, latin subset (92 KB total)
styleguide/index.html           every reusable style rendered; noindex
images/.gitkeep

data/
  site.json                     NAP, phone, bar info, disclaimers — one source of truth
  pages.json                    per-page metadata → drives sitemap + SEO checks

partials/
  head-meta.html  header.html  mobile-nav.html  footer.html  breadcrumbs.html
  cta-band.html  sticky-call-bar.html  contact-form.html  disclaimer.html

templates/
  page.html  practice-area.html  florida-law.html  location.html

scripts/
  build.mjs                     stitch includes, generate sitemap, --check mode
  new-page.mjs                  scaffold a page from a template
  check-contrast.mjs            WCAG AA contrast gate, parses tokens from source
  check-seo.mjs  check-links.mjs  check-placeholders.mjs

about/index.html
contact/index.html
thank-you/index.html
legal/disclaimer/index.html  legal/privacy-policy/index.html  legal/terms-of-use/index.html

practice-areas/index.html
practice-areas/{violation-of-probation, technical-violations, new-law-violations,
  absconding-and-failure-to-report, failed-drug-test-violations,
  restitution-and-fines-violations, community-control-violations,
  dui-probation-violations, sex-offender-probation-violations,
  early-termination-of-probation, probation-modification,
  out-of-state-probation-transfer}/index.html                          (12)

florida-law/index.html
florida-law/{fl-stat-948-01, fl-stat-948-03, fl-stat-948-04, fl-stat-948-06,
  fl-stat-948-09, fl-stat-948-10, rule-3-790-revocation-procedure,
  vop-hearing-process, vop-burden-of-proof, vop-arrest-and-bond,
  vop-sentencing-and-scoresheets, probation-vs-community-control}/index.html   (12)

locations/index.html
locations/{miami-dade, broward, palm-beach, orange, hillsborough, duval,
  pinellas, lee, polk, brevard, seminole, volusia}/index.html          (12)

tests/smoke.spec.js  tests/a11y.spec.js
```

---

## 13. Build order

| Stage | Scope | Output |
| --- | --- | --- |
| 1 | `package.json`, Tailwind CLI, tokens, partials, `build.mjs` | Stitcher working, CSS compiling |
| 2 | `index.html` end to end + SEO/JSON-LD + a11y baseline | Homepage passing every CI gate |
| 3 | Templates + `new-page.mjs`, practice-area index + 12 pages | Core money pages |
| 4 | Florida-law index + 12 pages, cross-linking | Authority layer |
| 5 | Location index + confirmed counties | Local reach |
| 6 | About, contact, form backend, legal pages | Intake live |
| 7 | Full gate suite, Lighthouse, screen-reader pass, attorney review | Production |

Stage 2 is the reference implementation — once the homepage clears all nine gates, every later page is scaffolded from a template that already satisfies them. Stages 3–5 depend on real content; stage 5 is blocked until the firm confirms which counties it serves.
