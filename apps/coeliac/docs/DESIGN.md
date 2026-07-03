<!-- AUTHORED-BY Claude Fable 5 -->

# Coeliac & Multi-Intolerance App — Design (the build contract)

> The complete, grounded design for the full product build-out of
> `jeswr/coeliac-app`. Evidence lives in `docs/RESEARCH.md`; the phased builder
> briefs live in `docs/BUILD-PLAN.md`. This document is the contract builder
> agents implement against.
>
> **Framing rule, everywhere in the product:** this is **decision support, not
> diagnosis**. Every inference, every conclusion, every pipeline page carries a
> medical-disclaimer frame and, where relevant, a "see a doctor" rail
> (`RESEARCH.md` §4). The app never tells anyone they have a disease.

---

## 0. Product thesis in one line
A pod-owned, multi-intolerance health diary whose **make-or-break feature is
frictionless logging** (5-second scan-or-say), whose **inference engine respects
symptom lag** (24–72 h for gluten, tight windows for lactose/sulphites), and
whose **structured elimination protocols** turn the multi-year "what else is
wrong with me?" odyssey into a guided, one-variable-at-a-time process — with the
diary owned by the user, forever, in their Solid pod.

The three things incumbents each do *one* of — safe-at-shelf scanning, symptom
diary, lagged correlation — this app does **all three, joined, across all
intolerances at once** (`RESEARCH.md` §1.2).

---

## 1. Architecture decision: Next.js (keep) — justified

**Decision: keep Next.js (App Router) on Vercel; adopt the suite stack on top of
it. Do NOT rewrite to the vite pod-app pattern.**

Rationale:
- `coeliac-app` is **already deployed on Vercel** at `coeliac-app.vercel.app`
  with a Next.js scaffold (`main` = `next@15.4.6`, React 19). Vercel Hobby
  deploy-on-commit is the maintainer's standing preference for apps that fit
  (memory: *Vercel free deploy preference*). Rewriting to vite throws that away
  for no user benefit.
- Next.js gives us **static export of the knowledge pages** (drug-pipeline
  explainer, research feed shell) and a natural home for the **Client ID
  Document** (`/clientid.jsonld`) — the `solid-client-id` skill documents the
  exact Next.js/Vercel serving recipe. Everything data-facing is client-only
  (pod fetches), so we use `"use client"` islands; no server of ours touches
  health data (privacy invariant).
- **PR #9 (Next 16) has NOT landed** (still open dependabot at time of design);
  build on the current `next@15.4.6` line off `origin/main`. Next 16 upgrade is a
  separate, mergeable dependabot concern — do not couple the product build to it.
  (If a builder takes Next 16, run `vercel:next-upgrade` codemods as its own PR.)

**The suite stack applies regardless of framework** (this is the non-negotiable
part):
- **Login/chrome:** `@jeswr/app-shell` (ThemeProvider/AccountMenu/FeedbackButton)
  + `@jeswr/solid-elements` `<jeswr-login-panel>` (wraps reactive-auth) —
  same as Pod Manager and the pod-apps. Do NOT hand-roll login.
