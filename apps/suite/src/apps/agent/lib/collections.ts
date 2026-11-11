// AUTHORED-BY Codex GPT-6.1-Sol
import type { Row } from "./client";

export const MEMBER_LIMIT = 500;
export const TRUST_MEMBER_LIMIT = 5000;
export interface CollectionMetadata {
  readonly truncated: boolean;
  readonly total: number;
  readonly newest: boolean;
  readonly complete: boolean;
  readonly incompleteMessage?: string;
  /** `total` counts only what was listed; more members exist beyond a capped listing. */
  readonly totalIsLowerBound?: boolean;
}
export type Collection<T> = Row<T>[] & CollectionMetadata;

/** Preserve array callers while carrying collection metadata through queries. */
export function collection<T>(
  rows: Row<T>[],
  {
    truncated = false,
    total = rows.length,
    newest = false,
    complete = true,
    incompleteMessage,
    totalIsLowerBound = false,
  }: Partial<CollectionMetadata> = {},
): Collection<T> {
  for (const [name, value] of Object.entries({
    truncated,
    total,
    newest,
    complete,
    incompleteMessage,
    totalIsLowerBound,
  }))
    Object.defineProperty(rows, name, { value });
  return rows as Collection<T>;
}
/** The metadata carried by a collection, for re-wrapping a filtered or mapped copy. */
export function metadataOf(rows: readonly unknown[]): Partial<CollectionMetadata> {
  const metadata = rows as Partial<CollectionMetadata>;
  const names = [
    "truncated",
    "total",
    "newest",
    "complete",
    "incompleteMessage",
    "totalIsLowerBound",
  ] as const;
  return Object.fromEntries(
    names.filter((name) => metadata[name] !== undefined).map((name) => [name, metadata[name]]),
  ) as Partial<CollectionMetadata>;
}
export function isTruncated(rows: readonly unknown[]): boolean {
  return (rows as { truncated?: boolean }).truncated === true;
}
export function isComplete(rows: readonly unknown[]): boolean {
  return (rows as { complete?: boolean }).complete !== false;
}

/** Display-only sample. Names imply recency only when a reader supplies an ordering. */
export function selectMembers<T extends { url: string }>(
  members: T[],
  limit = MEMBER_LIMIT,
  compare?: (a: T, b: T) => number,
): { members: T[] } & CollectionMetadata {
  const count = Math.min(limit, MEMBER_LIMIT);
  const byName = (a: T, b: T) =>
    (b.url.replace(/\/$/, "").split("/").pop() as string).localeCompare(
      a.url.replace(/\/$/, "").split("/").pop() as string,
      "en",
      { numeric: true },
    ) || b.url.localeCompare(a.url);
  return {
    members: members.toSorted(compare ?? byName).slice(0, count),
    truncated: members.length > count,
    total: members.length,
    newest: compare !== undefined,
    complete: true,
  };
}

/** Trust decisions require the entire collection; never return a partial sample. */
export function selectTrustMembers<T>(members: T[]): { members: T[] } & CollectionMetadata {
  const complete = members.length <= TRUST_MEMBER_LIMIT;
  return {
    members: complete ? members : [],
    complete,
    total: members.length,
    truncated: false,
    newest: false,
  };
}

/** A fixed worker pool, with ordered results and no dependency on collection size. */
export async function mapBounded<T, U>(
  values: readonly T[],
  load: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(values.length);
  const work = values.entries();
  await Promise.all(
    Array.from({ length: Math.min(6, values.length) }, async () => {
      for (const [index, value] of work) results[index] = await load(value);
    }),
  );
  return results;
}
