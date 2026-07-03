<!-- AUTHORED-BY Claude Fable 5 -->

# Coeliac & Multi-Intolerance App — Research / Evidence Base

> The grounded evidence behind `docs/DESIGN.md`. Every design call in that
> document traces to a finding here. Primary sources cited inline; live APIs
> were verified against the actual endpoint (not from memory) on 2026-07-03 —
> where a secondary source contradicted the live API, the live check wins and is
> flagged.
>
> **Not medical advice.** This document summarises published literature to
> inform a *decision-support* product. It is not clinical guidance, and the app
> it informs is decision support, never diagnosis.

---

## 1. Lived-experience needs (what people actually struggle with)

### 1.1 The top two unmet needs are label-reading and hidden gluten
A 2024 gluten-free-living survey (reported by the Celiac Disease Foundation)
found the two things people struggle with most are **how to read labels** and
**how to avoid hidden gluten** — not calorie counting, not recipes. In the US,
wheat must be declared as a major allergen, but **barley, rye, malt, brewer's
yeast and many derivatives are NOT required to be declared as gluten**, so a
label can be "wheat-free" and still unsafe.
- https://celiac.org/gluten-free-living/gluten-free-foods/label-reading-the-fda/
- https://celiac.org/wp-content/uploads/2024/04/2024-Food-Labeling-Guide.pdf
- Forbidden/hidden ingredient list: https://www.celiac.com/celiac-disease/forbidden-gluten-food-list-unsafe-ingredients-r182/

**Product implication:** the make-or-break capability is *"is this specific
packet safe for MY set of intolerances?"* at the shelf, in seconds — not a food
diary that happens to have a scanner bolted on.

### 1.2 What existing apps get wrong (app-store review mining)
| App | What it is | Recurring complaints (from reviews / roundups) |
|---|---|---|
| **mySymptoms** | Paid food+symptom diary, the long-time IBS-community pick | Basic functions locked behind subscription ("pure evil"); **no barcode scanning**; doesn't recognise common brands |
| **Cara Care** | IBS/FODMAP tracker | **IBS-only** — useless if you also have migraines, histamine/MCAS, sulphite, eczema triggers; day-boundary bug logs early-morning symptoms as "yesterday" |
| **Fig** | Barcode → green/yellow/red safety for your restrictions | Shopping tool only — **no symptom tracking, no pattern analysis, no delayed-reaction correlation** |
| **Spoonful** | FODMAP/diet barcode scanner | **Inaccurate** — green-checks products whose ingredients aren't even listed; missing products / "Product unavailable"; add-request backlog "behind… within our current budget"; paywalled then broken; unresponsive support |
| **Gluten Free Scanner / others** | Barcode safety | Same class of problem: crowdsourced/partial DBs, stale data, US-centric |

- Roundup: https://triggerbites.com/blog/best-food-diary-apps-2026
- mySymptoms: https://www.mysymptoms.net/ · https://apps.apple.com/us/app/mysymptoms-food-diary/id405231632
- Cara Care: https://cara.care/en · https://apps.apple.com/us/app/cara-care-ibs-fodmap-tracker/id1133687886
- Spoonful reviews: https://apps.apple.com/us/app/spoonful-diet-food-scanner/id1481914232?see-all=reviews · https://blog.spoonfulapp.com/product-reviews/

**The three structural gaps a pod app fixes:**
1. **Multi-condition in ONE model.** Every incumbent is single-axis (coeliac-only
   *or* FODMAP-only *or* IBS-only). Real patients stack conditions (see §2.3).
2. **Diary ⊕ scanner ⊕ correlation are three separate apps.** Nobody joins the
   shelf-scan to the symptom log to the lagged-correlation engine.
3. **Your health diary is rented, not owned.** Data is siloed in the vendor's
   DB, monetised, lost when the app dies or paywalls (Spoonful lock-outs). A
   years-long diagnostic diary is exactly the data you cannot afford to lose.

### 1.3 Cross-contamination anxiety & eating out
Patients must re-evaluate gluten risk *every time they eat*; the diet is
"difficult to maintain, socially isolating, and mentally taxing"
(PMC12567165, ARFID review). Eating out is the highest-anxiety context because
the label-reading tool doesn't exist there — you're trusting a kitchen.
Coeliac UK maintains 3,300+ **GF-accredited venues** but exposes them only
through a **members-only internal API** feeding their own app — no public
developer API (confirmed: venue/checker data is member-gated).
- https://www.coeliac.org.uk/gluten-free-accredited-venues/
- https://apps.apple.com/gb/app/coeliac-uk/id1129216617

