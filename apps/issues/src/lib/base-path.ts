// AUTHORED-BY Claude Opus 5.5
/**
 * The sub-path a static export is served under (`next.config.ts` `basePath`), e.g.
 * `/solid-sdk/issues` on GitHub Pages, or "" at a domain root. Next prefixes `<Link>`
 * and router paths itself; URLs built from `location` or baked into the Client
 * Identifier Document must add it explicitly.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** An absolute app path (starting with "/") under the base path. */
export function appPath(path: string): string {
  return `${BASE_PATH}${path}`;
}
