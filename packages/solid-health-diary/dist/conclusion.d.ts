/**
 * `diet:ToleranceConclusion` (DESIGN §2.2 entity 7) + `diet:DietPlan` (entity 9).
 *
 * A ToleranceConclusion is a per-trigger verdict (one resource per trigger,
 * `conclusions/{trigger}.ttl`) carrying an ordinal confidence + a plain-language
 * string (**never a bare percentage** — DESIGN §4.2 anti-overclaim rule), the
 * evidence it rests on (`diet:derivedFrom`, tap-through), and — crucially — a
 * `diet:reviewAfter` date, because secondary intolerances are time-boxed and
 * re-testable (RESEARCH §2.2). `confirmed` (`diet:confirmedByOwnTest`) is reachable
 * ONLY via a completed protocol, never correlation alone (enforced by the
 * inference engine, Brief 2A — a cross-resource invariant the SHACL cannot check).
 *
 * A DietPlan is the current working exclusion set — "what am I avoiding and why":
 * `diet:excludes` names the excluded TriggerClasses; `diet:restsOn` names the
 * ToleranceConclusions those exclusions rest on (the landed 1B vocab models both
 * at the plan level, per `diet-examples.ttl`).
 *
 * The enum-valued fields (`verdict`, `confidence`, `aboutTrigger`, and each
 * `excludes` trigger) are stored as `diet:` concept IRIs. Typed accessors; never
 * hand-built triples.
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { confidenceCodec, verdictCodec } from "./concepts.js";
import { type TriggerSlug } from "./vocab.js";
/** A per-trigger tolerance verdict (DESIGN §2.2 entity 7). */
export type Verdict = (typeof verdictCodec.tokens)[number];
/** The known verdicts. */
export declare const VERDICTS: readonly Verdict[];
/**
 * Ordinal confidence (DESIGN §4.2). `confirmed` = "confirmed by your own test"
 * (`diet:confirmedByOwnTest`) — reachable ONLY via a completed elimination
 * protocol, never correlation alone. Stored as a concept IRI; the plain-language
 * string lives on `diet:note`.
 */
export type Confidence = (typeof confidenceCodec.tokens)[number];
/** The known confidence ordinals, weakest first. */
export declare const CONFIDENCE_LEVELS: readonly Confidence[];
/** A tolerance conclusion (DESIGN §2.2 entity 7). */
export interface ToleranceConclusionData {
    /** Subject IRI (`${url}#it`); informational. */
    id?: string;
    /** `diet:aboutTrigger` — the TriggerClass this concludes about (required). */
    aboutTrigger: TriggerSlug;
    /** `diet:verdict` (required). */
    verdict: Verdict;
    /** `diet:confidence` — an ordinal (never a bare percentage). */
    confidence?: Confidence;
    /** `diet:note` — the plain-language confidence string ("a pattern in your data, not a diagnosis"). */
    note?: string;
    /** `diet:reviewAfter` — re-challenge date for time-boxed (secondary) intolerances. */
    reviewAfter?: Date;
    /** `diet:derivedFrom` — the exposures/symptoms/protocol this rests on (tap-through). */
    derivedFrom?: string[];
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    patient?: string;
    /** `dcterms:created`. */
    created?: Date;
}
/** Typed `@rdfjs/wrapper` view of a `diet:ToleranceConclusion`. */
export declare class ToleranceConclusion extends TermWrapper {
    get id(): string;
    get types(): Set<string>;
    mark(): this;
    get isConclusion(): boolean;
    /** `diet:aboutTrigger` → `diet:{slug}`; read back as the slug. */
    get aboutTrigger(): TriggerSlug | undefined;
    set aboutTrigger(value: TriggerSlug | undefined);
    /** `diet:verdict` → `diet:{concept}`; read back as the friendly token. */
    get verdict(): Verdict | undefined;
    set verdict(value: Verdict | undefined);
    /** `diet:confidence` → `diet:{concept}`; read back as the friendly token. */
    get confidence(): Confidence | undefined;
    set confidence(value: Confidence | undefined);
    get note(): string | undefined;
    set note(value: string | undefined);
    /** `diet:reviewAfter` — an `xsd:date`. */
    get reviewAfter(): Date | undefined;
    set reviewAfter(value: Date | undefined);
    /** `diet:derivedFrom` — the evidence IRIs (live set; ⊑ `prov:wasDerivedFrom`). */
    get derivedFrom(): Set<string>;
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    get patient(): string | undefined;
    set patient(value: string | undefined);
    get created(): Date | undefined;
    set created(value: Date | undefined);
}
/** The conclusion subject IRI: `${url}#it`. */
export declare function conclusionSubject(url: string): string;
/** Parse a ToleranceConclusion out of a dataset, or `undefined`. */
export declare function parseToleranceConclusion(url: string, dataset: DatasetCore): ToleranceConclusionData | undefined;
/** Build a fresh n3 `Store` holding one ToleranceConclusion rooted at `${url}#it`. */
export declare function buildToleranceConclusion(url: string, data: ToleranceConclusionData): Store;
/** Serialise a ToleranceConclusion to Turtle (via `n3.Writer`). */
export declare function serializeToleranceConclusion(url: string, data: ToleranceConclusionData): Promise<string>;
/** Parse a fetched ToleranceConclusion body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export declare function parseToleranceConclusionTtl(url: string, body: string, contentType?: string | null): Promise<ToleranceConclusionData | undefined>;
/**
 * The current working exclusion set (DESIGN §2.2 entity 9). Per the landed 1B
 * vocab, `diet:excludes` lists the excluded TriggerClasses and `diet:restsOn`
 * lists the ToleranceConclusions those exclusions rest on — both at the plan level.
 */
export interface DietPlanData {
    /** Subject IRI (`${url}#it`); informational. */
    id?: string;
    /** `diet:excludes` → the excluded TriggerClass slugs. */
    excludes: TriggerSlug[];
    /** `diet:restsOn` → the ToleranceConclusion IRIs the exclusions rest on ("…and why"). */
    restsOn?: string[];
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    patient?: string;
    /** `dcterms:created`. */
    created?: Date;
}
/** The DietPlan subject IRI: `${url}#it`. */
export declare function dietPlanSubject(url: string): string;
/** Typed `@rdfjs/wrapper` view of a `diet:DietPlan`. */
export declare class DietPlan extends TermWrapper {
    get id(): string;
    get types(): Set<string>;
    mark(): this;
    get isDietPlan(): boolean;
    /** `diet:excludes` → the excluded TriggerClass IRIs (live set). */
    get excludes(): Set<string>;
    /** `diet:restsOn` → the ToleranceConclusion IRIs (live set; ⊑ `prov:wasDerivedFrom`). */
    get restsOn(): Set<string>;
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    get patient(): string | undefined;
    set patient(value: string | undefined);
    get created(): Date | undefined;
    set created(value: Date | undefined);
}
/** Parse a DietPlan out of a dataset, or `undefined` if `${url}#it` is not one. */
export declare function parseDietPlan(url: string, dataset: DatasetCore): DietPlanData | undefined;
/** Build a fresh n3 `Store` holding one DietPlan rooted at `${url}#it`. */
export declare function buildDietPlan(url: string, data: DietPlanData): Store;
/** Serialise a DietPlan to Turtle (via `n3.Writer`). */
export declare function serializeDietPlan(url: string, data: DietPlanData): Promise<string>;
/** Parse a fetched DietPlan body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export declare function parseDietPlanTtl(url: string, body: string, contentType?: string | null): Promise<DietPlanData | undefined>;
//# sourceMappingURL=conclusion.d.ts.map