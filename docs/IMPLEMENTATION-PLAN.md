# FloridaProbationLaw.com — Implementation Plan

Operated by Hoffman Legal. Status: greenfield.

---

## 0. Repository assessment

| Item | Finding |
| --- | --- |
| Tracked files | `README.md` only (one line) |
| Commits | 1 (`f93a33b Initial commit`) |
| Branch | `claude/florida-probation-law-plan-bu7wml` (tracks origin) |
| Build tooling | None — no `package.json`, config, CI, or `.gitignore` |
| Runtime available | Node 22.22.2 / npm 10.9.7, Python 3.11.15 |

Nothing to migrate or preserve. All decisions are open.

### Stack recommendation

**Astro 5 + TypeScript + Tailwind CSS 4 + MDX content collections, static output.**

Rationale: this is a content/SEO property, not an app. Astro ships zero JS by default (wins Core Web Vitals against competing firm sites), MDX content collections give type-safe legal content with editable frontmatter, and static output deploys anywhere (Cloudflare Pages recommended). React/Next adds a hydration cost with no payoff here.

### Blocking unknowns — needed before content is written

These are business facts I must not invent. Every one is centralized in `src/site.config.ts` and seeded with clearly-marked `TODO` placeholders so the build runs, but **no page ships to production until they are replaced with verified data**:

1. Firm NAP — legal entity name, bona fide office street address, phone, email.
2. Attorney roster — names, Florida Bar numbers, admission dates, education, real bio copy.
3. Counties Hoffman Legal actually practices in (drives which location pages may exist at all).
4. Contact form backend (see §7) and the destination inbox.
5. Hosting/DNS target.

**Hard rule for this build: no fabricated case results, testimonials, reviews, "years of experience," client counts, awards, or attorney credentials.** Placeholder slots render as visible `TODO` markers in dev and fail the build in production mode rather than emitting invented facts.

### Compliance constraints shaping the design

A Florida law firm site is regulated advertising under Florida Bar Rules 4-7.11–4-7.22, and is YMYL content for search purposes. Architectural consequences, not afterthoughts:

- Every page footer carries the responsible firm/lawyer name and the city of a bona fide office (Rule 4-7.12).
- No guarantees, predictions of outcome, or "specialist"/"expert" phrasing unless board certification is verified (Rules 4-7.13, 4-7.14).
- Any past-results or testimonial component ships disabled until real, verifiable content plus required disclaimers exist.
- The contact form must not solicit confidential case detail pre-conflict-check, and carries a "no attorney-client relationship is formed" notice adjacent to the submit button.
- All substantive legal content requires named-attorney review before publish — tracked as a `reviewedBy` / `reviewedOn` frontmatter field enforced by the content schema.
- WCAG 2.2 AA is a build gate, not a nice-to-have (ADA demand-letter exposure).

---

## 1. Global design

**Positioning:** urgent, credible, plain-language. A VOP warrant is a same-day emergency — the design optimizes for "call now on a phone at 11pm," not brochure browsing.

- **Tokens** (Tailwind 4 `@theme` in `global.css`): navy/slate primary, a single warm accent for CTAs only, 4px spacing scale, `clamp()` fluid type scale, two families max (serif display / system-stack body).
- **Layout:** 1200px max content width, 68ch measure for article text, 8-col responsive grid, mobile-first.
- **Conversion furniture:** persistent header phone number; sticky mobile click-to-call bar; CTA band closing every page template.
- **Accessibility:** WCAG 2.2 AA — visible focus rings, 4.5:1 text contrast, landmark regions, skip link, keyboard-operable accordions, `prefers-reduced-motion` respected.
- **Performance budget:** ≤ 100KB JS on any route (target 0 on content routes), LCP < 2.0s on 4G, CLS < 0.05. Self-hosted subset fonts, `font-display: swap`, all images via `astro:assets` → AVIF/WebP with explicit dimensions.
- **Content voice:** 8th-grade reading level, defined terms on first use, no Latin without a gloss.

**Files:** `src/styles/global.css`, `src/site.config.ts`, `astro.config.mjs`, `tsconfig.json`, `package.json`

---

## 2. Shared components

Three layouts wrap everything; blocks compose pages; no page defines its own chrome.

