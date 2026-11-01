// AUTHORED-BY Codex GPT-6
"use client";
import { useParams, usePathname } from "next/navigation";

type Params = Record<string, string | string[]>;

/** The target is baked in, so each render lifetime uses exactly one set of router hooks. */
export const useRouteParams: <T extends Params = Params>(pattern: string) => T | undefined =
  process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? useNativeRouteParams : useWebRouteParams;

function useWebRouteParams<T extends Params>(): T {
  return useParams<T>();
}

/** The export's router tree contains placeholders; only the pathname has the real values. */
function useNativeRouteParams<T extends Params>(pattern: string): T | undefined {
  const pathname = usePathname();
  if (!pathname) return undefined;
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
  return result as T;
}
