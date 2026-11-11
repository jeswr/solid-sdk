// AUTHORED-BY Codex GPT-6.1-Sol
import type { Features } from "@jeswr/storage-capabilities";

/** Label search over resource graphs, optionally restricted by type and container. */
export interface SearchQuery {
  text?: string;
  types?: string[];
  within?: string[];
  orderBy?: "modified" | "relevance";
  limit?: number;
  cursor?: string;
}

/** One resource, with its containing URL container and optional RDF metadata. */
export interface SearchResult {
  url: string;
  title: string;
  type?: string;
  snippet?: string;
  modified?: Date;
  parent: string;
  contentType?: string;
}

/** A page and an opaque offset cursor; the source identifies its authority. */
export interface SearchPage {
  source: "server" | "local";
  results: SearchResult[];
  next?: string;
}

/** Cancellation applies to transport and to delivery of local query results. */
export interface SearchOptions {
  signal?: AbortSignal;
}

/** Stable callable accepted by useSearch; pass client.search directly. */
export type Search = (query: SearchQuery, options?: SearchOptions) => Promise<SearchPage>;

/** Shared surface for server selection and a standalone local search. */
export interface SearchClient {
  search: Search;
  recent(
    query?: Pick<SearchQuery, "within" | "limit">,
    options?: SearchOptions,
  ): Promise<SearchPage>;
}

/** Pass a StorageClient here, or its public root and features fields. */
export interface SearchCapabilities {
  root: string;
  features: Pick<Features, "serverSearch">;
}

/** Caller owns the authenticated fetch and the identity-scoped local index. */
export interface SearchConfig {
  capabilities: SearchCapabilities;
  fetch: typeof globalThis.fetch;
  local: Pick<SearchClient, "search">;
}
