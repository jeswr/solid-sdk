// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { notFound, useParams, usePathname } from "next/navigation";
import { useMemo } from "react";

type Params = Record<string, string | string[]>;

/** The target is baked in, so each render lifetime uses exactly one set of router hooks. */
export const useRouteParams: <T extends Params = Params>(pattern: string) => T | undefined =
  process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? useNativeRouteParams : useWebRouteParams;

/**
 * Params for a page that renders only on its own route. Undefined only while the native export
 * shows its placeholder page (prerendering `/x/__/`, or before the pathname is known); a real
 * path that does not match, such as a bad percent-encoding, is a 404 rather than a skeleton.
 */
export function usePageRouteParams<T extends Params = Params>(pattern: string): T | undefined {
  const params = useRouteParams<T>(pattern);
  const pathname = usePathname();
  if (params) return params;
  if (!pathname || pathname.split("/").includes("__")) return undefined;
  notFound();
}

/** Next's client `useParams()` keeps values percent-encoded; decode each one exactly once. */
function useWebRouteParams<T extends Params>(): T {
  const params = useParams<T>();
  return useMemo(() => decodeParams(params) as T, [params]);
}

/** Decode route values, keeping any value that is not valid percent-encoding as it arrived. */
export function decodeParams(params: Params): Params {
  const result: Params = {};
  for (const [key, value] of Object.entries(params))
    result[key] = Array.isArray(value) ? value.map(safeDecode) : safeDecode(value);
  return result;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
