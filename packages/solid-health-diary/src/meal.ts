// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `diet:Meal` (⊑ `schema:FoodEvent`) + its `diet:FoodItem`s + the derived
 * `diet:Exposure`s — one pod resource per intake event (DESIGN §2.2 entities 1–3,
 * §2.3 layout `meals/{yyyy}/{mm}/{ulid}.ttl`).
 *
 * A meal document holds: the Meal at `#it`, one FoodItem per `#item-{n}`, and one
 * Exposure per `#exposure-{n}`. The Meal links its items via `diet:hasItem`;
 * Exposures are found in the document by `rdf:type diet:Exposure` and carry
 * `diet:derivedFrom` back to the FoodItems they were derived from (tap-through
 * transparency — DESIGN §2.2 entity 3).
 *
 * The enum-valued fields (`context`, `portion`, `sourceConfidence`,
 * `exposureLevel`, `trigger`) are stored as canonical `diet:` **concept IRIs**
 * (the landed 1B vocab models them as object properties over SKOS concepts); the
 * accessors expose the friendly token via the codecs in `./concepts.ts`.
 *
 * Typed `@rdfjs/wrapper` accessors over an n3 `Store`; serialise via `n3.Writer`;
 * parse via `@jeswr/fetch-rdf`. **Never hand-built triples** (house rule).
 *
 * `schema:startTime` on the Meal is the **ingestion time** and is load-bearing:
 * it is one half of every lag calculation (the Symptom onset is the other).
 */

import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  contextCodec,
  exposureLevelCodec,
  portionCodec,
  sourceConfidenceCodec,
} from "./concepts.js";
import { docOf, httpIriOrUndefined, isHttpIri } from "./iri.js";
import { assertSubjectSingletons } from "./rdfGuards.js";
import { parseBody, storeToTurtle } from "./serialize.js";
import { setIfDefined, tryRead, validDateOrUndefined } from "./util.js";
import {
  DIET_DERIVED_FROM,
  DIET_EXPOSURE,
  DIET_FOOD_ITEM,
  DIET_MEAL,
  dct,
  diet,
  HEALTH_PATIENT_PROP,
  isTriggerSlug,
  RDF_TYPE,
  rdf,
  schema,
  type TriggerSlug,
  triggerIri,
  triggerSlugFromIri,
} from "./vocab.js";

// --- Enumerations (friendly tokens; stored as diet: concept IRIs) ------------

/** Where a meal was eaten — the eating-out signal (DESIGN §2.2, RESEARCH §1.3). */
export type MealContext = (typeof contextCodec.tokens)[number];
/** The known meal contexts. */
export const MEAL_CONTEXTS: readonly MealContext[] = contextCodec.tokens;

/** Qualitative portion size. */
export type Portion = (typeof portionCodec.tokens)[number];
/** The known portion sizes. */
export const PORTIONS: readonly Portion[] = portionCodec.tokens;

/**
 * How a FoodItem's data was captured — DESIGN §2.2 entity 2. `ocr`/`voice` are
 * DRAFTS the user confirms; the inference engine may down-weight low-confidence
 * sources (never auto-feeds OCR/voice into a conclusion — RESEARCH §3.6 / §10.5).
 */
export type SourceConfidence = (typeof sourceConfidenceCodec.tokens)[number];
/** The known source-confidence values. */
export const SOURCE_CONFIDENCES: readonly SourceConfidence[] = sourceConfidenceCodec.tokens;

/**
 * The strength of a derived trigger exposure (DESIGN §2.2 entity 3):
 * - `present` — declared (an allergen tag, an E220–E228 additive, an
 *   ingredient-text sulphite alias).
 * - `trace` — "may contain" / cross-contamination (a traces tag).
 * - `possible-undeclared` — clean tags but a high-risk `diet:offCategory` that
 *   commonly hides this trigger (the sub-10-ppm sulphite honesty flag — RESEARCH
 *   §2.7). An honest uncertainty flag, NOT a false all-clear.
 * - `absent` — modelled for completeness; the derivation never emits it (a
 *   trigger with no exposure simply yields no Exposure node).
 */
export type ExposureLevel = (typeof exposureLevelCodec.tokens)[number];
/** The known exposure levels, strongest first. */
export const EXPOSURE_LEVELS: readonly ExposureLevel[] = exposureLevelCodec.tokens;

