// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { LiteralAs, LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, OptionalFrom, SetFrom, TermWrapper, } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { coeliacGeneticRiskCodec, markerPresenceCodec, riskHaplotypeCodec, sourceTypeCodec, } from "./concepts.js";
import { httpIriOrUndefined } from "./iri.js";
import { assertSubjectSingletons } from "./rdfGuards.js";
import { parseBody, storeToTurtle } from "./serialize.js";
import { setIfDefined, tryRead, validDateOrUndefined } from "./util.js";
import { DIET_GENETIC_SUMMARY, DIET_HLA_MARKER, dct, diet, HEALTH_PATIENT_PROP, rdf, } from "./vocab.js";
/** The known risk haplotypes. */
export const RISK_HAPLOTYPES = riskHaplotypeCodec.tokens;
/** The known marker-presence values. */
export const MARKER_PRESENCES = markerPresenceCodec.tokens;
/** The known coeliac-genetic-risk rollup values. */
export const COELIAC_GENETIC_RISKS = coeliacGeneticRiskCodec.tokens;
/** The known genetic-source-type values. */
export const GENETIC_SOURCE_TYPES = sourceTypeCodec.tokens;
/** The GeneticSummary subject IRI: `${url}#it`. */
export function geneticSummarySubject(url) {
    return `${url}#it`;
}
// The SHACL `sh:maxCount 1` predicates (only these are guarded). Note
// diet:geneticInterpretation is min-count-1 but NOT max-count-1 in the shape, and
// diet:genotype is unconstrained — so neither is guarded here.
const GENETIC_SUMMARY_SINGLETONS = [
    diet("enteredManually"),
    diet("consentGiven"),
    diet("sourceType"),
    diet("coeliacGeneticRisk"),
    diet("coverageComplete"),
];
const HLA_MARKER_SINGLETONS = [
    diet("rsid"),
    diet("markerInterpretation"),
    diet("riskHaplotype"),
    diet("markerPresence"),
];
/** The n-th HLA marker node IRI: `${url}#marker-{n}`. */
export function markerSubject(url, index) {
    return `${url}#marker-${index}`;
}
function trailingIndex(iri) {
    const m = iri.match(/-(\d+)$/);
    return m ? Number.parseInt(m[1], 10) : -1;
}
/**
 * The coeliac-risk-CONFERRING HLA-DQ haplotypes for the rollup↔marker consistency
 * guardrail: `DQ2.5` / `DQ2.2` / `DQ8`. `DQ7` is deliberately EXCLUDED — it is not
 * a coeliac-risk-conferring haplotype on its own, so a present DQ7 marker does not
 * contradict a `risk-haplotype-absent` rollup. Mirrors the shape's DQ2.5/DQ2.2/DQ8
 * set (`dsh:GeneticRiskMarkerConsistencyShape`).
 */
const RISK_CONFERRING_HAPLOTYPES = new Set([
    "DQ2.5",
    "DQ2.2",
    "DQ8",
]);
/**
 * Does a `risk-haplotype-absent` rollup contradict a linked marker? A summary that
 * asserts NO coeliac-risk haplotype (`coeliacGeneticRisk = risk-haplotype-absent`)
 * MUST NOT carry a marker whose `markerPresence = present` for a coeliac-risk
 * haplotype (DQ2.5/DQ2.2/DQ8) — a present risk marker directly refutes the "no risk
 * haplotype found" claim, and the strong NPV signal is a genuine ABSENCE, so a
 * claimed absence contradicted by a present marker is unsafe. Used to fail the
 * write AND the read closed, symmetric with `dsh:GeneticRiskMarkerConsistencyShape`.
 */