**Product implication:** eating-out support = capture *context* (restaurant vs
home) as a first-class field on every meal so the correlation engine can flag
"your reactions cluster on restaurant meals" — plus **link-out** to Coeliac UK's
venue guide (we cannot ingest their data).

---

## 2. Clinical literature

### 2.1 Symptom lag is real, variable, and defeats naive correlation
The single most important design fact. In a prospective coeliac cohort
(PMC5283559), median time from suspected gluten ingestion to first symptom was
**1 hour (IQR 0.6–8 h)**, but **13% reported onset ≥12 h later**, and median
symptom *duration* was **24 h (IQR 6–48 h)**. Children react fast (15–30 min);
older adults can take **24–48 h**. Non-coeliac food *intolerance* reactions
classically appear **24–72 h** later.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC5283559/
- https://cygluten.com/article/how-fast-do-celiacs-react-to-gluten

**Design consequence:** correlation MUST be **lagged and per-trigger-class**.
A single global lag window is wrong. Gluten needs a wide, right-skewed window
(≈0–72 h, mode a few hours); acute lactose/sulphite reactions are much tighter
(≈30 min–6 h). A naive same-meal correlation would systematically mis-attribute.

### 2.2 Secondary lactose intolerance & the healing timeline
Villous atrophy from coeliac disease damages the brush-border lactase, causing
**secondary lactose intolerance** that often *resolves as the gut heals*.
Mucosal healing is slow: **~1/3 of adults have normal histology at 1 year,
~2/3 by 2 years**, some never fully normalise (PMC2881171). Dairy tolerance
typically returns after **≥6 months** GF, sometimes not to prior quantities.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC2881171/
- https://www.celiac.com/celiac-disease/gut-healing-after-a-celiac-diagnosis-what-science-says-about-recovery-time-video-r7066/
- https://www.allergicliving.com/2013/03/26/when-dairy-intolerance-joins-celiac-disease/

**Design consequence:** intolerance conclusions must be **time-boxed and
re-testable**, not permanent. A "lactose intolerant" conclusion carries a
*review-after* date; the app should proactively prompt a **re-challenge** of
secondary intolerances after a healing interval. This directly serves the
maintainer's multi-year multi-intolerance journey.

### 2.3 Comorbidity: persistent symptoms & FODMAP overlap
Up to **~25–30%** of coeliac patients have persistent GI symptoms despite strict
GF diet and even mucosal healing ("non-responsive coeliac disease"). Causes:
trace gluten (commonest), microscopic colitis, pancreatic insufficiency, and
**functional overlap (IBS)**. A **low-FODMAP** diet on top of GF beat GF-alone in
3/4 studies in a systematic review — evidence that a coeliac diary needs to model
*more than gluten* to be useful.
- https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11013587/ (low-FODMAP systematic review)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7019917/ (NHS non-responsive coeliac review)
- https://celiac.org/fodmaps-and-celiac-disease/

**Design consequence:** trigger classes must be extensible (gluten, lactose,
FODMAP subgroups, sulphites, nuts, histamine, …), each with its own lag profile
and its own elimination protocol. Multi-intolerance is the core model, not a
plugin.

### 2.4 Elimination / reintroduction protocol (the state machine spec)
Consensus across FODMAP (Monash) and general elimination-diet guidance:
- **Baseline** on current diet (establish symptom baseline).
- **Eliminate** the suspected trigger fully for a sustained period (FODMAP: the
  restriction phase runs ~2–6 weeks).
- **Reintroduce ONE variable at a time**, in small→larger doses over ~3 days.
- **Washout** to a clean baseline (**~3 days**, or 1–3 general) *between*
  challenges to isolate the signal and reset.
- Reintroduce foods every **3–5 days**; observe; **conclude** tolerate / react /
  dose-dependent.
- https://www.dietvsdisease.org/fodmap-reintroduction-challenge-plan/
- https://www.va.gov/WHOLEHEALTHLIBRARY/docs/Elimination-Diet.pdf

**Design consequence:** this maps cleanly to a finite state machine —
`baseline → eliminate → washout → reintroduce(oneVariable) → observe →
conclude` — with **one active challenge at a time** enforced (concurrent
challenges destroy attribution), configurable per-trigger durations, and
scheduled prompts.

### 2.5 HLA-DQ2/DQ8 genetics: rule OUT only, never diagnose
- HLA-DQ2/DQ8 **negative predictive value ≈ 100%** — its clinical role is to
  *exclude* coeliac disease. (PMC4149591)