// --- Plain data shapes --------------------------------------------------------

/** A single food/product in a meal (DESIGN §2.2 entity 2). */
export interface FoodItemData {
  /** Subject IRI (`${mealUrl}#item-{n}`); minted by {@link buildMeal} when absent. */
  id?: string;
  /** `schema:name`. */
  name?: string;
  /** `diet:offBarcode` — the scanned GTIN/EAN. */
  offBarcode?: string;
  /** `diet:offRef` — `https://world.openfoodfacts.org/product/{barcode}` (ODbL). */
  offRef?: string;
  /** `diet:ingredientsText` — cached OFF `ingredients_text` (or an OCR draft). */
  ingredientsText?: string;
  /** `diet:declaredAllergen` — OFF `allergens_tags` (raw strings, e.g. `en:milk`). */
  declaredAllergen?: string[];
  /** `diet:traceAllergen` — OFF `traces_tags` ("may contain"). */
  traceAllergen?: string[];
  /** `diet:additive` — OFF `additives_tags` (the sulphite hook `en:e220`…`en:e228`). */
  additive?: string[];
  /** `diet:offCategory` — OFF `categories_tags` (drives the possible-undeclared flag). */
  offCategory?: string[];
  /** `diet:sourceConfidence` — how this item's data was captured. */
  sourceConfidence?: SourceConfidence;
}

/** A derived trigger exposure (DESIGN §2.2 entity 3). */
export interface ExposureData {
  /**
   * Subject IRI (`${mealUrl}#exposure-{n}`). OUTPUT-only: set on parse.
   * {@link buildMeal} ALWAYS mints the in-document subject and ignores any value
   * supplied here (an out-of-document subject would be unreadable by the
   * document-scoped {@link parseMeal}).
   */
  id?: string;
  /** `diet:trigger` — the TriggerClass slug. */
  trigger: TriggerSlug;
  /** `diet:exposureLevel`. */
  exposureLevel: ExposureLevel;
  /** `diet:derivedFrom` — the FoodItem subject IRIs this was derived from. */
  derivedFrom?: string[];
  /** `diet:note` — e.g. the honest "verify against the packet" note on a possible-undeclared flag. */
  note?: string;
}

/** A meal / intake event (DESIGN §2.2 entity 1). */
export interface MealData {
  /** Subject IRI (`${url}#it`); informational — {@link buildMeal} roots at `#it`. */
  id?: string;
  /** `schema:startTime` — the INGESTION time (load-bearing for lag). Required. */
  startTime: Date;
  /** `diet:context` — where it was eaten. */
  context?: MealContext;
  /** `diet:venue` — free-text venue (or use {@link location} for a `schema:Restaurant`). */
  venue?: string;
  /** `schema:location` — an IRI reference to a place. */
  location?: string;
  /** `diet:portion`. */
  portion?: Portion;
  /** `diet:note`. */
  note?: string;
  /** `health:patient` — the pod-owner `health:Patient`/`core:Person` WebID (DESIGN §2.2). */
  patient?: string;
  /** `dcterms:created`. */
  created?: Date;
  /** `diet:hasItem` → the FoodItems. */
  items: FoodItemData[];
  /** The `diet:Exposure` nodes in the document (derived; see `deriveExposures`). */
  exposures?: ExposureData[];
}

/** Sorted copy of a string set-literal accessor (stable array round-trip). */
function sortedStrings(set: Set<string>): string[] {
  return [...set].sort();
}

// --- Subjects -----------------------------------------------------------------

/** The Meal subject IRI: `${url}#it`. */
export function mealSubject(url: string): string {
  return `${url}#it`;
}
/** The n-th FoodItem subject IRI: `${url}#item-{n}`. */
export function foodItemSubject(url: string, index: number): string {
  return `${url}#item-${index}`;
}
/** The n-th Exposure subject IRI: `${url}#exposure-{n}`. */
export function exposureSubject(url: string, index: number): string {
  return `${url}#exposure-${index}`;
}

