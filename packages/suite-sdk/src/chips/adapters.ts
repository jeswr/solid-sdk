// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import type { ChipRef } from "./core.js";
import { chipCandidates } from "./index.js";

export interface ChipPeopleOptions {
  fetch: typeof fetch;
  webId: string;
  displayName: string;
  contacts: () => Promise<ChipRef[]>;
}
/** Cache belongs to this loader's session; applications supply their contact model adapter. */
export function createChipPeople(options: ChipPeopleOptions): () => Promise<ChipRef[]> {
  let cached: { expires: number; value: Promise<ChipRef[]> } | undefined;
  return () => {
    if (!cached || cached.expires <= Date.now()) {
      const value = (async () => {
        const people: ChipRef[] = [
          { iri: options.webId, label: options.displayName, kind: "person" },
        ];
        await Promise.allSettled([
          options.contacts().then((contacts) => {
            people.push(...contacts);
          }),
          (async () => {
            const { dataset } = await fetchRdf(options.webId, {
              fetch: options.fetch,
              maxBytes: 256 * 1024,
            });
            const subject = new TermWrapper(options.webId, dataset, DataFactory);
            for (const term of SetFrom.subjectPredicate(
              subject,
              "http://xmlns.com/foaf/0.1/knows",
              NamedNodeAs.string,
              NamedNodeFrom.string,
            ))
              people.push({ iri: term, label: term, kind: "person" });
          })(),
        ]);
        return people;
      })();
      cached = { expires: Date.now() + 30_000, value };
    }
    return cached.value;
  };
}

export interface ChipSearchSource {
  search(
    query: string,
    options: { signal: AbortSignal },
  ): Promise<{
    source: "local" | "server";
    results: readonly { id: string; title: string; parent?: string; app?: string; type: string }[];
  }>;
}
/** Adapt a shell search source without creating a second search index. */
export function createChipSearch(
  source?: ChipSearchSource | null,
  people?: () => Promise<ChipRef[]>,
) {
  return async (query: string, signal: AbortSignal): Promise<ChipRef[]> =>
    chipCandidates(query, {
      search: async () => {
        if (!source) return { source: "local", results: [] };
        const page = await source.search(query.trim(), { signal });
        return {
          source: page.source,
          results: page.results.map((item) => ({
            url: item.id,
            title: item.title,
            parent: item.parent ?? "",
            type:
              (
                {
                  calendar: "event",
                  notes: "note",
                  sheets: "sheet",
                  docs: "doc",
                  tasks: "task",
                  contacts: "person",
                } as Record<string, string>
              )[item.app ?? ""] ?? item.type,
          })),
        };
      },
      contacts: people ? await people() : [],
      signal,
    });
}
