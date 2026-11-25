// AUTHORED-BY Claude Sonnet 5.5
import { isWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";

/** A caller predicate over the canonical URL, or container URLs the media must live under. */
export type MediaScope = ((url: string) => boolean) | readonly string[];

/** Whitespace, control characters, backslash, query and fragment: none belong in a media URL. */
const FORBIDDEN = /[\s\p{Cc}\\?#]/u;
/** Percent-encoded control characters, `.`, `/`, `\`, `?` and `#`: delimiters in disguise. */
const DISGUISED = /%(?:[01][0-9a-f]|7f|2e|2f|5c|3f|23)/i;
const MAX_URL_LENGTH = 2048;

/**
 * The canonical form of a media URL, or `undefined` when it is not an absolute http(s) URL with
 * no credentials, query, fragment, whitespace, control character, backslash or encoded delimiter.
 * Everything downstream (scope, cache key, request) uses this one string.
 */
export function canonicalMediaUrl(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_URL_LENGTH) {
    return undefined;
  }
  if (FORBIDDEN.test(input) || DISGUISED.test(input)) return undefined;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return url.href;
}

/** Build the scope test. Invalid container URLs are a programming error and throw at creation. */
export function scopeTest(scope: MediaScope): (canonicalUrl: string) => boolean {
  if (typeof scope === "function") {
    return (url) => {
      try {
        return scope(url) === true;
      } catch {
        return false;
      }
    };
  }
  const containers = scope.map((container) => {
    try {
      return normalizePodBase(container);
    } catch {
      // The guard's message can echo the container URL; ours is fixed.
      throw new TypeError("scope containers must be absolute http(s) container URLs");
    }
  });
  return (url) =>
    containers.some((container) => isWithinPodScope(container, url, { allowRoot: false }));
}