- **Layouts:** `BaseLayout` (html shell, SEO, header/footer, skip link) → `PageLayout` (marketing pages) / `ArticleLayout` (long-form legal content: TOC, breadcrumbs, review byline, last-updated).
- **Chrome:** `Header`, `MobileNav`, `Footer` (with Bar-required identification), `Breadcrumbs`, `StickyCallBar`.
- **UI primitives:** `Button`, `Card`, `Section`, `Prose`, `Accordion`, `TableOfContents`, `Badge`, `Icon`, `Alert`.
- **Blocks:** `Hero`, `CTABand`, `ContactForm`, `FAQSection`, `PracticeAreaGrid`, `LocationGrid`, `StatuteCallout`, `RelatedLinks`, `ProcessSteps`, `DisclaimerBlock`.
- **SEO:** `SEO.astro` (title/description/canonical/OG/Twitter/robots), `JsonLd.astro` (typed structured-data emitter).

Interactivity is progressive enhancement only — `<details>`-based accordions and native anchors mean every page works with JS off.

---

## 3. Homepage

Single-scroll conversion page; every section links deeper.

1. Hero — "Facing a Florida probation violation?" + click-to-call + secondary "Request a case review."
2. Urgency strip — three plain-language facts (VOP warrants are often no-bond; the standard is preponderance, not reasonable doubt; time is short).
3. Practice-area grid — 6 top areas, each linking to its pillar page.
4. How we defend a VOP — 4-step `ProcessSteps` (arrest/warrant → bond motion → hearing prep → disposition).
5. Florida law explainer teaser — 3 statute cards → `/florida-law/`.
6. Locations teaser → `/locations/`.
7. FAQ — 6 questions, `FAQPage` schema.
8. CTA band + short-form contact.

Trust/results modules are built but rendered only when real data exists in config.

**Files:** `src/pages/index.astro`

---

## 4. Practice-area pages

Index at `/practice-areas/`, detail at `/practice-areas/[slug]`, generated from an MDX collection.

**Template:** H1 + one-sentence answer → "what this means" → penalties/exposure → defenses → process timeline → related statutes (`StatuteCallout`) → FAQ → related areas → CTA.

**Launch set (12):** `violation-of-probation` (pillar), `technical-violations`, `new-law-violations`, `absconding-and-failure-to-report`, `failed-drug-test-violations`, `restitution-and-fines-violations`, `community-control-violations`, `dui-probation-violations`, `sex-offender-probation-violations`, `early-termination-of-probation`, `probation-modification`, `out-of-state-probation-transfer`.

Schema enforces: `title`, `slug`, `metaTitle`, `metaDescription`, `summary`, `relatedStatutes[]`, `faqs[]`, `reviewedBy`, `reviewedOn`.

**Files:** `src/pages/practice-areas/index.astro`, `src/pages/practice-areas/[slug].astro`, `src/content/practice-areas/*.mdx` (12), `src/data/practice-areas.ts`

---

## 5. Florida law pages

The topical-authority layer: neutral statute and procedure explainers that earn links and rank for research intent, each funneling to the matching practice area.

**Template:** what the statute says → plain-English translation → how it plays out in court → key exceptions → related statutes → "how this affects your case" CTA. Statute text is quoted and cited, never paraphrased as if authoritative; each page links to the official Online Sunshine text and carries an "accurate as of" date.

**Launch set (12):** `fl-stat-948-01` (when probation may be imposed), `fl-stat-948-03` (terms and conditions), `fl-stat-948-04` (period of probation; early termination), `fl-stat-948-06` (violation, revocation, modification — the anchor), `fl-stat-948-09` (cost of supervision), `fl-stat-948-10` (community control / home confinement), `rule-3-790-revocation-procedure`, `vop-hearing-process`, `vop-burden-of-proof` (preponderance; willful and substantial), `vop-arrest-and-bond`, `vop-sentencing-and-scoresheets` (§ 921.0024, credit for time served), `probation-vs-community-control`.

**Files:** `src/pages/florida-law/index.astro`, `src/pages/florida-law/[slug].astro`, `src/content/florida-law/*.mdx` (12), `src/data/statutes.ts`

---

## 6. Location pages

**The main SEO risk in this build.** Templated near-duplicate city pages are doorway pages — they get filtered or penalized, and under Bar rules they can imply an office presence that doesn't exist. Two rules govern this section:

