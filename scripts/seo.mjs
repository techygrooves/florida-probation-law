/**
 * Metadata and structured data.
 *
 * Everything SEO-related is generated here and injected through the shared
 * head partial, so no page carries hand-written meta tags or hand-written
 * JSON-LD. One consequence worth stating: a page cannot disagree with its own
 * structured data, because both come from the same route record and, for FAQs,
 * from the page's own visible markup.
 *
 * The governing rule is conservatism. A claim is emitted only when it is known
 * to be true:
 *
 *   - no `review` or `aggregateRating` — there are no verified reviews;
 *   - no `address` or `telephone` while those are placeholders;
 *   - no `Attorney` node until an attorney name is supplied;
 *   - no `author` on articles until a real one exists;
 *   - `FAQPage` only where genuine question/answer markup is on the page;
 *   - no per-county `LocalBusiness` — see the note on county pages below.
 */

/* ---- text helpers -------------------------------------------------------- */

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&nbsp;": " ", "&sect;": "§", "&middot;": "·", "&ldquo;": "“",
  "&rdquo;": "”", "&mdash;": "—", "&ndash;": "–", "&copy;": "©",
};

const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m);

export const plain = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

/* ---- titles --------------------------------------------------------------
 * A page's <h1> and its <title> serve different surfaces. The H1 can be as
 * long as the page needs; the title competes for roughly 60 characters in a
 * result listing, and anything past that is truncated.
 *
 * Mechanically appending " | Florida Probation Law" costs 24 of those
 * characters, which pushed the descriptive, intent-matching titles this site
 * depends on ("Early Termination of Probation in Hillsborough County") well
 * past the limit. The brand suffix is the least valuable part of a title, so
 * it is dropped rather than the words someone actually searched for.
 *
 * A route may set `titleTag` explicitly where neither the H1 nor the rule
 * produces the right result — the homepage being the case that matters, since
 * that is the one page where the firm's name belongs in the title.
 * ------------------------------------------------------------------------ */

const TITLE_TARGET = 60;

export function buildTitle({ route, site }) {
  if (route.titleTag) return route.titleTag;
  const base = route.title || route.label;
  const suffix = route.href === "/" ? site.firm : site.siteName;
  const withSuffix = `${base} | ${suffix}`;
  return withSuffix.length <= TITLE_TARGET ? withSuffix : base;
}

/* ---- FAQ extraction ------------------------------------------------------
 * Read from the page's own markup rather than from a separate data file.
 * Google requires FAQPage markup to match content visible to the user; taking
 * it from the rendered <details> blocks makes that true by construction, and
 * makes it impossible to mark ordinary marketing copy as an FAQ.
 * ------------------------------------------------------------------------ */

export function extractFaqs(html) {
  const faqs = [];
  for (const [, block] of html.matchAll(
    /<details class="faq-item"[^>]*>([\s\S]*?)<\/details>/g
  )) {
    const q = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(block);
    const a = /<div class="faq-answer"[^>]*>([\s\S]*?)<\/div>\s*$/.exec(block.trim());
    if (!q || !a) continue;
    const question = plain(q[1]);
    const answer = plain(a[1]);
    if (question && answer) faqs.push({ question, answer });
  }
  // A single question is not an FAQ page.
  return faqs.length >= 2 ? faqs : [];
}

/* ---- schema graph -------------------------------------------------------- */

