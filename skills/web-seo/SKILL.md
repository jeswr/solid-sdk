---
name: web-seo
description: Use when improving technical and entity SEO for a modern personal, portfolio, documentation, or marketing site, including crawlable HTML, canonical metadata, sitemap and robots, Person/ProfilePage JSON-LD, Core Web Vitals, and honest ranking expectations.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Improve web SEO honestly

On-page work makes a site crawlable and understandable; it cannot guarantee rank. For a common personal name, backlinks, consistent identity signals, and time often dominate.

## Technical baseline

- Server-render or statically generate indexable content.
- Verify raw crawler HTML contains the title, one meaningful H1, body copy, canonical URL, and structured data.
- Use one canonical HTTPS host with real 200/redirect/404/410 statuses and no cloaking.
- Publish `robots.txt` and `sitemap.xml`; ensure they reference the intended canonical URLs.
- Keep content negotiation and middleware away from framework assets and prove HTML requests cannot receive an RDF representation accidentally.
- Provide unique titles/descriptions, Open Graph/Twitter metadata, absolute image URLs, and stable icons/manifest.

## Entity structured data

For a personal profile, connect `Person`, `ProfilePage`, and `WebSite` JSON-LD nodes with stable `@id` values. Add only visible, true facts. Use `sameAs` for verified authoritative profiles and keep it consistent with any RDFa/WebID identity graph.

Do not invent ORCID, Wikidata, affiliation, or profile identifiers. Validate JSON-LD with current schema and search-engine tools.

## Content and performance

- Put the person's or product's primary name in title, H1, and natural prose.
- Publish useful dated/authored material, credentials, projects, and topical evidence.
- Keep client JavaScript small, reserve image dimensions, optimize the largest content element, and measure field Core Web Vitals.
- Use descriptive internal links and accessible link text.

## Human follow-up

List backlinks, Search Console/Bing verification, sitemap submission, and knowledge-graph/profile consistency as explicit maintainer actions. Report eligibility and validation results; never promise a ranking position.