- But **~30–40% of the general population carry DQ2/DQ8** and only ~1% have
  coeliac — so a **positive result has very low positive predictive value** and
  is *not* diagnostic.
- Tag-SNP **rs2187668** predicts the DQ2.5 haplotype with sensitivity 1.000,
  specificity 0.999, PPV 0.998 (PLOS One). Consumer raw genotype files
  (23andMe/AncestryDNA export) commonly include **rs2187668** (DQ2.5 / *HLA-DQA1
  tag) and **rs7454108** (a common DQ8 tag); DQ2.2/DQ7 need rs2395182,
  rs4713586/rs2187668 haplotype combinations — coverage varies by chip and is
  **imperfect**, so a consumer file can miss risk alleles it doesn't tag.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC4149591/
- https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0002270
- https://www.mygenefood.com/blog/genetics-celiac-disease-need-know/

**Design consequence:** genetics feature is framed **negative-predictive only** —
"these markers do not rule coeliac OUT / your carried risk haplotype is consistent
with coeliac but cannot diagnose it; diagnosis needs serology + biopsy on a
gluten-containing diet." Raw genotype file is parsed **client-side, on-device**;
**only the relevant-SNP summary** (a handful of rsIDs + interpretation) is stored,
pod-private. The raw file NEVER leaves the device. Explicit "chip may not tag all
risk alleles — a null result is not reassurance" caveat.

### 2.6 Drug pipeline (for the explainer page — as of 2026)
Framed carefully: **no disease-modifying drug is approved; GF diet remains the
only treatment.** Current landscape:
- **ZED1227 / TAK-227** (oral transglutaminase-2 inhibitor): most advanced
  disease-modifying candidate; **Phase 2b** under Takeda; Phase 2 showed
  histological protection during gluten challenge.
- **TAK-101** (tolerogenic gliadin nanoparticle, IV): **Phase 2** enrolling.
- **KAN-101 / zamaglutenase** (Anokion; liver-targeted tolerance): Phase 2;
  reads on gluten-induced IL-2.
- **Larazotide** (zonulin/tight-junction; formerly 9 Meters): **failed Phase 3,
  discontinued** — a cautionary tale to include honestly.
- Enzyme "glutenases" (latiglutenase/others): adjuncts, not cures.
- https://www.mdpi.com/2072-6643/17/18/2960 (Nutrients 2025 review)
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11970589/
- https://celiac.org/about-celiac-disease/future-therapies-for-celiac-disease/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC10341493/ (ZED1227)

**Design consequence:** the pipeline page is **static, research-grounded, and
dated**, refreshed from the Europe PMC feed (§3.3) + ClinicalTrials.gov (§3.2),
with an explicit "GF diet is still the only treatment" header and no hype.

### 2.7 Sulphites — the maintainer's named secondary intolerance
- Symptoms: asthma-type (wheeze, chest tightness), flushing, headache, nausea,
  diarrhoea; **4–5% of asthmatics** are sulphite-sensitive (Cleveland Clinic).
- Hidden sources: **dried fruit (esp. light/apricots), wine, beer, bottled
  citrus juice, frozen potato products, shrimp, pickles, maraschino cherries**.
- E-numbers **E220–E228** (sulphur dioxide + sulphites); ingredient aliases:
  sodium/potassium **meta**bisulphite, sodium bisulphite/sulphite, sulphurous
  acid. Regulatory declaration threshold is **10 ppm** — **below 10 ppm they can
  be legally unlabelled** (the hidden-exposure trap).
- https://my.clevelandclinic.org/health/diseases/11323-sulfite-sensitivity
- https://www.allergicliving.com/2010/08/19/food-allergy-sulphites/
- https://www.ingredicheck.app/blog/sulphite-allergy-dietary-guide-the-10-ppm-rule-e-numbers-and-common-sources

**Design consequence:** the exposure-derivation layer maps OpenFoodFacts
`additives_tags` (`en:e220`…`en:e228`) and ingredient-text aliases → a
`sulphites` exposure. Because sub-10-ppm sulphites are unlabelled, the app must
show a **"may contain undeclared sulphites"** hint for high-risk categories
(dried fruit, wine) even when tags are clean — an honest uncertainty flag, not
a false all-clear.

### 2.8 Psychological hazard: orthorexia / ARFID risk
A first-class safety concern, not a footnote. **14–57%** of coeliac patients may
meet **ARFID** criteria depending on tool; orthorexia tendencies and disturbed
eating attitudes are elevated in coeliac (adolescents especially). A tracking app
that rewards ever-tighter restriction can *worsen* this.
- https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12567165/ (ARFID in coeliac)
- https://jeatdisord.biomedcentral.com/articles/10.1186/s40337-025-01294-y (orthorexia)

