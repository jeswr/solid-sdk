// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The curated, CITED clinical-guideline catalog (§3.1 / §3.4.3). These are
 * documents, not APIs — so they are a small, human-maintained, dated constant
 * (never scraped, never fetched live), each with its authoritative source URL.
 * They are the authoritative anchor shown at the top of the Research view.
 *
 * Every entry cites a primary/authoritative source per the design's §1.2 facts.
 * A `year`/`asOf` per entry means a refresh (e.g. when BSG 2025 lands, §9) is a
 * one-line human edit.
 */
export interface Guideline {
  readonly id: string;
  readonly title: string;
  readonly org: string;
  /** The publication / effective year of the cited guidance. */
  readonly year: number;
  readonly url: string;
  /** A one-line, source-grounded summary — never a new medical assertion. */
  readonly summary: string;
}

/**
 * The catalog. Ordered by clinical authority for the coeliac diagnostic pathway.
 * The consistent clinical message across all: diagnosis needs serology + a
 * duodenal biopsy WHILE STILL EATING GLUTEN; HLA-DQ2/DQ8 testing only EXCLUDES.
 */
export const GUIDELINES: readonly Guideline[] = Object.freeze([
  {
    id: "nice-ng20",
    title: "Coeliac disease: recognition, assessment and management (NG20)",
    org: "NICE",
    year: 2015,
    url: "https://www.nice.org.uk/guidance/ng20",
    summary:
      "Diagnosis needs serology then a duodenal biopsy while the person is still eating gluten. HLA-DQ2/DQ8 testing is a specialist tool used to EXCLUDE coeliac disease, not to confirm it.",
  },
  {
    id: "acg-2023",
    title: "ACG Clinical Guidelines: Diagnosis and Management of Celiac Disease",
    org: "American College of Gastroenterology",
    year: 2023,
    url: "https://journals.lww.com/ajg/fulltext/2023/01000/american_college_of_gastroenterology_guidelines.17.aspx",
    summary:
      "Serology plus biopsy on a gluten-containing diet. A no-biopsy path is allowed only in adults with tTG-IgA over 10× the upper limit of normal plus a second positive endomysial antibody test.",
  },
  {
    id: "bsg-2014",
    title: "Diagnosis and management of adult coeliac disease (BSG guideline)",
    org: "British Society of Gastroenterology",
    year: 2014,
    url: "https://www.bsg.org.uk/clinical-resource/diagnosis-management-adult-coeliac-disease",
    summary:
      "Serology and duodenal biopsy on a gluten-containing diet remain the basis of diagnosis. (Under 2025 review — check for an updated version.)",
  },
  {
    id: "coeliac-uk",
    title: "Coeliac UK — the national coeliac charity",
    org: "Coeliac UK",
    year: 2025,
    url: "https://www.coeliac.org.uk/information-and-support/coeliac-disease/getting-diagnosed/",
    summary:
      "Patient-facing guidance: keep eating gluten until testing is complete, and never start a gluten-free diet before you have been tested and diagnosed.",
  },
]);

/** The single most important safety message the guidelines agree on. */
export const DIAGNOSIS_KEY_MESSAGE =
  "A coeliac diagnosis needs blood tests and a biopsy while you are still eating gluten. Do not start a gluten-free diet before testing — it can hide the disease and make diagnosis harder.";
