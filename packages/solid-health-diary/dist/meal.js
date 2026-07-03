// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `diet:Meal` (⊑ `schema:Meal`) + its `diet:FoodItem`s + the derived
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
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { contextCodec, exposureLevelCodec, portionCodec, sourceConfidenceCodec, } from "./concepts.js";
import { docOf, httpIriOrUndefined, isHttpIri } from "./iri.js";
import { assertSubjectSingletons } from "./rdfGuards.js";
import { parseBody, storeToTurtle } from "./serialize.js";
import { setIfDefined, tryRead, validDateOrUndefined } from "./util.js";
import { DIET_DERIVED_FROM, DIET_EXPOSURE, DIET_FOOD_ITEM, DIET_MEAL, dct, diet, HEALTH_PATIENT_PROP, isTriggerSlug, RDF_TYPE, rdf, schema, triggerIri, triggerSlugFromIri, } from "./vocab.js";
/** The known meal contexts. */
export const MEAL_CONTEXTS = contextCodec.tokens;
/** The known portion sizes. */
export const PORTIONS = portionCodec.tokens;
/** The known source-confidence values. */
export const SOURCE_CONFIDENCES = sourceConfidenceCodec.tokens;
/** The known exposure levels, strongest first. */
export const EXPOSURE_LEVELS = exposureLevelCodec.tokens;
/** Sorted copy of a string set-literal accessor (stable array round-trip). */
function sortedStrings(set) {
    return [...set].sort();
}
// --- Subjects -----------------------------------------------------------------
/** The Meal subject IRI: `${url}#it`. */
export function mealSubject(url) {
    return `${url}#it`;
}
/** The n-th FoodItem subject IRI: `${url}#item-{n}`. */
export function foodItemSubject(url, index) {
    return `${url}#item-${index}`;
}
/** The n-th Exposure subject IRI: `${url}#exposure-{n}`. */
export function exposureSubject(url, index) {
    return `${url}#exposure-${index}`;
}
// The predicates the guard checks are EXACTLY those the vendored SHACL declares
// `sh:maxCount 1` — NOT every field the accessors read as a scalar. The profile is
// open, so a field the shape leaves unconstrained (schema:name, diet:note,
// health:patient, dct:created, …) may legitimately repeat (e.g. localized labels)
// and must NOT invalidate the parse; for those the accessor's first-match read
// stands. (Derived from shapes/diet.shacl.ttl sh:maxCount 1 property shapes.)
const MEAL_SINGLETONS = [schema("startTime"), diet("context"), diet("portion")];
const FOOD_ITEM_SINGLETONS = [diet("sourceConfidence")];
const EXPOSURE_SINGLETONS = [diet("trigger"), diet("exposureLevel")];
/** The trailing integer of a `…-{n}` subject IRI, for deterministic ordering (−1 if none). */
function trailingIndex(iri) {
    const m = iri.match(/-(\d+)$/);
    return m ? Number.parseInt(m[1], 10) : -1;
}
/** Whether `subject`'s document (its IRI minus fragment) is exactly the meal `url`. */
function inDocument(subject, url) {
    try {
        return docOf(subject) === url;
    }
    catch {
        return false;
    }
}
// --- FoodItem accessor --------------------------------------------------------
/** Typed `@rdfjs/wrapper` view of a `diet:FoodItem`. */
export class FoodItem extends TermWrapper {
    get id() {
        return this.value;
    }
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    mark() {
        this.types.add(DIET_FOOD_ITEM);
        return this;
    }
    get isFoodItem() {
        return this.types.has(DIET_FOOD_ITEM);
    }
    get name() {
        return OptionalFrom.subjectPredicate(this, schema("name"), LiteralAs.string);
    }
    set name(value) {
        OptionalAs.object(this, schema("name"), value, LiteralFrom.string);
    }
    get offBarcode() {
        return OptionalFrom.subjectPredicate(this, diet("offBarcode"), LiteralAs.string);
    }
    set offBarcode(value) {
        OptionalAs.object(this, diet("offBarcode"), value, LiteralFrom.string);
    }
    get offRef() {
        return OptionalFrom.subjectPredicate(this, diet("offRef"), NamedNodeAs.string);
    }
    set offRef(value) {
        OptionalAs.object(this, diet("offRef"), value, NamedNodeFrom.string);
    }
    get ingredientsText() {
        return OptionalFrom.subjectPredicate(this, diet("ingredientsText"), LiteralAs.string);
    }
    set ingredientsText(value) {
        OptionalAs.object(this, diet("ingredientsText"), value, LiteralFrom.string);
    }
    /** `diet:declaredAllergen` — OFF tag strings (live set). */
    get declaredAllergen() {
        return SetFrom.subjectPredicate(this, diet("declaredAllergen"), LiteralAs.string, LiteralFrom.string);
    }
    /** `diet:traceAllergen` — OFF tag strings (live set). */
    get traceAllergen() {
        return SetFrom.subjectPredicate(this, diet("traceAllergen"), LiteralAs.string, LiteralFrom.string);
    }
    /** `diet:additive` — OFF tag strings (live set). */
    get additive() {
        return SetFrom.subjectPredicate(this, diet("additive"), LiteralAs.string, LiteralFrom.string);
    }
    /** `diet:offCategory` — OFF tag strings (live set). */
    get offCategory() {
        return SetFrom.subjectPredicate(this, diet("offCategory"), LiteralAs.string, LiteralFrom.string);
    }
    /** `diet:sourceConfidence` → `diet:{concept}`; read back as the friendly token. */
    get sourceConfidence() {
        return sourceConfidenceCodec.fromIri(OptionalFrom.subjectPredicate(this, diet("sourceConfidence"), NamedNodeAs.string));
    }
    set sourceConfidence(value) {
        OptionalAs.object(this, diet("sourceConfidence"), value ? sourceConfidenceCodec.toIri(value) : undefined, NamedNodeFrom.string);
    }
}
/** Read a FoodItem subject into plain data (its subject need not be `#item-{n}`). */
export function parseFoodItem(subject, dataset) {
    return tryRead(() => parseFoodItemImpl(subject, dataset));
}
function parseFoodItemImpl(subject, dataset) {
    // The SUBJECT itself must be an http(s) IRI — a hostile document can link
    // `diet:hasItem <javascript:…>` to a typed, named FoodItem; drop it rather than
    // surface a `javascript:`/`data:` IRI as a FoodItemData.id to consumers.
    if (!isHttpIri(subject))
        return undefined;
    const doc = new FoodItem(subject, dataset, DataFactory);
    if (!doc.isFoodItem)
        return undefined;
    assertSubjectSingletons(dataset, subject, FOOD_ITEM_SINGLETONS);
    // Fail-closed on the SHACL MUST (schema:name on every FoodItem), symmetric with
    // the buildMeal builder: a nameless FoodItem is not a usable intake record (the
    // WHAT is unknown), so drop it rather than surface an invalid item.
    const name = doc.name;
    if (!name)
        return undefined;
    const data = { id: subject, name };
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
    if (declared.length)
        data.declaredAllergen = declared;
    if (traces.length)
        data.traceAllergen = traces;
    if (additives.length)
        data.additive = additives;
    if (categories.length)
        data.offCategory = categories;
    return data;
}
/** Write a FoodItem's fields onto its subject in `store` (used by {@link buildMeal}). */
function writeFoodItem(store, subject, item) {
    const doc = new FoodItem(subject, store, DataFactory).mark();
    doc.name = item.name;
    doc.offBarcode = item.offBarcode;
    // offRef is an untrusted-ish IRI — drop a non-http(s) value.
    doc.offRef = httpIriOrUndefined(item.offRef);
    doc.ingredientsText = item.ingredientsText;
    doc.sourceConfidence = item.sourceConfidence;
    for (const t of item.declaredAllergen ?? [])
        doc.declaredAllergen.add(t);
    for (const t of item.traceAllergen ?? [])
        doc.traceAllergen.add(t);
    for (const t of item.additive ?? [])
        doc.additive.add(t);
    for (const t of item.offCategory ?? [])
        doc.offCategory.add(t);
}
// --- Exposure accessor --------------------------------------------------------
/** Typed `@rdfjs/wrapper` view of a `diet:Exposure`. */
export class Exposure extends TermWrapper {
    get id() {
        return this.value;
    }
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    mark() {
        this.types.add(DIET_EXPOSURE);
        return this;
    }
    get isExposure() {
        return this.types.has(DIET_EXPOSURE);
    }
    /** `diet:trigger` → `diet:{slug}`; read back as the slug (unknown IRI ⇒ undefined). */
    get trigger() {
        return triggerSlugFromIri(OptionalFrom.subjectPredicate(this, diet("trigger"), NamedNodeAs.string) ?? "");
    }
    set trigger(value) {
        OptionalAs.object(this, diet("trigger"), value ? triggerIri(value) : undefined, NamedNodeFrom.string);
    }
    /** `diet:exposureLevel` → `diet:{concept}`; read back as the friendly token. */
    get exposureLevel() {
        return exposureLevelCodec.fromIri(OptionalFrom.subjectPredicate(this, diet("exposureLevel"), NamedNodeAs.string));
    }
    set exposureLevel(value) {
        OptionalAs.object(this, diet("exposureLevel"), value ? exposureLevelCodec.toIri(value) : undefined, NamedNodeFrom.string);
    }
    /** `diet:derivedFrom` — the FoodItem IRIs (live set; ⊑ `prov:wasDerivedFrom`). */
    get derivedFrom() {
        return SetFrom.subjectPredicate(this, DIET_DERIVED_FROM, NamedNodeAs.string, NamedNodeFrom.string);
    }
    get note() {
        return OptionalFrom.subjectPredicate(this, diet("note"), LiteralAs.string);
    }
    set note(value) {
        OptionalAs.object(this, diet("note"), value, LiteralFrom.string);
    }
}
/** Read an Exposure subject into plain data. */
export function parseExposure(subject, dataset) {
    return tryRead(() => parseExposureImpl(subject, dataset));
}
function parseExposureImpl(subject, dataset) {
    // The SUBJECT itself must be an http(s) IRI (symmetric with parseFoodItem) — a
    // hostile document could type a `javascript:`/`data:` node as an Exposure; never
    // surface such an IRI as an ExposureData.id to consumers.
    if (!isHttpIri(subject))
        return undefined;
    const doc = new Exposure(subject, dataset, DataFactory);
    if (!doc.isExposure)
        return undefined;
    assertSubjectSingletons(dataset, subject, EXPOSURE_SINGLETONS);
    const trigger = doc.trigger;
    const exposureLevel = doc.exposureLevel;
    // A well-formed exposure must name a known trigger + level; a foreign/garbled
    // node missing either is not a usable exposure (drop it rather than guess).
    if (!trigger || !exposureLevel)
        return undefined;
    const data = { id: subject, trigger, exposureLevel };
    setIfDefined(data, "note", doc.note);
    // http(s)-only on READ (symmetric with the writer) — drop any non-http(s)
    // `derivedFrom` IRI a hostile pod document might carry.
    const from = sortedStrings(doc.derivedFrom).filter(isHttpIri);
    if (from.length)
        data.derivedFrom = from;
    return data;
}
/** Write an Exposure's fields onto its subject in `store` (used by {@link buildMeal}). */
function writeExposure(store, subject, exp) {
    // Fail-closed on the Exposure SHACL MUSTs: a KNOWN trigger and a KNOWN level.
    // `triggerIri` does NOT validate (it just concatenates), so an unknown trigger
    // would silently emit a bogus `diet:<bad-token>`; a missing trigger/level would
    // emit no predicate at all. Either way parseExposure drops it — refuse up front.
    if (!exp.trigger || !isTriggerSlug(exp.trigger)) {
        throw new Error(`buildMeal: every exposure needs a known diet:trigger — got ${JSON.stringify(exp.trigger)}.`);
    }
    if (!exp.exposureLevel || !exposureLevelCodec.isToken(exp.exposureLevel)) {
        throw new Error(`buildMeal: every exposure needs a known diet:exposureLevel — got ${JSON.stringify(exp.exposureLevel)}.`);
    }
    const doc = new Exposure(subject, store, DataFactory).mark();
    doc.trigger = exp.trigger;
    doc.exposureLevel = exp.exposureLevel;
    doc.note = exp.note;
    for (const iri of exp.derivedFrom ?? [])
        if (isHttpIri(iri))
            doc.derivedFrom.add(iri);
}
// --- Meal accessor ------------------------------------------------------------
/** Typed `@rdfjs/wrapper` view of a `diet:Meal`. */
export class Meal extends TermWrapper {
    get id() {
        return this.value;
    }
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    mark() {
        this.types.add(DIET_MEAL);
        return this;
    }
    get isMeal() {
        return this.types.has(DIET_MEAL);
    }
    /** `schema:startTime` — ingestion time. */
    get startTime() {
        return OptionalFrom.subjectPredicate(this, schema("startTime"), LiteralAs.date);
    }
    set startTime(value) {
        OptionalAs.object(this, schema("startTime"), value, LiteralFrom.dateTime);
    }
    /** `diet:context` → `diet:{concept}`; read back as the friendly token. */
    get context() {
        return contextCodec.fromIri(OptionalFrom.subjectPredicate(this, diet("context"), NamedNodeAs.string));
    }
    set context(value) {
        OptionalAs.object(this, diet("context"), value ? contextCodec.toIri(value) : undefined, NamedNodeFrom.string);
    }
    get venue() {
        return OptionalFrom.subjectPredicate(this, diet("venue"), LiteralAs.string);
    }
    set venue(value) {
        OptionalAs.object(this, diet("venue"), value, LiteralFrom.string);
    }
    get location() {
        return OptionalFrom.subjectPredicate(this, schema("location"), NamedNodeAs.string);
    }
    set location(value) {
        OptionalAs.object(this, schema("location"), value, NamedNodeFrom.string);
    }
    /** `diet:portion` → `diet:{concept}`; read back as the friendly token. */
    get portion() {
        return portionCodec.fromIri(OptionalFrom.subjectPredicate(this, diet("portion"), NamedNodeAs.string));
    }
    set portion(value) {
        OptionalAs.object(this, diet("portion"), value ? portionCodec.toIri(value) : undefined, NamedNodeFrom.string);
    }
    get note() {
        return OptionalFrom.subjectPredicate(this, diet("note"), LiteralAs.string);
    }
    set note(value) {
        OptionalAs.object(this, diet("note"), value, LiteralFrom.string);
    }
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    get patient() {
        return OptionalFrom.subjectPredicate(this, HEALTH_PATIENT_PROP, NamedNodeAs.string);
    }
    set patient(value) {
        OptionalAs.object(this, HEALTH_PATIENT_PROP, value, NamedNodeFrom.string);
    }
    get created() {
        return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
    }
    set created(value) {
        OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
    }
    /** `diet:hasItem` → the FoodItem IRIs (live set). */
    get hasItem() {
        return SetFrom.subjectPredicate(this, diet("hasItem"), NamedNodeAs.string, NamedNodeFrom.string);
    }
}
/**
 * Parse a whole Meal document (Meal + its FoodItems + its Exposures) into plain
 * data, or `undefined` if `${url}#it` is not a `diet:Meal`.
 *
 * Items are read in `#item-{n}` order (via `diet:hasItem`); exposures are found
 * by `rdf:type diet:Exposure` in the document, also ordered by `#exposure-{n}`.
 */
