// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Phase 3b — Drug/therapy pipeline explainer (§4.4). A STATIC, dated,
 * research-grounded catalog (§1.3) — honesty is load-bearing:
 *
 *   HEADER TRUTH: there is NO approved disease-modifying drug; the gluten-free
 *   diet remains the only treatment. This claim is sourced from the guidelines +
 *   reviews (NICE NG20 / ACG 2023 / Nutrients 2025), NOT from an openFDA 404.
 *
 * No candidate is described as effective. Larazotide and Nexvax2 are shown as
 * FAILED / DISCONTINUED. Enzyme "glutenase" supplements are flagged as adjuncts
 * with weak/mixed evidence, never a substitute for the diet. openFDA is used ONLY
 * as a named-product LABEL LOOKUP (a 404 for an investigational drug is expected,
 * and is not proof that "nothing is approved").
 */
import { knowledgeJson } from "./fetch.js";

/** Honest evidence stage for a therapy row (rail §2.5). */
export type EvidenceStage =
  | "phase-1"
  | "phase-2"
  | "phase-2b"
  | "phase-3"
  | "recruiting"
  | "discontinued"
  | "supplement";

/** A pipeline entry — every field cited/verified per §1.3; failures shown as failures. */
export interface Therapy {
  readonly id: string;
  readonly name: string;
  readonly mechanism: string;
  readonly stage: EvidenceStage;
  /** The verified status line (as of the catalog date). */
  readonly status: string;
  /** The honest caveat — never overstate; failures are shown as failures. */
  readonly note: string;
  /** Whether a trial is currently recruiting → tie to the live CT.gov query. */
  readonly recruiting: boolean;
  /** A CT.gov `query.term` to pull this candidate's live recruiting trials (opt-in refresh). */
  readonly ctgovTerm?: string;
  /** Cited primary/authoritative sources (URLs). */
  readonly sources: readonly string[];
}

/** The header truth — stated everywhere the pipeline is shown. */
export const NO_APPROVED_DRUG_HEADER =
  "The gluten-free diet is still the only treatment for coeliac disease. There is no approved drug that treats or cures it. Everything below is experimental research — nothing here is a treatment you can take, and none of it replaces the gluten-free diet or a clinician's advice.";

/** The catalog date — a refresh is a one-line human edit (§9). */
export const THERAPIES_AS_OF = "2026-07-03";

export const THERAPIES: readonly Therapy[] = Object.freeze([
  {
    id: "zed1227",
    name: "ZED1227 / TAK-227",
    mechanism: "Oral transglutaminase-2 (TG2) inhibitor",
    stage: "recruiting",
    status:
      "Most advanced candidate. A Phase 2b in non-responsive/refractory coeliac disease concluded around September 2024; a new Phase 2 (NCT07298343) is recruiting.",
    note: "A Phase 2 study showed histological protection during a gluten challenge, but the drug is unproven for real-world outcomes and remains trial-stage — not a treatment you can take.",
    recruiting: true,
    ctgovTerm: "ZED1227",
    sources: [
      "https://clinicaltrials.gov/study/NCT07298343",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC10341493/",
      "https://www.mdpi.com/2072-6643/17/18/2960",
    ],
  },
  {
    id: "tak-101",
    name: "TAK-101",
    mechanism: "Tolerogenic gliadin nanoparticle (intravenous)",
    stage: "phase-2",
    status: "Phase 2 dose-ranging (Takeda).",
    note: "An immune-tolerance approach at an early stage. No outcome data supports using it as a treatment.",
    recruiting: false,
    ctgovTerm: "TAK-101",
    sources: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC11970589/"],
  },
  {
    id: "kan-101",
    name: "KAN-101 (Anokion)",
    mechanism: "Liver-targeted gliadin-peptide immune tolerance",
    stage: "phase-2",
    status:
      "Phase 2 (ACeD-it, NCT06001177) reported positive symptom data; primary completion January 2025.",
    note: "An antigen-specific tolerance approach, still early. It is NOT an enzyme — do not confuse it with the glutenase candidates.",
    recruiting: false,
    ctgovTerm: "KAN-101",
    sources: [
      "https://clinicaltrials.gov/study/NCT06001177",
      "https://celiac.org/2024/05/22/anokion-announces-new-clinical-data-from-aced-it-trial-supporting-kan-101-as-a-potential-disease-modifying-treatment-for-celiac-disease/",
    ],
  },
  {
    id: "tak-062",
    name: "Zamaglutenase / TAK-062 (Kuma062)",
    mechanism: "Engineered oral glutenase enzyme (degrades gluten in the stomach)",
    stage: "phase-2",
    status: "A trial-stage oral glutenase enzyme candidate (Takeda). Confirm the current phase on ClinicalTrials.gov.",
    note: "A different drug from KAN-101. Even if it succeeds, an enzyme is an ADJUNCT that might reduce accidental exposure — not a cure and not a substitute for the diet.",
    recruiting: false,
    ctgovTerm: "TAK-062",
    sources: ["https://www.biospace.com/drug-development/opinion-new-treatments-for-celiac-disease-gain-traction"],
  },
  {
    id: "larazotide",
    name: "Larazotide acetate",
    mechanism: "Zonulin / tight-junction regulator",
    stage: "discontinued",
    status: "FAILED its Phase 3 trial and was DISCONTINUED.",
    note: "Included honestly as a cautionary tale — despite years of hope it did not work in the pivotal trial. It is not a live option.",
    recruiting: false,
    sources: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC11970589/"],
  },
  {
    id: "nexvax2",
    name: "Nexvax2 (ImmusanT)",
    mechanism: 'Peptide-based "vaccine" / immune tolerance',
    stage: "discontinued",
    status: "DISCONTINUED in June 2019 after a Phase 2 trial found it no better than placebo.",
    note: "History, not pipeline. Shown so the record is honest about what has already failed.",
    recruiting: false,
    sources: [
      "https://www.coeliac.org.uk/about-us/media-centre/news/trials-for-coeliac-disease-vaccine-discontinued/",
      "https://www.globenewswire.com/news-release/2019/06/25/1874108/0/en/ImmusanT-Discontinues-Phase-2-Clinical-Trial-for-Nexvax2-in-Patients-With-Celiac-Disease.html",
    ],
  },
  {
    id: "glutenase-supplements",
    name: 'Enzyme "glutenase" supplements (latiglutenase, AN-PEP, and OTC products)',
    mechanism: "Enzymes marketed to degrade ingested gluten",
    stage: "supplement",
    status: "Adjuncts / over-the-counter supplements with mixed, limited evidence.",
    note: "NOT cures and NOT a substitute for the gluten-free diet. Evidence that they protect coeliac patients from gluten damage is weak — never rely on one to eat gluten safely.",
    recruiting: false,
    sources: ["https://www.mdpi.com/2072-6643/17/18/2960"],
  },
]);

