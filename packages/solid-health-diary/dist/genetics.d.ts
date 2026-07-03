/**
 * `diet:GeneticSummary` — the interpreted HLA summary (DESIGN §2.2 entity 8, §7,
 * RESEARCH §2.5). **PRIVACY-CRITICAL.**
 *
 * **Hard invariant, by construction:** this model can hold ONLY the interpreted
 * summary — a few `rsID → genotype → interpretation` rows plus the framing text.
 * There is NO field, accessor, or predicate for a raw genotype file: the raw
 * 23andMe/AncestryDNA export is parsed on-device (`FileReader`) by the app
 * (Brief 3B) and immediately discarded; only the summary reaches the pod. The
 * absence of any raw-bytes surface here is the data-layer half of "the raw file
 * never enters the pod" (`src/genetics.test.ts` asserts the API exposes no such
 * field).
 *
 * **Framing is negative-predictive only** (RESEARCH §2.5): carrying DQ2/DQ8 does
 * NOT mean coeliac (30–40% of everyone carries it); NOT carrying it makes coeliac
 * very unlikely; this cannot diagnose. Plus a chip-coverage caveat. The framing
 * lives in `diet:geneticInterpretation`; the app is responsible for presenting it.
 *
 * Typed accessors; never hand-built triples.
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
/**
 * One interpreted HLA marker row (a `diet:HlaMarker`) — summary only, never raw
 * genotype data beyond the single relevant call. `diet:rsid` / `diet:genotype` /
 * `diet:markerInterpretation` are the canonical 1B terms.
 */
export interface HlaMarkerData {
    /** `diet:rsid` — the SNP id, e.g. `rs2187668` (DQ2.5 tag) / `rs7454108` (DQ8 tag). */
    rsid: string;
    /** `diet:genotype` — the called genotype at that SNP, e.g. `AG`. */
    genotype?: string;
    /** `diet:markerInterpretation` — e.g. "rs2187668 present → DQ2.5 risk haplotype". */
    markerInterpretation?: string;
}
/** The interpreted HLA summary (DESIGN §2.2 entity 8). Summary ONLY — never raw bytes. */
export interface GeneticSummaryData {
    /** Subject IRI (`${url}#it`); informational. */
    id?: string;
    /** `diet:hlaMarker` → the interpreted marker rows. */
    markers: HlaMarkerData[];
    /**
     * `diet:geneticInterpretation` — the negative-predictive framing + chip caveat.
     * REQUIRED (a SHACL MUST): a genetic summary must never be stored without its
     * "cannot diagnose you" framing, or the pod would hold a bare genotype call with
     * no interpretive guardrail. The builder rejects a missing/empty value; parsing
     * rejects a summary that lacks it.
     */
    interpretation: string;
    /** `diet:enteredManually` — manual-entry path vs parsed-upload path. */
    enteredManually?: boolean;
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    patient?: string;
    /** `dcterms:created`. */
    created?: Date;
}
/** The GeneticSummary subject IRI: `${url}#it`. */
export declare function geneticSummarySubject(url: string): string;
/** The n-th HLA marker node IRI: `${url}#marker-{n}`. */
export declare function markerSubject(url: string, index: number): string;
/** Typed `@rdfjs/wrapper` view of a `diet:GeneticSummary`. */
export declare class GeneticSummary extends TermWrapper {
    get id(): string;
    get types(): Set<string>;
    mark(): this;
    get isGeneticSummary(): boolean;
    /** `diet:hlaMarker` → the marker node IRIs (live set). */
    get hlaMarker(): Set<string>;
    get interpretation(): string | undefined;
    set interpretation(value: string | undefined);
    get enteredManually(): boolean | undefined;
    set enteredManually(value: boolean | undefined);
    /** `health:patient` — the pod-owner Patient/Person WebID. */
    get patient(): string | undefined;
    set patient(value: string | undefined);
    get created(): Date | undefined;
    set created(value: Date | undefined);
}
/** Parse a GeneticSummary out of a dataset, or `undefined` if `${url}#it` is not one. */
export declare function parseGeneticSummary(url: string, dataset: DatasetCore): GeneticSummaryData | undefined;
/** Build a fresh n3 `Store` holding one GeneticSummary rooted at `${url}#it`. */
export declare function buildGeneticSummary(url: string, data: GeneticSummaryData): Store;
/** Serialise a GeneticSummary to Turtle (via `n3.Writer`). */
export declare function serializeGeneticSummary(url: string, data: GeneticSummaryData): Promise<string>;
/** Parse a fetched GeneticSummary body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export declare function parseGeneticSummaryTtl(url: string, body: string, contentType?: string | null): Promise<GeneticSummaryData | undefined>;
//# sourceMappingURL=genetics.d.ts.map