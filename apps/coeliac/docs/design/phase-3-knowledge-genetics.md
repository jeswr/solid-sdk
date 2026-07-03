<!-- AUTHORED-BY Claude Fable 5 -->

# Phase 3 — Knowledge Integrations & Genetic-Test Upload (design)

> The implementable design for the coeliac app's Phase 3 (`BUILD-PLAN.md` briefs
> 3A/3B; `DESIGN.md` §6/§7; grounded in `RESEARCH.md` §2.5/§2.6/§3). Phase 3
> "hooks into the latest literature, drugs databases, and studies… and
> genetic-test upload" (maintainer's ask). This document goes deeper than the
> build-plan briefs: it fixes the exact APIs/shapes (re-verified live against
> primary sources on **2026-07-03**), the query + ranking + **misinformation
> guard** mechanisms, the genetic client-side-parse design + the
> `@jeswr/solid-health-diary` model refinements, and the per-integration
> build-ready follow-up beads (3a literature / 3b trials / 3c genetics).
>
> **This is health information. Accuracy and honesty are load-bearing.** Every
> external fact below traces to a cited primary or authoritative source; the API
> shapes + core clinical figures are PRIMARY-source/live-verified (§1.1/§1.2). A
> few emerging-therapy *status* rows (§1.3) cite sponsor releases / foundation
> summaries / trade press (news-style secondary sources) pending a
> registry-record or peer-reviewed confirmation — those are called out here and
> the builder confirms each phase/status via a live CT.gov registry query before
> the therapies page publishes it (§9). Anything I could not
> verify is flagged in §9 rather than stated as fact. **The app is decision
> support, never diagnosis.** No Phase-3 surface diagnoses, recommends
> enrolment, or asserts a therapy works.
>
> **No CORE-PSS server change is required by any of this** — the app is a pure
> Solid *client* against a standard pod. Flagged per the CLAUDE.md rule so no
> builder assumes a server change. The one genuinely human-gated item (a `diet:`
> vocab addition + its w3id redirect) is a `needs:user`, listed in §10.

---

## 1. Verified facts (primary sources, re-checked live 2026-07-03)

### 1.1 Live API shapes (hit directly this session)

| API | Endpoint (verified) | Verified response shape | CORS / auth |
|---|---|---|---|
| **ClinicalTrials.gov v2** | `GET https://clinicaltrials.gov/api/v2/studies?query.cond=celiac+disease&filter.overallStatus=RECRUITING&pageSize=N&fields=…` | top-level `{ studies[], nextPageToken }`; each study `protocolSection.{identificationModule.{nctId,briefTitle}, statusModule.overallStatus, conditionsModule.conditions, designModule.{studyType,phases}, eligibilityModule.eligibilityCriteria, contactsLocationsModule.locations[].{city,country}}`. Token pagination `nextPageToken → &pageToken=`. | Simple `GET` returns `access-control-allow-origin: *`; an `OPTIONS` **preflight 403s** (`RESEARCH.md` §3.2) → **simple requests only** (no custom headers, no `Authorization`, default `Accept`). |
| **Europe PMC REST** | `GET https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=…&format=json&pageSize=N&sort=P_PDATE_D%20desc` | top-level `{ version, hitCount, nextCursorMark, nextPageUrl, request, resultList.result[] }`; each result `{ id, source, pmid, pmcid, doi, title, authorString, journalTitle, pubYear, pubType, isOpenAccess, citedByCount, firstPublicationDate, … }`. Cursor pagination `nextCursorMark → &cursorMark=`. `hitCount` for "coeliac AND intolerance" was **2709** live. | `access-control-allow-origin: *`, no key. |
| **PubMed E-utilities** | `GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=…&retmode=json&retmax=N` | `{ header, esearchresult:{ count, retmax, retstart, idlist[], translationset, querytranslation, warninglist } }`. Then `esummary.fcgi`/`efetch.fcgi` for metadata by PMID. | CORS-open, no key (rate limit **3 req/s** unauthenticated, 10/s with a free key). **Caveat (verified):** `sort=most+recent` was **rejected** with a warning — the recency sort token differs; see §9. |
| **openFDA drug label** | `GET https://api.fda.gov/drug/label.json?search=openfda.generic_name:larazotide&limit=1` | **HTTP 404** (no match). Confirms investigational coeliac drugs have **no FDA label** — expected and informative (`RESEARCH.md` §3.4). Successful queries return `{ meta, results[] }`. | CORS-open, no key (240/min, 1000/day). |

**Not machine-readable (link-out only, re-confirmed):** Coeliac UK has **no public
developer API** — venue guide + product checker are members-only (`RESEARCH.md`
§3.5). NICE NG20 / BSG / ACG guidelines are **documents**, not APIs — curated
deep-link-outs, not ingested.

### 1.2 Clinical facts (each cited to a primary/authoritative source)

- **HLA-DQ2/DQ8 negative predictive value ≈ 100%** (its clinical role is to
  *exclude* coeliac): a negative for both haplotypes rules coeliac out with
  >95%–~100% NPV. [PMC4149591 (clinical utility of CD HLA testing)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4149591/)
