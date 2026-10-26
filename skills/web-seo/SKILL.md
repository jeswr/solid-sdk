---
name: web-seo
description: Use when improving technical and entity SEO for a modern personal, portfolio, documentation, or marketing site, including crawlable HTML, canonical metadata, sitemap and robots, Person/ProfilePage JSON-LD, Core Web Vitals, and honest ranking expectations.
---

## Quick reference

<!-- AUTHORED-BY Codex GPT-5 -->

**Improve web SEO honestly**

On-page work makes a site crawlable and understandable; it cannot guarantee rank. For a common personal name, backlinks, consistent identity signals, and time often dominate.

### Technical baseline

- Server-render or statically generate indexable content.
- Verify raw crawler HTML contains the title, one meaningful H1, body copy, canonical URL, and structured data.
- Use one canonical HTTPS host with real 200/redirect/404/410 statuses and no cloaking.
- Publish `robots.txt` and `sitemap.xml`; ensure they reference the intended canonical URLs.
- Keep content negotiation and middleware away from framework assets and prove HTML requests cannot receive an RDF representation accidentally.
- Provide unique titles/descriptions, Open Graph/Twitter metadata, absolute image URLs, and stable icons/manifest.

### Entity structured data

For a personal profile, connect `Person`, `ProfilePage`, and `WebSite` JSON-LD nodes with stable `@id` values. Add only visible, true facts. Use `sameAs` for verified authoritative profiles and keep it consistent with any RDFa/WebID identity graph.

Do not invent ORCID, Wikidata, affiliation, or profile identifiers. Validate JSON-LD with current schema and search-engine tools.

### Content and performance

- Put the person's or product's primary name in title, H1, and natural prose.
- Publish useful dated/authored material, credentials, projects, and topical evidence.
- Keep client JavaScript small, reserve image dimensions, optimize the largest content element, and measure field Core Web Vitals.
- Use descriptive internal links and accessible link text.

### Human follow-up

List backlinks, Search Console/Bing verification, sitemap submission, and knowledge-graph/profile consistency as explicit maintainer actions. Report eligibility and validation results; never promise a ranking position.

### Agent persona

