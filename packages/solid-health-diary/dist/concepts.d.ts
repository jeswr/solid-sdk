/**
 * Coded-value CODECS — the bijection between a friendly TypeScript token and the
 * canonical `diet:` **concept IRI** it is stored as.
 *
 * The landed `diet:` vocab (`solid-federation-vocab` @ Brief 1B) models the
 * enum-valued properties (`context`, `exposureLevel`, `phase`, `verdict`,
 * `confidence`, `sourceConfidence`, `portion`, `symptomType`, `trigger`) as
 * **object properties over SKOS concept IRIs**, not string literals. Each concept
 * also carries a `skos:notation` — the plain token the app UI uses. So this
 * package exposes the friendly token (the ergonomic DX) on its typed accessors
 * while STORING the concept IRI on the wire (the federation contract). This module
 * is the single reviewed home for that mapping, kept in lock-step with the vocab.
 *
 * Where the token and the concept's IRI local name differ, it is noted inline:
 * the multi-word tokens (`possible-undeclared`, `dose-dependent`, the kebab
 * symptom types) are the vocab's `skos:notation`, while the IRI local name is the
 * camelCase concept id (`possibleUndeclared`, `doseDependent`, `abdominalPain`, …).
 *
 * Pure, no platform, no RDF — client-safe.
 */
/** A friendly-token ⇄ concept-IRI codec for one coded-value scheme. */
export interface Codec<T extends string> {
    /** The concept IRI (`diet:{localName}`) for a friendly token. */
    toIri(token: T): string;
    /** The friendly token for a concept IRI, or `undefined` if it is not in the scheme. */
    fromIri(iri: string | undefined): T | undefined;
    /** Narrowing guard: is `s` one of the scheme's friendly tokens? */
    isToken(s: string): s is T;
    /** The friendly tokens, in declaration order. */
    readonly tokens: readonly T[];
}
/** `diet:MealContext` — home/restaurant/work/travel/other. */
export declare const contextCodec: Codec<"home" | "restaurant" | "work" | "travel" | "other">;
/** `diet:ExposureLevel` — token `possible-undeclared` ⇄ IRI `diet:possibleUndeclared`. */
export declare const exposureLevelCodec: Codec<"present" | "trace" | "possible-undeclared" | "absent">;
/** `diet:ProtocolPhase`. */
export declare const phaseCodec: Codec<"baseline" | "eliminate" | "washout" | "reintroduce" | "observe" | "concluded">;
/** `diet:Verdict` — token `dose-dependent` ⇄ IRI `diet:doseDependent`. */
export declare const verdictCodec: Codec<"tolerated" | "reacts" | "dose-dependent" | "inconclusive">;
/** `diet:Confidence` — token `confirmed` ⇄ IRI `diet:confirmedByOwnTest` (§4.2 ordinal). */
export declare const confidenceCodec: Codec<"emerging" | "suspected" | "likely" | "confirmed">;
/** `diet:SourceConfidence` — manual/off/ocr/voice. */
export declare const sourceConfidenceCodec: Codec<"manual" | "off" | "ocr" | "voice">;
/** `diet:Portion` — small/normal/large. */
export declare const portionCodec: Codec<"small" | "normal" | "large">;
/**
 * `diet:SymptomType` — the friendly token is the vocab's `skos:notation` (kebab),
 * the IRI local name is the camelCase concept id.
 */
export declare const symptomTypeCodec: Codec<"bloating" | "diarrhoea" | "constipation" | "abdominal-pain" | "brain-fog" | "headache" | "fatigue" | "skin-rash" | "wheeze-breathing" | "anaphylaxis" | "nausea" | "reflux" | "joint-pain" | "mood">;
/**
 * `diet:HlaRiskHaplotype` — WHICH coeliac-risk HLA-DQ haplotype a marker tags.
 * Token `DQ2.5` ⇄ IRI `diet:DQ2_5` (the IRI local name uses `_` since `.` is not
 * a valid bare local-name char). Tag SNPs (verified): `rs2187668`→`DQ2.5`,
 * `rs7454108`→`DQ8`; DQ2.2/DQ7 tags are chip-dependent (coverage caveat).
 */
export declare const riskHaplotypeCodec: Codec<"DQ2.5" | "DQ2.2" | "DQ7" | "DQ8">;
/**
 * `diet:MarkerPresence` — the structured presence call for one marker. `uncertain`
 * is used for a no-call / ambiguous genotype — **never a false `absent`** (an
 * unknown must not read as reassurance). Distinct IRI local names
 * (`markerPresent`/`markerAbsent`/`markerUncertain`) so this genetics value set
 * never conflates with the reused generic `diet:present`/`diet:absent`
 * ExposureLevel concepts (a different scheme).
 */
export declare const markerPresenceCodec: Codec<"present" | "absent" | "uncertain">;
/**
 * `diet:CoeliacGeneticRisk` — the NPV-only UI rollup over the markers. Token
 * `risk-haplotype-absent` ⇄ IRI `diet:riskHaplotypeAbsent`. **Framed
 * negative-predictive-only:** `risk-haplotype-absent` means coeliac is *unlikely*,
 * explicitly NOT "you don't have coeliac"; `risk-haplotype-present` is NOT a
 * diagnosis (DQ2/DQ8 is common). `partial-coverage` = the source could not speak
 * to every risk locus; `indeterminate` = cannot be called. The
 * `risk-haplotype-absent` rollup is only valid when coverage is complete — that
 * safety rule is enforced in `buildGeneticSummary`/`parseGeneticSummary`.
 */
export declare const coeliacGeneticRiskCodec: Codec<"risk-haplotype-present" | "risk-haplotype-absent" | "partial-coverage" | "indeterminate">;
/**
 * `diet:GeneticSourceType` — provenance of the summary WITHOUT any raw data. Token
 * `manual` ⇄ IRI `diet:manualEntry` (distinct from the reused generic `diet:manual`
 * SourceConfidence concept — a different scheme), `consumer-array` ⇄
 * `diet:consumerArray`, `clinical-report` ⇄ `diet:clinicalReport`. `sourceType=manual`
 * ≡ the legacy `enteredManually=true` (kept for back-compat; this supersedes it).
 */
export declare const sourceTypeCodec: Codec<"manual" | "consumer-array" | "clinical-report">;
//# sourceMappingURL=concepts.d.ts.map