1. **Only counties Hoffman Legal actually serves get a page.** The list comes from the firm, not from population rankings.
2. **Each page carries ≥ 400 words of genuinely local, verifiable substance** — county courthouse name/address, criminal division structure, the local FDC Probation & Parole office, county-specific VOP scheduling practice, local diversion or drug-court programs. Shared boilerplate stays under 30% of the page.

`locations.ts` holds structured per-county data; the MDX file holds the unique local narrative. A build-time check fails any location page below the word-count floor or missing courthouse data.

**Proposed Tier 1 (12), pending firm confirmation:** Miami-Dade, Broward, Palm Beach, Orange, Hillsborough, Duval, Pinellas, Lee, Polk, Brevard, Seminole, Volusia.

Each emits `LegalService` + `areaServed` schema — **not** `LocalBusiness` with a fake address, unless a real office exists there.

**Files:** `src/pages/locations/index.astro`, `src/pages/locations/[slug].astro`, `src/content/locations/*.mdx` (12), `src/data/locations.ts`

---

## 7. About and contact pages

**`/about`** — firm story, attorney bio cards (real credentials only, Bar numbers displayed), approach to VOP defense, bona fide office disclosure. Emits `Attorney` / `LegalService` schema.

**`/contact`** — office address + map link, click-to-call, hours, and the intake form.

**Form design:** name, phone, email, county, urgency (warrant outstanding? in custody?), short message. Explicitly instructs the visitor *not* to send confidential details before a conflict check, with the no-attorney-client-relationship notice beside the submit button. Honeypot + timing check for spam, no third-party CAPTCHA (privacy + CLS). Posts to a Cloudflare Pages Function or Formspree — **decision needed**; recommendation is a Pages Function so no third party holds prospective-client data. Success → `/thank-you` (the conversion-tracking endpoint).

**Legal pages:** `/legal/disclaimer`, `/legal/privacy-policy`, `/legal/terms-of-use`, all linked from every footer.

**Files:** `src/pages/about.astro`, `src/pages/contact.astro`, `src/pages/thank-you.astro`, `src/pages/legal/disclaimer.astro`, `src/pages/legal/privacy-policy.astro`, `src/pages/legal/terms-of-use.astro`

---

## 8. SEO

- **Technical:** self-referencing canonicals, `@astrojs/sitemap`, `robots.txt`, semantic heading order, descriptive internal anchors, 404 page, trailing-slash consistency, security headers via `public/_headers`.
- **Metadata:** every page requires `metaTitle` (≤ 60ch) and `metaDescription` (≤ 155ch) at the schema level — the build fails on a missing or duplicate title.
- **Structured data** (`src/lib/schema.ts`): `LegalService` + `Attorney` sitewide; `BreadcrumbList` on all nested pages; `FAQPage` where FAQs render; `Article` with `datePublished`/`dateModified`/`reviewedBy` on practice-area and Florida-law pages.
- **Internal linking:** hub-and-spoke — practice area ↔ statute ↔ location, three-way cross-linking generated from the data files so no orphans and no manual link rot.
- **E-E-A-T:** visible attorney review byline and last-reviewed date on every legal page; citations to Online Sunshine statute text.
- **Analytics:** privacy-respecting, cookieless (Plausible or Cloudflare Web Analytics) — avoids a cookie banner and the CLS it causes. Call and form-submit conversion events.

**Files:** `src/components/seo/SEO.astro`, `src/components/seo/JsonLd.astro`, `src/lib/schema.ts`, `src/lib/seo.ts`, `src/pages/404.astro`, `public/robots.txt`, `public/_headers`

---

## 9. Final testing

| Gate | Tool | Threshold |
| --- | --- | --- |
| Build + types | `astro check`, `tsc` | zero errors |
| Content schema | Zod (content collections) | all required fields, incl. `reviewedBy` |
| Smoke | Playwright | every route 200s, renders H1, nav works |
| Accessibility | `@axe-core/playwright` | zero serious/critical, WCAG 2.2 AA |
| SEO assertions | Playwright | unique title/description/canonical per page; valid JSON-LD; one H1 |
| Links | `scripts/check-links.mjs` | zero internal 404s |
| Performance | Lighthouse CI | Perf ≥ 95, A11y 100, SEO 100 on 4 sampled routes |
| Placeholders | `scripts/check-placeholders.mjs` | zero `TODO` markers in a production build |

