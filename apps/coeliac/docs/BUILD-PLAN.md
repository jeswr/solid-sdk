<!-- AUTHORED-BY Claude Fable 5 -->

# Coeliac & Multi-Intolerance App — Phased Build Plan (builder briefs)

> The dispatchable build contract derived from `docs/DESIGN.md` (grounded in
> `docs/RESEARCH.md`). Each phase is a set of builder-agent briefs with explicit
> acceptance criteria. Fan-out rules and dependencies are stated so the
> orchestrator can parallelise safely.
>
> **Shared contract (all briefs, stated once):** own worktree+branch; stage only
> changed paths; **no push/merge** (orchestrator lands one branch at a time,
> full re-gate + roborev PASS + adversarial verify between merges); gate
> in-worktree scoped to the touched area; never weaken a gate; Fable trailers +
> `AUTHORED-BY Claude Fable 5` on new files; signing-disabled commits
> (`git -c commit.gpgsign=false`); self-identify as the PSS agent on any
> cross-repo comment; report a concise result + follow-ups. **Every foreign
> fetch goes through `@jeswr/guarded-fetch` (https-only).** **Everything
> unit-testable with a stubbed `fetch` — no server in unit tests; E2E against
> LOCAL CSS only, never the live deploy.** **All health data owner-only WAC,
> fail-closed, ACL written first.**

---

## Dependency graph & parallelism
```
Phase 1 ──┬─ 1A data model pkg (jeswr/solid-health-diary)  ─┐   [new repo — full checklist]
          ├─ 1B diet: vocab (solid-federation-vocab)         │   ∥ 1A (different repo)
          └─ 1C app shell + login + logging + symptoms ──────┘   depends on 1A
Phase 2 ── 2A inference engine + 2B protocol state machine        depends on 1A (model types)
Phase 3 ── 3A knowledge integrations ∥ 3B genetics               depend on 1C shell
Phase 4 ── 4A community ∥ 4B polish/offline/a11y                 depend on 1C
```
- **1A and 1B run in parallel** (different repos). **1C depends on 1A** (imports
  its types). **Phase 2 depends on 1A** but not 1C (pure cores). **Phase 3/4
  depend on 1C.** Within a phase, briefs on different files run concurrently.
- Security-sensitive briefs (genetics 3B, ACL paths, guarded-fetch usage) get
  **exhaustive tests + roborev** and never land on a thin pass.

---

## PHASE 1 — Diary core (data model + logging + symptoms)

### Brief 1A — `@jeswr/solid-health-diary` package (NEW REPO)
**Agent:** suite-package-author. **Repo:** create `jeswr/solid-health-diary`
(public; full new-repo checklist — `git config user.email
"63333554+jeswr@users.noreply.github.com"` right after `git init`; `.npmrc`
`ignore-scripts=true`; `.roborev.toml` (codex, min-severity low); lint+typecheck+
test+build gate; committed self-contained `dist/`; `suite.json`; Opus/Fable
trailers + AUTHORED-BY; **do NOT push — orchestrator publishes**; verdict via
`roborev review <sha> --local --wait`).
**Template:** mirror `@jeswr/solid-task-model` exactly (`TermWrapper` accessors,
`parseX`/`buildX`(→`n3` `Store`)/`serializeX`, IRI helpers, `./` browser-safe root
+ `./shape` Node-only, characterization + browser-bundle tests).
**Implement** the entities in DESIGN §2.2: `Meal`, `FoodItem`, `Exposure`,
`Symptom`, `TriggerClass` (+ evidence-prior lag profiles from RESEARCH §2.1),
`EliminationProtocol`, `ToleranceConclusion`, `GeneticSummary`, `DietPlan`.
Reuse `schema:`/`health:`/`time:`/`prov:`/`dcterms:` real terms; new terms under
`diet:` (`https://w3id.org/jeswr/sectors/health/diet#`). Consume
`@jeswr/fetch-rdf@0.1.0`; serialise via `n3.Writer`. **Never hand-build triples.**
**Acceptance:**
- Each entity: `parse∘build == identity` round-trip test; typed accessors.
- `FoodItem` stores `diet:offCategory` (OFF `categories_tags`) alongside
  allergen/trace/additive tags — required so the derivation can see the category.
