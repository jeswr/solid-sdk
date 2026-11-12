// AUTHORED-BY Codex GPT-6.1-Sol
import type { Search } from "../search/types.js";
import { type ChipRef, chipIri, chipKind } from "./core.js";

export * from "./adapters.js";
export * from "./core.js";
export * from "./mentions.js";
export { resolveChip } from "./resolve.js";

/** Contacts can include the user's known WebIDs; search remains the sole resource resolver. */
export async function chipCandidates(
  query: string,
  options: {
    search: Search;
    contacts: readonly ChipRef[];
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<ChipRef[]> {
  const limit = options.limit ?? 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("Invalid chip limit");
  const needle = query.trim().toLowerCase();
  const page = await options.search(
    { text: query.trim(), limit: Math.max(50, limit) },
    { signal: options.signal },
  );
  options.signal?.throwIfAborted();
  const all = [
    ...options.contacts,
    ...page.results.map(
      (result): ChipRef => ({
        iri: result.url,
        label: result.title,
        kind: chipKind(result.type),
      }),
    ),
  ];
  const unique = new Map<string, ChipRef>();
  for (const ref of all) {
    if (!chipIri(ref.iri) || unique.has(ref.iri)) continue;
    if (needle && !`${ref.label} ${ref.iri}`.toLowerCase().includes(needle)) continue;
    unique.set(ref.iri, ref);
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        Number(!a.label.toLowerCase().startsWith(needle)) -
          Number(!b.label.toLowerCase().startsWith(needle)) ||
        a.label.localeCompare(b.label) ||
        a.iri.localeCompare(b.iri),
    )
    .slice(0, limit);
}