export function parseMeal(url, dataset) {
    return tryRead(() => parseMealImpl(url, dataset));
}
function parseMealImpl(url, dataset) {
    const doc = new Meal(mealSubject(url), dataset, DataFactory);
    if (!doc.isMeal)
        return undefined;
    // Fail closed on a document that duplicates any single-valued (sh:maxCount 1)
    // field (e.g. two schema:startTime) — never parse one with an arbitrary value.
    assertSubjectSingletons(dataset, mealSubject(url), MEAL_SINGLETONS);
    // `schema:startTime` is the load-bearing ingestion anchor and a SHACL MUST —
    // a meal without it is not a usable record (never coerce a missing timestamp to
    // the 1970 epoch, which would corrupt every lag calculation). Reject it.
    const startTime = validDateOrUndefined(doc.startTime);
    if (!startTime)
        return undefined;
    const data = {
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
        .filter((x) => x !== undefined);
    // Fail-closed on the SHACL MUST (a Meal has ≥1 diet:FoodItem), symmetric with
    // buildMeal: a meal whose `diet:hasItem` links are absent or all unparseable
    // (e.g. every linked item is nameless) is not a usable intake record — drop it
    // rather than return a food-less meal the model forbids.
    if (items.length === 0)
        return undefined;
    data.items = items;
    // Exposures: the diet:Exposure subjects IN THIS MEAL'S DOCUMENT only, ordered by
    // #exposure-{n}. Scoping by document (docOf(subject) === url) is essential — a
    // caller may parse from a dataset holding SEVERAL meals' documents (e.g. a merged
    // container listing), and an unscoped type-scan would attach another meal's
    // exposures to this one (health-data misattribution).
    const exposureSubjects = new Set();
    // Use n3's DataFactory (consistent with the rest of the file) to build the match
    // pattern so discovery works on ANY RDFJS DatasetCore, not just an n3.Store —
    // hand-shaped `{ termType, value } as never` casts only happen to work on n3.
    for (const q of dataset.match(null, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(DIET_EXPOSURE))) {
        const subject = q.subject.value;
        if (inDocument(subject, url))
            exposureSubjects.add(subject);
    }
    const exposures = [...exposureSubjects]
        .sort((a, b) => trailingIndex(a) - trailingIndex(b))
        .map((iri) => parseExposure(iri, dataset))
        .filter((x) => x !== undefined);
    if (exposures.length)
        data.exposures = exposures;
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
export function buildMeal(url, data) {
    // Fail-closed on the Meal MUSTs (vendored SHACL). `schema:startTime` is the
    // load-bearing ingestion anchor (half of every lag calculation) and a SHACL MUST;
    // a JS caller / bad cast could pass a missing or invalid Date, which parseMeal
    // then rejects and SHACL marks invalid — refuse to emit such a document.
    if (!(data.startTime instanceof Date) || Number.isNaN(data.startTime.getTime())) {
        throw new Error("buildMeal: startTime must be a valid Date (the ingestion time — a SHACL MUST and " +
            "the anchor of every lag calculation).");
    }
    // At least one FoodItem, and every FoodItem named. Refuse to emit invalid diary
    // RDF from the public builder rather than silently produce a document that fails
    // validation on read/write.
    if (data.items.length === 0) {
        throw new Error("buildMeal: a Meal MUST have at least one diet:FoodItem (diet:hasItem) — " +
            "refusing to build an itemless meal (the WHAT of the intake).");
    }
    data.items.forEach((item, i) => {
        if (!item.name) {
            throw new Error(`buildMeal: FoodItem #${i} MUST have a schema:name — refusing to build an unnamed food item.`);
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
    const itemSubjects = new Set();
    const resolved = data.items.map((item, i) => {
        const subject = item.id && isHttpIri(item.id) ? item.id : foodItemSubject(url, i);
        if (itemSubjects.has(subject)) {
            throw new Error(`buildMeal: duplicate FoodItem subject ${JSON.stringify(subject)} — every item must ` +
                "have a distinct id (a collision would silently overwrite a food item on round-trip).");
        }
        itemSubjects.add(subject);
        return subject;
    });
    data.items.forEach((item, i) => {
        const subject = resolved[i];
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
export function serializeMeal(url, data) {
    return storeToTurtle(buildMeal(url, data));
}
/** Parse a fetched Meal body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export async function parseMealTtl(url, body, contentType = "text/turtle") {
    return parseMeal(url, await parseBody(body, url, contentType));
}
//# sourceMappingURL=meal.js.map