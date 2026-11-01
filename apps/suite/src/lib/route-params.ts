// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { useParams, usePathname } from "next/navigation";

type Params = Record<string, string | string[]>;

/** The target is baked in, so each render lifetime uses exactly one set of router hooks. */
export const useRouteParams: <T extends Params = Params>(pattern: string) => T | undefined =
  process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? useNativeRouteParams : useWebRouteParams;

function useWebRouteParams<T extends Params>(): T {
  return useParams<T>();
}

/**
 * The current pathname without a trailing slash. The native export uses `trailingSlash: true`,
 * so `/photos/a/REF/` there is `/photos/a/REF` on the web; compare routes through this.
 */
export function useRoutePathname(): string {
  return normalizePathname(usePathname() ?? "/");
}

/** Strip one trailing slash, keeping the root as `/`. */
export function normalizePathname(pathname: string): string {
  return pathname.replace(/(.)\/$/, "$1");
}

/** The export's router tree contains placeholders; only the pathname has the real values. */
function useNativeRouteParams<T extends Params>(pattern: string): T | undefined {
  const pathname = usePathname();
  return pathname ? (matchRouteParams(pattern, pathname) as T | undefined) : undefined;
}

/**
 * Match a raw (still percent-encoded) pathname against a route pattern, decoding each segment
 * exactly once. Must agree with scripts/route-resolver.mjs on the shared vectors.
 */
export function matchRouteParams(pattern: string, pathname: string): Params | undefined {
  const segments = pattern.split("/").filter(Boolean);
  const result: Params = {};
  let index = 0;
  try {
    if (
      !pathname.startsWith("/") ||
      new TextEncoder().encode(pathname).length > 2048 ||
      /[\\\0?#]/.test(pathname)
    )
      return;
    const raw = pathname.split("/").slice(1);
    if (raw.at(-1) === "") raw.pop();
    const parts = raw.map(decodeURIComponent);
    if (parts.some((part) => !part || part === "." || part === ".." || /[\\/\0]/.test(part)))
      return;
    for (const segment of segments) {
      const catchAll = /^\[\[?\.\.\.(.+?)\]\]?$/.exec(segment);
      if (catchAll) {
        const values = parts.slice(index);
        if ((!values.length && !segment.startsWith("[[")) || values.includes("__")) return;
        result[catchAll[1] as string] = values;
        index = parts.length;
      } else if (segment.startsWith("[")) {
        const value = parts[index++];
        if (!value || value === "__") return;
        result[segment.slice(1, -1)] = value;
      } else if (parts[index++] !== segment) return;
    }
    if (index !== parts.length) return undefined;
  } catch {
    return undefined;
  }
  return result;
}
