# @jeswr/solid-health-diary

> The **shared multi-intolerance health-diary RDF model** for the Solid app suite —
> the data layer of the coeliac / multi-intolerance diary (`jeswr/coeliac-app`),
> so a meal, symptom, or conclusion written by one app reads identically in
> another and in Pod Manager.

A small, dependency-light data-model package (Brief 1A of the coeliac-app build):
a documented RDF vocabulary binding, typed read/write accessors, exposure
derivation from Open Food Facts tags, an owner-only fail-closed ACL helper, and a
SHACL profile. It models health data, so **every diary resource is owner-only,
fail-closed** — nothing here is ever public.

## Why one model

A `diet:Meal` / `diet:Symptom` / `diet:ToleranceConclusion` written by one app is
only useful to another if both agree on which predicates carry which fields. This
package is that shared contract, built on **reused, dereferenceable standard
vocabulary** — [schema.org](https://schema.org/), the suite gUFO-rooted `health`
sector, OWL-Time, PROV-O and Dublin Core — plus the new nutrition/intolerance
terms under `diet:` (`https://w3id.org/jeswr/sectors/health/diet#`). The `diet:`
ontology + SHACL are authored in
[`solid-federation-vocab`](https://github.com/jeswr/solid-federation-vocab)
(`sectors/health/diet`, Brief 1B); this package uses those exact terms and vendors
the profile + vocabulary (`shapes/diet.shacl.ttl`, `shapes/diet.vocab.ttl`) so it
is self-contained and its round-trip fixtures validate against the canonical SHACL.

## The entities (DESIGN §2.2)

| Entity | Class | Key fields |
|---|---|---|
| Meal / intake event | `diet:Meal` (⊑ `schema:Meal`) | `schema:startTime` (ingestion time — load-bearing for lag), `diet:context`, `diet:portion`, `diet:hasItem` → FoodItems, `diet:venue`, `diet:note` |
| Food item | `diet:FoodItem` | `schema:name`, `diet:offBarcode`/`offRef`/`ingredientsText`, `diet:declaredAllergen`/`traceAllergen`/`additive`/`offCategory` (OFF tags), `diet:sourceConfidence` (`manual`/`off`/`ocr`/`voice`) |
| Exposure (derived) | `diet:Exposure` | `diet:trigger` → TriggerClass, `diet:exposureLevel` (`present`/`trace`/`possible-undeclared`/`absent`), `diet:derivedFrom` (tap-through provenance) |
| Symptom | `diet:Symptom` (⊑ `health:Observation`) | `diet:symptomType`, `schema:startTime` (onset), `diet:severity` (0–10), `health:patient` |
| Trigger class | `diet:TriggerClass` (`skos:Concept`) | `diet:lagWindowMin`/`lagWindowMax`/`lagMode` (evidence-prior lag profile, hours) |
| Elimination protocol | `diet:EliminationProtocol` | `diet:targetTrigger`, `diet:phase` (FSM), `diet:phaseStarted`/`phasePlannedEnd`, `diet:challengeStep` |
| Tolerance conclusion | `diet:ToleranceConclusion` | `diet:aboutTrigger`, `diet:verdict`, `diet:confidence` (ordinal), `diet:reviewAfter` (time-boxed re-challenge), `diet:derivedFrom` |
| Genetic summary | `diet:GeneticSummary` + `diet:HlaMarker` | `diet:hlaMarker` (rsid/genotype/interpretation — **summary only, never raw genotype data**), `diet:geneticInterpretation` (negative-predictive framing), `diet:enteredManually` |
| Diet plan | `diet:DietPlan` | `diet:excludes` → TriggerClasses, `diet:restsOn` → the conclusions they rest on |

The enum-valued fields are stored as canonical `diet:` **concept IRIs** (the vocab
models them as SKOS concepts); the typed accessors expose a friendly token (e.g.
`possible-undeclared` ⇄ `diet:possibleUndeclared`) via the codecs in
`concepts.ts`.

## Usage

```ts
import {
  buildMeal, parseMealTtl, serializeMeal, deriveExposures,
  buildOwnerOnlyAcl, type MealData,
} from "@jeswr/solid-health-diary";

// Derive trigger exposures from scanned Open Food Facts tags…
const items = [{ id: url + "#item-0", name: "Dried apricots", offCategory: ["en:dried-apricots"] }];
const exposures = deriveExposures(items); // → possible-undeclared sulphites (clean tags, high-risk category)

// …and serialise the meal (n3.Writer under the hood — never hand-built triples).
const ttl = await serializeMeal(url, { startTime: new Date(), items, exposures });

// Parse a fetched body (Turtle or JSON-LD, dispatched via @jeswr/fetch-rdf).
const meal: MealData | undefined = await parseMealTtl(url, body, contentType);

// Write the owner-only, fail-closed ACL for the diary container FIRST.
const aclTtl = await buildOwnerOnlyAcl("https://alice.pod/health/diary/", webId);
```

### Exposure derivation (`deriveExposures`)

Maps OFF `allergens_tags` / `traces_tags` → `present` / `trace` exposures,
`additives_tags` E220–E228 + ingredient-text sulphite aliases → `sulphites`
`present`, and a curated **high-risk-category → trigger** map (dried fruit / wine /
beer / bottled citrus / pickles → sulphites) → `possible-undeclared` when tags are
clean. If a food item has **no category**, the `possible-undeclared` fallback does
not fire (no false alarm) — an honest uncertainty flag, never a false all-clear
(the sub-10-ppm sulphite honesty case, RESEARCH §2.7).

### Evidence-prior lag profiles

Each `diet:TriggerClass` carries a literature-seeded lag window (hours) —
gluten wide/right-skewed (0–72 h, modal ~3 h), acute lactose/sulphite/histamine
(tight ~0.25–6 h), FODMAP subgroups mid (~0.5–24 h). `EVIDENCE_PRIOR_LAG` is kept
byte-for-byte in step with the landed `diet:` ontology (a test cross-checks it
against `shapes/diet.vocab.ttl`); they are priors, learnable per-user later.

### SHACL validation (`./shape` — Node-only)

```ts
import { dietShaclTtl, dietVocabTtl } from "@jeswr/solid-health-diary/shape";
// Validate a data graph against the vendored 1B profile; load dietVocabTtl() into
// the data graph so the sh:class checks over the coded-value concept IRIs resolve.
```

The `./shape` subpath imports `node:fs` and is server-only. **The root barrel is
browser-safe** (an esbuild `--platform=browser` smoke test gates it), so
`import { buildMeal } from "@jeswr/solid-health-diary"` bundles cleanly in a client
component.

## Install (GitHub, no build step)

`dist/` is **committed**, so under the suite's `ignore-scripts=true` policy the
package installs and imports with no build step:

```sh
npm install github:jeswr/solid-health-diary#main
```

> Because `dist/` is committed it can drift from `src/`. The `check:dist` gate
> rebuilds into a temp dir and diffs — so **any `src/` change must rebuild + commit
> `dist/` in the same change**. npm publish is a deferred migration, not a blocker.

## Develop

```sh
npm run gate   # lint (Biome) + typecheck (tsc) + test (vitest) + build + check:dist + check:lockfile-transport
```

Authored by Claude Opus 4.8 (Fable unavailable). See commit trailers / `AUTHORED-BY`
markers.
