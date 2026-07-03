// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The genotype → presence → haplotype interpretation (Phase 3c §5.2/§5.3), the
 * NPV-only rollup, and the mandatory negative-predictive framing. PURE + no I/O +
 * exhaustively tested — this is the health-accuracy core, so its ONE cardinal rule
 * is: **a no-call / ambiguous / strand-uncertain genotype is `uncertain`, NEVER a
 * false `absent`.** A false "absent" would read as reassurance ("you very likely do
 * not have coeliac"), which is exactly the harm the design forbids.
 *
 * Risk alleles (verified primary sources, §1.2):
 *   - **rs2187668** is a **C/T** SNP; the **T** allele tags DQ2.5. (PLOS One
 *     pone.0002270: sensitivity 1.000, specificity 0.999.)
 *   - **rs7454108** is a **T/C** SNP; the **C** allele tags DQ8. (SNPedia; sens.
 *     99.1%, spec. 99.6%.)
 *
 * **Strand-safety (why we can never emit a false absent):** consumer arrays report
 * on either DNA strand. rs2187668 is biallelic C/T, so a minus-strand report shows
 * G/A — the risk `T` appears as its complement `A`. We therefore treat the risk
 * allele-set as {the plus-strand risk base, its complement} = {T,A} for rs2187668
 * and {C,G} for rs7454108. Because each SNP is biallelic, the risk set and the
 * non-risk set are DISJOINT across both strands ({T,A} vs {C,G}; {C,G} vs {T,A}),
 * so a genotype carrying a risk allele on EITHER strand is always called `present`
 * — a risk carrier can never be mis-read as `absent`. `absent` is asserted ONLY
 * when every allele is a recognised non-risk base; anything else (no-call, single
 * allele, indel, unexpected base) is `uncertain`.
 */

import type {
  CoeliacGeneticRisk,
  GeneticSummaryData,
  HlaMarkerData,
  MarkerPresence,
  RiskHaplotype,
} from "@jeswr/solid-health-diary";
import { ALL_TAG_SNPS, type ClinicalObservation, type RawSnpCall, type TagRsid } from "./parse.js";

/** Per-SNP allele classification (both DNA strands), from the verified biallelic pairs. */
interface SnpModel {
  haplotype: RiskHaplotype;
  /** Bases that indicate the risk haplotype, on EITHER strand (see strand-safety above). */
  risk: ReadonlySet<string>;
  /** Bases that indicate the NON-risk allele, on either strand. */
  nonRisk: ReadonlySet<string>;
}

/**
 * The verified interpretation model per tag SNP. rs2187668 C/T (risk T ⇒ {T,A});
 * rs7454108 T/C (risk C ⇒ {C,G}). Secondary DQ2.2/DQ7 tags are documented but their
 * risk-allele orientation is chip-dependent, so they are interpreted CONSERVATIVELY
 * (only genotype→haplotype label, never used to assert a definitive `absent`).
 */
const SNP_MODELS: Partial<Record<TagRsid, SnpModel>> = {
  rs2187668: { haplotype: "DQ2.5", risk: new Set(["T", "A"]), nonRisk: new Set(["C", "G"]) },
  rs7454108: { haplotype: "DQ8", risk: new Set(["C", "G"]), nonRisk: new Set(["T", "A"]) },
};

/** The rsids we can make a DEFINITIVE present/absent call for (drives coverage). */
export const PRIMARY_MODEL_RSIDS = Object.keys(SNP_MODELS) as TagRsid[];

/** A parsed genotype: the individual allele bases, or `undefined` if not a clean 2-allele ACGT call. */
function alleles(genotype: string): [string, string] | undefined {
  const g = genotype.trim().toUpperCase();
  // No-call markers seen across formats: `--`, `00`, `NN`, single char, indels I/D.
  if (!/^[ACGT]{2}$/.test(g)) return undefined;
  return [g[0] as string, g[1] as string];
}

/**
 * Call the structured presence for a genotype at a tag SNP. **No-call / ambiguous /
 * unmodelled ⇒ `uncertain`, never a false `absent`.** For a modelled SNP:
 *   - any allele in the risk set (either strand) ⇒ `present`
 *   - both alleles recognised non-risk ⇒ `absent`
 *   - anything else ⇒ `uncertain`.
 * A SNP without a definitive model (secondary DQ2.2/DQ7 tags) never returns
 * `absent` — it is `present` only if it exactly matches a known risk pattern, else
 * `uncertain` (conservative; its absence must not read as reassurance).
 */
export function callPresence(rsid: TagRsid, genotype: string): MarkerPresence {
  const pair = alleles(genotype);
  if (!pair) return "uncertain"; // no-call / ambiguous — the safe default
  const model = SNP_MODELS[rsid];
  if (!model) return "uncertain"; // unmodelled secondary tag — never asserts absent
  const [a, b] = pair;
  if (model.risk.has(a) || model.risk.has(b)) return "present";
  if (model.nonRisk.has(a) && model.nonRisk.has(b)) return "absent";
  return "uncertain";
}

/** A short, human interpretation line for a marker (stored + shown, never a bare genotype). */
function markerInterpretationLine(
  haplotype: RiskHaplotype,
  presence: MarkerPresence,
  rsid: string,
): string {
  const verb =
    presence === "present"
      ? "a risk allele was found"
      : presence === "absent"
        ? "no risk allele was found"
        : "the result was inconclusive (no clear call)";
  return `${rsid} (${haplotype} tag): ${verb}.`;
}

/** Build a machine-readable marker row from one raw SNP call. */
export function markerFromRawCall(call: RawSnpCall): HlaMarkerData {
  const haplotype = ALL_TAG_SNPS[call.rsid];
  const presence = callPresence(call.rsid, call.genotype);
  return {
    rsid: call.rsid,
    genotype: call.genotype,
    riskHaplotype: haplotype,
    markerPresence: presence,
    markerInterpretation: markerInterpretationLine(haplotype, presence, call.rsid),
  };
}

/** The canonical tag SNP used to represent a haplotype in a manual entry (needs a non-empty rsid). */
export const HAPLOTYPE_TAG_SNP: Record<RiskHaplotype, TagRsid> = {
  "DQ2.5": "rs2187668",
  DQ8: "rs7454108",
  "DQ2.2": "rs2395182",
  DQ7: "rs4713586",
};

/** Build a marker row from a manual present/absent/uncertain selection for a haplotype. */
export function markerFromManual(
  haplotype: RiskHaplotype,
  presence: MarkerPresence,
): HlaMarkerData {
  const rsid = HAPLOTYPE_TAG_SNP[haplotype];
  return {
    rsid,
    riskHaplotype: haplotype,
    markerPresence: presence,
    markerInterpretation: `${haplotype}: manually recorded as ${presence}.`,
  };
}

/**
 * Whether a set of marker rows COMPLETELY covers the primary coeliac risk tags —
 * i.e. BOTH rs2187668 (DQ2.5) and rs7454108 (DQ8) produced a DEFINITIVE call
 * (`present` or `absent`, not `uncertain`). Only when this is true can a
 * `risk-haplotype-absent` (NPV "coeliac unlikely") rollup be asserted — the model
 * enforces the same rule, so an incomplete source can never overstate a negative.
 */
export function coverageComplete(markers: readonly HlaMarkerData[]): boolean {
  return PRIMARY_MODEL_RSIDS.every((rsid) => {
    const m = markers.find((x) => x.rsid === rsid);
    return m !== undefined && (m.markerPresence === "present" || m.markerPresence === "absent");
  });
}

/**
 * The NPV-only rollup over the markers (§5.4). Precedence:
 *   1. any marker `present` ⇒ `risk-haplotype-present` (NOT a diagnosis — DQ2/DQ8 is
 *      common, ~25–40% of the general population).
 *   2. else, complete coverage with every primary tag `absent` ⇒ `risk-haplotype-absent`
 *      (coeliac *unlikely*, explicitly NOT "you don't have coeliac"). Only valid with
 *      {@link coverageComplete}.
 *   3. else, at least one definitive `absent` but coverage incomplete ⇒ `partial-coverage`.
 *   4. else (all uncertain / nothing called) ⇒ `indeterminate`.
 */
export function rollup(markers: readonly HlaMarkerData[]): CoeliacGeneticRisk {
  if (markers.some((m) => m.markerPresence === "present")) return "risk-haplotype-present";
  const complete = coverageComplete(markers);
  const anyAbsent = markers.some((m) => m.markerPresence === "absent");
  if (complete && anyAbsent) return "risk-haplotype-absent";
  if (anyAbsent) return "partial-coverage";
  return "indeterminate";
}

/**
 * The MANDATORY negative-predictive framing (§5.3, RESEARCH §2.5). This exact text
 * is written into `diet:geneticInterpretation` (the model REQUIRES a non-empty
 * value and refuses to write a summary without it) and shown on every genetics
 * surface. It states the NPV-only truth: DQ2/DQ8 is common and NOT diagnostic; its
 * absence is what is informative; a coeliac diagnosis needs blood tests + biopsy
 * WHILE STILL EATING GLUTEN; a "not found" is not a clean bill of health.
 */
export const GENETIC_FRAMING =
  "Carrying DQ2/DQ8 does NOT mean you have coeliac disease — about a quarter to 40% " +
  "of everyone carries it. NOT carrying it makes coeliac disease very unlikely. This " +
  "cannot diagnose you. A coeliac diagnosis needs blood tests and a biopsy while you " +
  "are still eating gluten — never start a gluten-free diet before testing. Your test " +
  "file may not cover every risk gene, so a 'not found' result here is not a clean " +
  "bill of health. Discuss any result with your clinician.";

/** How a summary was produced (mirrors the model's `diet:sourceType`). */
export type SummarySource = "manual" | "consumer-array" | "clinical-report";

/**
 * Assemble a {@link GeneticSummaryData} (WITHOUT consent — consent is added at the
 * write boundary in `summary.ts`, so the pure interpretation layer never carries a
 * consent flag). Computes the rollup + coverage from the markers and attaches the
 * mandatory framing. Never fabricates a marker; an empty marker set yields an
 * `indeterminate` rollup.
 */
export function buildSummaryData(
  markers: HlaMarkerData[],
  source: SummarySource,
  patient?: string,
): Omit<GeneticSummaryData, "consentGiven"> {
  const complete = coverageComplete(markers);
  return {
    markers,
    interpretation: GENETIC_FRAMING,
    sourceType: source,
    enteredManually: source === "manual",
    coeliacGeneticRisk: rollup(markers),
    coverageComplete: complete,
    ...(patient ? { patient } : {}),
  };
}

/** Interpret consumer-array raw SNP calls into a summary-data payload (no consent yet). */
export function interpretConsumerArray(
  calls: RawSnpCall[],
  patient?: string,
): Omit<GeneticSummaryData, "consentGiven"> {
  return buildSummaryData(calls.map(markerFromRawCall), "consumer-array", patient);
}

/** Interpret clinical-report observations into a summary-data payload (no consent yet). */
export function interpretClinical(
  observations: ClinicalObservation[],
  patient?: string,
): Omit<GeneticSummaryData, "consentGiven"> {
  const markers: HlaMarkerData[] = observations.map((o) => {
    if (o.rsid && o.genotype !== undefined) return markerFromRawCall({ rsid: o.rsid, genotype: o.genotype });
    // A prose "positive"/"negative" statement → present/absent (never uncertain=absent).
    const presence: MarkerPresence = o.statedPresent ? "present" : "absent";
    return markerFromManual(o.haplotype, presence);
  });
  return buildSummaryData(markers, "clinical-report", patient);
}
