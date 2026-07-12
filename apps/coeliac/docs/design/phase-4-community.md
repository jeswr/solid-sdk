<!-- AUTHORED-BY Claude Fable 5 -->

# Phase 4 — Community & Social Layer (design)

> The maintainer's explicit Phase-4 ask: *"a social networking feature to chat to
> other people with the condition and to link into existing communities like
> Coeliac UK."* This is the grounded design for that layer of `jeswr/coeliac-app`,
> building on `docs/DESIGN.md` §8, `docs/BUILD-PLAN.md` Phase 4A, and the Phase-3
> knowledge rails (`docs/design/phase-3-knowledge-genetics.md`).
>
> **Framing rule inherited from the whole product:** this is **decision support and
> peer *experience*, never diagnosis or medical advice**. A community layer around a
> health condition is where dangerous "cures", self-administered gluten challenges,
> and eating-disorder-adjacent content spread — so privacy, safety, and an
> anti-misinformation posture are **first-order** here, not a footnote. Every design
> call below is subordinate to "do no harm to a vulnerable user."

---

## 0. The honest headline (read this first)

Two facts, both **verified live 2026-07-03**, shape everything and correct an
optimistic assumption in `DESIGN.md` §8:

1. **The coeliac community lives almost entirely on CLOSED platforms with no open
   read API.** The gathering places are Facebook groups (no Groups API), Reddit
   (its unauthenticated `.json` endpoint was **killed 30 May 2026** — returns 403),
   the celiac.com IPS/Invision forums (**no RSS** — confirmed by the forum's own
   admin), and HealthUnlocked (a closed patient-community platform, no developer
   API). There is **essentially no Matrix / Lemmy / Mastodon coeliac presence** to
   read.
2. **`@jeswr/solid-community-feeds` reads only Matrix + Discourse** (verified from
   its source — no generic RSS source, no Reddit/IPS/Facebook adapter). And the
   Pod Manager **"Solid Community" view does not actually exist yet** — neither
   community package is even a dependency of Pod Manager. `DESIGN.md` §8's "reuse
   the PM Solid-Community pattern" refers to the *package's design intent*, not a
   shipped surface. So there is **no drop-in aggregated-feed integration** for this
   domain the way there is for the Solid community itself.

**The correct, honest consequence:** Phase 4A's realistic primary shape is
**curated, safe, accessible link-outs** to the communities that already exist and
already moderate themselves — NOT a rich live aggregated feed we cannot honestly
source. A read-only feed is possible only for the *few* sources that expose a
public RSS/Atom endpoint (see §3.3), and even that is fragile and
terms-encumbered. The genuinely valuable, differentiated, Solid-native feature is
the **pod-owned peer-sharing layer** (§4) — sharing a *sanitised* "safe foods" /
"safe venue" card the user owns — not re-hosting other people's closed forums.

This doc designs to that reality rather than the aspiration.

---

## 1. Verified facts (primary sources, checked live 2026-07-03)

### 1.1 Coeliac UK — what actually exists, and what is member-gated
- **No public/developer API and no open-data licence.** Confirmed against their
  contact/partnership pages: the only routes are a **commercial-partner** contact
  (`commercial.coeliac.org.uk/contact-us`) and a **research** route; neither
  advertises API or data access.
  - https://www.coeliac.org.uk/about-us/contact-us/
- Their consumer product is the **"Live Well Gluten Free" app** (formerly "Gluten
  Free Food Checker"), **built with and powered by FoodMaestro** (Android package
  `com.foodmaestro.coeliacuk`). It offers a barcode scanner over **150,000–185,000
  products** and **~3,000 GF-accredited venues** — but it is **members-only**
  (digital membership from **£21/yr**). The product/venue data is FoodMaestro's
  commercial database, not open.
  - https://www.coeliac.org.uk/information-and-support/your-gluten-free-hub/food-and-drink-information/live-well-gluten-free-app/
  - https://play.google.com/store/apps/details?id=com.foodmaestro.coeliacuk
  - https://www.thegrocer.co.uk/news/coeliac-uk-launches-gluten-free-food-checker-app/540768.article
- **Venue guide** (3,300+ GF-accredited venues) is web-facing but has **no public
  API** — it feeds their own member app.
  - https://www.coeliac.org.uk/gluten-free-accredited-venues/
- Their **news page has no RSS/Atom feed** (checked the page markup); the
  subscribe route is a **newsletter**. They run a **Community page** (local
  volunteer groups, Facebook groups, "Coeliac UK Connect" — a *private* Instagram
  for 16–19-year-olds).
  - https://www.coeliac.org.uk/news/ · https://www.coeliac.org.uk/living-with-coeliac-disease/community/
- **Net:** Coeliac UK integration = **respectful deep link-out only** (venue guide,
  food/drink hub, the Live Well app, community page, diagnosis pages), attributed,
  **never scraped**. Any *data* integration is a **partnership/permission** ask
  (§5), not something we can build unilaterally.