// The predicates the guard checks are EXACTLY those the vendored SHACL declares
// `sh:maxCount 1` — NOT every field the accessors read as a scalar. The profile is
// open, so a field the shape leaves unconstrained (schema:name, diet:note,
// health:patient, dct:created, …) may legitimately repeat (e.g. localized labels)
// and must NOT invalidate the parse; for those the accessor's first-match read
// stands. (Derived from shapes/diet.shacl.ttl sh:maxCount 1 property shapes.)
const MEAL_SINGLETONS: readonly string[] = [schema("startTime"), diet("context"), diet("portion")];
const FOOD_ITEM_SINGLETONS: readonly string[] = [diet("sourceConfidence")];
const EXPOSURE_SINGLETONS: readonly string[] = [diet("trigger"), diet("exposureLevel")];

/** The trailing integer of a `…-{n}` subject IRI, for deterministic ordering (−1 if none). */
function trailingIndex(iri: string): number {
  const m = iri.match(/-(\d+)$/);
  return m ? Number.parseInt(m[1] as string, 10) : -1;
}

/** Whether `subject`'s document (its IRI minus fragment) is exactly the meal `url`. */
function inDocument(subject: string, url: string): boolean {
  try {
    return docOf(subject) === url;
  } catch {
    return false;
  }
}

// --- FoodItem accessor --------------------------------------------------------

/** Typed `@rdfjs/wrapper` view of a `diet:FoodItem`. */
export class FoodItem extends TermWrapper {
  get id(): string {
    return this.value;
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(DIET_FOOD_ITEM);
    return this;
  }
  get isFoodItem(): boolean {
    return this.types.has(DIET_FOOD_ITEM);
  }

  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, schema("name"), LiteralAs.string);
  }
  set name(value: string | undefined) {
    OptionalAs.object(this, schema("name"), value, LiteralFrom.string);
  }

  get offBarcode(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("offBarcode"), LiteralAs.string);
  }
  set offBarcode(value: string | undefined) {
    OptionalAs.object(this, diet("offBarcode"), value, LiteralFrom.string);
  }

  get offRef(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("offRef"), NamedNodeAs.string);
  }
  set offRef(value: string | undefined) {
    OptionalAs.object(this, diet("offRef"), value, NamedNodeFrom.string);
  }

  get ingredientsText(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("ingredientsText"), LiteralAs.string);
  }
  set ingredientsText(value: string | undefined) {
    OptionalAs.object(this, diet("ingredientsText"), value, LiteralFrom.string);
  }

  /** `diet:declaredAllergen` — OFF tag strings (live set). */
  get declaredAllergen(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      diet("declaredAllergen"),
      LiteralAs.string,
      LiteralFrom.string,
    );
  }
  /** `diet:traceAllergen` — OFF tag strings (live set). */
  get traceAllergen(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      diet("traceAllergen"),
      LiteralAs.string,
      LiteralFrom.string,
    );
  }
  /** `diet:additive` — OFF tag strings (live set). */
  get additive(): Set<string> {
    return SetFrom.subjectPredicate(this, diet("additive"), LiteralAs.string, LiteralFrom.string);
  }
  /** `diet:offCategory` — OFF tag strings (live set). */
  get offCategory(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      diet("offCategory"),
      LiteralAs.string,
      LiteralFrom.string,
    );
  }

  /** `diet:sourceConfidence` → `diet:{concept}`; read back as the friendly token. */
  get sourceConfidence(): SourceConfidence | undefined {
    return sourceConfidenceCodec.fromIri(
      OptionalFrom.subjectPredicate(this, diet("sourceConfidence"), NamedNodeAs.string),
    );
  }
  set sourceConfidence(value: SourceConfidence | undefined) {
    OptionalAs.object(
      this,
      diet("sourceConfidence"),
      value ? sourceConfidenceCodec.toIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }
}