When this work is delegated to a sub-agent, spawn the `solid-frontend-dev` persona from
[`.claude/agents/solid-frontend-dev.md`](../../.claude/agents/solid-frontend-dev.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# web-seo — SEO for a modern personal / portfolio site

## The one thing to internalize first (honesty rule)

On-page SEO makes a site **eligible** and **legible**. It does not buy rank.
For a **common personal name** ("Jesse Wright", "John Smith") ranking #1 is
dominated by **off-page authority** (who links to you, how strong those domains
are) and **time/consistency** — not by any tag you can add. So split every
engagement into:

- **On-page (you control, do now):** crawlability, metadata, structured data,
  content, internal links, performance. Aim: be the single canonical, clearly-
  described, entity-resolved page for the person.
- **Off-page (you influence, takes time):** authoritative backlinks, a Wikidata/
  Knowledge-Graph entity, consistent name-and-bio across the web. List these as
  explicit human actions; never promise a ranking.

Tell the user this up front. Over-promising rank is the cardinal SEO sin.

## 1. Crawlability & render — Googlebot must get full HTML

Google crawls → renders (headless Chromium runs JS) → indexes, but Google itself
says server-side or pre-rendering is still a great idea — not all bots run JS. So:

- **SSR or SSG every indexable route.** Keep page content in Server Components;
  push interactivity to small `"use client"` leaves. A client-only SPA shell that
  paints empty HTML risks thin/late indexing and starves non-Google + AI bots.
- **Verify the bytes a crawler receives:** `curl -A "Googlebot" -H "Accept: text/html,..." URL`
  and confirm `<title>`, `<h1>`, body copy, and JSON-LD are in the RAW HTML.
- **Never serve different content to Googlebot than to users** (cloaking — a
  Google violation). Same content, same status codes.
- **Edge middleware / content-negotiation is a crawl hazard.** If a middleware
  transforms responses by `Accept` header (e.g. RDF conneg), prove the `text/html`
  branch returns the page unchanged, runs no extra origin fetch on the crawl path,
  and is scoped with a `matcher` so it never touches `/_next/*`, sitemap, robots,
  or icons. A negotiator that can pick a non-HTML representation for any `Accept`
  a bot might send is a latent de-indexing bug.
- Real HTTP status codes (200/301/308/404/410), one canonical host (pick apex OR
  www and 301/308 the other), HTTPS only, no redirect chains.

## 2. Next.js App Router metadata (the legible layer)

Use the Metadata API (Server Components only):
- **`metadataBase`** in the root layout = production origin (so relative OG image
  URLs resolve to absolute — social scrapers need absolute).
- **`title`** as `{ default, template: "%s — Name" }`; per-page `title` strings.
- **`description`** — unique, ~150 chars, includes the primary query naturally.
- **`alternates: { canonical }`** — absolute, self-canonical per page.
- **`robots: { index, follow, googleBot }`**.
- **`openGraph`**: title, description, url, siteName, type ('website'|'profile'),
  images [{ url, width:1200, height:630, alt }], locale.
- **`twitter`**: card 'summary_large_image', title, description, images, creator.
- **OG image 1200×630** — a static `app/opengraph-image.(png|jpg)` / `app/twitter-image.png`,
  or a dynamic `opengraph-image.tsx` using `ImageResponse` from `next/og`.
- **Favicons/manifest** via file conventions: `app/favicon.ico`, `app/icon.png`,
  `app/apple-icon.png`, `app/manifest.ts`.
- **`app/sitemap.ts`** → `MetadataRoute.Sitemap`. **`app/robots.ts`** →
  `MetadataRoute.Robots` (rules + sitemap + host).
- Next ≥15 streams metadata on dynamic pages but disables streaming for known
  bots; prefer static/prerendered pages so metadata is in the HTML at build time.

## 3. Structured data — the key ENTITY lever (JSON-LD)

Google prefers **JSON-LD in `<script type="application/ld+json">`**. This makes a
person a resolvable **entity** (Knowledge Graph, AI-answer citations), not a
string. Emit three connected nodes:
- **`Person`** with a stable `@id` (the page's own identity URI, e.g. `https://site/#me`),
  name, alternateName, url, image, jobTitle, worksFor/affiliation, alumniOf,
  description, `knowsAbout` (topics to be associated with), and **`sameAs`** — an
  array of EVERY authoritative profile (GitHub, LinkedIn, ORCID, Google Scholar,
  employer/university page, X, Mastodon, and crucially Wikidata/Wikipedia if they
  exist). `sameAs` is the strongest entity-resolution signal; Wikidata is a direct
  Knowledge-Graph input.
- **`WebSite`** (url, name, publisher/author → the Person `@id`).
- **`ProfilePage`** (Google-supported) with `mainEntity` → the Person; recommended
  `dateCreated`/`dateModified`.
Rules: the JSON-LD must match visible page content (Google policy — no markup-only
facts). Validate with the Rich Results Test + Schema Markup Validator. Keep `@id`s
consistent across pages so the graph links into one entity.

### Coexisting JSON-LD (SEO) with RDFa (a WebID/Linked-Data profile)
A site can be both a human page and a machine-readable profile:
- **RDFa** = attributes on the visible DOM (`typeof`/`property`/`resource`),
  consumed by RDF parsers / content-negotiation to Turtle. Keep it for a WebID.
- **JSON-LD** = a `<script>` block, consumed by search engines. Add it for SEO.
- **Align the subject URI:** point the JSON-LD `Person` `@id` at the SAME identity
  URI the RDFa/WebID uses (`…/#me`). Use schema.org terms in both so the Turtle
  conneg output and the JSON-LD agree. Keep the two `sameAs` lists identical. Do
  NOT rely on RDFa alone for SEO (JSON-LD is Google's recommended, rich-results
  path), and do NOT drop RDFa for JSON-LD (it would break the WebID conneg).

## 4. Content & E-E-A-T

- **Name in `<title>` and the single `<h1>`.** One `<h1>` per page.
- **Real, dated, authored content** in server-rendered HTML (a name-only SPA stub
  is thin). Bio + what you do + your topics, in prose.
- **Natural keyword use** — topics woven into sentences, not stuffed.
- **Outbound links to your own authoritative profiles** corroborate the entity.
- For a researcher/professional: surface credentials, affiliations, publications,
  talks — and mirror them in `Person` (jobTitle, affiliation, alumniOf, knowsAbout).
- Descriptive URLs; meaningful internal links.

## 5. Core Web Vitals (the performance gate; p75 of real users)

Thresholds: **LCP < 2.5 s · INP < 200 ms · CLS < 0.1**, at the 75th percentile of
field data (CrUX); lab scores are diagnostic only. Levers: SSR/SSG, ship less JS
(Server Components + dynamic-import client islands), `next/image` with explicit
width/height + priority on the LCP image, `next/font` (no layout-shift swap),
preconnect to needed origins.

## 6. Off-page (human actions — list as needs:user, never promise rank)

- **Backlinks from authoritative profiles → the site** (employer staff page,
  university dept page, ORCID, Scholar, GitHub, LinkedIn, conference speaker pages)
  — the strongest realistic lever for a personal name.
- **Knowledge Graph / Wikidata** — create/claim a Wikidata item (notability
  permitting) + add the site + sameAs. Direct Knowledge-Graph input.
- **Google Search Console** — verify (DNS TXT or HTML meta), submit the sitemap,
  monitor coverage + CWV + queries. **Bing Webmaster Tools** likewise.
- **Consistency** — identical name, bio, headshot across all profiles.

## 7. Verify before claiming done

- `curl -A Googlebot` the page; title/h1/body/JSON-LD in raw HTML.
- Rich Results Test + Schema Markup Validator (zero errors).
- `/sitemap.xml` + `/robots.txt` resolve and reference each other.
- One canonical host; no redirect chains; HTTPS; 404 returns 404.
- PageSpeed Insights / CrUX for field CWV.
- Search Console: property verified, sitemap submitted, no coverage errors.

## Anti-patterns

- Promising a rank (esp. for a common name).
- Keyword stuffing; markup describing facts not visible on the page (policy
  violation → possible structured-data manual action).
- Cloaking / serving bots different content.
- A client-only SPA with an empty HTML shell as the indexable page.
- A middleware/conneg layer that can return non-HTML to a crawler, double-fetches
  on the crawl path, or lacks a `matcher`.
- Inventing identifiers (ORCID, Wikidata IDs) — only assert profiles the person
  owns; a wrong `sameAs` poisons entity resolution.