Plus manual pre-launch: real-device iOS/Android check, click-to-call verified, form submission end-to-end to the live inbox, and **attorney sign-off on 100% of legal content**. CI runs all gates on every PR.

**Files:** `playwright.config.ts`, `tests/smoke.spec.ts`, `tests/a11y.spec.ts`, `tests/seo.spec.ts`, `scripts/check-links.mjs`, `scripts/check-placeholders.mjs`, `lighthouserc.json`, `.github/workflows/ci.yml`

---

## Exact file manifest

`~` = modify, all others new. **111 files.**

```
~ README.md
  .gitignore  .editorconfig  .prettierrc.json  CLAUDE.md
  package.json  astro.config.mjs  tsconfig.json
  playwright.config.ts  lighthouserc.json
  .github/workflows/ci.yml
  docs/IMPLEMENTATION-PLAN.md          (this file)
  docs/CONTENT-STYLE-GUIDE.md

src/
  site.config.ts                       firm NAP, bar info, disclaimers — single source of truth
  content.config.ts                    collection schemas
  styles/global.css

  data/  nav.ts  practice-areas.ts  locations.ts  statutes.ts  faqs.ts

  lib/   seo.ts  schema.ts  urls.ts  format.ts

  layouts/  BaseLayout.astro  PageLayout.astro  ArticleLayout.astro

  components/
    seo/     SEO.astro  JsonLd.astro
    layout/  Header.astro  MobileNav.astro  Footer.astro
             Breadcrumbs.astro  StickyCallBar.astro
    ui/      Button.astro  Card.astro  Section.astro  Prose.astro
             Accordion.astro  TableOfContents.astro  Badge.astro
             Icon.astro  Alert.astro
    blocks/  Hero.astro  CTABand.astro  ContactForm.astro  FAQSection.astro
             PracticeAreaGrid.astro  LocationGrid.astro  StatuteCallout.astro
             RelatedLinks.astro  ProcessSteps.astro  DisclaimerBlock.astro
             AttorneyCard.astro

  pages/
    index.astro  about.astro  contact.astro  thank-you.astro  404.astro
    practice-areas/index.astro   practice-areas/[slug].astro
    florida-law/index.astro      florida-law/[slug].astro
    locations/index.astro        locations/[slug].astro
    legal/disclaimer.astro  legal/privacy-policy.astro  legal/terms-of-use.astro

  content/
    practice-areas/  (12 .mdx)
      violation-of-probation  technical-violations  new-law-violations
      absconding-and-failure-to-report  failed-drug-test-violations
      restitution-and-fines-violations  community-control-violations
      dui-probation-violations  sex-offender-probation-violations
      early-termination-of-probation  probation-modification
      out-of-state-probation-transfer

    florida-law/  (12 .mdx)
      fl-stat-948-01  fl-stat-948-03  fl-stat-948-04  fl-stat-948-06
      fl-stat-948-09  fl-stat-948-10  rule-3-790-revocation-procedure
      vop-hearing-process  vop-burden-of-proof  vop-arrest-and-bond
      vop-sentencing-and-scoresheets  probation-vs-community-control

    locations/  (12 .mdx — pending firm confirmation of served counties)
      miami-dade  broward  palm-beach  orange  hillsborough  duval
      pinellas  lee  polk  brevard  seminole  volusia

public/  robots.txt  favicon.svg  site.webmanifest  _headers  images/.gitkeep

scripts/  check-links.mjs  check-placeholders.mjs

tests/  smoke.spec.ts  a11y.spec.ts  seo.spec.ts
```

---

## Suggested build order

| Stage | Scope | Output |
| --- | --- | --- |
| 1 | Scaffold, tokens, layouts, shared components | Styled shell, CI green |
| 2 | Homepage + SEO/schema layer | Working conversion path |
| 3 | Practice-area system + 12 MDX pages | Core money pages |
| 4 | Florida-law system + 12 MDX pages | Authority layer + cross-links |
| 5 | Location system + confirmed counties | Local reach |
| 6 | About, contact, form backend, legal pages | Intake live |
| 7 | Test gates, Lighthouse, attorney review, launch | Production |

Stages 3–5 each depend on real content; stage 5 is blocked until the firm confirms served counties.
