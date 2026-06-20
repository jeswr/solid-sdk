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
export declare function normalizeContainer(container: string): string;
/**
 * Fail-closed assertion that `url` is `container` itself or a strict descendant of
 * it (same origin, path prefixed by the container path). Guards against any
 * encoding/normalisation trick producing a URL outside the pod sub-tree the store
 * owns.
 */
export declare function assertWithinBase(container: string, url: string): void;
/** True iff `url` is a container (LDP convention: a trailing slash on the path). */
export declare function isContainerUrl(url: string): boolean;
//# sourceMappingURL=scope.d.ts.map