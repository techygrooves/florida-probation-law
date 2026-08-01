# Launch checklist

Everything on this page is blocking. The site is complete as a build and
publishes nothing: all 47 routes carry `noindex`, `sitemap.xml` lists zero
URLs, and both intake forms show a notice instead of a submit button. That is
deliberate — an unreviewed legal site that ranks is worse than one that does
not exist — and it stays that way until the items below are cleared.

Run `npm run check:launch` at any point. It fails while anything below is
outstanding, and is the mechanical half of this list.

---

## 1. Firm details

**Supplied and live.** Every firm and attorney detail now comes from
`data/site.json` and renders across the site: firm legal name, responsible
attorney, office address, telephone, email, consultation terms and the primary
service area. Nothing about the firm is written into a page by hand.

Two items in this category remain:

| Item | Where | Why it is still open |
| --- | --- | --- |
| Attorney portrait | `attorney.image` | Loaded from `floridadepositlaw.com`. It is the only remote asset on the site and the only thing here depending on a host this repository does not control. Replace with a locally hosted, optimized copy. The `TODO` is in the source of both pages that show it. |
| Registration identifier | — | Deliberately not recorded anywhere in this repository. |

## 2. Legal content requiring attorney review

**45 pages** are written and unreviewed. Every one carries `draft: true` in
`data/nav.json`, which forces `noindex, follow` and keeps it out of
`sitemap.xml`. Removing that flag is the act of publishing, and it should be
done per page, by the reviewing attorney, not in bulk.

31 marked passages need specific attention. Find them with:

```bash
grep -rn "CONTENT REVIEW\|ATTORNEY REVIEW\|LOCAL VERIFICATION" --include=*.html .
```

They fall into three groups:

**Statutory summaries** — `/florida-probation-law/statute-948-04/`,
`/statute-948-05/`, `/948-04-vs-948-05/`, `/types-of-probation/`, `/glossary/`.
No statutory language was ever quoted or paraphrased, because the official
source at `leg.state.fl.us` could not be reached from the build environment to
verify it. The pages describe *where* provisions sit and what they broadly
govern. Each carries a visible "Pending attorney review" date and a
"Source link pending — Florida Legislature" placeholder. Both need the real
values, and the comparison table on `/948-04-vs-948-05/` needs confirming as a
whole before it is published.

**Legal conclusions** — the early-termination cluster and the eight service
pages. The marked passages are the points where a statement could be read as
advice about a specific case.

**Local practice** — all six county pages carry a
`LOCAL VERIFICATION REQUIRED` block. No courthouse address, judge, division
assignment, filing procedure, or hearing schedule appears anywhere in the
repository, because none could be verified. Only stable public facts (circuit
number, county seat, circuit composition, bordering counties) are recorded, in
`data/locations.json`.

## 3. Technical items requiring production credentials

| Item | Where | Notes |
| --- | --- | --- |
| Form submission endpoint | `site.formEndpoint` | Empty. Both forms validate client-side but the submit control is replaced by a visible notice, so no case details are collected and silently dropped. Setting it switches both forms live on the next build. A first-party endpoint (e.g. a Cloudflare Pages Function) is preferable to a third-party form service, so prospective-client information is not held by an outside processor. |
| Form redirect field name | `site.formRedirectField` | Defaults to `_next`, which suits Formspree and Basin. Set it to whatever the chosen endpoint reads, or the visitor lands on the endpoint's response page instead of `/thank-you/`. |
| Server-side validation | — | Every rule in `js/main.js` must be re-implemented at the endpoint. Client-side checks stop honest mistakes and nothing else. |
| Spam filtering | — | The honeypot and the elapsed-time field are recorded for a server to weigh. Neither is enforced client-side beyond the honeypot, because a bot that POSTs directly never runs the script. |
| Production domain | `site.url`, `site.basePath` | See deployment below. |
| Analytics / call tracking | not present | None is configured. Anything added needs a privacy-policy update — `/privacy-policy/` currently describes a site that sets no cookies and runs no third-party scripts, which is true today. |

## 4. Deployment

### Choosing the target

The site is authored with root-relative URLs and rewritten at build time.
`data/site.json` → `basePath` decides which.

| Target | `basePath` | Command |
| --- | --- | --- |
| floridaprobationlaw.com (or Pages with a `CNAME`) | `""` | `npm run build:production` |
| GitHub Pages project site (current) | `/florida-probation-law` | `npm run build` |

The rewrite is idempotent — switching back and forth converges rather than
stacking prefixes — but the built pages must be committed after switching.

### Before the first publish

1. Host the attorney portrait locally (§1) and confirm `npm run check:launch`
   passes.
2. Have a Florida attorney review the content (§2) and clear the marked
   passages.
3. Remove `"draft": true` from `data/nav.json` for each reviewed route. Leave
   `"noindex": true` on `/thank-you/` — that one is permanent.
4. Configure the form endpoint (§3) and test a real submission end to end,
   including the redirect to `/thank-you/`.
5. `npm run build` — `sitemap.xml` now lists the published routes and
   `robots.txt` drops its pre-launch note automatically.
6. `npm run serve` and `npm run audit` to confirm nothing regressed.

### Moving to the production domain

`robots.txt` and `sitemap.xml` are written to the repository root, which
serves them at the domain root on a normal host. **On the current GitHub Pages
project deploy they resolve under `/florida-probation-law/`, where crawlers do
not look for them.** This does not matter while everything is `noindex`, but it
means the project-site deploy is not a launch configuration. Move to the real
domain, or add a `CNAME`, before publishing anything.

`_redirects` is generated from `data/redirects.json` in Netlify/Cloudflare
format and records the URL changes made during the build. GitHub Pages ignores
it. None of those old paths was ever indexed, so nothing is lost either way —
but a host that honours it costs nothing and keeps the map live.

### After publishing

1. Submit `sitemap.xml` in Google Search Console and Bing Webmaster Tools.
2. Confirm the `LegalService`, `Attorney` and `FAQPage` nodes in the Rich
   Results Test now that real firm data is present.
3. Re-run `npm run check:content` after any copy edit. It is the gate that
   catches a borrowed sentence carrying a guarantee or a superlative into a
   regulated page.
