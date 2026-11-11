// AUTHORED-BY Codex GPT-6
/** Retain the buffered readers' existing limits; ResolutionBudget supplies its tighter caps. */
export const BUFFERED_RDF_LIMITS = {
  maxBytes: Number.MAX_SAFE_INTEGER,
  maxQuads: Number.MAX_SAFE_INTEGER,
  maxTermLength: Number.MAX_SAFE_INTEGER,
  maxTotalTermLength: Number.MAX_SAFE_INTEGER,
} as const;
