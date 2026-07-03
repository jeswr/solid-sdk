// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { DIET } from "./vocab.js";
/**
 * Build a codec from `[token, iriLocalName]` pairs. When the token equals the IRI
 * local name (the common case), pass a bare string — it is used for both.
 */
function makeCodec(pairs) {
    const tokenToLocal = new Map(pairs.map(([t, l]) => [t, l]));
    const localToToken = new Map(pairs.map(([t, l]) => [l, t]));
    const tokens = pairs.map(([t]) => t);
    return {
        toIri(token) {
            const local = tokenToLocal.get(token);
            if (local === undefined) {
                throw new Error(`unknown coded-value token: ${token}`);
            }
            return `${DIET}${local}`;
        },
        fromIri(iri) {
            if (!iri?.startsWith(DIET))
                return undefined;
            return localToToken.get(iri.slice(DIET.length));
        },
        isToken(s) {
            return tokenToLocal.has(s);
        },
        tokens,
    };
}
/** `token === IRI local name` pairs. */
function ident(...tokens) {
    return tokens.map((t) => [t, t]);
}
// --- The nine coded schemes (mirrors diet.ttl §4/§5/§6) ----------------------
/** `diet:MealContext` — home/restaurant/work/travel/other. */
export const contextCodec = makeCodec(ident("home", "restaurant", "work", "travel", "other"));
/** `diet:ExposureLevel` — token `possible-undeclared` ⇄ IRI `diet:possibleUndeclared`. */
export const exposureLevelCodec = makeCodec([
    ["present", "present"],
    ["trace", "trace"],
    ["possible-undeclared", "possibleUndeclared"],
    ["absent", "absent"],
]);
/** `diet:ProtocolPhase`. */
export const phaseCodec = makeCodec(ident("baseline", "eliminate", "washout", "reintroduce", "observe", "concluded"));
/** `diet:Verdict` — token `dose-dependent` ⇄ IRI `diet:doseDependent`. */
export const verdictCodec = makeCodec([
    ["tolerated", "tolerated"],
    ["reacts", "reacts"],
    ["dose-dependent", "doseDependent"],
    ["inconclusive", "inconclusive"],
]);
/** `diet:Confidence` — token `confirmed` ⇄ IRI `diet:confirmedByOwnTest` (§4.2 ordinal). */
export const confidenceCodec = makeCodec([
    ["emerging", "emerging"],
    ["suspected", "suspected"],
    ["likely", "likely"],
    ["confirmed", "confirmedByOwnTest"],
]);
/** `diet:SourceConfidence` — manual/off/ocr/voice. */
export const sourceConfidenceCodec = makeCodec(ident("manual", "off", "ocr", "voice"));
/** `diet:Portion` — small/normal/large. */
export const portionCodec = makeCodec(ident("small", "normal", "large"));
/**
 * `diet:SymptomType` — the friendly token is the vocab's `skos:notation` (kebab),
 * the IRI local name is the camelCase concept id.
 */
export const symptomTypeCodec = makeCodec([
    ["bloating", "bloating"],
    ["diarrhoea", "diarrhoea"],
    ["constipation", "constipation"],
    ["abdominal-pain", "abdominalPain"],
    ["brain-fog", "brainFog"],
    ["headache", "headache"],
    ["fatigue", "fatigue"],
    ["skin-rash", "skinRash"],
    ["wheeze-breathing", "wheezeBreathing"],
    ["anaphylaxis", "anaphylaxis"],
    ["nausea", "nausea"],
    ["reflux", "reflux"],
    ["joint-pain", "jointPain"],
    ["mood", "mood"],
]);
// --- Genetics coded schemes (Phase 3c — GeneticSummary refinement) ------------
//
// PRIVACY-/SAFETY-CRITICAL. These four schemes give the interpreted HLA summary
// machine-readable structure so a UI can render DQ2/DQ8 status without re-parsing
// prose, WITHOUT ever storing raw genotype data. The honesty semantics are
// load-bearing and enforced in `genetics.ts` (never here — this module is pure
// token↔IRI mapping): DQ2/DQ8 is COMMON (~25–40% of the general population) and
// is NOT diagnostic; only the NEGATIVE predictive value is strong (a NOT-carrying
// result makes coeliac very unlikely). See `genetics.ts` for the guardrails
// (consent MUST be true; a `risk-haplotype-absent` rollup requires complete
// coverage) that keep the model from overstating a genetic risk.
/**
 * `diet:HlaRiskHaplotype` — WHICH coeliac-risk HLA-DQ haplotype a marker tags.
 * Token `DQ2.5` ⇄ IRI `diet:DQ2_5` (the IRI local name uses `_` since `.` is not
 * a valid bare local-name char). Tag SNPs (verified): `rs2187668`→`DQ2.5`,
 * `rs7454108`→`DQ8`; DQ2.2/DQ7 tags are chip-dependent (coverage caveat).
 */
export const riskHaplotypeCodec = makeCodec([
    ["DQ2.5", "DQ2_5"],
    ["DQ2.2", "DQ2_2"],
    ["DQ7", "DQ7"],
    ["DQ8", "DQ8"],
]);
/**
 * `diet:MarkerPresence` — the structured presence call for one marker. `uncertain`
 * is used for a no-call / ambiguous genotype — **never a false `absent`** (an
 * unknown must not read as reassurance). Distinct IRI local names
 * (`markerPresent`/`markerAbsent`/`markerUncertain`) so this genetics value set
 * never conflates with the reused generic `diet:present`/`diet:absent`
 * ExposureLevel concepts (a different scheme).
 */
export const markerPresenceCodec = makeCodec([
    ["present", "markerPresent"],
    ["absent", "markerAbsent"],
    ["uncertain", "markerUncertain"],
]);
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
export const coeliacGeneticRiskCodec = makeCodec([
    ["risk-haplotype-present", "riskHaplotypePresent"],
    ["risk-haplotype-absent", "riskHaplotypeAbsent"],
    ["partial-coverage", "partialCoverage"],
    ["indeterminate", "indeterminate"],
]);
/**
 * `diet:GeneticSourceType` — provenance of the summary WITHOUT any raw data. Token
 * `manual` ⇄ IRI `diet:manualEntry` (distinct from the reused generic `diet:manual`
 * SourceConfidence concept — a different scheme), `consumer-array` ⇄
 * `diet:consumerArray`, `clinical-report` ⇄ `diet:clinicalReport`. `sourceType=manual`
 * ≡ the legacy `enteredManually=true` (kept for back-compat; this supersedes it).
 */
export const sourceTypeCodec = makeCodec([
    ["manual", "manualEntry"],
    ["consumer-array", "consumerArray"],
    ["clinical-report", "clinicalReport"],
]);
//# sourceMappingURL=concepts.js.map