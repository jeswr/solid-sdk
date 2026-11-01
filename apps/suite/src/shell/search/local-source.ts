// AUTHORED-BY Codex GPT-6.1-Sol
import { SearchIndex } from "../../lib/search";
import type { SearchResult, SearchSource } from "../lib/search-results";

export type LocalSearchItem = SearchResult & { body?: string };
/** One source/index per account. Populate from opened or synced items; discard on account switch. */
export function createLocalSearchSource(items: readonly LocalSearchItem[]): SearchSource {
  const index = new SearchIndex();
  const metadata = new Map<string, SearchResult>();
  for (const { body = "", ...result } of items) {
    index.add({ id: result.id, title: result.title, body });
    metadata.set(result.id, result);
  }
  return {
    async search(query, { scope, signal }) {
      signal.throwIfAborted();
      const results = index
        .search(query)
        .map((hit) => ({ ...(metadata.get(hit.document.id) as SearchResult) }))
        .filter((result) => !scope || result.app === scope);
      return { results, source: "local", serverSearch: false };
    },
  };
}
