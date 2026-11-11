// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, normalizePodBase, refuseRedirects } from "@jeswr/guarded-fetch";
import type { LocalIndex } from "@jeswr/rdf-engine";
import { buildSearchQuery, httpIri } from "./query.js";
import { jsonRows, searchPage } from "./results.js";
import type { Search, SearchClient, SearchConfig } from "./types.js";

function client(search: Search): SearchClient {
  return { search, recent: (q, options) => search({ ...q, orderBy: "modified" }, options) };
}

/** Query an existing, caller-owned index. Cancellation discards completed stale WASM work. */
export function createLocalSearch(index: LocalIndex): SearchClient {
  return client(async (q, options) => {
    options?.signal?.throwIfAborted();
    const rows = await index.select(buildSearchQuery(q));
    options?.signal?.throwIfAborted();
    return searchPage(
      "local",
      rows.map((row) =>
        Object.fromEntries(
          [...row].map(([variable, term]) => [
            variable.value,
            { type: term.termType === "NamedNode" ? "uri" : "literal", value: term.value },
          ]),
        ),
      ),
      q,
    );
  });
}

/** Prefer the advertised ACQ service; service failures propagate, preserving their meaning. */
export function createSearch({ capabilities, fetch, local }: SearchConfig): SearchClient {
  const root = normalizePodBase(capabilities.root);
  // Services may live beside the storage path, but must share its trusted origin.
  const origin = `${new URL(root).origin}/`;
  const send = refuseRedirects(fetch);
  return client(async (q, options) => {
    options?.signal?.throwIfAborted();
    const feature = capabilities.features.serverSearch;
    if (feature.state !== "available") return local.search(q, options);
    const endpoint = feature.detail.endpoint;
    if (!endpoint) throw new TypeError("Available serverSearch requires an endpoint");
    const target = assertWithinPodScope(origin, httpIri(endpoint));
    const response = await send(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: "application/sparql-results+json",
      },
      body: buildSearchQuery(q),
      signal: options?.signal,
    });
    if (!response.ok) throw new Error(`Search request failed (${response.status})`);
    const rows = jsonRows(await response.json());
    options?.signal?.throwIfAborted();
    return searchPage("server", rows, q);
  });
}
