// AUTHORED-BY Codex GPT-6
import type { PhotoStorage } from "../model";

export interface Failure {
  url: string;
  error: unknown;
}
export interface Listed<T> {
  items: T[];
  failures: Failure[];
}
export function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : undefined;
}
export function requireEtag(etag: string | null): string {
  if (!etag || etag.startsWith("W/"))
    throw new TypeError("A strong ETag is required to save changes");
  return etag;
}
/** Missing collections are empty. Permission and transport failures remain errors. */
export async function children(
  io: Pick<PhotoStorage, "root" | "list">,
  path: string,
): Promise<string[]> {
  const container = new URL(path, io.root);
  let urls: string[];
  try {
    urls = await io.list(container.href);
  } catch (error) {
    if (statusOf(error) === 404) return [];
    throw error;
  }
  return urls.filter((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === container.origin &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname.startsWith(container.pathname) &&
        url.pathname.length > container.pathname.length &&
        !url.pathname.endsWith("/")
      );
    } catch {
      return false;
    }
  });
}
/** Six concurrent reads, stable result order, isolated document failures. */
export async function collect<T>(
  urls: readonly string[],
  load: (url: string) => Promise<T[]>,
): Promise<Listed<T>> {
  const results: T[][] = new Array(urls.length);
  const failures: Failure[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, urls.length) }, async () => {
      while (cursor < urls.length) {
        const index = cursor++;
        const url = urls[index] as string;
        try {
          results[index] = await load(url);
        } catch (error) {
          failures.push({ url, error });
          results[index] = [];
        }
      }
    }),
  );
  return { items: results.flat(), failures };
}
