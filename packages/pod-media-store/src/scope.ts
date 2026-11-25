// AUTHORED-BY Claude Sonnet 5.5
import { isWithinPodScope } from "@jeswr/guarded-fetch";

/** Absolute http(s) with no whitespace, control characters, backslash, query or fragment. */
const ABSOLUTE = /^https?:\/\/[^\s\p{Cc}\\?#]+$/iu;
/** Credentials in the authority. */
const CREDENTIALS = /^https?:\/\/[^/]*@/i;
/** Percent-encoded control characters, `.`, `/`, `\`, `?` and `#`: delimiters in disguise. */
const DISGUISED = /%(?:[01][0-9a-f]|7f|2e|2f|5c|3f|23)/i;

export const YEAR = /^\d{4}$/;
export const MONTH = /^(0[1-9]|1[0-2])$/;

/**
 * True only for a URL strictly inside the library container tree: same origin, real segment
 * boundary, no credentials, no query, no fragment, no encoded delimiters or control characters,
 * no dot or empty path segments (written out or normalised away), no auxiliary resource names
 * (a segment below the library that starts with a dot, such as `.acl`), and not the library
 * container itself. `libraryUrl` must be the container URL the store resolved.
 */
export function isInsideLibrary(libraryUrl: string, url: string): boolean {
  if (typeof url !== "string" || !ABSOLUTE.test(url) || CREDENTIALS.test(url)) return false;
  if (DISGUISED.test(url)) return false;
  const segments = url
    .replace(/^https?:\/\/[^/]*/i, "")
    .split("/")
    .slice(1);
  const last = segments.length - 1;
  if (
    segments.some(
      (segment, i) => segment === "." || segment === ".." || (segment === "" && i !== last),
    )
  ) {
    return false;
  }
  if (!isWithinPodScope(libraryUrl, url, { allowRoot: false })) return false;
  const below = segments
    .filter((segment) => segment !== "")
    .slice(new URL(libraryUrl).pathname.split("/").filter((segment) => segment !== "").length);
  return !below.some((segment) => segment.startsWith("."));
}

/** `yyyy/mm` for the UTC creation month; `undefined` outside 1970..9999 or for an invalid date. */
export function shardKeyOf(date: Date): string | undefined {
  const time = date.getTime();
  if (Number.isNaN(time)) return undefined;
  const year = date.getUTCFullYear();
  if (year < 1970 || year > 9999) return undefined;
  return `${String(year).padStart(4, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isShardKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [year, month, rest] = value.split("/");
  return rest === undefined && YEAR.test(year ?? "") && MONTH.test(month ?? "");
}

/** The last path segment, percent-decoded when valid. */
export function segmentOf(url: string): string {
  const segment = new URL(url).pathname.replace(/\/$/, "").split("/").pop() as string;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** True for exactly `<library>/<yyyy>/<mm>/` (path form, Solid). */
export function isShardUrl(libraryUrl: string, url: string): boolean {
  if (!isInsideLibrary(libraryUrl, url) || !url.endsWith("/")) return false;
  const rest = new URL(url).pathname.slice(new URL(libraryUrl).pathname.length).split("/");
  return (
    rest.length === 3 && YEAR.test(rest[0] ?? "") && MONTH.test(rest[1] ?? "") && rest[2] === ""
  );
}

/**
 * Split a URL into its shard container and resource name when it is a direct child of a
 * `<library>/<yyyy>/<mm>/` shard; `undefined` for anything else.
 */
export function shardChildOf(
  libraryUrl: string,
  url: string,
): { shardUrl: string; name: string } | undefined {
  if (!isInsideLibrary(libraryUrl, url)) return undefined;
  const parsed = new URL(url);
  const library = new URL(libraryUrl);
  const parts = parsed.pathname.slice(library.pathname.length).split("/");
  const [year, month, name, extra] = parts;
  if (
    extra !== undefined ||
    !YEAR.test(year ?? "") ||
    !MONTH.test(month ?? "") ||
    name === undefined ||
    name === ""
  ) {
    return undefined;
  }
  return { shardUrl: `${library.origin}${library.pathname}${year}/${month}/`, name };
}