- **~95% of coeliac patients carry DQ2 or DQ8** (DQ2.5 ~90–95%; DQ8 alone
  ~5–10%). Same source + [23andMe medical](https://medical.23andme.com/new-23andme-report-on-celiac-disease/).
- **~25–40% of the general (healthy) population carry DQ2/DQ8** yet only ~1% have
  coeliac → **positive result has LOW positive predictive value; NOT diagnostic**
  (only ~3% of carriers develop coeliac). [PMC4737358 (prevalence DQ2/DQ8)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4737358/), [23andMe topic page](https://www.23andme.com/topics/health-predispositions/celiac-disease/).
- **Tag SNPs (verified):** **`rs2187668`** = HLA-DQA1 variant tagging the
  **DQ2.5** haplotype (PLOS One: sensitivity 1.000, specificity 0.999, PPV 0.998
  — `RESEARCH.md` §2.5); **`rs7454108`** = variant near HLA-DQB1 tagging **DQ8**.
  Both are the SNPs 23andMe's own coeliac report uses. Consumer arrays' coverage
  of DQ2.2/DQ7 tags is **imperfect** (chip-dependent). [PLOS One rs2187668](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0002270), [23andMe blog](https://blog.23andme.com/articles/new-23andme-report-celiac-disease).
- **NICE NG20:** diagnosis needs **serology → duodenal biopsy while still eating
  gluten**; HLA-DQ2/DQ8 testing is **specialist-setting only** (e.g. children not
  having biopsy, or people already on limited gluten who decline a challenge) and
  is used to **exclude**, not confirm. [NICE NG20](https://www.nice.org.uk/guidance/ng20).
- **BSG 2014 (under 2025 review) & ACG 2023** concur: serology + biopsy **on a
  gluten-containing diet**; ACG allows a no-biopsy path in adults only with
  tTG-IgA >10× ULN + a second positive EMA. [BSG guideline](https://www.bsg.org.uk/clinical-resource/diagnosis-management-adult-coeliac-disease), [ACG 2023 (Am J Gastroenterol)](https://journals.lww.com/ajg/fulltext/2023/01000/american_college_of_gastroenterology_guidelines.17.aspx).

### 1.3 Emerging-therapy status (honest evidence levels, verified live)

**Header truth (state everywhere): there is NO approved disease-modifying drug;
the gluten-free diet remains the only treatment.** The **basis for this clinical
claim is the guidelines + reviews** — NICE NG20, ACG 2023, and the 2025 Nutrients
review all state the GF diet is the only treatment. (The openFDA 404 in §1.1 is
only a *label lookup* for a named product — it proves larazotide has no FDA label,
NOT the broad "nothing is approved" claim; see §4.4/§9 for the honest framing.)
Pipeline (verified via live CT.gov + 2025 reviews — cite, date, and flag failures
honestly):

| Candidate | Mechanism | Status (verified 2026-07-03) | Honest note |
|---|---|---|---|
| **ZED1227 / TAK-227** | oral TG2 (transglutaminase-2) inhibitor | **Most advanced.** Phase 2b in non-responsive/GFD-refractory CD concluded ~Sept 2024; a **new Phase 2 is RECRUITING now — [NCT07298343](https://clinicaltrials.gov/study/NCT07298343)** ("Efficacy and Tolerability of ZED1227 in Non-responsive Celiac Disease"). Ph2 showed histological protection during gluten challenge. | Promising but unproven for outcomes; still trial-stage. [Nutrients 2025 review](https://www.mdpi.com/2072-6643/17/18/2960), [PMC10341493 (ZED1227 Ph2)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10341493/) |
| **TAK-101** | tolerogenic gliadin nanoparticle (IV) | Phase 2 dose-ranging (Takeda). | Immune-tolerance approach; early. [PMC11970589](https://pmc.ncbi.nlm.nih.gov/articles/PMC11970589/) |
| **KAN-101** (Anokion) | liver-targeted gliadin-peptide immune tolerance | Phase 2 ACeD-it (positive symptom data reported); [NCT06001177](https://clinicaltrials.gov/study/NCT06001177), primary completion Jan 2025. | Antigen-specific tolerance; early. **NOT** an enzyme — do not conflate with zamaglutenase. [Anokion Ph2 (Celiac Disease Foundation)](https://celiac.org/2024/05/22/anokion-announces-new-clinical-data-from-aced-it-trial-supporting-kan-101-as-a-potential-disease-modifying-treatment-for-celiac-disease/) |
| **Zamaglutenase / TAK-062 (Kuma062)** (Takeda) | engineered oral **glutenase** enzyme (degrades gluten in the stomach) | Trial-stage enzyme candidate. | A *different* drug from KAN-101; an adjunct-class enzyme, not a cure. Verify current phase live before publishing. [BioSpace pipeline](https://www.biospace.com/drug-development/opinion-new-treatments-for-celiac-disease-gain-traction) |
| **Larazotide** (zonulin/tight-junction; ex-9 Meters) | tight-junction regulator | **FAILED Phase 3, DISCONTINUED.** | Include HONESTLY as a cautionary tale — do not present as a live option. [PMC11970589](https://pmc.ncbi.nlm.nih.gov/articles/PMC11970589/) |
| **Nexvax2** (ImmusanT) | peptide-based "vaccine"/tolerance | **DISCONTINUED June 2019, Phase 2 — ineffective vs placebo.** | History, not pipeline. [Coeliac UK news](https://www.coeliac.org.uk/about-us/media-centre/news/trials-for-coeliac-disease-vaccine-discontinued/), [ImmusanT release](https://www.globenewswire.com/news-release/2019/06/25/1874108/0/en/ImmusanT-Discontinues-Phase-2-Clinical-Trial-for-Nexvax2-in-Patients-With-Celiac-Disease.html) |
| **Other enzyme "glutenases"** (latiglutenase, AN-PEP, others) | degrade ingested gluten | Adjuncts, OTC-style supplements; **NOT cures**, mixed/limited evidence. | Never overstate; supplements are not a substitute for the GF diet. |

---

## 2. Cross-cutting rails (stated ONCE; every Phase-3 surface inherits them)

These are the maintainer's §5 rails, made concrete. A Phase-3 builder wires
**all five** into every knowledge/genetics view; the acceptance tests assert
their presence.

1. **NOT medical advice — everywhere.** Every knowledge/trials/pipeline/genetics
   surface carries a persistent "This is information, not medical advice —
   decision support, not diagnosis" frame (a shared `<MedicalDisclaimer>`
   component). No surface renders without it (a test asserts the string is
   present on each page).
   By default the app sends only a **generic public condition name** (e.g.
   "celiac disease") to the four APIs — never a term derived from the user's
   intolerance profile. Personalisation is done **locally** over cached public
   results (§3.2); any intolerance-specific external query is **explicit opt-in**
   with privacy copy. A barcode / a generic condition name is the most that ever
   leaves the device.
2. **Information → clinician-discussion framing.** Trials and therapies are
   presented as **"things to discuss with your clinician,"** never "you match" /
   "you should enrol" / "this will help you." No eligibility auto-matching against
   the user's pod data (§4.3). Buttons say *"Read on ClinicalTrials.gov"* /
   *"Discuss with your doctor,"* never *"Apply"* / *"Enrol."*
3. **Misinformation guard (hard requirement — mechanism in §3.4).** The app
   **never** does open web search and **never** renders arbitrary web text. It
   reads ONLY a fixed allowlist of authoritative, curated endpoints (EPMC =
   peer-reviewed indexed literature; CT.gov = the official trial registry;
   NICE/BSG/ACG/Coeliac UK = curated guideline link-outs). Ranking weights
   source-authority + recency and **excludes** preprints-by-default, retracted
   items, and non-authoritative domains. There is no user-supplied-URL fetch path.
4. **Health/genetic-data privacy (§8).** Owner-only WAC, fail-closed, ACL written
   first; DPoP-authed; no health data ever sent to any API (only a public search
   term / a barcode / a condition name leaves the device). Genetic **raw files
   never leave the device** (§5). Genetics gets explicit consent.
5. **Honest evidence levels.** Every therapy/finding carries its evidence stage
   (guideline / systematic review / RCT / Phase-N trial / preprint / discontinued)
   and its date. Failures (larazotide, Nexvax2) are shown as failures. No hype
   header; the "GF diet is still the only treatment" truth leads the pipeline page.

---

## 3. Phase 3a — Literature hooks (`lib/knowledge/literature.ts` + a Research view)

**Goal:** surface CURRENT, CREDIBLE coeliac + user-intolerance literature and the
authoritative guidelines — and structurally make it *impossible* to surface
misinformation.

### 3.1 Sources & roles (allowlist)

| Source | Role | Why |
|---|---|---|
| **Europe PMC REST** (§1.1) | **primary literature feed** | CORS-open, no key, indexes PubMed + PMC + Agricola + preprint servers with a `source`/`pubType` field to filter by, exposes `citedByCount` + a retraction signal, and has a **proven recency sort** (`sort=P_PDATE_D desc`). |
| **PubMed E-utilities** (§1.1) | **fallback + PMID/DOI resolution** | Canonical NLM index; used to resolve/confirm a record or when EPMC is down. Recency-sort caveat in §9 → EPMC is primary for "latest." |
| **NICE NG20 / BSG / ACG / Coeliac UK** | **curated guideline link-outs** (static, hand-maintained, dated) | The authoritative clinical guidance; documents not APIs → deep-link, never scrape. A small committed `guidelines.ts` catalog (title, org, year, URL, one-line summary), each entry citing its source; refreshed by a maintainer, not fetched live. |

### 3.2 Query design (per-user, intolerance-aware)

- **Default query is GENERIC — no derived health interest leaves the device
  (privacy default, rail §2.4).** The external EPMC/CT.gov query is a fixed
  broad coeliac query (`query=(coeliac OR celiac disease) …`) that reveals nothing
  about the user. **Personalisation happens LOCALLY**: the app fetches the broad
  result set, caches it in the pod, and then filters/ranks it *on-device* against
  the user's tracked `diet:TriggerClass` set (boosting items mentioning
  `lactose`/`sulphite`/`FODMAP`/`histamine` the user tracks). So the user's
  intolerance profile shapes what they *see* without any intolerance term being
  *sent* to a third party.
- **Intolerance-specific external queries are EXPLICIT OPT-IN only.** If the user
  wants a targeted external search (e.g. "lactose intolerance" trials directly),
  that is behind a clear consent affordance with privacy copy — "this sends the
  condition name to ClinicalTrials.gov/Europe PMC" — never the silent default.
  When opted in, a term **allowlist** maps each `diet:TriggerClass` → a vetted
  query fragment (curated constant, not user free-text, so a hostile pod value
  can't inject a query — §8), and every param is URL-encoded.
- **Recency:** `sort=P_PDATE_D desc` (verified). Default window: last ~24 months,
  paged with `cursorMark`.
- **Type filter:** prefer `pubType` in {`review`, `systematic review`,
  `guideline`, `randomized controlled trial`, `meta-analysis`}; **preprints
  (`source=PPR`) excluded by default** and, if ever shown, hard-labelled
  "PREPRINT — not peer-reviewed."
- **Guidelines** are not queried — they are the curated `guidelines.ts` catalog,
  always shown at the top of the Research view as the authoritative anchor.

### 3.3 Ranking (surface current + credible first)

A pure, testable scoring function over EPMC results (no black box):

```
score = W_authority(pubType, source) × W_recency(firstPublicationDate)
        × W_impact(citedByCount, isOpenAccess)     − HARD_EXCLUDE(retracted|predatory)
```

- **`W_authority`**: guideline/meta-analysis/systematic-review > RCT >
  observational > preprint(0, excluded by default). Driven by `pubType`/`source`.
- **`W_recency`**: monotone decay on `firstPublicationDate` (guidelines exempt —
  a 2014 BSG guideline outranks a fresh low-tier paper).
- **`W_impact`**: mild `citedByCount` + open-access boost (tie-breaker only, so a
  brand-new important paper isn't buried).
- **`HARD_EXCLUDE`**: any item flagged retracted or from a non-allowlisted source
  is dropped, not down-ranked. **Retraction detection (concrete, testable):**
  (a) exclude any result whose `pubType` array contains a retraction marker (e.g.
  `"retracted publication"` / `"retraction of publication"`); (b) for each item
  that survives (a), a follow-up fetch of the EPMC full record
  `…/webservices/rest/{source}/{id}/…` `commentCorrectionList` and drop it if it
  carries a `type` of `"Retraction"` or `"Expression of concern"`. Both signals
  are treated as hard excludes. **The exact `pubType`/`commentCorrectionList`
  field shapes must be confirmed live before build** (not live-verified this
  session — §9), and the contract-test fixtures MUST include a **retracted** and a
  **corrected/expression-of-concern** record so the exclusion is proven, not
  assumed. Fail-closed: if the retraction status of an item cannot be determined,
  it is shown with a neutral label, never silently promoted.

The score, the pubType, and the date are **shown** next to each item (interpretable,
per the app's "show your working" rule) — the user sees *why* something ranks.

### 3.4 The misinformation guard — the mechanism (hard requirement)

Misinformation is prevented **structurally**, not by moderation:

1. **Closed allowlist of origins.** `lib/knowledge/*` may fetch ONLY
   `www.ebi.ac.uk` (EPMC), `eutils.ncbi.nlm.nih.gov` (PubMed),
   `clinicaltrials.gov`, `api.fda.gov`. Enforced by a host-allowlist check *inside*
   the knowledge fetch wrapper (belt-and-braces on top of `guarded-fetch`), so no
   code path can fetch an arbitrary URL. **No open web search exists in the app.**
2. **Peer-reviewed / registry-only content.** EPMC returns indexed literature;
   CT.gov returns the official registry. Neither returns free web text. Preprints
   excluded by default; retracted items hard-excluded (§3.3).
3. **Guidelines are curated + cited, not fetched.** The authoritative clinical
   claims (diagnosis needs biopsy-on-gluten, etc.) come from the committed
   `guidelines.ts` catalog reviewed by a human, each with its source URL.
4. **No LLM summarisation of medical claims by default.** The app does not
   paraphrase findings into new medical assertions. Titles + metadata + the
   authoritative link are shown; the user reads the source. The injectable-LLM
   seam (`DESIGN.md` §9) stays **off** for medical text and never sends health
   data; if a user opts in, output is labelled non-authoritative and never
   replaces the cited source.
5. **Provenance on every card.** Source name, date, type, and the canonical
   DOI/PMID/NCT link — so the reader can always reach and judge the primary source.

### 3.5 Caching / offline (pod-cached, guarded)

- Fetch via the existing `foreignFetch` seam (`src/lib/fetch/guarded.ts` —
  https-only, credentials omitted, size-capped, timeout) wrapped by the
  §3.4 host-allowlist.
- Cache the **result list JSON** (not health data) in the pod under a new
  `…/health/diary/cache/knowledge/` container (mirror `offCacheContainer`):
  `research-latest.json`, `guidelines.json` (built from the static catalog).
  Refresh daily (a `dcterms:modified` staleness check); serve from cache offline
  (`@jeswr/solid-offline` SW). Owner-only ACL (it lives under the diary root, so
  the "ACL written first" invariant already covers it via `ensureDiaryReady`).
- **Contract tests** against the recorded 2026-07-03 fixtures (this doc's shapes);
  a periodic live-smoke catches API drift.

---

## 4. Phase 3b — Clinical-trials hooks (`lib/knowledge/trials.ts` + a Trials view)

**Goal:** surface RECRUITING coeliac/intolerance trials with location + an
eligibility **summary**, as information to **discuss with a clinician** — never
auto-match or recommend enrolment.

### 4.1 ClinicalTrials.gov v2 (primary)

- **Query (verified):** `GET /api/v2/studies?query.cond=celiac disease&filter.overallStatus=RECRUITING&pageSize=N&fields=NCTId,BriefTitle,OverallStatus,Condition,Phase,StudyType,LocationCountry,LocationCity,EligibilityCriteria`.
  **Simple GET only** — no custom headers/`Authorization`/non-default `Accept`
  (preflight 403, §1.1). Token pagination via `nextPageToken → &pageToken=`.
- **Fields rendered:** `identificationModule.{nctId,briefTitle}`,
  `statusModule.overallStatus`, `designModule.{studyType,phases}`,
  `eligibilityModule.eligibilityCriteria` (shown as a **truncated read-only
  summary** with a "full criteria on the study page" link — never parsed into a
  match decision), `contactsLocationsModule.locations[].{city,country}`.
- **Location filtering (verified caveat):** v2 has no clean single-country param;
  filter **client-side** on `locations[].country`. That field is a
  **human-readable country NAME** (e.g. `"United Kingdom"`, `"United States"`),
  **not** an ISO code — so the filter uses a deterministic
  **locale-code → registry-country-name** map (`GB → "United Kingdom"`,
  `US → "United States"`, `IE → "Ireland"`, …), never a raw `GB`/`US` code
  comparison (which would hide every trial). Default to the user's locale's
  mapped name, with an "all countries" toggle. **Test fixtures cover UK / US /
  non-US** filtering. Optionally `query.locn`/`filter.geo` distance search later.
- **Intolerance breadth:** the external `query.cond` stays the **generic coeliac
  term by default** (privacy, §2.4/§3.2); targeted queries for the user's other
  tracked conditions (e.g. "lactose intolerance") are **explicit opt-in** with
  privacy copy, using public condition names only — never a silent default.

### 4.2 WHO ICTRP (secondary breadth — flagged, verify before building)

ICTRP aggregates non-US registries (EU-CTR, ISRCTN, ANZCTR, …). **I could not
live-verify a CORS-open JSON ICTRP search endpoint this session** (§9). Design:
treat ICTRP as an **optional Phase-3b.2 enhancement** behind a **deep-link-out**
to the ICTRP search portal (`https://trialsearch.who.int/`) pre-filled with the
condition, *until* a builder confirms a browser-fetchable ICTRP API. Do NOT ship a
live ICTRP fetch on an unverified shape — link-out is the honest default. ISRCTN
(UK-relevant) has a documented API and is the better first non-US add if one is
wanted; the builder verifies its CORS + shape live before wiring it.

### 4.3 The critical rail: information, not enrolment advice

- **No auto-matching.** The app must **never** compute "you are eligible" from the
  user's pod data. Eligibility criteria are shown verbatim (truncated) as
  *information*; the decision is the clinician's. A test asserts no pod
  health/genetic field is read into any trial-ranking or eligibility logic.
- **Framing on every trial card:** "Recruiting trials are shown for information.
  Whether a trial is right for you is a decision for you and your doctor —
  discuss it with your clinician." CTA = *"Read on ClinicalTrials.gov"* (native
  `<a rel="noopener noreferrer" target="_blank">` to `…/study/{nctId}`), never
  "Apply/Enrol."
- **No PII to the registry.** Only the public condition term leaves the device.

### 4.4 Drug/therapy pipeline explainer (`app/knowledge/therapies` — static + honest)

Ties #3-drugs into #4: coeliac is **diet-managed with no approved
disease-modifying drug** — be honest.

- A **static, dated, research-grounded** page built from the §1.3 table
  (committed `therapies.ts` catalog: candidate, mechanism, verified status,
  evidence note, source links). Header: **"The gluten-free diet is still the only
  treatment."** No candidate is described as effective; **larazotide + Nexvax2 are
  shown as failed/discontinued.**
- **"Recent evidence"** section auto-populated from the §3 EPMC feed + the §4.1
  CT.gov RECRUITING query filtered to the named interventions (e.g. `query.term=ZED1227`
  — verified live: returns NCT07298343 recruiting) so the page's live half stays
  current without hand-editing, while the framing stays static + human-reviewed.
- **The "no approved disease-modifying drug" claim is sourced from the guidelines
  + reviews** (NICE NG20 / ACG 2023 / Nutrients 2025 review — all state the GF
  diet is the only treatment), NOT from an openFDA 404. **openFDA** is used only as
  a **label lookup for named products** (e.g. confirming a specific investigational
  drug like larazotide has no FDA label — a 404, §1.1) and to link an approved
  product's label if one ever exists; it is **not** a pipeline source and a single
  404 is not proof that nothing is approved. **RxNorm** offers drug-name
  normalisation but there is essentially
  nothing approved to normalise — so RxNorm is **not** in scope for v1 (noted so a
  builder doesn't over-build; §9). Enzyme/adjunct OTC products, if ever listed,
  carry an explicit "supplement, not a treatment; does not replace the GF diet"
  caveat and never a bare efficacy claim.

---

## 5. Phase 3c — Genetic-test upload (`lib/genetics/*` + a Genetics view) — PRIVACY-CRITICAL

**Goal:** let a user record their HLA-DQ2/DQ8 status — by manual entry OR by
uploading a consumer raw file / clinical HLA report — with **all parsing
on-device**, only the interpreted summary stored, framed strictly as
negative-predictive and non-diagnostic.

### 5.1 The two entry paths

1. **Manual entry** — the user selects known status per haplotype
   (DQ2.5 / DQ2.2 / DQ8 / DQ7: present / absent / unknown), or types a clinical
   result. Produces a `GeneticSummary` directly.
2. **Raw-file upload — parsed 100% client-side.** Accept a consumer array export
   (23andMe / AncestryDNA `.txt`, tab-separated `rsid  chromosome  position
   genotype`) OR a clinical HLA report (PDF/text, best-effort text scan). Read via
   `FileReader` **in the browser**; scan for the coeliac tag SNPs; interpret;
   **immediately discard the raw bytes.** Only the `GeneticSummary` is written to
   the pod.

### 5.2 The on-device parser (`lib/genetics/parse.ts` — pure, exhaustively tested)

- **SNPs scanned (verified §1.2):** `rs2187668` → **DQ2.5** tag (primary);
  `rs7454108` → **DQ8** tag. Documented secondary tags for DQ2.2/DQ7 (e.g.
  `rs2395182`, `rs7775228`, `rs4713586` haplotype combinations) are scanned
  **where present**, always with the coverage caveat — a consumer chip may not
  tag every risk allele (§1.2, `RESEARCH.md` §2.5).
- **Output** = a list of `{ rsid, genotype, presence: present|absent|uncertain,
  riskHaplotype: DQ2.5|DQ2.2|DQ7|DQ8 }` rows + a **coverage note** (which risk
  loci the file *could* speak to). A risk-allele call maps genotype → presence via
  a small, cited, unit-tested lookup (e.g. rs2187668 `A` allele → DQ2.5-tagging);
  ambiguous/no-call → `uncertain`, never a false "absent."
- **Hard invariants (tested):**
  - Raw genotype bytes **never touch the network** (a test asserts no `fetch`
    receives raw file content) and **never enter the pod** (a test asserts the
    written resource contains only summary rows — the model has no raw-bytes field
    by construction, `genetics.ts` docstring).
  - The `FileReader` result is dropped after parse (no retention beyond the parse
    call; no `localStorage`/IndexedDB persistence of raw content).
  - A **null/absent result is not reassurance** — surfaced explicitly when a risk
    locus wasn't covered by the file.

### 5.3 Framing (non-negotiable, tested for presence — `RESEARCH.md` §2.5)

Every genetics surface shows, and the stored `diet:geneticInterpretation`
contains, the negative-predictive framing:

> "Carrying DQ2/DQ8 does **not** mean you have coeliac disease — about a quarter
> to 40% of everyone carries it. **Not** carrying it makes coeliac disease very
> unlikely. **This cannot diagnose you.** A coeliac diagnosis needs blood tests
> and a biopsy **while you are still eating gluten** — never start a gluten-free
> diet before testing. Your test file may not cover every risk gene, so a
> 'not found' result here is not a clean bill of health. Discuss any result with
> your clinician."

The model already **requires** a non-empty `diet:geneticInterpretation` and
refuses to write a summary without it (`buildGeneticSummary` throws) — §5.4 keeps
that guardrail and adds structure around it.

### 5.4 `@jeswr/solid-health-diary` `GeneticSummary` model refinements (additive, back-compat)

The landed model (`solid-health-diary/src/genetics.ts`) holds free-text marker
interpretation + a required framing string. Phase 3c wants **machine-readable**
structure so the UI can render DQ2.5/DQ8 status without re-parsing prose, plus a
consent record. Proposed **additive** terms (no breaking change — existing docs
still parse; these are new optional predicates under `diet:`, so they need the
`diet:` vocab addition in `solid-federation-vocab` + w3id, a `needs:user`, §10):

| New term | On | Type | Purpose |
|---|---|---|---|
| `diet:riskHaplotype` | `HlaMarker` | concept IRI (`diet:DQ2_5`/`DQ2_2`/`DQ7`/`DQ8`) | machine-readable which haplotype a marker tags (today it's only in free-text `markerInterpretation`). |
| `diet:markerPresence` | `HlaMarker` | concept IRI (`present`/`absent`/`uncertain`) | structured call; `uncertain` for no-call/ambiguous — never a false absent. |
| `diet:coeliacGeneticRisk` | `GeneticSummary` | concept IRI (`risk-haplotype-present`/`risk-haplotype-absent`/`partial-coverage`/`indeterminate`) | a **UI rollup**, framed NPV-only — "absent" means *low likelihood*, explicitly not "you don't have coeliac." |
| `diet:sourceType` | `GeneticSummary` | concept IRI (`manual`/`consumer-array`/`clinical-report`) | provenance **without raw data**; supersedes the boolean `enteredManually` (kept for back-compat; `sourceType=manual` ≡ `enteredManually=true`). |
| `diet:coverageComplete` | `GeneticSummary` | `xsd:boolean` | was every tracked risk locus testable by the source? Drives the "null is not reassurance" caveat. |
| `diet:consentGiven` | `GeneticSummary` | `xsd:boolean` (**MUST be true to write**) | explicit genetic-data consent; builder refuses to write without it (mirrors the interpretation guardrail). Optionally link a DPV consent receipt (`dpv:hasConsent`) as the richer form later. |

Refinement rules: keep the "interpretation REQUIRED, refuse to write without it"
guardrail; add the **"consentGiven MUST be true"** guardrail in `buildGeneticSummary`;
all new fields optional-on-read (a pre-refinement summary still parses); http(s)-
filter any IRI on read (symmetric with the writer, as the model already does).
This is a `@jeswr/solid-health-diary` follow-up bead (own repo, own gate + roborev),
NOT app code — the app depends on the published `dist`.

### 5.5 Consent + storage

- **Explicit consent gate** before any genetic write: a modal stating what is
  stored (summary only), where (the user's own pod, owner-only), and that raw
  files never leave the device; `diet:consentGiven=true` is recorded with
  `dcterms:created`. No consent → no write.
- **Storage:** `…/health/diary/genetics/summary.ttl`, owner-only WAC, fail-closed,
  ACL written first (via `ensureDiaryReady`), DPoP-authed. Most-sensitive data →
  same treatment as the rest of the diary, no exceptions.

---

## 6. Where the code lands (concrete, mirrors existing structure)

```
src/lib/knowledge/
  fetch.ts        # host-allowlist wrapper over foreignFetch (§3.4) — the ONLY knowledge egress
  literature.ts   # EPMC query + ranking (3a); PubMed fallback/resolver
  guidelines.ts   # curated NICE/BSG/ACG/Coeliac-UK catalog (static, cited)
  trials.ts       # CT.gov v2 query + client-side country filter (3b)
  therapies.ts    # static, dated pipeline catalog (§1.3); openFDA = named-product LABEL LOOKUP only (the "no approved drug" claim comes from the guideline/review catalog, §4.4)
  cache.ts        # pod cache read/write under …/cache/knowledge/ (mirror off/cache.ts)
  *.test.ts       # contract tests vs recorded 2026-07-03 fixtures; ranking unit tests
src/lib/genetics/
  parse.ts        # on-device raw-file parser (3c) — pure, exhaustively tested
  interpret.ts    # genotype→presence→haplotype lookup + framing (cited)
  summary.ts      # build GeneticSummary via @jeswr/solid-health-diary accessors
  *.test.ts       # raw-bytes-never-leave / never-persist invariant tests
src/app/knowledge/
  research/        # literature + guidelines view
  trials/          # recruiting-trials view
  therapies/       # pipeline explainer (static + recent-evidence)
src/app/genetics/  # manual entry + upload + consent + summary view
```

Reuse (do not reinvent): `foreignFetch` (`lib/fetch/guarded.ts`), the pod I/O
(`lib/pod/pod-fs.ts` `ensureDiaryReady`/`putResource`, `lib/pod/layout.ts` — add a
`knowledgeCacheContainer`/`geneticsSummaryUrl` helper), `lib/pod/rdf-io.ts`, and the
`@jeswr/solid-health-diary` typed accessors. **Never hand-build triples.** Every
foreign fetch through `foreignFetch` + the host-allowlist. Everything unit-testable
with a stubbed `fetch`; E2E against **local CSS** only.

---

## 7. Read-vs-write phasing

- **Phase 3a/3b are READ-ONLY of public data + WRITE-ONLY-to-own-pod-cache.** No
  health data written anywhere but the user's own pod cache; no PII to any API.
- **Phase 3c writes the genetic summary** to the user's own pod (owner-only) after
  explicit consent; it never *reads* pod health data into any external call.
- Suggested build order: **3a-literature → 3b-trials → 3c-drugs pipeline page →
  3c-genetics** (genetics last: it's the highest-sensitivity, needs the model
  refinement bead landed first). 3a/3b/therapies are independent and can run
  concurrently in separate worktrees; genetics depends on the model refinement.

---

## 8. Security & privacy posture

- **Egress is a closed allowlist** (§3.4): four hosts, enforced in a wrapper over
  `foreignFetch`. No user-supplied-URL fetch, no open web search, ever.
- **No health/genetic data leaves the device.** Only public search terms /
  barcodes / condition names go out. Genetic **raw files never touch the network
  or the pod** (§5.2, hard-tested). A test asserts no pod field is read into any
  external request.
- **Query-injection guard:** the intolerance→query-fragment map (§3.2) is a curated
  constant; a hostile `diet:TriggerClass` value from a tampered pod cannot inject a
  query — unknown trigger classes map to nothing, and all query params are
  URL-encoded. (An attacker who controls the user's own pod is already inside the
  trust boundary, but we still fail-closed.)
- **All writes owner-only WAC, fail-closed, ACL written first** via
  `ensureDiaryReady`; DPoP-authed via the suite login stack; genetics summary +
  knowledge cache both under the diary root, so the existing invariant covers them.
- **Consent** for genetic data is explicit and recorded (§5.5).
- **No analytics on health data.** The only telemetry is the FeedbackButton
  (files a GitHub issue via `@jeswr/solid-feedback-proxy`), which carries no
  health data.
- **guarded-fetch** browser policy on every foreign call (https-only, credentials
  omitted, size-capped, timeout, redirect re-validation) — belt-and-braces under
  the host-allowlist.

---

## 9. What I could NOT verify (flagged, not stated as fact)

- **PubMed E-utilities recency sort token.** `sort=most+recent` was **rejected
  live** (a warning, not an error). The correct esearch recency-sort token was not
  confirmed this session → the builder must confirm it against the
  [E-utilities docs](https://www.ncbi.nlm.nih.gov/books/NBK25499/) before relying
  on PubMed for "latest." **Mitigation already in the design:** EPMC is the
  primary recency feed (its `sort=P_PDATE_D desc` IS verified); PubMed is a
  fallback/resolver where exact-recency ordering is not depended on.
- **WHO ICTRP browser-fetchable JSON API + CORS.** Not verified live this session
  → §4.2 keeps ICTRP as a **link-out** until a builder confirms a real
  CORS-open endpoint; ISRCTN is the suggested first non-US add (verify its
  CORS+shape live first). Do not ship an unverified live ICTRP fetch.
- **Exact DQ2.2/DQ7 secondary tag SNP set.** rs2187668 (DQ2.5) and rs7454108
  (DQ8) are firmly verified; the fuller DQ2.2/DQ7 tag combinations are
  chip-dependent and vary by source (`RESEARCH.md` §2.5) — the design scans them
  "where present" with the coverage caveat rather than asserting a definitive set.
  The builder cites the specific rsIDs it implements from a primary genetics source.
- **EPMC retraction-signal field shape.** The `pubType` retraction markers + the
  `commentCorrectionList` `type` values used by the §3.3 hard-exclude were NOT
  live-verified this session → the builder confirms the exact field names/values
  against the [EPMC RESTful docs](https://europepmc.org/RestfulWebService) + a live
  retracted-record fetch, and lands the retracted/corrected fixtures, before the
  literature feed ships. Retraction exclusion is a safety requirement, so it must
  be proven against a real retracted record, not assumed.
- **BSG 2025 update.** The BSG guideline is under 2025 review; the design cites the
  current 2014 BSG + ACG 2023 + NICE NG20. The `guidelines.ts` catalog carries a
  date per entry so a refresh is a one-line human edit when BSG 2025 lands.
- **openFDA/RxNorm for therapies:** deliberately minimal — openFDA is only a
  **label lookup** (the larazotide 404 proves *that drug* has no FDA label, NOT
  the broad "nothing is approved" claim, which rests on the guidelines/reviews —
  §4.4); RxNorm out of scope for v1 (nothing to normalise). Flagged so a builder
  doesn't over-build a drug-database integration that has no approved coeliac drug
  to point at, and doesn't overclaim from a single 404.
- **Zamaglutenase / TAK-062 current phase.** Confirmed as a distinct Takeda oral
  glutenase enzyme (≠ KAN-101); its exact current trial phase was not live-verified
  this session → the builder confirms it via a live CT.gov query before the
  therapies page publishes a phase for it.

---

## 10. Build-ready follow-up beads

Each is an independent, concurrent-safe front (own worktree+branch, gate
in-worktree, no push/merge, roborev PASS, adversarial verify before arming;
Fable trailers + AUTHORED-BY; **health/genetics briefs are security-sensitive →
exhaustive tests, never a thin pass**).

- **Bead 3a — Literature hooks** (`pm-feature-builder`; depends on 1C). Implement
  `lib/knowledge/{fetch,literature,guidelines,cache}.ts` + the Research view per
  §3: EPMC primary feed (verified `sort=P_PDATE_D desc`), PubMed fallback/resolver
  (recency-sort caveat §9), curated cited `guidelines.ts` catalog, the host-allowlist
  misinformation guard (§3.4), pod-cached + offline, all five rails (§2). Contract
  tests vs the 2026-07-03 fixtures; ranking unit tests; guard test that no
  non-allowlisted host is fetchable. roborev PASS.
- **Bead 3b — Trials + therapies** (`pm-feature-builder`; depends on 1C). Implement
  `lib/knowledge/{trials,therapies}.ts` + the Trials + Therapies views per §4:
  CT.gov v2 simple-GET (preflight-403 constraint), client-side country filter,
  eligibility shown as read-only summary, **no auto-match / no enrol CTA**
  (tested), static dated pipeline catalog with larazotide/Nexvax2 shown as failed,
  a **named-product openFDA label lookup** (NOT a "nothing approved" proof — that
  claim stays sourced from the guidelines/reviews, §4.4), ICTRP as link-out
  (§4.2). Confirm each therapy status via a live CT.gov registry query before
  publishing it. roborev PASS.
- **Bead 3c-model — `GeneticSummary` refinement** (`suite-package-author`; repo
  `jeswr/solid-health-diary`; **do first among 3c**). Add the §5.4 additive terms
  + the `consentGiven MUST be true` guardrail; keep back-compat + the interpretation
  guardrail; round-trip + guardrail tests; rebuild + commit `dist/`; roborev PASS.
  Depends on the `diet:` vocab addition (below).
- **Bead 3c-genetics — Genetic upload** (`auth-specialist`/security-focused
  `claude`; depends on 1A/1C + 3c-model). Implement `lib/genetics/*` + the
  Genetics view per §5: two paths, **on-device parse only**, tag-SNP scan
  (rs2187668/rs7454108 verified + documented DQ2.2/DQ7 where present), NPV-only
  framing, explicit consent gate, owner-only summary write. **Hard invariant tests:
  raw bytes never leave the device / never enter the pod / never persist.**
  Exhaustive tests + adversarial verify (`honest && recommendArm`) before merge.
  roborev PASS.
- **`needs:user` / cross-repo:** the `diet:` vocab additions (§5.4) →
  `solid-federation-vocab` `sectors/health/diet/` (own repo, additive) + the
  `diet:` **w3id redirect** (maintainer merges the w3id PR). No CORE-PSS server
  change. npm publish of the refined `@jeswr/solid-health-diary` deferred
  (GitHub-installable meanwhile).

---

*Verified live 2026-07-03 against the cited primary sources. Health information —
decision support, not diagnosis; no Phase-3 surface diagnoses, recommends
enrolment, or asserts a therapy works. AUTHORED-BY Claude Fable 5.*
