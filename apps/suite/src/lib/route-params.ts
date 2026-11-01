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
  const parts = pathname.split("/").filter(Boolean);
  const segments = pattern.split("/").filter(Boolean);
  const result: Params = {};
  let index = 0;
  try {
    for (const segment of segments) {
      const catchAll = /^\[\[?\.\.\.(.+?)\]\]?$/.exec(segment);
      if (catchAll) {
        const values = parts.slice(index).map(decodeURIComponent);
        if ((!values.length && !segment.startsWith("[[")) || values.includes("__")) return;
        result[catchAll[1] as string] = values;
        index = parts.length;
      } else if (segment.startsWith("[")) {
        const value = parts[index++];
        if (!value || value === "__") return;
        const decoded = decodeURIComponent(value);
        if (decoded === "__") return;
        result[segment.slice(1, -1)] = decoded;
      } else if (parts[index++] !== segment) return;
    }
  } catch {
    return undefined;
  }
  if (index !== parts.length) return undefined;
  return result as T;
}
