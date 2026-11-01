// AUTHORED-BY Codex GPT-6.1-Sol
import type { AppSlug } from "@jeswr/suite-ui";
import type { SearchResult } from "./search-results";

export interface SearchFilters {
  type: SearchResult["type"] | "any";
  app: AppSlug | "any";
  modified: "any" | "7" | "30" | "year";
  owner: "anyone" | "me";
}
export const defaultSearchFilters: SearchFilters = {
  type: "any",
  app: "any",
  modified: "any",
  owner: "anyone",
};
export function filterSearchResults(
  results: readonly SearchResult[],
  filters: SearchFilters,
  { now = Date.now(), accountId }: { now?: number; accountId?: string } = {},
): SearchResult[] {
  const days = filters.modified === "year" ? 365 : Number(filters.modified);
  return results.filter(
    (result) =>
      (filters.type === "any" || result.type === filters.type) &&
      (filters.app === "any" || result.app === filters.app) &&
      (filters.modified === "any" ||
        (!!result.modified &&
          result.modified.getTime() >= now - days * 86400000 &&
          result.modified.getTime() <= now)) &&
      (filters.owner === "anyone" || (!!accountId && result.owner === accountId)),
  );
}
