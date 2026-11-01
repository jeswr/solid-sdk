// AUTHORED-BY Codex GPT-6.1-Sol
import type { Row } from "./client";

export const MEMBER_LIMIT = 500;
export type Collection<T> = Row<T>[] & { readonly truncated: boolean };

/** Preserve array callers while carrying collection metadata through queries. */
export function collection<T>(rows: Row<T>[], truncated = false): Collection<T> {
  return Object.defineProperty(rows, "truncated", { value: truncated }) as Collection<T>;
}
export function isTruncated(rows: readonly unknown[]): boolean {
  return (rows as { truncated?: boolean }).truncated === true;
}

/** Listings have no date metadata; select by resource name before any member GETs. */
export function selectMembers<T extends { url: string }>(
  members: T[],
  limit = MEMBER_LIMIT,
  compare = (a: T, b: T) =>
    (b.url.replace(/\/$/, "").split("/").pop() as string).localeCompare(
      a.url.replace(/\/$/, "").split("/").pop() as string,
      "en",
      { numeric: true },
    ) || b.url.localeCompare(a.url),
): { members: T[]; truncated: boolean } {
  const count = Math.min(limit, MEMBER_LIMIT);
  return {
    members: members.sort(compare).slice(0, count),
    truncated: members.length > count,
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
