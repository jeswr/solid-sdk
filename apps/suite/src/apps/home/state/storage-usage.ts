// AUTHORED-BY Claude Opus 5.5
import { NS } from "@jeswr/suite-vocab";
import { DiscoveryBudget, type DiscoveryLimits } from "../lib/model/discovery-budget";
import { inStorage, subjectOf } from "../lib/model/rdf";

const POSIX_SIZE = "http://www.w3.org/ns/posix/stat#size";
const CONCURRENCY = 6;

/**
 * Total bytes stored, from a complete metadata accounting of the storage tree: every
 * container is listed and every non-container member reports a `posix:size`, including
 * files in nested folders. Anything less (an unreadable or truncated walk, a missing or
 * malformed size, a member outside storage) returns `undefined`, which Home shows as
 * "usage unavailable" rather than a partial total.
 */
export async function storageUsage(
  fetch: typeof globalThis.fetch,
  storage: string,
  limits: DiscoveryLimits = {},
): Promise<number | undefined> {
  const budget = new DiscoveryBudget(limits);
  const seen = new Set<string>([storage]);
  const sizes = new Map<string, number>();
  let level = [storage];
  try {
    while (level.length) {
      const next: string[] = [];
      for (let start = 0; start < level.length; start += CONCURRENCY) {
        const batch = level.slice(start, start + CONCURRENCY);
        const listings = await Promise.all(batch.map((url) => budget.read(fetch, url)));
        for (const [index, listing] of listings.entries()) {
          const url = batch[index] as string;
          if (!listing) return undefined;
          for (const child of subjectOf(listing.dataset, url).contains) {
            if (child === url || !inStorage(child, storage)) return undefined;
            const node = subjectOf(listing.dataset, child);
            if (
              child.endsWith("/") ||
              node.types.some(
                (type) => type === `${NS.LDP}Container` || type === `${NS.LDP}BasicContainer`,
              )
            ) {
              if (!seen.has(child)) next.push(child);
              seen.add(child);
              continue;
            }
            const lexical = node.texts(POSIX_SIZE)[0];
            if (lexical === undefined || !/^\d+$/.test(lexical)) return undefined;
            const size = Number(lexical);
            if (!Number.isSafeInteger(size)) return undefined;
            sizes.set(child, size);
          }
        }
      }
      level = next;
    }
    return [...sizes.values()].reduce((sum, size) => sum + size, 0);
  } catch {
    return undefined;
  }
}
