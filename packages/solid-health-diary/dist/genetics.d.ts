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
 * NOT mean coeliac (~25–40% of the general population carries it — it is COMMON and
 * NOT diagnostic); NOT carrying it makes coeliac very unlikely (only the NEGATIVE
 * predictive value is strong). This cannot diagnose. Plus a chip-coverage caveat.
 * The framing lives in `diet:geneticInterpretation`; the app presents it.
 *
 * **Two fail-closed write guardrails (mirroring the interpretation MUST):**
 * 1. `diet:consentGiven` MUST be `true` — genetic data is never written without
 *    explicit consent (`buildGeneticSummary` throws; a stored summary whose consent
 *    is present-but-not-true is rejected on read).
 * 2. A `diet:coeliacGeneticRisk` of `risk-haplotype-absent` (the NPV "coeliac
 *    unlikely" rollup) requires `diet:coverageComplete=true` — the model refuses to
 *    assert an absent result when the source did not cover every risk tag SNP, so it
 *    can never overstate a negative.
 *
 * Additive Phase-3c terms (`diet:riskHaplotype`/`markerPresence` on a marker;
 * `diet:consentGiven`/`sourceType`/`coeliacGeneticRisk`/`coverageComplete` on the
 * summary) are all optional-on-read, so a pre-refinement summary still parses.
 *
 * Typed accessors; never hand-built triples.
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { coeliacGeneticRiskCodec, markerPresenceCodec, riskHaplotypeCodec, sourceTypeCodec } from "./concepts.js";
/**
 * Which coeliac-risk HLA-DQ haplotype a marker tags (`DQ2.5`/`DQ2.2`/`DQ7`/`DQ8`).
 * Stored as a `diet:` concept IRI; surfaced as this friendly token.
 */
export type RiskHaplotype = (typeof riskHaplotypeCodec.tokens)[number];
/** The known risk haplotypes. */
export declare const RISK_HAPLOTYPES: readonly RiskHaplotype[];
/**
 * A marker's structured presence call. `uncertain` = no-call / ambiguous — never
 * a false `absent` (an unknown must not read as reassurance).
 */
export type MarkerPresence = (typeof markerPresenceCodec.tokens)[number];
/** The known marker-presence values. */
export declare const MARKER_PRESENCES: readonly MarkerPresence[];
/**
 * The NPV-only UI rollup for a summary. `risk-haplotype-absent` means coeliac is
 * *unlikely*, NOT "you don't have coeliac", and is valid ONLY with complete
 * coverage; `risk-haplotype-present` is NOT a diagnosis (DQ2/DQ8 is common,
 * ~25–40% of the general population).
 */
export type CoeliacGeneticRisk = (typeof coeliacGeneticRiskCodec.tokens)[number];
/** The known coeliac-genetic-risk rollup values. */
export declare const COELIAC_GENETIC_RISKS: readonly CoeliacGeneticRisk[];
/** The provenance of a summary (WITHOUT any raw data). `manual` ≡ `enteredManually=true`. */
export type GeneticSourceType = (typeof sourceTypeCodec.tokens)[number];
/** The known genetic-source-type values. */
export declare const GENETIC_SOURCE_TYPES: readonly GeneticSourceType[];
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
    /**
     * `diet:riskHaplotype` — machine-readable which coeliac-risk haplotype this
     * marker tags (`DQ2.5`/`DQ2.2`/`DQ7`/`DQ8`). Additive to the free-text
     * `markerInterpretation`, so a UI can render the haplotype without parsing prose.
     */
    riskHaplotype?: RiskHaplotype;
    /**
     * `diet:markerPresence` — the structured `present`/`absent`/`uncertain` call.
     * `uncertain` for a no-call / ambiguous genotype — **never** a false `absent`.
     */
    markerPresence?: MarkerPresence;
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
    /**
     * `diet:consentGiven` — explicit genetic-data consent. **MUST be `true` for a
     * summary to be written or to parse as valid** (fail-closed): `buildGeneticSummary`
     * refuses to write without it, mirroring the interpretation guardrail, and
     * `parseGeneticSummary` rejects a stored summary whose `consentGiven` is present
     * but not `true`. A pre-refinement summary that carries no `diet:consentGiven`
     * triple still parses (back-compat) with this left `undefined`.
     */
    consentGiven?: boolean;
    /**
     * `diet:sourceType` — provenance of the summary WITHOUT raw data
     * (`manual`/`consumer-array`/`clinical-report`). Supersedes the boolean
     * `enteredManually` (`sourceType=manual` ≡ `enteredManually=true`); both are kept
     * for back-compat and set independently by the caller.
     */
    sourceType?: GeneticSourceType;
    /**
     * `diet:coeliacGeneticRisk` — the NPV-only UI rollup. **`risk-haplotype-absent`
     * is only valid when {@link GeneticSummaryData.coverageComplete} is `true`** — a
     * "no risk haplotype found" claim is meaningful only if the source tested the
     * needed tag SNPs; otherwise use `partial-coverage`/`indeterminate`. The builder
     * and parser enforce this so the model can never assert an overstated negative.
     */
    coeliacGeneticRisk?: CoeliacGeneticRisk;
    /**
     * `diet:coverageComplete` — did the source test every tracked coeliac-risk tag
     * SNP? Load-bearing for the "absence excludes" NPV claim: a `false`/absent value
     * means a "not found" result is **not** reassurance (a consumer chip may not tag
     * every risk allele).
     */
    coverageComplete?: boolean;
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
    /** `diet:consentGiven` — explicit genetic-data consent (MUST be true to write). */
    get consentGiven(): boolean | undefined;
    set consentGiven(value: boolean | undefined);
    /** `diet:coverageComplete` — did the source test every tracked risk tag SNP? */
    get coverageComplete(): boolean | undefined;
    set coverageComplete(value: boolean | undefined);
    /** `diet:sourceType` → `diet:{concept}`; read back as the friendly token. */
    get sourceType(): GeneticSourceType | undefined;
    set sourceType(value: GeneticSourceType | undefined);
    /** `diet:coeliacGeneticRisk` → `diet:{concept}`; read back as the friendly token. */
    get coeliacGeneticRisk(): CoeliacGeneticRisk | undefined;
    set coeliacGeneticRisk(value: CoeliacGeneticRisk | undefined);
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