- `deriveExposures(foodItems) → Exposure[]` maps OFF `allergens_tags`,
  `traces_tags`, `additives_tags` (E220–E228 → `sulphites`) + ingredient-text
  sulphite aliases (RESEARCH §2.7) → exposures with `exposureLevel`. The
  `possible-undeclared` level fires from a curated **high-risk-category → trigger
  map** applied to `diet:offCategory` (dried fruit / wine / beer / bottled citrus
  / pickles → `sulphites`) when tags are clean; if the category is absent/unknown
  it does NOT fire. **Fixtures must cover** a clean-tag high-risk sulphite
  category (e.g. `en:dried-apricots`) → `possible-undeclared`, and an
  unknown-category product → no false alarm.
- ACL helper writes **owner-only, fail-closed** ACL via `n3.Writer`; test proves
  no public access.
- `sourceConfidence` field on FoodItem (`manual`/`off`/`ocr`/`voice`).
- Gate green; committed `dist/` GitHub-installable under `ignore-scripts=true`;
  roborev PASS.
**Follow-ups to flag:** `diet:` w3id redirect (`needs:user`); npm publish
(deferred); ownership-index row in PSS `AGENTS.md`.

### Brief 1B — `diet:` sector vocab (solid-federation-vocab)
**Agent:** suite-researcher or suite-package-author. **Repo:**
`jeswr/solid-federation-vocab` (own, but MULTI-file — isolate to
`sectors/health/diet/`; do NOT bump shared deps). **Coordinate:** this extends
the **existing** gUFO-rooted `health` sector — do NOT fork it.
**Implement:** `sectors/health/diet/diet.ttl` (gUFO-rooted, Core-rooted per the
sector contract R8 §4), `diet.shacl.ttl`, `diet-alignments.ttl` (align to
`schema:Meal`/`NutritionInformation`, SNOMED/LOINC symptom concepts via
`skos:closeMatch`, FODMAP concepts). Terms: the `diet:` classes/properties used
by 1A. Add a fedapp `sectors/health/diet#` entry + a `suite.json`/catalog row.
**Acceptance:** OWL-DL clean (matches sector's F5 hygiene); SHACL validates the
1A fixtures; `owl:versionInfo`/`versionIRI`; roborev PASS. Runs **∥ 1A** (1A can
proceed against draft terms; reconcile IRIs before 1A's `dist` is finalised).

### Brief 1C — App shell, login, logging UX, symptom log (coeliac-app)
**Agent:** pm-feature-builder (Next.js App Router). **Repo:** `jeswr/coeliac-app`,
branch off `design/product-buildout` (or a fresh feat branch off `origin/main`
after this design lands). **Depends on 1A.**
**Implement (DESIGN §1, §5):**
- Adopt suite stack: `@jeswr/app-shell` chrome, `@jeswr/solid-elements`
  `<jeswr-login-panel>`, `@jeswr/solid-session-restore` silent restore,
  injectable-`fetch` seam, `@jeswr/solid-offline` SW. Publish a stable **Client
  ID Document** at `/clientid.jsonld` (solid-client-id skill — Next/Vercel recipe).
- **Logging (the make-or-break, §5):** camera-live **barcode scan** (`zxing-wasm`)
  → OFF v2 lookup (CORS-verified; guarded-fetch; **cache product in pod**;
  **attribute Open Food Facts**) → derived exposures → 1-tap "Ate it now".
  **Recent/Frequent one-tap re-log chips.** Manual barcode + manual meal entry
  fallback. 5-second happy path; optimistic writes + "Saving…/Saved"; instant
  cache paint.
- **Symptom quick-log:** symptom chips + severity slider, onset=now, two taps.
  Breathing/anaphylaxis chip triggers the **emergency rail** (§4.4), never
  "we'll correlate it".
- Pod layout per §2.3; private type-index registration (solid-type-index skill).
**Acceptance:**
- Scan→log and symptom-log both work with a **stubbed fetch** in component tests
  (no server); E2E happy path against **local CSS**.
- Offline: logging works with SW offline, reconciles on reconnect (UX invariants
  #1–3 demonstrated).
- OFF attribution visible on every product view; owner-only ACL on all writes.
- Gate green; roborev PASS.
**Explicitly NOT in 1C:** inference, protocols, knowledge pages, genetics
(later phases) — 1C ships a working diary you can log into and fill.

---

## PHASE 2 — Inference + elimination protocols (pure cores)

### Brief 2A — Inference engine (coeliac-app lib or a `@jeswr` sub-package)
**Agent:** claude (or optimization-specialist for the scoring). **Depends on 1A.**
**Implement (DESIGN §4):** pure functional core, no I/O.
- Lagged exposure↔symptom correlation with **per-TriggerClass lag windows**
  (gluten ~0–72 h right-skew; lactose/sulphite ~0.5–6 h; FODMAP mid) from
  RESEARCH §2.1.
- Interpretable scoring with **counts shown** (lift / conditional rate), not a
  black box; tap-through to the paired events (`prov:wasDerivedFrom`).
- Confounder flagging (co-occurring triggers → "needs a test").
- Ordinal confidence (`emerging`/`suspected`/`likely`/`confirmed-by-your-own-
  test`) — `confirmed` only via a completed protocol, never correlation alone.
- **Hard-coded safety rails** (§4.4): anaphylaxis→emergency, alarm symptoms→
  urgent care, persistent-despite-adherence→GI referral, restriction-anxiety→
  dietitian. These are rules, non-correlated, non-suppressible.
**Acceptance:** exhaustive unit tests incl. lag-window boundary cases, confounded-
trigger cases, each safety-rail trigger, and an anti-overclaim test (no output
asserts a diagnosis). Deterministic. roborev PASS (decision-support correctness
is safety-critical here).

### Brief 2B — Elimination-protocol state machine + UI (coeliac-app)
**Agent:** pm-feature-builder. **Depends on 1A (+ 2A for proposal input).**
**Implement (DESIGN §3):** pure reducer `advance(protocol, event, now) →
protocol'`; the `baseline→eliminate→washout→reintroduce→observe→concluded` FSM
with per-phase defaults (RESEARCH §2.4), the **one-active-challenge invariant**,
scheduled supportive prompts, re-challenge offer at `reviewAfter` for secondary
intolerances (RESEARCH §2.2). Proposal generation biased toward
**reintroduction/expansion** (orthorexia guard); **pre-diagnosis gluten-
elimination hard block** with "get tested first" (RESEARCH §4). UI to run a
protocol + log against it.
**Acceptance:** reducer unit-tested across all transitions incl. the one-active-
challenge guard and the pre-diagnosis block; conclusions carry `reviewAfter`;
prompts non-gamified; roborev PASS.

---

## PHASE 3 — Knowledge integrations + genetics

### Brief 3A — Knowledge pages (coeliac-app) — trials, research, pipeline
**Agent:** pm-feature-builder. **Depends on 1C.**
**Implement (DESIGN §6):**
- **Trials view:** ClinicalTrials.gov v2, `query.cond=celiac disease` +
  `filter.overallStatus=RECRUITING`, **simple GET only** (preflight 403 —
  RESEARCH §3.2), country filter **client-side** on `locations[].country`
  (default GB), cache JSON in pod, refresh daily, deep-link out.
- **Research feed:** Europe PMC REST (`sort=P_PDATE_D desc`, CORS-open), link by
  DOI/PMID, cached.
- **Drug-pipeline explainer:** **static, dated, research-grounded** (RESEARCH
  §2.6): ZED1227/TAK-227 Ph2b, TAK-101 Ph2, KAN-101 Ph2, larazotide
  **failed/discontinued** (honest), enzymes as adjuncts; header "GF diet is still
  the only treatment"; "recent evidence" auto-populated from EPMC+CTGov; openFDA
  used only to state **no drug is FDA-approved** (RESEARCH §3.4).
**Acceptance:** all three fetch via guarded-fetch, cache in pod, work offline
from cache; contract tests against the recorded 2026-07-03 fixtures; attribution
present; no health data ever sent to these APIs (only a barcode/search term).
roborev PASS.

### Brief 3B — Genetics (coeliac-app) — PRIVACY-CRITICAL
**Agent:** auth-specialist or claude with security focus. **Depends on 1A, 1C.**
**Implement (DESIGN §7, RESEARCH §2.5):**
- Two paths: manual entry + consumer raw-file upload.
- **On-device parse only** (`FileReader`): scan for `rs2187668` (DQ2.5),
  `rs7454108` (DQ8), + documented DQ2.2/DQ7 tags; interpret; **discard raw file**.
  Store **only** the `GeneticSummary` to the pod, owner-only.
- **Invariant (tested):** raw genotype bytes **never leave the device, never
  enter the pod, never hit the network.**
- **Framing (tested for presence):** negative-predictive-only + "cannot diagnose"
  + "diagnosis needs serology+biopsy while eating gluten" + chip-coverage caveat.
**Acceptance:** a test that asserts no network call carries raw genotype data and
no raw bytes are written to the pod; framing strings present; owner-only ACL;
**exhaustive tests + roborev** (privacy-critical — never a thin pass); adversarial
verify (`honest && recommendArm`) before merge.

---

## PHASE 4 — Community + polish

### Brief 4A — Community (coeliac-app) — reuse suite infra
**Agent:** pod-app-builder. **Depends on 1C.**
**Implement (DESIGN §8):** link-outs to Coeliac UK venue guide + product checker
(no public API — RESEARCH §3.5) + curated communities; a **read-only community
feed** via `@jeswr/solid-community-feeds` (SSRF-safe Matrix+forum read). **No new
chat system** — reuse `@jeswr/solid-chat-interop` if interactive pod-chat is
later wanted. Lowest priority.
**Acceptance:** feed via guarded-fetch/community-feeds (SSRF-safe); link-outs use
accessible native `<a rel="noopener noreferrer">`; roborev PASS.

### Brief 4B — Polish / offline / a11y / eating-out context
**Agent:** pod-app-builder or pm-feature-builder. **Depends on 1C.**
**Implement:** finish `@jeswr/solid-offline` coverage (instant offline load
everywhere), full a11y pass (web-design-guidelines + accessible-html-links),
the **eating-out context surfacing** ("your reactions cluster on restaurant
meals" from the `diet:context` field, DESIGN §2.2/§4), DietPlan "what I'm
currently avoiding and why" view, and the review-after re-challenge prompts
surfaced on the home screen. Medical-disclaimer frame + "see a doctor" rails
audited present on every inference surface.
**Acceptance:** a11y clean; offline invariants #1–3 demonstrated app-wide; every
inference/conclusion surface carries the disclaimer + relevant safety rail;
roborev PASS.

---

## Cross-cutting acceptance (every phase)
- `lint` + `typecheck` + `test` + `build` green in-worktree before hand-off.
- roborev PASS on every commit; security-sensitive briefs (1A ACL, 2A safety
  rails, 3B genetics) get exhaustive tests + adversarial verify before arming.
- No hand-built triples; all RDF via the suite libs.
- No health data to any server of ours or any third party (only barcodes/public
  search terms to the four public APIs).
- Fable trailers + AUTHORED-BY on new files; ownership-index row added when
  `jeswr/solid-health-diary` is created.

## `needs:user` (surfaced, non-blocking — build proceeds)
- `diet:` w3id redirect PR (maintainer merges).
- npm publish of `@jeswr/solid-health-diary` (deferred; GitHub-installable now).
- **No CORE-PSS server change is required** — the app is a pure Solid client;
  any standard pod works. (Flagged so no builder assumes a server change.)
