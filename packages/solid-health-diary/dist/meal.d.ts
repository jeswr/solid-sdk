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
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { contextCodec, exposureLevelCodec, portionCodec, sourceConfidenceCodec } from "./concepts.js";
import { type TriggerSlug } from "./vocab.js";
/** Where a meal was eaten — the eating-out signal (DESIGN §2.2, RESEARCH §1.3). */
export type MealContext = (typeof contextCodec.tokens)[number];
/** The known meal contexts. */
export declare const MEAL_CONTEXTS: readonly MealContext[];
/** Qualitative portion size. */
export type Portion = (typeof portionCodec.tokens)[number];
/** The known portion sizes. */
export declare const PORTIONS: readonly Portion[];
/**
 * How a FoodItem's data was captured — DESIGN §2.2 entity 2. `ocr`/`voice` are
 * DRAFTS the user confirms; the inference engine may down-weight low-confidence
 * sources (never auto-feeds OCR/voice into a conclusion — RESEARCH §3.6 / §10.5).
 */
export type SourceConfidence = (typeof sourceConfidenceCodec.tokens)[number];
/** The known source-confidence values. */
export declare const SOURCE_CONFIDENCES: readonly SourceConfidence[];
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
export declare const EXPOSURE_LEVELS: readonly ExposureLevel[];
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
/** The Meal subject IRI: `${url}#it`. */
export declare function mealSubject(url: string): string;
/** The n-th FoodItem subject IRI: `${url}#item-{n}`. */
export declare function foodItemSubject(url: string, index: number): string;
/** The n-th Exposure subject IRI: `${url}#exposure-{n}`. */
export declare function exposureSubject(url: string, index: number): string;
/** Typed `@rdfjs/wrapper` view of a `diet:FoodItem`. */
export declare class FoodItem extends TermWrapper {
    get id(): string;
    get types(): Set<string>;
    mark(): this;
    get isFoodItem(): boolean;
    get name(): string | undefined;
    set name(value: string | undefined);
    get offBarcode(): string | undefined;
    set offBarcode(value: string | undefined);
    get offRef(): string | undefined;
    set offRef(value: string | undefined);
    get ingredientsText(): string | undefined;
    set ingredientsText(value: string | undefined);
    /** `diet:declaredAllergen` — OFF tag strings (live set). */
    get declaredAllergen(): Set<string>;
    /** `diet:traceAllergen` — OFF tag strings (live set). */
    get traceAllergen(): Set<string>;
    /** `diet:additive` — OFF tag strings (live set). */
    get additive(): Set<string>;
    /** `diet:offCategory` — OFF tag strings (live set). */
    get offCategory(): Set<string>;
    /** `diet:sourceConfidence` → `diet:{concept}`; read back as the friendly token. */
    get sourceConfidence(): SourceConfidence | undefined;
    set sourceConfidence(value: SourceConfidence | undefined);
}
/** Read a FoodItem subject into plain data (its subject need not be `#item-{n}`). */
export declare function parseFoodItem(subject: string, dataset: DatasetCore): FoodItemData | undefined;
/** Typed `@rdfjs/wrapper` view of a `diet:Exposure`. */
export declare class Exposure extends TermWrapper {
    get id(): string;
    get types(): Set<string>;
    mark(): this;
    get isExposure(): boolean;
    /** `diet:trigger` → `diet:{slug}`; read back as the slug (unknown IRI ⇒ undefined). */
    get trigger(): TriggerSlug | undefined;
    set trigger(value: TriggerSlug | undefined);
    /** `diet:exposureLevel` → `diet:{concept}`; read back as the friendly token. */
    get exposureLevel(): ExposureLevel | undefined;
    set exposureLevel(value: ExposureLevel | undefined);
    /** `diet:derivedFrom` — the FoodItem IRIs (live set; ⊑ `prov:wasDerivedFrom`). */
    get derivedFrom(): Set<string>;
    get note(): string | undefined;
    set note(value: string | undefined);
}
/** Read an Exposure subject into plain data. */
export declare function parseExposure(subject: string, dataset: DatasetCore): ExposureData | undefined;
/** Typed `@rdfjs/wrapper` view of a `diet:Meal`. */
export declare class Meal extends TermWrapper {
    get id(): string;
    get types(): Set<string>;
    mark(): this;
    get isMeal(): boolean;
    /** `schema:startTime` — ingestion time. */
    get startTime(): Date | undefined;
    set startTime(value: Date | undefined);
    /** `diet:context` → `diet:{concept}`; read back as the friendly token. */
    get context(): MealContext | undefined;
    set context(value: MealContext | undefined);
    get venue(): string | undefined;
    set venue(value: string | undefined);
    get location(): string | undefined;
    set location(value: string | undefined);
    /** `diet:portion` → `diet:{concept}`; read back as the friendly token. */
    get portion(): Portion | undefined;
    set portion(value: Portion | undefined);
    get note(): string | undefined;
    set note(value: string | undefined);
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    get patient(): string | undefined;
    set patient(value: string | undefined);
    get created(): Date | undefined;
    set created(value: Date | undefined);
    /** `diet:hasItem` → the FoodItem IRIs (live set). */
    get hasItem(): Set<string>;
}
/**
 * Parse a whole Meal document (Meal + its FoodItems + its Exposures) into plain
 * data, or `undefined` if `${url}#it` is not a `diet:Meal`.
 *
 * Items are read in `#item-{n}` order (via `diet:hasItem`); exposures are found
 * by `rdf:type diet:Exposure` in the document, also ordered by `#exposure-{n}`.
 */
export declare function parseMeal(url: string, dataset: DatasetCore): MealData | undefined;
/**
 * Build a fresh n3 `Store` holding a whole Meal document: the Meal at `${url}#it`,
 * its FoodItems at `${url}#item-{n}` (linked via `diet:hasItem`), and its
 * Exposures at `${url}#exposure-{n}`.
 *
 * `created` defaults to now. Item/exposure subjects are minted deterministically
 * so the document round-trips. An exposure's `derivedFrom` should reference the
 * minted item IRIs; a non-http(s) IRI is dropped (untrusted-input discipline).
 */
export declare function buildMeal(url: string, data: MealData): Store;
/** Serialise a whole Meal document to Turtle (via `n3.Writer`, model prefixes). */
export declare function serializeMeal(url: string, data: MealData): Promise<string>;
/** Parse a fetched Meal body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export declare function parseMealTtl(url: string, body: string, contentType?: string | null): Promise<MealData | undefined>;
//# sourceMappingURL=meal.d.ts.map