export function buildSchema({ site, route, source, origin }) {
  const url = origin + route.href;
  const siteId = `${origin}/#website`;
  const orgId = `${origin}/#organization`;

  const graph = [];

  /* One organisation, expressed as a LegalService because that is what it is,
     referenced by @id from every page including the county pages. There is a
     single office and a single business entity; a per-county LocalBusiness
     would assert offices the firm does not have.

     `name` is the website, `legalName` the registered entity — Florida
     Probation Law is a website operated by Hoffman Legal, PLLC, and the graph
     says exactly that rather than implying a second firm.

     Address, telephone and email are still conditional. The condition is now
     satisfied, but the gate stays: it is what stops a placeholder ever being
     emitted as though it were real. */
  const org = {
    "@type": "LegalService",
    "@id": orgId,
    name: site.siteName,
    legalName: site.firmLegalName,
    url: origin + "/",
    /* Florida, plus the counties the firm has confirmed as its primary service
       area. Serving an area is not occupying one — no address appears on any
       county page. */
    areaServed: [
      { "@type": "State", name: "Florida" },
      ...(site.serviceArea?.primary || []).map((name) => ({
        "@type": "AdministrativeArea",
        name,
        containedInPlace: { "@type": "State", name: "Florida" },
      })),
    ],
    knowsAbout: [
      "Early termination of probation",
      "Florida probation law",
      "Probation violations",
      "Community control",
    ],
  };
  if (site.office.street && site.office.city) {
    org.address = {
      "@type": "PostalAddress",
      streetAddress: site.office.street,
      addressLocality: site.office.city,
      addressRegion: site.office.state,
      postalCode: site.office.zip,
      addressCountry: "US",
    };
  }
  if (site.phone.tel) org.telephone = site.phone.tel;
  if (site.email.display) org.email = site.email.display;
  /* No openingHours: telephone intake runs 24/7 but the office does not, and
     no office hours have been supplied. An openingHours of 00:00–23:59 would
     say the premises are staffed around the clock, which is not the claim. */
  graph.push(org);

  /* Attorney is a claim about a real person, so every field here is one that
     was actually supplied. No alumni, no credentials, no certifications, no
     languages, no social profiles — those were not provided, and inventing one
     on a law firm site is a Fla. Bar Rule 4-7.13 problem rather than a
     cosmetic gap. */
  if (site.attorney.name) {
    const attorney = {
      "@type": "Attorney",
      "@id": `${origin}/about/attorney-profile/#attorney`,
      name: site.attorney.legalName || site.attorney.name,
      alternateName: site.attorney.name,
      jobTitle: site.attorney.title,
      worksFor: { "@id": orgId },
      affiliation: { "@id": orgId },
      url: origin + "/about/attorney-profile/",
    };
    if (site.phone.tel) attorney.telephone = site.phone.tel;
    if (site.email.display) attorney.email = site.email.display;
    if (org.address) attorney.workLocation = { "@type": "Place", address: org.address };
    if (site.attorney.image) attorney.image = site.attorney.image;
    graph.push(attorney);
  }

  graph.push({
    "@type": "WebSite",
    "@id": siteId,
    url: origin + "/",
    name: site.siteName,
    publisher: { "@id": orgId },
    inLanguage: "en-US",
  });

  const webPage = {
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: route.title,
    description: route.description,
    isPartOf: { "@id": siteId },
    about: { "@id": orgId },
    inLanguage: "en-US",
  };

  /* Breadcrumbs, from the route's position in the navigation. */
  if (route.crumbs && route.crumbs.length) {
    const crumbId = `${url}#breadcrumbs`;
    graph.push({
      "@type": "BreadcrumbList",
      "@id": crumbId,
      itemListElement: route.crumbs.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: c.label,
        item: origin + c.href,
      })),
    });
    webPage.breadcrumb = { "@id": crumbId };
  }

  graph.push(webPage);

  /* FAQPage only where real question/answer markup exists on the page. */
  const faqs = extractFaqs(source);
  if (faqs.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      isPartOf: { "@id": `${url}#webpage` },
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }

  /* Article, for blog posts only — not the blog index. `author` is omitted
     until a real one is supplied; an invented byline is worse than none. */
  if (route.href.startsWith("/blog/") && route.href !== "/blog/") {
    const article = {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: route.title,
      description: route.description,
      mainEntityOfPage: { "@id": `${url}#webpage` },
      publisher: { "@id": orgId },
      inLanguage: "en-US",
    };
    if (route.datePublished) article.datePublished = route.datePublished;
    if (route.dateModified) article.dateModified = route.dateModified;
    if (site.attorney.name) {
      article.author = { "@id": `${origin}/about/attorney-profile/#attorney` };
    }
    graph.push(article);
  }

  return `<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2)}
</script>`;
}

/* ---- robots.txt ----------------------------------------------------------
 * Crawling stays allowed even while every page is noindex: a crawler has to
 * fetch a page to see the noindex directive, so blocking here would leave
 * pages eligible for indexing on inbound links alone.
 * ------------------------------------------------------------------------ */

export function buildRobotsTxt({ site, origin, indexableCount }) {
  const preamble = indexableCount
    ? []
    : [
        "# Pre-launch: every page currently carries `noindex` in its markup while",
        "# content awaits review by a Florida attorney. Crawling is deliberately",
        "# left open so that directive can actually be read.",
        "",
      ];

  return [
    "# FloridaProbationLaw.com",
    "",
    ...preamble,
    "User-agent: *",
    "Allow: /",
    "",
    "# Internal design reference, not part of the public site.",
    "Disallow: /styleguide/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

/* ---- sitemap.xml ---------------------------------------------------------
 * Only publishable routes are listed. While every page is gated behind
 * attorney review the set is empty, which leaves a valid but urlless
 * <urlset> — the file is still emitted so the advertised URL resolves rather
 * than 404s, with a comment saying why it is bare.
 * ------------------------------------------------------------------------ */

export function buildSitemap({ origin, routes }) {
  const body = routes.length
    ? routes.map((r) => `  <url><loc>${origin}${r.href}</loc></url>`).join("\n")
    : "  <!-- No publishable routes yet: every page carries noindex until a\n" +
      "       Florida attorney has reviewed its content. -->";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${body}\n</urlset>\n`
  );
}
