// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Container-scope guard for `MemoryStore` (see `./store.ts`).
 *
 * The store's container is its primary SECURITY surface: every URL the store
 * issues an authenticated request to MUST lie under that container. This module
 * is the one reviewed home for normalising the container and asserting that a
 * target URL is `container` itself or a strict descendant of it — a defence-in-
 * depth check applied to every CRUD target and every listed member, so a hostile
 * / buggy server cannot make the store touch a foreign origin or escape the
 * container sub-tree. (Adapted from `@jeswr/unstorage-solid`'s `keys.ts`.)
 *
 * **Pure core, no platform.** Only the WHATWG `URL` global — no `node:*`, no RDF.
 */
/**
 * Normalise a container URL to exactly one trailing slash. Throws if it is not an
 * absolute http(s) URL. A container must not carry a query or fragment.
 */
export function normalizeContainer(container) {
    let url;
    try {
        url = new URL(container);
    }
    catch {
        throw new Error(`[solid-memory] \`container\` must be an absolute URL, got: ${container}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`[solid-memory] \`container\` must be an http(s) URL, got protocol: ${url.protocol}`);
    }
    // Collapse the path to a single trailing slash; preserve everything else.
    if (!url.pathname.endsWith("/")) {
        url.pathname = `${url.pathname}/`;
    }
    // A container is an address, not a query/fragment target.
    url.search = "";
    url.hash = "";
    return url.toString();
}
/**
 * Fail-closed assertion that `url` is `container` itself or a strict descendant of
 * it (same origin, path prefixed by the container path). Guards against any
 * encoding/normalisation trick producing a URL outside the pod sub-tree the store
 * owns.
 */
export function assertWithinBase(container, url) {
    const b = new URL(container);
    let u;
    try {
        u = new URL(url);
    }
    catch {
        throw new Error(`[solid-memory] target URL is invalid: ${url}`);
    }
    if (u.origin !== b.origin) {
        throw new Error(`[solid-memory] target URL ${url} escapes container origin ${b.origin} (refused)`);
    }
    if (!u.pathname.startsWith(b.pathname)) {
        throw new Error(`[solid-memory] target URL ${url} escapes container path ${b.pathname} (refused)`);
    }
}
/** True iff `url` is a container (LDP convention: a trailing slash on the path). */
export function isContainerUrl(url) {
    // Compare on the path so a query/fragment (which a container address never has)
    // cannot fool the check.
    try {
        return new URL(url).pathname.endsWith("/");
    }
    catch {
        return url.endsWith("/");
    }
}
//# sourceMappingURL=scope.js.map