/** Read a FoodItem subject into plain data (its subject need not be `#item-{n}`). */
export function parseFoodItem(subject: string, dataset: DatasetCore): FoodItemData | undefined {
  return tryRead(() => parseFoodItemImpl(subject, dataset));
}
function parseFoodItemImpl(subject: string, dataset: DatasetCore): FoodItemData | undefined {
  // The SUBJECT itself must be an http(s) IRI — a hostile document can link
  // `diet:hasItem <javascript:…>` to a typed, named FoodItem; drop it rather than
  // surface a `javascript:`/`data:` IRI as a FoodItemData.id to consumers.
  if (!isHttpIri(subject)) return undefined;
  const doc = new FoodItem(subject, dataset, DataFactory);
  if (!doc.isFoodItem) return undefined;
  assertSubjectSingletons(dataset, subject, FOOD_ITEM_SINGLETONS);
  // Fail-closed on the SHACL MUST (schema:name on every FoodItem), symmetric with
  // the buildMeal builder: a nameless FoodItem is not a usable intake record (the
  // WHAT is unknown), so drop it rather than surface an invalid item.
  const name = doc.name;
  if (!name) return undefined;
  const data: FoodItemData = { id: subject, name };
  setIfDefined(data, "offBarcode", doc.offBarcode);
  // Drop a non-http(s) `offRef` on READ too (not only on write) — a hostile pod
  // document could otherwise surface a `javascript:`/`data:` IRI to consumers.
  setIfDefined(data, "offRef", httpIriOrUndefined(doc.offRef));
  setIfDefined(data, "ingredientsText", doc.ingredientsText);
  setIfDefined(data, "sourceConfidence", doc.sourceConfidence);
  const declared = sortedStrings(doc.declaredAllergen);
  const traces = sortedStrings(doc.traceAllergen);
  const additives = sortedStrings(doc.additive);
  const categories = sortedStrings(doc.offCategory);
  if (declared.length) data.declaredAllergen = declared;
  if (traces.length) data.traceAllergen = traces;
  if (additives.length) data.additive = additives;
  if (categories.length) data.offCategory = categories;
  return data;
}

/** Write a FoodItem's fields onto its subject in `store` (used by {@link buildMeal}). */
function writeFoodItem(store: Store, subject: string, item: FoodItemData): void {
  const doc = new FoodItem(subject, store, DataFactory).mark();
  doc.name = item.name;
  doc.offBarcode = item.offBarcode;
  // offRef is an untrusted-ish IRI — drop a non-http(s) value.
  doc.offRef = httpIriOrUndefined(item.offRef);
  doc.ingredientsText = item.ingredientsText;
  doc.sourceConfidence = item.sourceConfidence;
  for (const t of item.declaredAllergen ?? []) doc.declaredAllergen.add(t);
  for (const t of item.traceAllergen ?? []) doc.traceAllergen.add(t);
  for (const t of item.additive ?? []) doc.additive.add(t);
  for (const t of item.offCategory ?? []) doc.offCategory.add(t);
}

// --- Exposure accessor --------------------------------------------------------

/** Typed `@rdfjs/wrapper` view of a `diet:Exposure`. */
export class Exposure extends TermWrapper {
  get id(): string {
    return this.value;
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(DIET_EXPOSURE);
    return this;
  }
  get isExposure(): boolean {
    return this.types.has(DIET_EXPOSURE);
  }