### 1.2 The community landscape (where people actually gather)
| Venue | What it is | Read-access reality (verified) |
|---|---|---|
| **r/Celiac**, **r/Coeliac**, **r/glutenfree** (Reddit) | Large active subreddits | Unauth `.json` **dead since 30 May 2026** (403). Per-subreddit **`.rss` (Atom) reportedly still works** (survived the API repricing because it was never OAuth-gated) — **but this is a secondary-source claim (RSS vendors), NOT live-verified by us, and Reddit's Data API terms restrict programmatic/commercial use.** Treat as fragile + terms-encumbered. |
| **celiac.com forums** | 30-year IPS/Invision community (Scott Adams) | **No RSS for forum content** (confirmed by the site's own forum admin thread). Closed to structured read. |
| **HealthUnlocked** | Closed patient-community platform (600+ orgs) | Hosts coeliac discussion; **no public developer API**. Closed. |
| **Facebook groups** (e.g. Celiac Disease Foundation 150k+, regional GF dining groups) | The biggest real gathering places | **No Groups read API** (Meta deprecated it). Link-out only. |
| **Coeliac UK Connect / local groups** | Charity-run (some minor-only) | Closed; safeguarding-sensitive (minors). Link-out to the charity's own page only. |
| **Celiac Disease Foundation**, **patient.info coeliac tag**, **findmeglutenfree.com** | Info + venue-review communities | Web-facing; link-out targets. Find Me Gluten Free is a useful eating-out venue-review complement to Coeliac UK's guide. |

Sources: https://www.celiac.com/forums/ · https://www.celiac.com/forums/topic/158327-rss-feed-of-forum-content/ ·
https://healthunlocked.com/communities · https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki ·
https://news.ycombinator.com/item?id=48329557 · https://celiac.org/ · https://www.findmeglutenfree.com/

**Takeaway:** none of the coeliac gathering places is a Matrix room or a Discourse
forum — the two backends `@jeswr/solid-community-feeds` supports. So the suite
"read the community into a feed" precedent **does not transfer to this domain
as-is**; it would need a new generic RSS/Atom source (§3.3) and would still only
reach the handful of sources that expose one.

### 1.3 The suite packages this composes with (verified from source)
- **`@jeswr/solid-community-feeds`** (v0.1.0, ESM, GitHub-installable, committed
  `dist/`, zero runtime deps). Model: `CommunityChannel → CommunityThread →
  CommunityMessage { id, source:"matrix"|"discourse", author, authorId, body,
  bodyHtml?, createdAt (ISO), permalink }`. Entry: `CommunityFeed`,
  `MatrixFeedSource`, `DiscourseFeedSource`, `SOLID_CHANNELS`. `getFeed()` never
  throws on one source failing (per-source `errors[]`). **SSRF-safety is its own
  `safeFetch`** (not `@jeswr/guarded-fetch`): https-only, rejects URL creds, blocks
  private/loopback/link-local/metadata IPs + local hostnames, `redirect:"manual"`,
  5 MiB body cap, 15 s timeout, **injectable `fetch`**. Blocklist model (no positive
  allowlist). Read-marker persisted by the host app (stateless client).
  **Only Matrix + Discourse sources exist** — surfacing a coeliac source needs a
  new `RssFeedSource` contributed upstream (§3.3).
- **`@jeswr/solid-chat-interop`** (ESM, GitHub-installable, browser-safe root).
  `CanonicalMessage { id?, content, mediaType (default text/plain), author? (WebID),
  published? (ISO), room? (IRI), inReplyTo?, replacedBy? (edit), deletedAt?
  (tombstone), provenance?: {attributedTo,generatedBy,derivedFrom}, task?:
  {state,title,assignee} }`. Reconciles **AS2.0** (canonical write, = `@jeswr/
  pod-chat`), **SolidOS `meeting:LongChat`** (installed-base read), and external
  schemas via a `ChatAdapter` seam. Functions: `as2ToCanonical`/`canonicalToAs2`,
  `longChatToCanonical`/`canonicalToLongChat`, `parseAs2`/`serializeAs2`,
  `serializeLongChat`, `buildAs2Message`, `LibreChatAdapter`, IRI-safety helpers
  (`isHttpIri`/`safeIri` — http(s)-only untrusted filter). **Mints no new
  predicate**; reuses `pc:ChatRoom` + `@jeswr/solid-task-model` `wf:Task`. Node-only
  SHACL on `./shape`. This is our peer-message model (§4).
- **`@jeswr/guarded-fetch`** — the suite SSRF-safe browser policy (https-only)
  Phase 3 already wraps as `foreignFetch` (`src/lib/fetch/guarded.ts`).
- **`@jeswr/federation-registry` / `@jeswr/federation-trust`** — the catalogue +
  signed-membership stack, if community *discovery* is ever federated (§4.5,
  conservative/optional).

---

## 2. Cross-cutting community rails (stated ONCE; every Phase-4 surface inherits them)

These extend the Phase-3 §2 rails to the community layer. A builder wires **all
seven** into every community/peer surface; acceptance tests assert their presence.

1. **Peer experience ≠ medical advice — everywhere.** Every community surface
   carries the shared `<MedicalDisclaimer>` PLUS a distinct **peer-content banner**:
   "This is other people's *experience*, not medical advice, and not verified.
   Check anything important against the sources on the Research page and your
   clinician." (a test asserts the string on each community view). Peer content is
   **visually and structurally separated** from the Phase-3 credible-source
   knowledge — never interleaved as if equivalent.
2. **No app-stored health data is intentionally sent to any community.** The app
   sends **nothing about the user's diary/health data** on a link-out or feed read;
   sharing (§4) sends only what the user explicitly, per-item, chooses — never
   symptoms, genetics, the raw diary, or the real WebID-to-condition link unless the
   user opts in per-share (§4.2). **Honest caveat (roborev, fixed):** *opening* an
   external coeliac-specific site is itself network metadata that can disclose
   interest in coeliac content (DNS, TLS SNI, the destination host) — the app cannot
   prevent that, and does not claim to. It **does** minimise the leak it controls:
   all external community links use `rel="noopener noreferrer"` **and**
   `referrerPolicy="no-referrer"` (asserted by an acceptance test) so no in-app URL,
   path, or referrer travels to the destination.
3. **Pseudonymous-by-default identity (§4.2).** A health condition is a sensitive
   category (potentially special-category data under GDPR Art. 9). The app **never**
   attaches the user's real diary WebID to community content by default. Community
   participation uses an **opt-in pseudonymous community identity** with no link
   back to the health diary.
4. **Closed link-out + fetch allowlist (extends Phase-3 §3.4).** Community code may
   link out **only** to a curated, committed allowlist of reputable domains
   (`lib/community/allowlist.ts`), and may *fetch* only from an equally-closed host
   allowlist inside the community fetch wrapper (on top of `guarded-fetch`). **No
   open web search, no user-supplied-URL fetch, no arbitrary embed.** Adding a
   domain is a reviewed code change, not a runtime input.
5. **Anti-misinformation content safety (§4.4).** Any peer/feed text rendered in-app
   passes a curated **dangerous-claims filter** (fake cures, "microdose gluten to
   build tolerance", enzymes-as-cure, MMS/bleach/chelation, "you don't really need
   to be strict", anti-vaccine-adjacent) → the item is collapsed behind a warning
   that links to the credible Research page. This never *silences* the source (we
   don't control it); it protects the in-app reader and refuses to amplify.
6. **Safeguarding + crisis rails (§4.6).** The eating-disorder / orthorexia
   safeguard (`RESEARCH.md` §2.8) and the "see a doctor / dietitian / emergency"
   rails (`RESEARCH.md` §4) extend into community: restriction-anxiety or
   self-harm-adjacent peer content triggers a **crisis-signposting** surface
   (eating-disorder + GP/clinician helplines), and any interaction surface carries
   **block / mute / report** and a minors-safeguarding posture (no private
   messaging with unverified accounts; no minor-targeted features).
7. **Owner-only WAC, fail-closed, ACL written first** for the user's own community
   data; **explicit per-item consent** for anything shared beyond owner-only. The
   shared container is a *separate* ACL scope from the diary — a share can never
   accidentally widen access to the diary itself (§4.3).

---

## 3. Phase 4A — Link into existing communities (READ-ONLY, lowest risk)

**Goal:** get the user to the good, already-moderated communities safely — and,
where a source honestly exposes a public feed, optionally surface it read-only —
without pretending we can aggregate closed platforms we cannot read.

### 3.1 Curated safe link-outs (the primary, honest shape)
A committed, hand-maintained catalog `lib/community/communities.ts` (title, org,
URL, one-line description, category, `moderated: boolean`, `audience` note),
rendered as accessible native links. This is the reliable core of 4A.

| Entry | Link | Note surfaced |
|---|---|---|
| **Coeliac UK — support & community** | coeliac.org.uk/living-with-coeliac-disease/community/ | UK charity; local groups + their app (member-gated) |
| **Coeliac UK — GF-accredited venue guide** | coeliac.org.uk/gluten-free-accredited-venues/ | Eating-out (§3.4 ties to `diet:context`) |
| **Find Me Gluten Free** | findmeglutenfree.com | Community venue reviews (eating-out complement) |
| **Celiac Disease Foundation** | celiac.org | US charity; label-reading + patient resources |
| **r/Celiac / r/Coeliac / r/glutenfree** | reddit.com/r/... | Large peer communities (Reddit-moderated) |
| **celiac.com forums** | celiac.com/forums/ | 30-yr peer forum (site-moderated) |
| **HealthUnlocked / patient.info coeliac** | healthunlocked.com, community.patient.info | Moderated patient communities |

- Rendered with the **accessible-html-links** skill: native `<a href>` with
  descriptive link text (WCAG 2.4.4), `target="_blank" rel="noopener noreferrer"`
  **plus `referrerPolicy="no-referrer"`** (so no in-app URL/path/referrer leaks to
  the destination — §rail 2), and a visible "opens in a new tab / external site"
  affordance. **Never** a `<div onclick>` navigation.
- Each entry states *who moderates it* and (where relevant) *audience/safeguarding*
  (e.g. the minor-only Coeliac UK Connect is described but not deep-linked to a
  minors' space).
- **No app-stored health data, no user identity** is sent by a link-out (network
  metadata caveat + `no-referrer` per §rail 2). The catalog is static + reviewed, so
  **in-app amplification of misinformation is avoided by construction** — but the
  targets are open peer forums where a user *can still encounter* unsafe health
  claims after navigating out (roborev Low, fixed). So each peer-community link-out
  carries an **external-community interstitial/warning** ("you're leaving for an
  external community — treat posts as personal experience, not medical advice; check
  the Research page") before hand-off. The guard is about what the *app* surfaces,
  not a claim to sanitise the destination.

### 3.2 Eating-out surfacing (composes with the diary — `DESIGN.md` §2.2 `diet:context`)
The one place a link-out becomes *personal and useful*: when the Phase-2 inference
engine flags **"your reactions cluster on `restaurant` meals"** (`RESEARCH.md`
§1.3, the `diet:context` field), the community surface offers the **Coeliac UK
venue guide + Find Me Gluten Free** link-outs in context — "find GF-accredited
places near you." This is the honest substitute for the venue data we cannot
ingest: we point at the authoritative guide rather than re-host it.

### 3.3 Optional read-only feed — a generic RSS/Atom source (upstream contribution)
Only a few sources expose a public feed. To surface those read-only (never
required), the clean path is to **contribute a `RssFeedSource` to
`@jeswr/solid-community-feeds`** (the "contribute features upstream to
packages-under-development" rule), matching the two existing sources' contract:

- New `RssFeedSource` mapping RSS 2.0 / **Atom** (Reddit `.rss` is Atom) →
  `CommunityMessage { source:"rss", author, body (sanitised), createdAt, permalink }`,
  fetched through the package's existing `safeFetch` (https-only, size-cap,
  timeout, no-redirect-chase), `fetch` injectable. HTML in feed bodies is **stripped
  to text** (`htmlToText` already exists) — no raw HTML render (stored-XSS guard).
- The coeliac-app configures it with a **committed allowlist of feed URLs only**
  (rail §4) — e.g. a reputable GF blog that publishes a feed (Coeliac Sanctuary),
  Nature's coeliac-disease subject feed (nature.com/subjects/coeliac-disease.rss —
  **verify live before building**), and, *if and only if* a live check confirms it
  still returns 200 for a server-region request AND we accept Reddit's terms,
  per-subreddit `.rss`.
- **Honesty flags on this whole option:**
  - Reddit `.rss` still-working is a **secondary-source claim, not live-verified**;
    Reddit's Data API terms **restrict** programmatic/commercial reuse — so the
    conservative default is **link-out, not feed**, and Reddit RSS is an
    explicitly-flagged, opt-in, terms-reviewed extra, not shipped by default.
  - celiac.com and HealthUnlocked expose **no feed** → link-out only, no feed
    possible.
  - This is **lower priority than 4B**. A curated link-out list already delivers the
    maintainer's "link into existing communities" ask; the RSS source is a
    nice-to-have that must not gate the phase.
- If built, the feed is **cached in the pod** (`…/health/diary/cache/community/`,
  owner-only, the Phase-3 caching pattern) and works offline; peer-content banner +
  dangerous-claims filter (§4.4) apply to every rendered item.

**Recommendation:** ship 4A as **curated link-outs first**; treat the `RssFeedSource`
as a documented, flagged follow-up (bead 4A-2) gated on a live per-source
verification + a terms review — not a launch blocker.

---

## 4. Phase 4B — The pod-owned peer layer (the differentiated feature)

**Goal:** let people with the condition **share what they've learned — safe foods,
safe venues, trigger experiences, elimination-diet tips — while owning the data and
without exposing that they have a health condition.** This is the Solid-native
feature no incumbent can offer, and the maintainer's "chat to other people with the
condition." It is **privacy- and safety-critical** and phases **read-first**.

### 4.1 What is shared — a *sanitised, derived* card, never the diary
The user never shares the diary. They share a small, deliberately-constructed,
pod-owned artifact, generated **from** their data but stripped of the sensitive
context:

| Shareable card | Derived from (built product) | What is STRIPPED |
|---|---|---|
| **Safe-foods card** (`diet:SafeFoodShare`) | Concluded `diet:ToleranceConclusion` (`verdict=tolerated`) + `diet:DietPlan` + specific `diet:FoodItem` product names the user *picks* | No symptoms, no severities, no Exposure evidence, no dates, no reaction detail, no genetics |
| **Safe-venue note** (`diet:SafeVenueShare`) | A `diet:Meal` with `diet:context=restaurant` + `diet:venue`, marked "no reaction", user-picked | No symptom/diary linkage, no other meals |
| **Trigger-experience note** (`diet:ExperienceShare`) | A free-text note the user writes (optionally seeded from a conclusion) | Nothing auto-included; user authors it |

- Sharing is a **deliberate, explicit action per card** ("Share this to the
  community"), never automatic, never a background sync. The generator produces a
  **new resource** in a *separate* shareable container (§4.3) — it does not widen
  access to any diary resource.
- Each card is modeled as an **`@jeswr/solid-chat-interop` `CanonicalMessage`**
  (`content` = the card text, `mediaType=text/plain`, `task` overlay unused) so it
  interoperates with the suite's chat/feed model and can be read by Pod Manager. New
  `diet:*Share` subclasses are additive in `@jeswr/solid-health-diary`
  (round-trip-tested, `parse∘build==identity`).
- **No diary provenance ever enters the shared resource** (roborev High, fixed).
  The shared card carries **no `prov:wasDerivedFrom` / `provenance.derivedFrom`
  pointing at any `/health/diary/` IRI** — even an owner-private diary IRI leaks
  diary structure and health context the moment the card is published. The
  user↔source link, if the user wants it for their own bookkeeping, lives **only in
  a separate owner-only sidecar** (`/community/shares/{ulid}.provenance.ttl`, its own
  never-widened ACL) that the share/publish path is structurally incapable of
  bundling into the public card. The §4.2 fail-closed guard enforces this: the card
  body/author/**provenance** must contain no `/health/diary/` IRI (tested).
- **No new share predicate is hand-built** — cards go through the chat-interop
  typed builders + `n3.Writer`; the `diet:*Share` class terms land in the `diet:`
  vocab (Phase-1 §2.1), SHACL-shaped.

### 4.2 Identity — pseudonymous by default (the load-bearing privacy control)
The single most important control: **a health condition must never be tied to the
real WebID without explicit, per-context consent.**

- The pod owner's **real WebID authenticates to their OWN pod** (unchanged).
- Community participation uses an **opt-in pseudonymous community identity**. For a
  **public** share the pseudonym MUST be **origin-unlinkable** — a **separate pod /
  account / origin** (or an omitted author), NOT merely a distinct path on the same
  pod (roborev High, fixed): a `/community/` path on the user's own pod shares the
  host/origin with their real WebID and is **trivially linkable** to the same
  person, so a same-pod pseudonym is **explicitly labelled linkable and unsafe for
  public sharing**. The share UI therefore offers two honest tiers: **(a)
  same-pod pseudonym** — allowed only for **owner-only or trusted-named-group**
  shares where the audience already knows the pod owner, with a clear "this is
  linkable to you" label; **(b) an unlinkable identity** (a separate pod/account, or
  author omitted) — **required** before a card can be made **public**. Either way the
  profile carries a display handle and **no `rdfs:seeAlso` / no back-link** to the
  health diary or the real profile, and shared cards' `CanonicalMessage.author` is
  the pseudonym (or omitted for public cards). A test asserts a **public** card can
  never carry a same-origin-as-diary author.
- A **generation-guard**: the share pipeline refuses to emit a card whose author,
  provenance, or body resolves to the real WebID or any `/health/diary/` IRI
  (tested — a fail-closed assertion, mirroring the genetics "raw bytes never leave"
  invariant). If the user *chooses* to share under their real identity (e.g. to a
  trusted dietitian, §4.5), that is a distinct, explicit, per-share opt-in with
  privacy copy ("this links your name to a coeliac-related post").
- **Default audience is nobody** (owner-only). Widening to a group or public is an
  explicit ACL action (§4.3) with a plain-language preview of *who will be able to
  read this and what it reveals*.

> **Design decision (documented per the "proceed on best call" rule, open a review
> issue):** pseudonymous community identity is the default. The alternative — a
> single real-WebID social graph — is rejected as unsafe for a sensitive-category
> condition. Genuinely-anonymous-yet-accountable identity (e.g. a ZK-backed
> unlinkable credential from the SPARQ suite) is a **future** enhancement, not the
> MVP; the MVP pseudonym is a plain separate profile with no diary back-link.

### 4.3 Storage + WAC (owner-controlled sharing, diary never widened)
```
/community/                       # SEPARATE root from /health/diary — its own ACL scope
  profile/card.ttl                # pseudonymous community profile (handle, avatar; NO diary link)
  shares/{ulid}.ttl               # a shared card (CanonicalMessage + diet:*Share)
  inbox/                          # LDN inbox (ldp:inbox) for replies / reports (opt-in)
  outbox/                         # AS2 outbox of the user's own shares (self-describing)
  blocklist.ttl                   # muted/blocked pseudonyms (client-enforced on read)
```
- **`/health/diary/` and `/community/` are DISJOINT ACL scopes.** A share writes a
  *new* resource under `/community/shares/`; nothing under `/health/diary/` ever
  changes ACL. A test asserts the share pipeline never issues a WAC write to a
  diary resource (fail-closed against accidental diary exposure).
- **Per-card ACL, written first** via `n3.Writer` / `@solid/object` typed
  accessors (never hand-built triples): default owner-only; widening to
  `acl:agentClass foaf:Agent` (public) or a named group is an explicit action with
  the who-can-read preview. The genetics/plan resources are **never shareable** —
  the share generator has no code path that reads them.
- **Discovery** is opt-in: a shared *public* card may register in the **public type
  index** under `diet:SafeFoodShare` so a coeliac federation (§4.5) can find it —
  but only public, pseudonymous cards; diary types stay in the **private** index
  (Phase-1 §2.3), never the public one. A test asserts no `diet:Meal`/`diet:Symptom`/
  `diet:GeneticSummary` ever reaches the public index.

### 4.4 Anti-misinformation content safety (health-critical, the reason to be careful)
A community around a chronic condition is a known vector for dangerous advice
(fake cures, self-administered gluten challenges without medical supervision,
"you can outgrow it / microdose it", enzyme-as-cure overselling, MMS/chelation
quackery). The app **refuses to amplify** it:

- **Structural separation (rail §1/§5):** peer content is never rendered in the
  same list or with the same authority styling as the Phase-3 credible-source
  knowledge. Peer cards always carry the "experience, not verified advice" banner
  and a "check the Research page" cross-link.
- **Curated dangerous-claims filter** (`lib/community/safety-lexicon.ts`, a
  committed, reviewed, testable list of patterns): any rendered peer/feed body
  matching it is **collapsed behind a warning** ("This mentions a claim that
  contradicts medical guidance — see the Research page") rather than shown inline.
  Fail-safe: an ambiguous match collapses (shows the warning), it does not silently
  pass. The lexicon is **not** an LLM classifier by default (deterministic,
  auditable); an injectable-LLM seam may *assist* but never replaces the
  deterministic rules and never sends the user's data.
- **No LLM paraphrase of medical claims** (inherits Phase-3 §3.4.4): the app does
  not turn peer text into new medical assertions.
- **Provenance + reachability:** every peer item shows its source + a permalink to
  the original so the reader can judge it — we surface, we don't launder.
- **This is client-side + user-side** (there is no central server to moderate): the
  guard protects the *in-app reader* and refuses amplification; it does not claim to
  moderate other platforms. Combined with block/mute/report (§4.6) and the
  curated-source allowlist, this is the honest decentralised moderation posture.

### 4.5 Discovery + interaction — read-first, conservative phasing
- **Read-first MVP:** the peer layer ships first as **read + share-out**: a user can
  publish a sanitised public card and read others' *public* pseudonymous cards
  discovered via a **curated community registry** (a small committed list of
  known-good sharing endpoints / a `@jeswr/federation-registry` "gluten-free
  community" federation entry). No open crawling. Reading applies §4.4 + §4.6.
- **Interactive replies (later, gated):** if two-way discussion is wanted, reuse
  `@jeswr/solid-chat-interop` `CanonicalMessage` over an **LDN inbox** (`ldp:inbox`,
  POST an AS2 reply) — the suite/LD convention (memory: *Linked Data API
  conventions* — LDN inbox for POST). No new chat system. **Reply/report POST
  targets MUST be on the committed host allowlist (roborev Medium, fixed):** a
  *discovered* `ldp:inbox` is a user/pod-supplied URL, so POSTing a report or reply
  to it verbatim violates the "no user-supplied-URL fetch" rule (rail §4) and could
  leak report content or network metadata to an attacker-controlled endpoint. So:
  the app POSTs **only to reviewed, allowlisted moderation/reply inboxes** (the
  curated registry's own inboxes); for any non-allowlisted target a report is kept
  **local** (`/community/blocklist.ttl` + a client-side hide) and/or the user is
  handed the destination platform's **native report link** with explicit consent —
  never a silent cross-origin POST. Allowlisted inbox writes are SSRF-guarded
  (`guarded-fetch`), rate-limited client-side, and reply bodies pass §4.4 + are
  stored `text/plain` (never raw HTML). **Private 1:1 messaging is explicitly
  deferred** and gated on the safeguarding review (§4.6) — it is the highest-risk
  surface (grooming/harassment/minors) and must not be built casually.
- **Federated discovery (optional, later):** a signed **`@jeswr/federation-trust`**
  membership over a coeliac community federation gives *accountable pseudonymity* —
  a pseudonym provably belongs to a vetted community without revealing the real
  WebID. Conservative: this is a future enhancement; the MVP is a curated registry +
  block/report.

### 4.6 Safeguarding, moderation & crisis rails (non-negotiable)
- **Block / mute / report** on every peer item and every pseudonym
  (`/community/blocklist.ttl`, client-enforced on read). A report POSTs an LDN
  notification **only to an allowlisted moderation inbox** (§4.5, roborev Medium);
  for any other source the report is kept **local** and the user is offered a
  link-out to the platform's **native** report mechanism — never a silent POST to a
  discovered inbox.
- **Vulnerable-user safeguarding:** the ARFID/orthorexia safeguard (`RESEARCH.md`
  §2.8) extends here — the app **never** gamifies restriction in a social frame (no
  "strictest diet" leaderboards, no avoidance streaks shared), and biases community
  prompts toward *reintroduction/expansion successes* consistent with §4.3 of the
  inference design.
- **Crisis signposting:** peer content (or the user's own pattern) indicating
  restriction-anxiety, disordered eating, or self-harm-adjacent distress triggers a
  **crisis-signposting surface** (eating-disorder helpline + "talk to your GP /
  dietitian" — the `RESEARCH.md` §4 rails), shown non-judgementally, never
  correlated-away.
- **Minors:** no minor-targeted features; no unverified-account private messaging;
  the minor-only Coeliac UK Connect is described, not integrated. A safeguarding
  note is documented for the maintainer (§5) — a real social feature touching a
  health condition may need a formal safeguarding/DPIA review before any
  interactive/messaging surface goes live.

---

## 5. What needs a partnership / permission — or is out of scope (flagged)
Per the "proceed on best call, document, steer after" rule, these are the genuinely
human-gated items; the buildable parts (link-outs, the pod-owned peer layer)
proceed around them.

- **Coeliac UK data integration (venue guide / product checker / food-drink guide)
  → PARTNERSHIP, `needs:user` / outreach.** There is no public API; the data is
  FoodMaestro's commercial, member-gated database. Any *data* integration requires a
  **content/data partnership** via `commercial.coeliac.org.uk/contact-us` (or the
  charity-collaboration/research route). **Draft outreach ask** (maintainer sends,
  identifying as the PSS/@jeswr suite): *"a privacy-first, pod-owned coeliac diary
  that keeps users' data in their own control; we link out to your venue guide and
  resources with attribution and would value a conversation about a respectful data
  or content collaboration."* **Realistic expectation: low** — they already have a
  commercial app partner (FoodMaestro); a *link/content* collaboration or a charity
  cross-promotion is far more plausible than a data API. **Until/unless a partnership
  exists: deep link-out only, attributed, never scraped.**
- **Reddit `.rss` surfacing → terms review + live verification, `needs:user`-ish.**
  Fragile (not live-verified this session) and Reddit's Data API terms restrict
  reuse. Default is link-out; RSS surfacing is an explicitly-flagged, opt-in extra
  gated on (a) a live per-source 200 check and (b) a terms review. Do not ship it by
  default.
- **A formal safeguarding / DPIA review before any *interactive* community surface
  (replies, and especially 1:1 messaging) goes live → `needs:user`.** A social
  feature around a health condition touching potentially-minors and
  eating-disorder-vulnerable users warrants a maintainer decision + possibly a DPIA.
  The read-only link-outs (4A) and the share-out-only peer layer (4B read-first) do
  not need this; **private messaging is deferred until it happens.**
- **CORE-PSS server changes: NONE required.** The community layer is a pure Solid
  *client* over standard LDP + WAC + LDN inbox — any compliant pod (CSS/PSS/ESS)
  works. Flagged explicitly so no builder assumes a server change.
- **`diet:*Share` w3id terms** land in the existing `diet:` namespace redirect
  (already a Phase-1 `needs:user`); no new redirect needed.

---

## 6. Where the code lands (concrete, mirrors Phase-3 structure)
```
src/lib/community/
  communities.ts          # curated safe link-out catalog (4A) — reviewed, static
  allowlist.ts            # link-out + fetch host allowlist (extends Phase-3 §3.4)
  safety-lexicon.ts       # curated dangerous-claims patterns (4B §4.4) — reviewed, tested
  share.ts                # sanitised-card generator (4B §4.1) — fail-closed identity guard
  feed.ts                 # optional read-only feed adapter (4A §3.3) if RssFeedSource ships
app/community/
  page.tsx                # link-outs + eating-out context + (optional) read-only feed
  share/…                 # "share a safe-foods / safe-venue card" flow (4B), consent preview
components/community/
  PeerContentBanner.tsx   # the "experience, not advice" banner (rail §1)
  CommunityLink.tsx       # accessible external link (accessible-html-links skill)
  ShareConsentPreview.tsx # "who can read this / what it reveals" preview (4B §4.2/§4.3)
  CrisisSignpost.tsx      # eating-disorder + clinician signposting (rail §6)
```
- New `@jeswr/solid-health-diary` terms: `diet:SafeFoodShare`, `diet:SafeVenueShare`,
  `diet:ExperienceShare` (additive, round-trip-tested), authored via chat-interop
  builders + `n3.Writer` — never hand-built.
- New `@jeswr/solid-community-feeds` `RssFeedSource` (optional, upstream PR) — only
  if 4A-2 proceeds.

---

## 7. Read-vs-write phasing (safety-ordered)
1. **4A link-outs (READ, no identity, no fetch of user data)** — ship first;
   lowest risk; satisfies "link into existing communities."
2. **4A optional read-only feed (READ, guarded, cached)** — flagged/gated (§3.3,
   §5); not a blocker.
3. **4B share-out (WRITE, owner-authored, pseudonymous, per-item consent)** — the
   differentiated feature; **security/privacy-critical** → exhaustive tests
   (identity fail-closed guard, diary-never-widened, public-index-never-leaks-diary,
   sanitisation) + roborev + adversarial `honest && recommendArm` verify before
   merge.
4. **4B read others' public cards (READ, filtered)** — with §4.4 + §4.6 applied.
5. **Interactive replies via LDN inbox (WRITE, gated)** — after 3/4 are solid;
   guarded, rate-limited, `text/plain`, §4.4/§4.6 enforced.
6. **Private 1:1 messaging** — **deferred**, gated on the safeguarding/DPIA review
   (§5). Not in the Phase-4 build.

---

## 8. Security & privacy posture (summary)
- **Health condition never tied to the real WebID by default** — pseudonymous
  community identity, no diary back-link, fail-closed generation guard (§4.2).
- **Diary is never shared and never has its ACL widened** — shares are separate,
  derived, sanitised resources in a disjoint `/community/` scope; genetics + plan
  have no share code path (§4.1/§4.3).
- **No health data to any community or third party** — link-outs send nothing;
  shares send only user-picked, sanitised, pseudonymous content (§rail 2).
- **SSRF-safe foreign fetch** — link-out + fetch host allowlist on top of
  `guarded-fetch` / the community-feeds `safeFetch`; https-only, no
  user-supplied-URL fetch, no redirect-chase, size/timeout capped (§rail 4).
- **Stored-XSS guard** — all peer/feed bodies rendered as `text/plain`; feed HTML
  stripped via `htmlToText`; no raw HTML render (§3.3/§4.5).
- **Anti-misinformation** — structural separation + curated deterministic
  dangerous-claims filter + no LLM medical paraphrase + provenance/reachability
  (§4.4).
- **Safeguarding** — block/mute/report everywhere, crisis signposting, no
  restriction-gamification, minors posture, DPIA-gated interactive surfaces (§4.6).
- **Owner-only WAC, fail-closed, ACL written first**; DPoP-authed; type-index
  discipline (diary private, only public sanitised cards public) (§4.3).

---

## 9. What I could NOT verify (flagged, not stated as fact)
- **Reddit `.rss` still returning 200 for a server-region programmatic request**
  in July 2026 — asserted only by RSS-vendor secondary sources; NOT live-verified
  this session. Treat as fragile + terms-encumbered; default to link-out (§3.3/§5).
- **Nature / Coeliac Sanctuary / any specific feed URL** — not live-verified;
  verify each returns a valid feed before adding it to the allowlist.
- **Whether Coeliac UK would entertain any data/content partnership** — unknown;
  their public pages advertise no data route (§1.1); this is an outreach unknown,
  not a fact (§5).
- **Any *current* coeliac Matrix/Lemmy/Mastodon community large enough to feed** —
  searches surfaced none; if one emerges, `MatrixFeedSource` could read it, but
  none is assumed to exist today.
- **Exact GDPR/DPIA obligations** for a pseudonymous health-adjacent social feature
  — flagged as a maintainer/legal review item (§5), not asserted here.

---

## 10. Build-ready follow-up beads
> Shared contract (BUILD-PLAN.md): own worktree+branch off `origin/main`; stage only
> changed paths; no push/merge; gate in-worktree; Fable trailers + `AUTHORED-BY
> Claude Fable 5`; signing-disabled commits; every foreign fetch through
> `@jeswr/guarded-fetch` / the community-feeds `safeFetch`; unit-testable with a
> stubbed fetch; roborev PASS; security-sensitive briefs get exhaustive tests +
> adversarial verify before arming. Depends on Phase-1C shell.

- **4A-1 — Community link-outs + eating-out surfacing** (pod-app-builder). Curated
  `communities.ts` catalog + `allowlist.ts`; accessible `<CommunityLink>`
  (accessible-html-links skill, `rel="noopener noreferrer"` +
  `referrerPolicy="no-referrer"`, external-community interstitial per §3.1); the
  `diet:context=restaurant` → venue-guide surfacing (§3.2); `<PeerContentBanner>` +
  `<MedicalDisclaimer>` on the view.
  **Acceptance:** native `rel="noopener noreferrer"` + `referrerPolicy="no-referrer"`
  links (asserted by a test); a11y clean; banner + disclaimer asserted present; no
  fetch of user data; no app-stored health data intentionally egressed.
- **4A-2 — (optional, flagged) `RssFeedSource` upstream + read-only feed** (suite-
  package-author for the package PR; pod-app-builder for the view). Contribute
  `RssFeedSource` to `@jeswr/solid-community-feeds` (Atom/RSS → `CommunityMessage`,
  via `safeFetch`, HTML→text); coeliac-app committed feed-URL allowlist; pod-cached
  offline; §4.4 filter applied. **Gated** on live per-source 200 verification + a
  Reddit-terms review (§3.3/§5). **Not a launch blocker.**
- **4B-1 — Sanitised share-card model + generator** (auth-specialist or claude with
  security focus). `diet:SafeFoodShare`/`SafeVenueShare`/`ExperienceShare` in
  `@jeswr/solid-health-diary` (round-trip-tested); `share.ts` generator emitting a
  `@jeswr/solid-chat-interop` `CanonicalMessage`; **fail-closed identity guard**
  (no real WebID / no `/health/diary/` IRI ever in author/provenance/body);
  disjoint `/community/` ACL scope, owner-only default, ACL written first.
  **PRIVACY-CRITICAL:** exhaustive tests (identity guard, diary-never-widened,
  public-index-never-leaks-diary, sanitisation) + roborev + adversarial verify.
- **4B-2 — Pseudonymous community identity + share consent UX** (pod-app-builder).
  Community profile (no diary back-link), the per-card "share" flow with a
  who-can-read/what-it-reveals `<ShareConsentPreview>`, block/mute list.
  **Acceptance:** default owner-only; widening is explicit with preview; pseudonym
  default; real-identity share is a distinct opt-in with privacy copy.
- **4B-3 — Read others' public cards + anti-misinformation + safeguarding rails**
  (pod-app-builder). Curated community registry read; deterministic
  `safety-lexicon.ts` dangerous-claims filter (collapse-behind-warning, fail-safe);
  `<CrisisSignpost>`; block/report; structural separation from Research.
  **Acceptance:** dangerous-claim fixtures collapse; crisis rail present; peer
  content never styled as verified knowledge; roborev PASS.
- **4B-4 — (deferred, gated) Interactive replies via LDN inbox** (pod-app-builder).
  AS2 reply POST **only to an allowlisted moderation/reply inbox** (§4.5 — never a
  discovered/user-supplied inbox), guarded + rate-limited + `text/plain` + §4.4/§4.6.
  Gated after 4B-1..3 land. **Private 1:1 messaging remains deferred on the
  safeguarding/DPIA review (§5).**
- **needs:user / outreach (surfaced):** Coeliac UK data/content partnership ask
  (§5); safeguarding/DPIA review before any interactive surface (§5); Reddit-terms
  + live-feed verification for 4A-2 (§3.3).

---

*Authored by Claude Fable 5. Research verified against primary sources live
2026-07-03; every unverified claim is flagged in §9. This is a design document
(`docs/design/`) — it changes no application code.*