**Design consequence:** the inference engine is tuned to **expand, not
contract**, the safe-food set where evidence allows (celebrate reintroduction
successes; prompt re-challenge of resolved secondary intolerances); never
gamifies restriction; shows confidence honestly; and surfaces a **"talk to a
dietitian / see a doctor" safety rail** (§4). No streaks-for-avoidance mechanics.

---

## 3. Integratable open APIs — VERIFIED LIVE (2026-07-03)

> Each endpoint below was hit directly. CORS was checked because the app is
> client-side (pod-based, no server of our own). Where a secondary source was
> wrong, the live result is authoritative and flagged.

### 3.1 OpenFoodFacts — the packet-scan backbone ✅ CORS-open
- Base: `https://world.openfoodfacts.org/api/v2/product/{barcode}.json`
- **CORS: `access-control-allow-origin: *` — VERIFIED on the live v2 endpoint.**
  ⚠️ Widely-repeated secondary claims that "OFF has no CORS" are **WRONG for
  v2** — direct browser fetch works. (Confirmed with a live `curl -D-`.)
- No API key, no signup for reads. Free; "no rate limiting for reasonable use"
  but **they ask for a descriptive `User-Agent`** identifying the app so they can
  contact abusers. (Browsers forbid setting `User-Agent`; use the documented
  alternative header / query param, or accept the default — see DESIGN §Knowledge.)
- Fields we need (verified present in a live response for `3017620422003`):
  `product_name`, `ingredients_text`, **`allergens_tags`** (e.g. `en:milk`,
  `en:nuts`, `en:soybeans`), **`traces_tags`** (cross-contamination — "may
  contain"), **`additives_tags`** (e.g. `en:e322` — the sulphite hook is
  `en:e220`…`en:e228`), `nutriments`.
- **Licence: ODbL** — data is open; **attribution to Open Food Facts required**;
  cache is fine (encouraged).
- Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/ ·
  Terms: https://world.openfoodfacts.org/terms-of-use · Data: https://world.openfoodfacts.org/data

### 3.2 ClinicalTrials.gov API v2 — recruiting-trials view ✅ (simple GET only)
- Base: `https://clinicaltrials.gov/api/v2/studies`
- Query verified live: `?query.cond=celiac%20disease&filter.overallStatus=RECRUITING&pageSize=…&fields=…`
  returns JSON with `studies[].protocolSection.{identificationModule,statusModule,…}`;
  token pagination via `nextPageToken` → `pageToken`.
- **CORS nuance (VERIFIED):** a plain `GET` returns `access-control-allow-origin:
  *` and works cross-origin; but an `OPTIONS` **preflight returns 403**. So the
  client must issue **simple requests only** — no custom headers, no non-simple
  `Content-Type` — or the browser preflight fails. (This shaped the design: no
  `Authorization`, default `Accept`.)
- No key; JSON; OpenAPI-described.
- Docs: https://clinicaltrials.gov/data-api/api ·
  https://www.nlm.nih.gov/pubs/techbull/ma24/ma24_clinicaltrials_api.html
- **Location filtering caveat:** v2 has no clean single "country" filter param;
  filter client-side on `protocolSection.contactsLocationsModule.locations[].country`
  (or via `query.locn`/`filter.geo` distance search).

### 3.3 Europe PMC REST — latest-research feed ✅ CORS-open
- Base: `https://www.ebi.ac.uk/europepmc/webservices/rest/search`
- Verified: `?query=coeliac%20AND%20intolerance&format=json&pageSize=…&sort=P_PDATE_D%20desc`
  → `{hitCount, nextCursorMark, resultList.result[]}` with `pmid`, `pmcid`,
  `doi`, `title`, `authorString`, journal, date. `cursorMark` pagination.
- **CORS: `access-control-allow-origin: *` — VERIFIED.** No key. Free.
- Docs: https://europepmc.org/RestfulWebService

### 3.4 openFDA — drug labels & adverse events (pipeline page enrichment) ✅ CORS-open
- Base: `https://api.fda.gov/drug/label.json` and `.../drug/event.json`
- **CORS: `access-control-allow-origin: *` — VERIFIED.** No key needed (rate
  limit **240 req/min, 1,000/day** unauthenticated; higher with a free key).
- Note: **investigational coeliac drugs (larazotide, ZED1227, TAK-101) have NO
  FDA label** (none approved) — a live query returns 404, which is *expected and
  informative*. openFDA is only useful for enzyme/adjunct OTC products and for
  the honest "no approved drug exists" framing, not for pipeline data. Pipeline
  status comes from Europe PMC + ClinicalTrials.gov + curated review citations.