  /** `diet:trigger` → `diet:{slug}`; read back as the slug (unknown IRI ⇒ undefined). */
  get trigger(): TriggerSlug | undefined {
    return triggerSlugFromIri(
      OptionalFrom.subjectPredicate(this, diet("trigger"), NamedNodeAs.string) ?? "",
    );
  }
  set trigger(value: TriggerSlug | undefined) {
    OptionalAs.object(
      this,
      diet("trigger"),
      value ? triggerIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  /** `diet:exposureLevel` → `diet:{concept}`; read back as the friendly token. */
  get exposureLevel(): ExposureLevel | undefined {
    return exposureLevelCodec.fromIri(
      OptionalFrom.subjectPredicate(this, diet("exposureLevel"), NamedNodeAs.string),
    );
  }
  set exposureLevel(value: ExposureLevel | undefined) {
    OptionalAs.object(
      this,
      diet("exposureLevel"),
      value ? exposureLevelCodec.toIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  /** `diet:derivedFrom` — the FoodItem IRIs (live set; ⊑ `prov:wasDerivedFrom`). */
  get derivedFrom(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      DIET_DERIVED_FROM,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  get note(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("note"), LiteralAs.string);
  }
  set note(value: string | undefined) {
    OptionalAs.object(this, diet("note"), value, LiteralFrom.string);
  }
}

/** Read an Exposure subject into plain data. */
export function parseExposure(subject: string, dataset: DatasetCore): ExposureData | undefined {
  return tryRead(() => parseExposureImpl(subject, dataset));
}
function parseExposureImpl(subject: string, dataset: DatasetCore): ExposureData | undefined {
  // The SUBJECT itself must be an http(s) IRI (symmetric with parseFoodItem) — a
  // hostile document could type a `javascript:`/`data:` node as an Exposure; never
  // surface such an IRI as an ExposureData.id to consumers.
  if (!isHttpIri(subject)) return undefined;
  const doc = new Exposure(subject, dataset, DataFactory);
  if (!doc.isExposure) return undefined;
  assertSubjectSingletons(dataset, subject, EXPOSURE_SINGLETONS);
  const trigger = doc.trigger;
  const exposureLevel = doc.exposureLevel;
  // A well-formed exposure must name a known trigger + level; a foreign/garbled
  // node missing either is not a usable exposure (drop it rather than guess).
  if (!trigger || !exposureLevel) return undefined;
  const data: ExposureData = { id: subject, trigger, exposureLevel };
  setIfDefined(data, "note", doc.note);
  // http(s)-only on READ (symmetric with the writer) — drop any non-http(s)
  // `derivedFrom` IRI a hostile pod document might carry.
  const from = sortedStrings(doc.derivedFrom).filter(isHttpIri);
  if (from.length) data.derivedFrom = from;
  return data;
}

/** Write an Exposure's fields onto its subject in `store` (used by {@link buildMeal}). */
function writeExposure(store: Store, subject: string, exp: ExposureData): void {
  // Fail-closed on the Exposure SHACL MUSTs: a KNOWN trigger and a KNOWN level.
  // `triggerIri` does NOT validate (it just concatenates), so an unknown trigger
  // would silently emit a bogus `diet:<bad-token>`; a missing trigger/level would
  // emit no predicate at all. Either way parseExposure drops it — refuse up front.
  if (!exp.trigger || !isTriggerSlug(exp.trigger)) {
    throw new Error(
      `buildMeal: every exposure needs a known diet:trigger — got ${JSON.stringify(exp.trigger)}.`,
    );
  }
  if (!exp.exposureLevel || !exposureLevelCodec.isToken(exp.exposureLevel)) {
    throw new Error(
      `buildMeal: every exposure needs a known diet:exposureLevel — got ${JSON.stringify(
        exp.exposureLevel,
      )}.`,
    );
  }
  const doc = new Exposure(subject, store, DataFactory).mark();
  doc.trigger = exp.trigger;
  doc.exposureLevel = exp.exposureLevel;
  doc.note = exp.note;
  for (const iri of exp.derivedFrom ?? []) if (isHttpIri(iri)) doc.derivedFrom.add(iri);
}

// --- Meal accessor ------------------------------------------------------------

/** Typed `@rdfjs/wrapper` view of a `diet:Meal`. */
export class Meal extends TermWrapper {
  get id(): string {
    return this.value;
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(DIET_MEAL);
    return this;
  }
  get isMeal(): boolean {
    return this.types.has(DIET_MEAL);
  }

  /** `schema:startTime` — ingestion time. */
  get startTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, schema("startTime"), LiteralAs.date);
  }
  set startTime(value: Date | undefined) {
    OptionalAs.object(this, schema("startTime"), value, LiteralFrom.dateTime);
  }

  /** `diet:context` → `diet:{concept}`; read back as the friendly token. */
  get context(): MealContext | undefined {
    return contextCodec.fromIri(
      OptionalFrom.subjectPredicate(this, diet("context"), NamedNodeAs.string),
    );
  }
  set context(value: MealContext | undefined) {
    OptionalAs.object(
      this,
      diet("context"),
      value ? contextCodec.toIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  get venue(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("venue"), LiteralAs.string);
  }
  set venue(value: string | undefined) {
    OptionalAs.object(this, diet("venue"), value, LiteralFrom.string);
  }

  get location(): string | undefined {
    return OptionalFrom.subjectPredicate(this, schema("location"), NamedNodeAs.string);
  }
  set location(value: string | undefined) {
    OptionalAs.object(this, schema("location"), value, NamedNodeFrom.string);
  }

  /** `diet:portion` → `diet:{concept}`; read back as the friendly token. */
  get portion(): Portion | undefined {
    return portionCodec.fromIri(
      OptionalFrom.subjectPredicate(this, diet("portion"), NamedNodeAs.string),
    );
  }
  set portion(value: Portion | undefined) {
    OptionalAs.object(
      this,
      diet("portion"),
      value ? portionCodec.toIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  get note(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("note"), LiteralAs.string);
  }
  set note(value: string | undefined) {
    OptionalAs.object(this, diet("note"), value, LiteralFrom.string);
  }

  /** `health:patient` — the pod-owner Patient/Person WebID. */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HEALTH_PATIENT_PROP, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, HEALTH_PATIENT_PROP, value, NamedNodeFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }

  /** `diet:hasItem` → the FoodItem IRIs (live set). */
  get hasItem(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      diet("hasItem"),
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/**
 * Parse a whole Meal document (Meal + its FoodItems + its Exposures) into plain
 * data, or `undefined` if `${url}#it` is not a `diet:Meal`.
 *
 * Items are read in `#item-{n}` order (via `diet:hasItem`); exposures are found
 * by `rdf:type diet:Exposure` in the document, also ordered by `#exposure-{n}`.
 */
export function parseMeal(url: string, dataset: DatasetCore): MealData | undefined {
  return tryRead(() => parseMealImpl(url, dataset));
}
function parseMealImpl(url: string, dataset: DatasetCore): MealData | undefined {
  const doc = new Meal(mealSubject(url), dataset, DataFactory);
  if (!doc.isMeal) return undefined;
  // Fail closed on a document that duplicates any single-valued (sh:maxCount 1)
  // field (e.g. two schema:startTime) — never parse one with an arbitrary value.
  assertSubjectSingletons(dataset, mealSubject(url), MEAL_SINGLETONS);

  // `schema:startTime` is the load-bearing ingestion anchor and a SHACL MUST —
  // a meal without it is not a usable record (never coerce a missing timestamp to
  // the 1970 epoch, which would corrupt every lag calculation). Reject it.
  const startTime = validDateOrUndefined(doc.startTime);
  if (!startTime) return undefined;

  const data: MealData = {
    startTime,
    id: mealSubject(url),
    items: [],
  };
  setIfDefined(data, "context", doc.context);
  setIfDefined(data, "venue", doc.venue);
  // URL-valued fields are http(s)-filtered on READ (symmetric with the writer) so
  // a hostile pod document can never surface a `javascript:`/`data:` IRI.
  setIfDefined(data, "location", httpIriOrUndefined(doc.location));
  setIfDefined(data, "portion", doc.portion);
  setIfDefined(data, "note", doc.note);
  setIfDefined(data, "patient", httpIriOrUndefined(doc.patient));
  setIfDefined(data, "created", validDateOrUndefined(doc.created));

  const items = [...doc.hasItem]
    .sort((a, b) => trailingIndex(a) - trailingIndex(b))
    .map((iri) => parseFoodItem(iri, dataset))
    .filter((x): x is FoodItemData => x !== undefined);
  // Fail-closed on the SHACL MUST (a Meal has ≥1 diet:FoodItem), symmetric with
  // buildMeal: a meal whose `diet:hasItem` links are absent or all unparseable
  // (e.g. every linked item is nameless) is not a usable intake record — drop it
  // rather than return a food-less meal the model forbids.
  if (items.length === 0) return undefined;
  data.items = items;

  // Exposures: the diet:Exposure subjects IN THIS MEAL'S DOCUMENT only, ordered by
  // #exposure-{n}. Scoping by document (docOf(subject) === url) is essential — a
  // caller may parse from a dataset holding SEVERAL meals' documents (e.g. a merged
  // container listing), and an unscoped type-scan would attach another meal's
  // exposures to this one (health-data misattribution).
  const exposureSubjects = new Set<string>();
  // Use n3's DataFactory (consistent with the rest of the file) to build the match
  // pattern so discovery works on ANY RDFJS DatasetCore, not just an n3.Store —
  // hand-shaped `{ termType, value } as never` casts only happen to work on n3.
  for (const q of dataset.match(
    null,
    DataFactory.namedNode(RDF_TYPE),
    DataFactory.namedNode(DIET_EXPOSURE),
  )) {
    const subject = (q.subject as { value: string }).value;
    if (inDocument(subject, url)) exposureSubjects.add(subject);
  }
  const exposures = [...exposureSubjects]
    .sort((a, b) => trailingIndex(a) - trailingIndex(b))
    .map((iri) => parseExposure(iri, dataset))
    .filter((x): x is ExposureData => x !== undefined);
  if (exposures.length) data.exposures = exposures;

  return data;
}

/**
 * Build a fresh n3 `Store` holding a whole Meal document: the Meal at `${url}#it`,
 * its FoodItems at `${url}#item-{n}` (linked via `diet:hasItem`), and its
 * Exposures at `${url}#exposure-{n}`.
 *
 * `created` defaults to now. Item/exposure subjects are minted deterministically
 * so the document round-trips. An exposure's `derivedFrom` should reference the
 * minted item IRIs; a non-http(s) IRI is dropped (untrusted-input discipline).
 */
export function buildMeal(url: string, data: MealData): Store {
  // Fail-closed on the Meal MUSTs (vendored SHACL). `schema:startTime` is the
  // load-bearing ingestion anchor (half of every lag calculation) and a SHACL MUST;
  // a JS caller / bad cast could pass a missing or invalid Date, which parseMeal
  // then rejects and SHACL marks invalid — refuse to emit such a document.
  if (!(data.startTime instanceof Date) || Number.isNaN(data.startTime.getTime())) {
    throw new Error(
      "buildMeal: startTime must be a valid Date (the ingestion time — a SHACL MUST and " +
        "the anchor of every lag calculation).",
    );
  }
  // At least one FoodItem, and every FoodItem named. Refuse to emit invalid diary
  // RDF from the public builder rather than silently produce a document that fails
  // validation on read/write.
  if (data.items.length === 0) {
    throw new Error(
      "buildMeal: a Meal MUST have at least one diet:FoodItem (diet:hasItem) — " +
        "refusing to build an itemless meal (the WHAT of the intake).",
    );
  }
  data.items.forEach((item, i) => {
    if (!item.name) {
      throw new Error(
        `buildMeal: FoodItem #${i} MUST have a schema:name — refusing to build an unnamed food item.`,
      );
    }
  });

  const store = new Store();
  const doc = new Meal(mealSubject(url), store, DataFactory).mark();
  doc.startTime = data.startTime;
  doc.context = data.context;
  doc.venue = data.venue;
  doc.location = httpIriOrUndefined(data.location);
  doc.portion = data.portion;
  doc.note = data.note;
  doc.patient = httpIriOrUndefined(data.patient);
  doc.created = data.created ?? new Date();

  // Resolve each item's subject up front and reject a DUPLICATE — two items sharing
  // a caller-supplied `id` (or one colliding with a minted `#item-{n}`) would collapse
  // into a single `diet:hasItem` entry and overwrite each other's scalar fields on the
  // same subject, silently losing food-item data on round-trip. Fail closed.
  const itemSubjects = new Set<string>();
  const resolved = data.items.map((item, i) => {
    const subject = item.id && isHttpIri(item.id) ? item.id : foodItemSubject(url, i);
    if (itemSubjects.has(subject)) {
      throw new Error(
        `buildMeal: duplicate FoodItem subject ${JSON.stringify(subject)} — every item must ` +
          "have a distinct id (a collision would silently overwrite a food item on round-trip).",
      );
    }
    itemSubjects.add(subject);
    return subject;
  });
  data.items.forEach((item, i) => {
    const subject = resolved[i] as string;
    writeFoodItem(store, subject, item);
    doc.hasItem.add(subject);
  });

  // Exposures are ALWAYS minted in THIS meal's document (`#exposure-{n}`),
  // IGNORING any externally-supplied `exp.id`. parseMeal discovers exposures by
  // document scope (to avoid cross-meal misattribution), so an out-of-document
  // subject would be written but never read back — a silent round-trip break.
  // `ExposureData.id` is therefore OUTPUT-only (set on parse); a caller-supplied
  // one is intentionally normalised away. (An exposure's `derivedFrom` — which
  // references FoodItem subjects — is independent and preserved as given.)
  (data.exposures ?? []).forEach((exp, i) => {
    writeExposure(store, exposureSubject(url, i), exp);
  });

  return store;
}

/** Serialise a whole Meal document to Turtle (via `n3.Writer`, model prefixes). */
export function serializeMeal(url: string, data: MealData): Promise<string> {
  return storeToTurtle(buildMeal(url, data));
}

/** Parse a fetched Meal body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export async function parseMealTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<MealData | undefined> {
  return parseMeal(url, await parseBody(body, url, contentType));
}
