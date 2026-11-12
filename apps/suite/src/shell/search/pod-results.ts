// AUTHORED-BY Codex GPT-6.1-Sol
import type { SearchResult as SdkResult, SearchPage } from "@jeswr/suite-sdk/search";
import { resolveSuiteResource } from "@jeswr/suite-sdk/shared";
import type { AppSlug } from "@jeswr/suite-ui";
import { encodeContactRef } from "../../apps/contacts/state/data";
import { encodeRef } from "../../lib/refs";
import type { SearchResponse, SearchResult } from "../lib/search-results";

/** RDF subjects retain their identity; document editors receive the containing document. */
export function podSearchResult(result: SdkResult): SearchResult {
  const { app, group, href } = resolveSuiteResource(
    {
      url: result.url,
      parent: result.parent,
      ...(result.type ? { rdfTypes: [result.type] } : {}),
      ...(result.contentType ? { contentType: result.contentType } : {}),
    },
    // Only RDF types choose the app: untyped files keep Drive scope and containers stay folders.
    { encodeRef, encodeContactRef, hints: false },
  );
  return {
    id: result.url,
    title: result.title,
    href,
    type: group,
    app,
    parent: result.parent,
    ...(result.modified ? { modified: result.modified } : {}),
  };
}

export function podSearchResponse(page: SearchPage, scope?: AppSlug): SearchResponse {
  return {
    results: page.results.map(podSearchResult).filter((result) => !scope || result.app === scope),
    source: page.source,
    serverSearch: page.source === "server",
  };
}