### 3.5 Coeliac UK — NO public API (link-out only) ✅ confirmed
Venue-guide and food-directory data sit behind a **members-only internal API**.
No developer API, no ODbL-style open licence. **Integration = deep link-out**
to their venue guide and product checker. Do not scrape.
- https://www.coeliac.org.uk/gluten-free-accredited-venues/

### 3.6 Client-side scan/OCR/voice libraries (verified, for capture UX)
- **Barcode:** `zxing-wasm` (ZXing-C++ compiled to WASM, actively maintained;
  ES/CJS; powers the `barcode-detector` polyfill) — https://github.com/Sec-ant/zxing-wasm ·
  `react-zxing` hook wrapper. Struggles with damaged/blurry/tiny codes + low
  light — needs a manual-barcode-entry fallback.
- **OCR fallback:** `tesseract.js` (WASM Tesseract). Independent eval on real
  food packaging (arXiv 2510.03570) found Tesseract has **decent char accuracy
  under good lighting but only ~80% coverage** and is sensitive to noise, small
  fonts, curved/tabular text — i.e. **error-prone on ingredient panels**. Treat
  OCR output as a *draft the user confirms*, never as ground truth into
  inference. — https://arxiv.org/abs/2510.03570
- **Voice:** Web Speech API (`SpeechRecognition`) — browser-native, **no key**,
  but **Chromium-only in practice** (Safari/Firefox partial/absent) and sends
  audio to a cloud recogniser in Chrome. Deterministic food-phrase parser on top;
  optional injectable-LLM seam for free-text (no key baked in).

---

## 4. What "see a doctor" must mean (safety literature → product rails)
The app is decision support and must actively route users to care when
appropriate. Evidence-driven red flags to hard-surface (not correlate away):
- **Never self-diagnose coeliac off this app.** Diagnosis requires serology
  (tTG-IgA) + duodenal biopsy **while still eating gluten** — going GF first
  invalidates testing. The app must warn *before* anyone eliminates gluten
  pre-diagnosis. (Celiac Disease Foundation; §2.5.)
- **Alarm symptoms** → urgent care, not correlation: unintended weight loss, GI
  bleeding/black stools, persistent vomiting, dysphagia, iron-deficiency anaemia,
  severe/persistent pain, or any **anaphylaxis** signs (true IgE allergy ≠
  intolerance). Sulphite reactions can include **asthma/anaphylactoid** responses
  (§2.7) — a breathing-difficulty flag must say *emergency*, not "log it."
- **Non-responsive symptoms despite strict GF** (§2.3) → see gastroenterology
  (rule out refractory coeliac, microscopic colitis, pancreatic insufficiency),
  don't just eliminate more foods.
- **Eating-disorder safety** (§2.8): restriction-anxiety patterns → dietitian
  referral prompt; the app must not be the sole manager of a shrinking diet.

---

## 5. Why a pod-based app (the differentiator, evidence-backed)
1. **Ownership & longevity** — a multi-year diagnostic diary (the maintainer's
   own journey) is irreplaceable; Spoonful lock-outs and dead apps show the risk
   of vendor-held health data. Pod = the diary outlives any app version.
2. **Privacy** — genetic summaries, symptom logs, and mental-health-adjacent
   restriction data are among the most sensitive categories; **owner-only WAC,
   fail-closed**, no server of ours ever sees it, nothing monetised.
3. **Multi-condition, one model** — the suite already ships a gUFO-rooted
   `health` sector (`solid-federation-vocab/sectors/health`, FHIR/SNOMED/LOINC-
   aligned, QUDT units) and `@jeswr/solid-task-model` accessors to build on; a
   coeliac diary is a *nutrition/intolerance extension* of that, not a silo.
4. **Portability** — the same pod diary can surface in Pod Manager, feed the
   federation, and be shared (opt-in) with a real dietitian — impossible in a
   walled-garden app.

---

## 6. Open questions carried into DESIGN (documented, proceeding on best call)
- **Trigger-class lag windows**: seeded from literature (§2.1) but should become
  *learnable per-user* once enough data exists — start with evidence priors.
- **Genetics chip coverage**: which rsIDs to parse is chip-dependent; start with
  the well-established DQ2.5 (rs2187668) + DQ8 (rs7454108) tags + explicit
  incompleteness caveat.
- **Voice availability**: Chromium-only; ship as progressive enhancement with
  manual + scan always available.
