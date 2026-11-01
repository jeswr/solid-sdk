// AUTHORED-BY Codex GPT-6.1-Sol
import type { AppSlug } from "@jeswr/suite-ui";

export interface SearchResult {
  id: string;
  title: string;
  type: "file" | "document" | "task" | "person" | "data";
  href: string;
  parent?: string;
  modified?: Date;
  app: AppSlug;
  /** Optional ownership metadata; unknown ownership is excluded by the Me filter. */
  owner?: string;
}
export interface SearchResponse {
  results: SearchResult[];
  source: "server" | "local";
  serverSearch: boolean;
}
export interface SearchSource {
  search(query: string, options: { scope?: AppSlug; signal: AbortSignal }): Promise<SearchResponse>;
}
export const searchGroups = [
  ["file", "Files"],
  ["document", "Documents"],
  ["task", "Tasks"],
  ["person", "People"],
  ["data", "Data"],
] as const;
export const recentSearchesKey = "suite.recentSearches.v1";
export const searchHintKey = "suite.searchHint.v1";

/** Preserve the source's relevance order within each group, independent of request timing. */
export function groupSearchResults(results: readonly SearchResult[], cap = 5) {
  return searchGroups
    .map(([type, label]) => ({
      type,
      label,
      results: results.filter((result) => result.type === type).slice(0, Math.max(0, cap)),
    }))
    .filter((group) => group.results.length > 0);
}
export function updateRecentSearches(recent: readonly string[], query: string): string[] {
  const trimmed = query.trim();
  const all = trimmed ? [trimmed, ...recent] : recent;
  const seen = new Set<string>();
  return all
    .filter((item) => {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((item) => item.trim());
}
export function readRecentSearches(json: string | null): string[] {
  try {
    const value: unknown = JSON.parse(json ?? "null");
    return Array.isArray(value)
      ? updateRecentSearches(
          value.filter((item): item is string => typeof item === "string"),
          "",
        )
      : [];
  } catch {
    return [];
  }
}