/** The therapies whose trials are recruiting now → tie to the live CT.gov query (§4.4). */
export function recruitingTherapies(): readonly Therapy[] {
  return THERAPIES.filter((t) => t.recruiting && t.ctgovTerm);
}

// ---- openFDA named-product LABEL LOOKUP (§4.4) — NOT a pipeline source ------

const OPENFDA_LABEL = "https://api.fda.gov/drug/label.json";
const GENERIC_NAME_RE = /^[a-z0-9][a-z0-9 -]{0,63}$/i;

/** The result of a named-product openFDA label lookup. */
export interface OpenFdaLabelResult {
  /** True only when openFDA returned a label for the exact generic name. */
  readonly found: boolean;
  readonly genericName: string;
  /** The label's brand/generic display name, if found. */
  readonly labelName?: string;
}

/**
 * Build an openFDA drug-label lookup URL for a named generic drug. The name is
 * validated (alnum/space/dash) so it cannot alter the query path. This is a
 * LABEL LOOKUP only — a 404 for an investigational drug is expected and does NOT
 * prove "nothing is approved" (that claim is the guideline/review-sourced header).
 */
export function buildOpenFdaLabelUrl(genericName: string): string {
  if (!GENERIC_NAME_RE.test(genericName)) throw new Error(`invalid generic name: ${genericName}`);
  const params = new URLSearchParams({
    search: `openfda.generic_name:"${genericName}"`,
    limit: "1",
  });
  return `${OPENFDA_LABEL}?${params.toString()}`;
}

/** Parse an openFDA label response into a found/not-found result. */
export function parseOpenFdaLabel(genericName: string, body: unknown): OpenFdaLabelResult {
  const o = (body ?? {}) as Record<string, unknown>;
  const results = Array.isArray(o.results) ? (o.results as unknown[]) : [];
  const first = (results[0] ?? undefined) as Record<string, unknown> | undefined;
  const openfda = (first?.openfda ?? {}) as Record<string, unknown>;
  const names = Array.isArray(openfda.brand_name)
    ? (openfda.brand_name as unknown[])
    : Array.isArray(openfda.generic_name)
      ? (openfda.generic_name as unknown[])
      : [];
  const labelName = names.find((n): n is string => typeof n === "string");
  return { found: results.length > 0, genericName, labelName };
}

/**
 * Look up an FDA label for a named generic drug. A 404 (no label — the common,
 * EXPECTED case for investigational coeliac drugs) resolves to `found:false`,
 * never an error, so the caller can render the honest "no approved label" note.
 */
export async function lookupDrugLabel(
  knowledgeFetchFn: typeof globalThis.fetch,
  genericName: string,
): Promise<OpenFdaLabelResult> {
  try {
    const body = await knowledgeJson(knowledgeFetchFn, buildOpenFdaLabelUrl(genericName));
    return parseOpenFdaLabel(genericName, body);
  } catch {
    // 404 / network / non-JSON → treated as "no approved label" (expected).
    return { found: false, genericName };
  }
}