- **Session:** `@jeswr/solid-session-restore` for silent DPoP refresh-token
  restore on load (cross-app UX invariant #1 — `AGENTS.md`). Reopening the tab
  restores silently, no re-login.
- **Auth seam:** every data view takes an **injectable `fetch`** (`.fetch` /
  `.publicFetch` / `.webId` seam) so the whole app is unit-testable with a
  stubbed fetch and no server (suite convention).
- **RDF:** parse via `@jeswr/fetch-rdf` (`fetchRdf`/`parseRdf`, keep the ETag),
  extract via `@solid/object`/`@rdfjs/wrapper` typed accessors, serialise via
  `n3.Writer` (or `@jeswr/rdf-serialize`). **Never hand-build triples.**
- **Client ID:** publish a stable Client Identifier Document (`solid-client-id`
  skill) so the consent screen shows "Coeliac Diary", not a random registration.
- **Offline:** `@jeswr/solid-offline` SW layer for instant offline load (UX
  invariant #3) — logging must work with no connectivity and sync later.
- **Foreign-origin fetch (OFF/CTGov/EPMC/openFDA):** SSRF-conscious via
  `@jeswr/guarded-fetch` browser policy; https-only; these are public read-only
  APIs but still go through the guard + are **cached in the pod**, not re-hit.
- **Lockfile #78:** no `git+ssh://` @jeswr deps; consume suite packages by
  `github:jeswr/<repo>#main` (committed dist) or published version where one
  exists (`@jeswr/fetch-rdf@0.1.0`).

**What we are NOT doing:** no server-side storage of health data, no analytics on
health data, no third-party health SDKs. The only network egress is: the user's
pod (authed), and four public read-only knowledge APIs (unauthed, guarded,
cached).

---

## 2. Data model — `@jeswr/solid-health-diary`

A **new public `@jeswr/` package** (repo `jeswr/solid-health-diary`), following
the `@jeswr/solid-task-model` template exactly: `TermWrapper`-based typed
accessors, `parseX` / `buildX` (→ `n3` `Store`) / `serializeX` per entity, IRI
helpers, `./` root browser-safe + `./shape` Node-only SHACL helpers, committed
self-contained `dist/`, GitHub-installable.

### 2.1 Vocabulary strategy — extend the existing `health` sector, don't fork
The suite **already ships a gUFO-rooted `health` sector**
(`solid-federation-vocab/sectors/health`, FHIR-R4/R5 + SNOMED/LOINC aligned via
`skos:closeMatch`, QUDT/UCUM units, the Patient-role-vs-Record-document split).
Reuse it; add the **nutrition/intolerance domain terms it lacks** as a companion
namespace. Concretely:
- **Reuse from existing vocabs (real terms, no invention):**
  - `schema:` — `schema:Meal`, `schema:Recipe`, `schema:NutritionInformation`,
    `schema:Restaurant`, `schema:FoodEstablishment`, `schema:MedicalCondition`,
    `schema:startTime`/`endTime`.
  - `health:` sector — `health:Patient` (the pod owner), `health:Observation`/
    `health:Condition` for symptom records + the Patient/Record split, QUDT units
    for severity/quantity where a real unit applies.
  - `time:` (OWL-Time) — for lag intervals (`time:Interval`, `time:hasBeginning`).
  - `prov:` — provenance (a conclusion `prov:wasDerivedFrom` the exposures +
    symptoms it rests on; a scan `prov:wasGeneratedBy` the OFF lookup).
  - `dcterms:` — `created`/`modified`/`source`.
- **New `diet:` namespace** (`https://w3id.org/jeswr/sectors/health/diet#`, a
  sub-module of the health sector so it inherits Core-rooting; w3id redirect =
  `needs:user`) for the genuinely-missing concepts below. Author it gUFO-rooted
  and SHACL-shaped to match the sector contract; contribute it to
  `solid-federation-vocab` as `sectors/health/diet` (or a new `nutrition`
  sub-sector) — **coordinate in that repo, don't invent a rival vocab.**

### 2.2 Entities (each = one pod resource type, owner-only ACL, one accessor)
All entities are `health:`-sector records **`core:about` the pod-owner Patient**,
carrying `dcterms:created`, provenance, and a stable slug-derived IRI.

1. **Meal / Intake event** — `diet:Meal` (⊑ `schema:Meal`)
   - `schema:startTime` (xsd:dateTime — the *ingestion* time; load-bearing for lag).
   - `diet:context` ∈ {`home`, `restaurant`, `work`, `travel`, `other`} — the
     eating-out signal (`RESEARCH.md` §1.3). Optional `schema:location` /
     `diet:venue` (free text or a `schema:Restaurant` ref).
   - `diet:hasItem` → one or more **FoodItem** nodes.
   - `diet:portion` (qualitative small/normal/large, or a QUDT quantity).
   - `diet:note` (xsd:string), optional `schema:image` (pod-stored packet photo).
2. **FoodItem** — `diet:FoodItem`
   - `schema:name` (text).
   - `diet:offBarcode` (the GTIN/EAN) + `diet:offRef`
     (`https://world.openfoodfacts.org/product/{barcode}` — the OFF reference,
     ODbL-attributed) when scanned.
   - `diet:ingredientsText` (cached OFF `ingredients_text`, or OCR draft
     **flagged `diet:sourceConfidence "ocr"`**).
   - `diet:declaredAllergen` → allergen codes (from OFF `allergens_tags`).
   - `diet:traceAllergen` → "may contain" (OFF `traces_tags` — cross-contam).
   - `diet:additive` → OFF `additives_tags` (the sulphite hook E220–E228).
3. **Exposure (derived)** — `diet:Exposure`
   - The engine-derived trigger content of a meal: `diet:trigger` → a
     **TriggerClass** (see §2.3), `diet:exposureLevel` ∈
     {`present`, `trace`, `possible-undeclared`, `absent`}, `diet:derivedFrom`
     (`prov:wasDerivedFrom` the FoodItems/tags it came from — full transparency).
   - `possible-undeclared` encodes the sub-10-ppm sulphite / high-risk-category
     honesty flag (`RESEARCH.md` §2.7): "clean tags but a category that commonly
     hides this trigger."
4. **Symptom** — `diet:Symptom` (a `health:Observation` about the Patient)
   - `diet:symptomType` (SKOS-coded: bloating, diarrhoea, constipation,
     abdominal-pain, brain-fog, headache, fatigue, skin/rash, wheeze/breathing,
     nausea, reflux, joint-pain, mood — extensible; SNOMED closeMatch where clean).
   - `diet:severity` (0–10 or none/mild/moderate/severe; store an ordinal).
   - `schema:startTime` (**onset** time — the other half of the lag calculation)
     + optional `diet:duration` (`time:` interval).
   - `diet:note`.
   - **breathing/anaphylaxis type is specially flagged** → the UI shows the
     emergency rail, never "we'll correlate it" (`RESEARCH.md` §4).
5. **TriggerClass** — `diet:TriggerClass` (a SKOS concept in a pod-local or
   published scheme): `gluten`, `lactose`, `fructose`, `fructan`, `galactan`
   (GOS), `polyol` (sorbitol/mannitol), `sulphites`, `histamine`, `nuts`,
   `soy`, `egg`, `caffeine`, … each carrying an **evidence-prior lag profile**
   (`diet:lagWindowMin`/`Max` in hours + `diet:lagMode`) seeded from
   `RESEARCH.md` §2.1 and **learnable per-user later**.
6. **EliminationProtocol** — `diet:EliminationProtocol` (a state machine, §3)
   - `diet:targetTrigger` → a TriggerClass.
   - `diet:phase` ∈ {`baseline`,`eliminate`,`washout`,`reintroduce`,`observe`,
     `concluded`}.
   - `diet:phaseStarted`, `diet:phasePlannedEnd`, per-phase durations
     (defaults from §2.4, user-adjustable).
   - `diet:challengeStep` (dose escalation within reintroduce).
   - **invariant: at most ONE protocol per pod may be in an active
     `reintroduce`/`observe` phase at a time** (concurrent challenges destroy
     attribution — enforced in the accessor + UI).
7. **ToleranceConclusion** — `diet:ToleranceConclusion`
   - `diet:aboutTrigger` → TriggerClass.
   - `diet:verdict` ∈ {`tolerated`,`reacts`,`dose-dependent`,`inconclusive`}.
   - `diet:confidence` (an ordinal + a plain-language string — **never a bare
     percentage that implies precision**).
   - `prov:wasDerivedFrom` → the exposures/symptoms/protocol it rests on
     (tap-through evidence).
   - `diet:reviewAfter` (xsd:date) — **secondary intolerances are time-boxed**;
     a lactose conclusion during villous healing gets a re-challenge date
     (`RESEARCH.md` §2.2). This is the feature that serves the multi-year journey.
8. **GeneticSummary** — `diet:GeneticSummary`
   - **ONLY the interpreted summary is stored** (`diet:hlaMarker` rsID → genotype
     → interpretation; e.g. `rs2187668` present → DQ2.5 risk haplotype). The
     **raw genotype file NEVER enters the pod** (parsed on-device, discarded).
   - `diet:geneticInterpretation` — always negative-predictive-framed text
     (`RESEARCH.md` §2.5) + a "chip may not tag all risk alleles" incompleteness
     caveat.
   - `diet:enteredManually` boolean (manual entry path vs parsed-upload path).
9. **DietPlan** — `diet:DietPlan` — the current working exclusion set
   (`diet:excludes` → TriggerClasses, with the ToleranceConclusion each rests on),
   generated from conclusions; the "what am I currently avoiding and why" view.

### 2.3 Storage layout in the pod (LDP containers)
```
/health/diary/
  meals/{yyyy}/{mm}/{ulid}.ttl        # Meal + its FoodItems + derived Exposures
  symptoms/{yyyy}/{mm}/{ulid}.ttl     # Symptom
  protocols/{ulid}.ttl                # EliminationProtocol (mutable state machine)
  conclusions/{trigger}.ttl           # ToleranceConclusion (one per trigger, updated)
  genetics.ttl                        # GeneticSummary (summary only)
  plan.ttl                            # DietPlan
  triggers.ttl                        # per-user TriggerClass lag profiles
/health/diary/cache/off/{barcode}.ttl # cached OFF product (ODbL-attributed)
```
- **ACL: owner-only, fail-closed, written first** via `n3.Writer` on container
  creation (the suite fork recipe). Nothing here is ever public. Genetics + the
  restriction plan are the most sensitive — same owner-only ACL, no exceptions.
- Month-bucketed meal/symptom containers keep listings small (the sharding
  convention) and make date-range queries cheap.
- Type-index registration (`solid-type-index` skill): register `diet:Meal`,
  `diet:Symptom`, etc. in the **private** type index so Pod Manager and future
  apps can discover the diary (privately). Never the public index.

---

## 3. The elimination-protocol state machine (spec)
From `RESEARCH.md` §2.4. A pure, testable reducer `advance(protocol, event,
now) → protocol'` (no I/O; fully unit-testable):

```
baseline ──(baseline period elapsed, symptom baseline captured)──▶ eliminate
eliminate ──(elimination period elapsed, symptoms improved?)────▶ washout
                                    │
                                    └(no improvement)──▶ concluded[verdict=trigger-not-implicated]
washout   ──(washout ≥ N days, back to clean baseline)──────────▶ reintroduce
reintroduce ──(dose step, observe reaction)─────────────────────▶ observe
observe   ──(reaction at dose D)────────────────────────────────▶ concluded[reacts | dose-dependent]
observe   ──(no reaction through max dose)──────────────────────▶ concluded[tolerated]
concluded ──(reviewAfter date reached, secondary intolerance)───▶ (offer re-challenge → new protocol)
```
- **Defaults (user-adjustable, sourced §2.4):** baseline 3–7 d; eliminate
  2–6 wk (FODMAP-style); washout ≥3 d; reintroduce dose steps over ~3 d; observe
  per-trigger lag window; re-challenge interval for secondary intolerances tied
  to the ≥6-month healing timeline (§2.2).
- **One active challenge invariant** (§2.4) enforced.
- Each transition **schedules a prompt** ("Day 3 of washout — log how you feel";
  "Time to reintroduce lactose, small dose"). Prompts are supportive, never
  restrictive-gamified (`RESEARCH.md` §2.8).
- The engine **proposes** the next protocol from the suspicion ranking (§4) but
  the user always confirms — decision support, not autopilot.

---

## 4. The inference engine (client-side, transparent, lag-aware)
A pure functional core (`packages`/app-lib), fully unit-testable, no I/O.

### 4.1 Lagged exposure↔symptom correlation
- For each Symptom at onset `t`, and each TriggerClass `c`, look back over the
  **trigger-specific lag window** `[t − lagMax(c), t − lagMin(c)]` for Exposures
  to `c`. **Per-class windows** (not one global window) — gluten wide/right-skew
  (~0–72 h), lactose/sulphite tight (~0.5–6 h), FODMAP subgroups mid
  (`RESEARCH.md` §2.1). This is the core correctness requirement.
- Score = a **transparent, explainable** association (exposure-symptom
  co-occurrence within window, adjusted for base rates of both), not a black box.
  Show the actual paired events behind every score (tap-through). Prefer an
  interpretable measure (e.g. lift / conditional rate with counts shown:
  "symptoms followed 7/9 gluten exposures within 6–48 h vs 2/20 gluten-free
  days") over an opaque coefficient.
- **Confounder honesty:** flag when a suspected trigger co-occurs with another
  (can't separate lactose from gluten if they always appear together → that's
  exactly what a *protocol* resolves). Surface "needs an elimination test to
  confirm."

### 4.2 Confidence display — the anti-overclaim rule
- **Never** show a diagnosis. Ordinal confidence (`emerging` / `suspected` /
  `likely` / `confirmed-by-your-own-test`) with the *count* of supporting events
  and always the caveat: "this is a pattern in your data, not a diagnosis."
- A conclusion only reaches `confirmed-by-your-own-test` via a completed
  **elimination protocol** (§3), not correlation alone. Correlation *proposes*;
  the protocol *confirms*. This is the scientific spine and the anti-confirmation-
  bias guard (`RESEARCH.md` §2.8 adversarial notes).

### 4.3 Elimination-diet proposal generation
- From the current suspicion ranking, propose the highest-value next protocol
  (most-suspected, least-confounded, safe-to-test trigger). Never propose
  eliminating gluten *pre-diagnosis* — hard block + "get tested first while still
  eating gluten" (`RESEARCH.md` §4).
- **Bias toward reintroduction/expansion where safe** (orthorexia guard): when a
  secondary-intolerance conclusion passes its `reviewAfter` date, proactively
  propose a re-challenge — the app's job is to *shrink* the avoid-list where
  evidence allows, not grow it.

### 4.4 Safety rails (hard-coded, non-correlated)
The engine short-circuits to the "see a doctor" / emergency UI on:
- breathing-difficulty/anaphylaxis symptom type → **emergency** framing;
- alarm symptoms (weight loss, GI bleeding, persistent vomiting, dysphagia,
  anaemia flags) → urgent-care prompt;
- persistent symptoms despite strict adherence → gastroenterology referral text;
- restriction-anxiety / rapidly-shrinking diet pattern → dietitian prompt.
(All per `RESEARCH.md` §4. These are rules, not inferences — they never get
"correlated away".)

---

## 5. Logging UX — the make-or-break feature (design the 5-second path)
The maintainer's explicit priority: **as easy as possible.** Three capture
modes, all landing in the same quick-entry sheet; **the happy path is ≤5 s.**

### 5.1 The 5-second happy paths
1. **Scan (primary):** open app → camera is already live (`zxing-wasm`) → point
   at barcode → OFF lookup (cached) → product + derived exposures shown → one tap
   "Ate it now" → saved. Time/context default to now/last-used.
2. **Repeat (the killer shortcut — meals recur):** home screen shows **"Recent"
   and "Frequent"** meals as one-tap re-log chips ("Log again"). Most real
   logging is repetition (`RESEARCH.md` §1.2 gap: nobody does this well). One tap
   = a new Meal cloned from a past one with `startTime = now`.
3. **Say it:** hold the mic → "porridge with oat milk and a handful of
   raisins" → deterministic food-phrase parser splits into FoodItems → optional
   LLM seam refines free text → confirm sheet → save.
4. **Symptom quick-log:** a persistent "How do you feel?" affordance → tap a
   symptom chip + severity slider → saved with onset=now. Two taps.

### 5.2 Capture pipeline details
- **Barcode → OFF:** `zxing-wasm` decode → `guardedFetch` OFF v2 (CORS-verified,
  §RESEARCH 3.1) with the descriptive UA where settable → cache product TTL in
  pod (`/health/diary/cache/off/`) → derive exposures from `allergens_tags` +
  `traces_tags` + `additives_tags` + ingredient-text alias scan (sulphite
  aliases, §RESEARCH 2.7). **Attribute Open Food Facts** on every product view
  (ODbL). Manual barcode entry fallback (scanner fails on damaged/tiny codes,
  §RESEARCH 3.6).
- **OCR fallback (packet photo):** `tesseract.js` on-device → extracted text is a
  **draft the user confirms** (marked `sourceConfidence "ocr"`), NEVER fed
  straight into inference (Tesseract ~80% coverage, error-prone on panels —
  §RESEARCH 3.6). Photo stored in pod (owner-only), optional.
- **Voice:** Web Speech API (`SpeechRecognition`) → deterministic parser
  (quantity + food-noun grammar, unit words, "handful/slice/cup") → **optional
  injectable-LLM seam** (`parseMealText(text, {llm?})`) for free-text; **no key
  baked in** — the seam takes a caller-provided function or stays deterministic.
  Progressive enhancement: Chromium-only, so mic is additive, never required
  (§RESEARCH 3.6).
- **Offline:** all capture works offline (`@jeswr/solid-offline` SW); OFF lookups
  queue and reconcile; meals persist to a durable client cache first
  (optimistic), sync to pod when online (UX invariants #2/#3).

### 5.3 Anti-friction principles
- Time & context **default and are one-tap to change**, never a required form.
- **Optimistic writes** with a small "Saving…/Saved" indicator (UX invariant #2);
  failure reverts + shows an error.
- No mandatory fields beyond "what" and "when" (defaulted). Portion/context/notes
  are optional enrichment.
- Home screen paints instantly from cache (UX invariant #3), never a blank load.

---

## 6. Knowledge integrations (client-side, guarded, pod-cached)
All four are **public read-only APIs, fetched client-side through
`@jeswr/guarded-fetch` (https-only), results cached in the pod** so we don't
re-hit them and the user's knowledge view works offline.

1. **Recruiting trials** — ClinicalTrials.gov v2 (`RESEARCH.md` §3.2).
   `query.cond=celiac disease`, `filter.overallStatus=RECRUITING`, **simple GET
   only** (preflight 403 — no custom headers). Country filter **client-side** on
   `locations[].country` (default the user's locale, e.g. GB). Card list →
   deep-link to the study page. Cache the JSON in the pod, refresh daily.
2. **Latest research** — Europe PMC REST (`RESEARCH.md` §3.3).
   `query=coeliac …`, `sort=P_PDATE_D desc`, CORS-open. A "latest literature"
   feed; link out by DOI/PMID. Also powers the pipeline page's "recent evidence".
3. **Drug-pipeline explainer** — a **static, dated, research-grounded page**
   (`RESEARCH.md` §2.6): ZED1227/TAK-227 (Ph2b), TAK-101 (Ph2), KAN-101 (Ph2),
   larazotide (**failed/discontinued** — included honestly), enzymes as adjuncts.
   Header: **"the gluten-free diet is still the only treatment."** "Recent
   evidence" section auto-populated from the Europe PMC + CTGov queries;
   openFDA (`RESEARCH.md` §3.4) only to state honestly that **no drug is FDA-
   approved** (a label query 404s — that's the point).
4. **Genetics** (§7).

**Attribution & terms:** OFF = ODbL, attribute + cache OK. CTGov/EPMC/openFDA =
public US-gov/EMBL open data, no key, attribute politely. None require a server.

---

## 7. Genetics feature (privacy-critical)
- **Two entry paths:** (a) **manual** entry of known HLA type / result;
  (b) **consumer raw-file upload** (23andMe/AncestryDNA export).
- **On-device parse only.** The raw genotype file is read in-browser
  (`FileReader`), scanned for the coeliac-relevant rsIDs (**rs2187668** = DQ2.5
  tag, **rs7454108** = DQ8 tag, + documented DQ2.2/DQ7 tags where the chip has
  them), interpreted, and **immediately discarded**. Only the `GeneticSummary`
  (a few rsID→genotype→interpretation rows) is written to the pod, owner-only.
  **The raw file never touches the network and never enters the pod.** This is a
  hard invariant, tested.
- **Framing (non-negotiable, `RESEARCH.md` §2.5):** negative-predictive only.
  "Carrying DQ2/DQ8 does NOT mean you have coeliac (30–40% of everyone carries
  it); NOT carrying it makes coeliac very unlikely. This cannot diagnose you.
  Diagnosis needs serology + biopsy while eating gluten." Plus the **chip-coverage
  caveat**: "your file may not test every risk allele — a null result here is not
  a clean bill of health."

---

## 8. Community (reuse suite infra — don't invent chat)
- **Link-outs** to Coeliac UK (venue guide + product checker — no public API,
  `RESEARCH.md` §3.5) and curated communities (r/Celiac, Coeliac UK forum).
- **Pod-backed discussion** reuses the suite's existing chat/feeds stack — the
  **Pod Manager "Solid Community" pattern**: `@jeswr/solid-community-feeds`
  (SSRF-safe read of Matrix rooms + Discourse/forum into one feed) for a
  read-only community feed, and `@jeswr/solid-chat-interop` (canonical message
  model) if/when interactive pod-chat is wanted. **No new chat system.**
- Community is Phase 4 / lowest priority — the diary + inference + protocols are
  the product; community is reach.

---

## 9. Security & privacy posture (summary)
- **All health data owner-only WAC, fail-closed, ACL written first.** No public
  resources. Genetics + restriction plan get the same treatment (most sensitive).
- **No server of ours ever sees health data** — client-only pod fetches; Vercel
  serves static assets + the Client ID doc only.
- **Foreign fetches (OFF/CTGov/EPMC/openFDA)** go through `@jeswr/guarded-fetch`
  browser policy (https-only), are read-only public endpoints, and are **cached
  in the pod** (minimise egress, enable offline). No health data is ever sent to
  them (we send only a barcode / a public search term).
- **Genetics raw file never leaves the device** (§7) — the strongest invariant.
- **DPoP-bound auth** via the suite login stack; silent restore via
  `@jeswr/solid-session-restore` (WebID-scoped refresh token in IndexedDB,
  cleared on logout).
- **No analytics on health data.** FeedbackButton (via `@jeswr/solid-feedback-
  proxy`) is the only telemetry and it files a GitHub issue, carries no health
  data.
- **Injectable-LLM seam carries no baked key** and defaults off; if a user wires
  one, meal *text* only (never symptoms/genetics) is sent, with explicit consent.

---

## 10. Adversarial self-critique (where this design can hurt people)
A first-class section — the app touches health, mental health, and genetics.

1. **Naive correlation → confirmation bias / false conclusions.** Symptom lag
   (§4.1) and confounding (co-occurring triggers) make same-meal correlation
   actively misleading. *Mitigation:* per-class lag windows; show counts not just
   scores; correlation only ever *proposes* — a **protocol confirms** (§4.2);
   surface "can't separate these two triggers, needs a test."
2. **Orthorexia / ARFID amplification.** A tracker that rewards restriction can
   worsen the 14–57% ARFID risk (`RESEARCH.md` §2.8). *Mitigation:* no
   avoidance-streak gamification; engine biased toward **re-challenge and
   expansion**; time-boxed conclusions with review dates; dietitian safety rail;
   supportive prompt tone.
3. **Missed medical care.** Someone could self-manage worsening disease with the
   app instead of seeing a doctor. *Mitigation:* hard-coded, non-correlated
   safety rails (§4.4); pre-diagnosis "don't go GF before testing" block;
   "decision support not diagnosis" everywhere.
4. **OpenFoodFacts data-quality limits.** Crowdsourced: ~67% have complete
   macros, incomplete/duplicate/erroneous entries common (`RESEARCH.md` §3.6 /
   §OFF quality). A green "safe" off bad data is dangerous. *Mitigation:* show
   **data completeness + last-edited + "verify against the packet"**; never a
   bare green tick; the sub-10-ppm sulphite honesty flag (`possible-undeclared`);
   OFF is an *input to the user's judgement*, not an oracle.
5. **OCR/voice garbage into inference.** Tesseract ~80% coverage & error-prone;
   voice mishears (`RESEARCH.md` §3.6). *Mitigation:* OCR/voice output is a
   **draft the user confirms** (`sourceConfidence` flagged), never auto-fed to
   the engine; the engine can down-weight low-confidence-sourced items.
6. **Genetic-data hazards.** Genetic data is uniquely sensitive + carries
   misinterpretation risk (false reassurance from an incomplete chip; family
   implications). *Mitigation:* raw file never leaves device (§7); summary-only
   pod storage owner-only; negative-predictive-only framing + chip-coverage
   caveat; never a "you have/don't have coeliac" statement.
7. **Pod availability / data-loss.** If the pod is unreachable, logging must not
   fail. *Mitigation:* offline-first (`@jeswr/solid-offline`), optimistic writes,
   durable client cache, reconcile on reconnect.

---

## 11. Testing strategy (everything stubbed-fetch testable)
- **Pure cores unit-tested exhaustively:** the inference engine (lag windows,
  scoring, safety rails), the elimination-protocol reducer, exposure derivation
  from OFF tags (incl. sulphite aliases), the genetic-file parser (fixture files,
  and a test asserting the raw bytes never leave / never persist).
- **Data model:** `parse`/`build`/`serialize` round-trips (task-model pattern),
  ACL-written-first, owner-only.
- **Views:** injectable-`fetch` seam → RTL/component tests with a stubbed pod,
  no server.
- **E2E (Playwright):** against a **local CSS** (never live) per the suite rule;
  scan→log→symptom→correlation→protocol happy path.
- **Foreign APIs:** contract tests against **recorded fixtures** (the live shapes
  captured 2026-07-03 in `RESEARCH.md` §3); a periodic live-smoke to catch drift.
- Suite gate: `lint` + `typecheck` + `test` + `build`; roborev on every commit;
  `@jeswr/guarded-fetch` on every foreign fetch.

---

## 12. What needs maintainer input (`needs:user`) — flagged, not blocking
Per the "proceed on best call, document, steer after" rule, these are the few
genuinely human-gated items (build proceeds around them):
- **w3id redirect** for the `diet:` namespace (`w3id.org/jeswr/...`) — a PR to
  the w3id repo the maintainer merges.
- **npm publish** of `@jeswr/solid-health-diary` — deferred, GitHub-installable
  meanwhile (suite norm).
- **CORE-PSS server changes:** none required by this design — the app is a pure
  Solid *client*; it needs only a standard Solid pod (any CSS/PSS/ESS). Flagged
  explicitly so no builder assumes a server change.
- **Coeliac UK data**: no public API → link-out only; nothing to request.