function absentRollupContradictedByMarker(coeliacGeneticRisk, markers) {
    if (coeliacGeneticRisk !== "risk-haplotype-absent")
        return false;
    return markers.some((m) => m.markerPresence === "present" &&
        m.riskHaplotype !== undefined &&
        RISK_CONFERRING_HAPLOTYPES.has(m.riskHaplotype));
}
/** Typed `@rdfjs/wrapper` view of a `diet:GeneticSummary`. */
export class GeneticSummary extends TermWrapper {
    get id() {
        return this.value;
    }
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    mark() {
        this.types.add(DIET_GENETIC_SUMMARY);
        return this;
    }
    get isGeneticSummary() {
        return this.types.has(DIET_GENETIC_SUMMARY);
    }
    /** `diet:hlaMarker` → the marker node IRIs (live set). */
    get hlaMarker() {
        return SetFrom.subjectPredicate(this, diet("hlaMarker"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    get interpretation() {
        return OptionalFrom.subjectPredicate(this, diet("geneticInterpretation"), LiteralAs.string);
    }
    set interpretation(value) {
        OptionalAs.object(this, diet("geneticInterpretation"), value, LiteralFrom.string);
    }
    get enteredManually() {
        return OptionalFrom.subjectPredicate(this, diet("enteredManually"), LiteralAs.boolean);
    }
    set enteredManually(value) {
        OptionalAs.object(this, diet("enteredManually"), value, LiteralFrom.boolean);
    }
    /** `diet:consentGiven` — explicit genetic-data consent (MUST be true to write). */
    get consentGiven() {
        return OptionalFrom.subjectPredicate(this, diet("consentGiven"), LiteralAs.boolean);
    }
    set consentGiven(value) {
        OptionalAs.object(this, diet("consentGiven"), value, LiteralFrom.boolean);
    }
    /** `diet:coverageComplete` — did the source test every tracked risk tag SNP? */
    get coverageComplete() {
        return OptionalFrom.subjectPredicate(this, diet("coverageComplete"), LiteralAs.boolean);
    }
    set coverageComplete(value) {
        OptionalAs.object(this, diet("coverageComplete"), value, LiteralFrom.boolean);
    }
    /** `diet:sourceType` → `diet:{concept}`; read back as the friendly token. */
    get sourceType() {
        return sourceTypeCodec.fromIri(OptionalFrom.subjectPredicate(this, diet("sourceType"), NamedNodeAs.string));
    }
    set sourceType(value) {
        OptionalAs.object(this, diet("sourceType"), value ? sourceTypeCodec.toIri(value) : undefined, NamedNodeFrom.string);
    }
    /** `diet:coeliacGeneticRisk` → `diet:{concept}`; read back as the friendly token. */
    get coeliacGeneticRisk() {
        return coeliacGeneticRiskCodec.fromIri(OptionalFrom.subjectPredicate(this, diet("coeliacGeneticRisk"), NamedNodeAs.string));
    }
    set coeliacGeneticRisk(value) {
        OptionalAs.object(this, diet("coeliacGeneticRisk"), value ? coeliacGeneticRiskCodec.toIri(value) : undefined, NamedNodeFrom.string);
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
}
/** A single `diet:HlaMarker` node accessor (`diet:rsid`/`diet:genotype`/`diet:markerInterpretation`). */
class HlaMarker extends TermWrapper {
    get types() {
        return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
    }
    mark() {
        this.types.add(DIET_HLA_MARKER);
        return this;
    }
    get rsid() {
        return OptionalFrom.subjectPredicate(this, diet("rsid"), LiteralAs.string);
    }
    set rsid(value) {
        OptionalAs.object(this, diet("rsid"), value, LiteralFrom.string);
    }
    get genotype() {
        return OptionalFrom.subjectPredicate(this, diet("genotype"), LiteralAs.string);
    }
    set genotype(value) {
        OptionalAs.object(this, diet("genotype"), value, LiteralFrom.string);
    }
    get markerInterpretation() {
        return OptionalFrom.subjectPredicate(this, diet("markerInterpretation"), LiteralAs.string);
    }
    set markerInterpretation(value) {
        OptionalAs.object(this, diet("markerInterpretation"), value, LiteralFrom.string);
    }
    /** `diet:riskHaplotype` → `diet:{concept}`; read back as the friendly token. */
    get riskHaplotype() {
        return riskHaplotypeCodec.fromIri(OptionalFrom.subjectPredicate(this, diet("riskHaplotype"), NamedNodeAs.string));
    }
    set riskHaplotype(value) {
        OptionalAs.object(this, diet("riskHaplotype"), value ? riskHaplotypeCodec.toIri(value) : undefined, NamedNodeFrom.string);
    }
    /** `diet:markerPresence` → `diet:{concept}`; read back as the friendly token. */
    get markerPresence() {
        return markerPresenceCodec.fromIri(OptionalFrom.subjectPredicate(this, diet("markerPresence"), NamedNodeAs.string));
    }
    set markerPresence(value) {
        OptionalAs.object(this, diet("markerPresence"), value ? markerPresenceCodec.toIri(value) : undefined, NamedNodeFrom.string);
    }
}
/** Parse a GeneticSummary out of a dataset, or `undefined` if `${url}#it` is not one. */
export function parseGeneticSummary(url, dataset) {
    return tryRead(() => parseGeneticSummaryImpl(url, dataset));
}
function parseGeneticSummaryImpl(url, dataset) {
    const doc = new GeneticSummary(geneticSummarySubject(url), dataset, DataFactory);
    if (!doc.isGeneticSummary)
        return undefined;
    assertSubjectSingletons(dataset, geneticSummarySubject(url), GENETIC_SUMMARY_SINGLETONS);
    // The negative-predictive interpretation is a SHACL MUST — a summary without it
    // is not a usable (or safe) record; reject rather than surface a framing-less one.
    const interpretation = doc.interpretation;
    if (!interpretation || interpretation.trim() === "")
        return undefined;
    // Consent guardrail on READ (fail-closed, symmetric with the writer): a summary
    // whose diet:consentGiven is PRESENT but not `true` is an un-consented genetic
    // record — reject it rather than surface it. An ABSENT diet:consentGiven parses
    // (back-compat: a pre-refinement summary predates the consent field).
    const consentGiven = doc.consentGiven;
    if (consentGiven !== undefined && consentGiven !== true)
        return undefined;
    const coverageComplete = doc.coverageComplete;
    const coeliacGeneticRisk = doc.coeliacGeneticRisk;
    // NPV-only safety guardrail: a "risk-haplotype-absent" rollup asserts coeliac is
    // unlikely, which is only sound when the source tested every needed tag SNP. A
    // stored summary that claims `risk-haplotype-absent` WITHOUT coverageComplete=true
    // is an overstated negative — reject it (never surface a false reassurance).
    if (coeliacGeneticRisk === "risk-haplotype-absent" && coverageComplete !== true)
        return undefined;
    // Provenance-consistency guardrail on READ (fail-closed, symmetric with the
    // writer): diet:sourceType and the legacy diet:enteredManually are equivalent
    // (`manual` ⇔ enteredManually=true). A stored summary that carries a contradictory
    // pair is hostile/stale pod data — reject it rather than surface two conflicting
    // provenance claims. (Either field alone, or an absent field, is fine.)
    const enteredManually = doc.enteredManually;
    const sourceType = doc.sourceType;
    if (enteredManually !== undefined &&
        sourceType !== undefined &&
        (sourceType === "manual") !== enteredManually) {
        return undefined;
    }
    const data = { id: geneticSummarySubject(url), markers: [], interpretation };
    setIfDefined(data, "enteredManually", enteredManually);
    setIfDefined(data, "consentGiven", consentGiven);
    setIfDefined(data, "sourceType", sourceType);
    setIfDefined(data, "coeliacGeneticRisk", coeliacGeneticRisk);
    setIfDefined(data, "coverageComplete", coverageComplete);
    // http(s)-filtered on READ (symmetric with the writer) — never surface a
    // non-http(s) IRI from a hostile pod document.
    setIfDefined(data, "patient", httpIriOrUndefined(doc.patient));
    setIfDefined(data, "created", validDateOrUndefined(doc.created));
    const nodes = [...doc.hlaMarker].sort((a, b) => trailingIndex(a) - trailingIndex(b));
    for (const node of nodes) {
        assertSubjectSingletons(dataset, node, HLA_MARKER_SINGLETONS);
        const m = new HlaMarker(node, dataset, DataFactory);
        const rsid = m.rsid;
        // Mirror the builder's rsid MUST on READ: drop a marker with a missing or
        // whitespace-only diet:rsid (an invalid HLA row must not surface from pod data).
        if (!rsid || rsid.trim() === "")
            continue;
        const marker = { rsid };
        setIfDefined(marker, "genotype", m.genotype);
        setIfDefined(marker, "markerInterpretation", m.markerInterpretation);
        setIfDefined(marker, "riskHaplotype", m.riskHaplotype);
        setIfDefined(marker, "markerPresence", m.markerPresence);
        data.markers.push(marker);
    }
    // ROLLUP↔MARKER CONSISTENCY guardrail on READ (fail-closed, symmetric with the
    // writer + dsh:GeneticRiskMarkerConsistencyShape): a stored summary claiming
    // 'risk-haplotype-absent' while a linked marker shows a coeliac-risk haplotype
    // (DQ2.5/DQ2.2/DQ8) PRESENT is a self-contradictory (hostile/stale) record —
    // reject it rather than surface a false "coeliac unlikely".
    if (absentRollupContradictedByMarker(coeliacGeneticRisk, data.markers))
        return undefined;
    return data;
}
/**
 * Build a fresh n3 `Store` holding one GeneticSummary rooted at `${url}#it`.
 *
 * `data` is a {@link GeneticSummaryInput}, so `consentGiven: true` is required at
 * COMPILE time; the runtime guardrails below still fire (a cast can bypass the type).
 */
export function buildGeneticSummary(url, data) {
    if (!data.interpretation || data.interpretation.trim() === "") {
        throw new Error("buildGeneticSummary: a diet:geneticInterpretation (the negative-predictive " +
            "framing) is REQUIRED and must be non-empty — refusing to write a genetics " +
            'summary with no "cannot diagnose you" guardrail.');
    }
    // CONSENT GUARDRAIL (fail-closed, mirrors the interpretation MUST): a genetic
    // summary is the most sensitive record in the diary — it is never written without
    // EXPLICIT consent. `consentGiven` must be strictly `true`; `undefined`/`false`
    // both refuse the write. This is the data-layer half of "no consent → no write".
    if (data.consentGiven !== true) {
        throw new Error("buildGeneticSummary: diet:consentGiven MUST be true to write a genetics " +
            "summary — refusing to store genetic data without explicit consent (fail-closed).");
    }
    // NPV-only safety guardrail: "risk-haplotype-absent" (coeliac unlikely) is a sound
    // claim ONLY when the source tested every needed tag SNP. Refuse to assert an
    // absent rollup without complete coverage — that would overstate the negative
    // (a consumer chip may not tag every risk allele; a "not found" is not a clean
    // bill of health). Use partial-coverage/indeterminate instead when coverage is
    // incomplete.
    if (data.coeliacGeneticRisk === "risk-haplotype-absent" && data.coverageComplete !== true) {
        throw new Error("buildGeneticSummary: a diet:coeliacGeneticRisk of 'risk-haplotype-absent' " +
            "requires diet:coverageComplete=true — refusing to assert an absent (NPV) " +
            "rollup when the source did not cover every risk tag SNP (use " +
            "'partial-coverage'/'indeterminate' instead).");
    }
    // ROLLUP↔MARKER CONSISTENCY guardrail (mirrors dsh:GeneticRiskMarkerConsistencyShape,
    // so the app write path never emits what the SHACL profile rejects): refuse a
    // 'risk-haplotype-absent' rollup that is directly contradicted by a linked marker
    // showing a coeliac-risk haplotype (DQ2.5/DQ2.2/DQ8) PRESENT — a present risk
    // marker means the "no risk haplotype found" claim is false. Use
    // 'risk-haplotype-present'/'indeterminate' instead.
    if (absentRollupContradictedByMarker(data.coeliacGeneticRisk, data.markers)) {
        throw new Error("buildGeneticSummary: a diet:coeliacGeneticRisk of 'risk-haplotype-absent' MUST " +
            "NOT be asserted alongside an HLA marker whose diet:markerPresence is 'present' " +
            "for a coeliac-risk haplotype (DQ2.5/DQ2.2/DQ8) — a present risk marker " +
            "contradicts the 'no risk haplotype found' rollup (use " +
            "'risk-haplotype-present'/'indeterminate').");
    }
    // Provenance-consistency guardrail: diet:sourceType and the legacy
    // diet:enteredManually are equivalent (`manual` ⇔ enteredManually=true). When a
    // caller sets BOTH, refuse a contradictory pair (e.g. sourceType:"manual" with
    // enteredManually:false, or a non-manual sourceType with enteredManually:true) so
    // the pod never holds two conflicting provenance claims.
    if (data.sourceType !== undefined && data.enteredManually !== undefined) {
        const manualByType = data.sourceType === "manual";
        if (manualByType !== data.enteredManually) {
            throw new Error("buildGeneticSummary: diet:sourceType and diet:enteredManually disagree — " +
                "'manual' ⇔ enteredManually=true. Set them consistently or provide only one.");
        }
    }
    const store = new Store();
    const doc = new GeneticSummary(geneticSummarySubject(url), store, DataFactory).mark();
    doc.interpretation = data.interpretation;
    doc.enteredManually = data.enteredManually;
    doc.consentGiven = data.consentGiven;
    doc.sourceType = data.sourceType;
    doc.coeliacGeneticRisk = data.coeliacGeneticRisk;
    doc.coverageComplete = data.coverageComplete;
    doc.patient = httpIriOrUndefined(data.patient);
    doc.created = data.created ?? new Date();
    data.markers.forEach((marker, i) => {
        // Fail-closed on the HlaMarker SHACL MUST: a non-empty diet:rsid. A marker with
        // no rsid writes an invalid node that parseGeneticSummary then drops silently.
        if (!marker.rsid || marker.rsid.trim() === "") {
            throw new Error(`buildGeneticSummary: HLA marker #${i} MUST have a non-empty diet:rsid — refusing to write an rsid-less marker.`);
        }
        const node = markerSubject(url, i);
        const m = new HlaMarker(node, store, DataFactory).mark();
        m.rsid = marker.rsid;
        m.genotype = marker.genotype;
        m.markerInterpretation = marker.markerInterpretation;
        m.riskHaplotype = marker.riskHaplotype;
        m.markerPresence = marker.markerPresence;
        doc.hlaMarker.add(node);
    });
    return store;
}
/** Serialise a GeneticSummary to Turtle (via `n3.Writer`). Requires consent (see {@link GeneticSummaryInput}). */
export function serializeGeneticSummary(url, data) {
    return storeToTurtle(buildGeneticSummary(url, data));
}
/** Parse a fetched GeneticSummary body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export async function parseGeneticSummaryTtl(url, body, contentType = "text/turtle") {
    return parseGeneticSummary(url, await parseBody(body, url, contentType));
}
//# sourceMappingURL=genetics.js.map