/**
 * Normalise a base container URL to exactly one trailing slash. Throws if the
 * base is not an absolute http(s) URL.
 */
export declare function normalizeBase(base: string): string;
/**
 * Map an unstorage key to the absolute LDP resource URL under `base`.
 * `base` must already be normalised (see {@link normalizeBase}).
 *
 * @throws if the key contains a traversal / empty / malformed segment, or if the
 *   resolved URL would escape `base` (defence in depth).
 */
export declare function keyToUrl(base: string, key: string): string;
/**
 * Map an unstorage key to the absolute LDP CONTAINER URL under `base` (trailing
 * slash). Used by getKeys/clear when a key denotes a sub-container.
 */
export declare function keyToContainerUrl(base: string, key: string): string;
/**
 * Fail-closed assertion that `url` is `base` itself or a strict descendant of it
 * (same origin, path prefixed by base path). Guards against any
 * encoding/normalisation trick producing a URL outside the pod sub-tree we own.
 */
export declare function assertWithinBase(base: string, url: string): void;
/**
 * Map a member URL (absolute, as discovered in a container listing) back to an
 * unstorage key, relative to `base`. Returns `undefined` if the member is `base`
 * itself or does not lie under `base` (defence in depth — a hostile/buggy server
 * cannot inject a foreign URL into the key space).
 *
 * The returned key is `:`-delimited with each path segment decoded, so it
 * round-trips exactly through {@link keyToUrl}. A trailing slash (container
 * member) is stripped before mapping — callers track container-ness separately.
 */
export declare function urlToKey(base: string, memberUrl: string): string | undefined;
/** True iff `memberUrl` is a container (LDP convention: a trailing slash). */
export declare function isContainerUrl(memberUrl: string): boolean;
//# sourceMappingURL=keys.d.ts.map