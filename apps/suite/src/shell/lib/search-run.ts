// AUTHORED-BY Claude Opus 5.5
import type { AppSlug } from "@jeswr/suite-ui";
import type { SearchResult, SearchSource } from "./search-results";

export type SearchOutcome =
  | { kind: "results"; results: readonly SearchResult[] }
  | { kind: "error" };

/**
 * Runs one search and reports its outcome only while `signal` is live. A slow request
 * that was superseded (and so aborted) must never overwrite a newer one's results,
 * whether it resolves or rejects after the abort.
 */
export async function runSearch(
  source: SearchSource,
  query: string,
  options: { scope?: AppSlug; signal: AbortSignal },
  report: (outcome: SearchOutcome) => void,
): Promise<void> {
  let outcome: SearchOutcome;
  try {
    const { results } = await source.search(query, options);
    outcome = { kind: "results", results };
  } catch {
    outcome = { kind: "error" };
  }
  if (!options.signal.aborted) report(outcome);
}
