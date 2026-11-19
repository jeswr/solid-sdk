// AUTHORED-BY Claude Opus 5.5
/**
 * The sub-path the static export is served under (`next.config.ts` `basePath`), e.g.
 * `/solid-sdk/pod-manager` on GitHub Pages, or "" at a domain root. Next prefixes
 * `<Link>` and router paths itself; anything built from `location.origin` or baked into
 * the Client Identifier Document must add it explicitly.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
