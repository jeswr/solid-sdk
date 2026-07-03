/**
 * `diet:Symptom` (⊑ `health:Observation`) — a symptom the pod owner logged
 * (DESIGN §2.2 entity 4). One pod resource per symptom
 * (`symptoms/{yyyy}/{mm}/{ulid}.ttl`).
 *
 * `schema:startTime` is the **onset** time — the other half of every lag
 * calculation (the Meal ingestion time is the first half). The breathing /
 * anaphylaxis symptom types are specially flagged ({@link isEmergencySymptomType},
 * mirroring `diet:triggersEmergencyRail` in the vocab) so the UI shows the
 * emergency rail, never "we'll correlate it" (RESEARCH §4).
 *
 * `symptomType` is stored as a canonical `diet:` **concept IRI** (camelCase); the
 * accessor exposes the friendly kebab token via `symptomTypeCodec`.
 *
 * Typed accessors over an n3 `Store`; never hand-built triples.
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { symptomTypeCodec } from "./concepts.js";
/** A known symptom-type token (the vocab's `skos:notation`; stored as `diet:{camelCase}`). */
export type SymptomType = (typeof symptomTypeCodec.tokens)[number];
/** The known symptom-type tokens (DESIGN §2.2 entity 4; extensible). */
export declare const SYMPTOM_TYPES: readonly SymptomType[];
/**
 * Symptom types that are a medical EMERGENCY, not a data point (RESEARCH §4;
 * mirrors `diet:triggersEmergencyRail true` on these concepts in the vocab). The
 * UI must short-circuit to the emergency rail for these; never "correlated away".
 */
export declare const EMERGENCY_SYMPTOM_TYPES: readonly SymptomType[];
/** True if `slug` is a known symptom type. */
export declare function isSymptomType(slug: string): slug is SymptomType;
/** True if a symptom type triggers the hard-coded emergency rail (RESEARCH §4). */
export declare function isEmergencySymptomType(slug: string): boolean;
/** The `diet:{concept}` symptom-type IRI for a friendly token. */
export declare function symptomTypeIri(slug: SymptomType): string;
/** The symptom-type token for a `diet:{concept}` IRI, or `undefined`. */
export declare function symptomTypeFromIri(iri: string): SymptomType | undefined;
/** A symptom observation (DESIGN §2.2 entity 4). */
export interface SymptomData {
    /** Subject IRI (`${url}#it`); informational. */
    id?: string;
    /** `diet:symptomType` — the SKOS-coded symptom (required). */
    symptomType: SymptomType;
    /** `schema:startTime` — ONSET time (required; the lag calculation's second half). */
    onset: Date;
    /** `diet:severity` — ordinal 0–10 (0 = none, 10 = worst). */
    severity?: number;
    /** `diet:note`. */
    note?: string;
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    patient?: string;
    /** `dcterms:created`. */
    created?: Date;
}
/** Typed `@rdfjs/wrapper` view of a `diet:Symptom`. */
export declare class Symptom extends TermWrapper {
    get id(): string;
    get types(): Set<string>;
    /** Stamp as `diet:Symptom` + `health:Observation`. Idempotent; returns `this`. */
    mark(): this;
    get isSymptom(): boolean;
    /** `diet:symptomType` → `diet:{concept}`; read back as the friendly token. */
    get symptomType(): SymptomType | undefined;
    set symptomType(value: SymptomType | undefined);
    /** `schema:startTime` — onset time. */
    get onset(): Date | undefined;
    set onset(value: Date | undefined);
    /** `diet:severity` — ordinal 0–10. */
    get severity(): number | undefined;
    set severity(value: number | undefined);
    get note(): string | undefined;
    set note(value: string | undefined);
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    get patient(): string | undefined;
    set patient(value: string | undefined);
    get created(): Date | undefined;
    set created(value: Date | undefined);
}
/** The Symptom subject IRI: `${url}#it`. */
export declare function symptomSubject(url: string): string;
/** Whether a parsed/loaded symptom is a medical emergency (convenience). */
export declare function isEmergency(symptom: Pick<SymptomData, "symptomType">): boolean;
/** Parse a Symptom out of a dataset, or `undefined` if `${url}#it` is not a `diet:Symptom`. */
export declare function parseSymptom(url: string, dataset: DatasetCore): SymptomData | undefined;
/** Build a fresh n3 `Store` holding one Symptom rooted at `${url}#it`. */
export declare function buildSymptom(url: string, data: SymptomData): Store;
/** Serialise a Symptom to Turtle (via `n3.Writer`). */
export declare function serializeSymptom(url: string, data: SymptomData): Promise<string>;
/** Parse a fetched Symptom body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export declare function parseSymptomTtl(url: string, body: string, contentType?: string | null): Promise<SymptomData | undefined>;
//# sourceMappingURL=symptom.d.ts.map