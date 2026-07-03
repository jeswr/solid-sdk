/**
 * `@jeswr/unstorage-solid` — an {@link https://unstorage.unjs.io | unstorage}
 * `defineDriver()` driver that backs unstorage's KV API with a
 * {@link https://solidproject.org | Solid} pod over LDP.
 *
 * unstorage keys map to LDP resource paths under a fixed `base` container; stored
 * VALUES are opaque KV blobs (text / JSON / binary) and are never RDF-parsed. The
 * ONLY RDF the driver touches is the container listing used by `getKeys` /
 * `clear`, parsed via `@jeswr/fetch-rdf` + `@solid/object` (never hand-built).
 *
 * Authentication is injected: pass a (DPoP-bound) authenticated `fetch` — e.g. a
 * browser Solid session's `fetch`, or a Node client-credentials fetch from
 * `@jeswr/solid-dpop`. With no `fetch` the global `fetch` is used (only public
 * resources will work).
 *
 * @packageDocumentation
 */
import type { Driver } from "unstorage";
import { type WatchSocketFactory } from "./watch.js";
/** Configuration for the Solid unstorage driver. */
export interface SolidDriverOptions {
    /**
     * Base container URL the driver reads/writes under, e.g.
     * `https://alice.pod.example/unstorage/`. Normalised to exactly one trailing
     * slash. Keys are mapped to LDP resource paths beneath this container and can
     * never escape it (see the key-mapping rules in the README).
     */
    base: string;
    /**
     * The `fetch` implementation. Pass an authenticated Solid `fetch` for protected
     * pods. Defaults to the global `fetch`.
     */
    fetch?: typeof globalThis.fetch;
    /**
     * Extra request headers merged into every request (e.g. a custom auth header).
     * Per-transaction `opts.headers` override these.
     */
    headers?: Record<string, string>;
    /**
     * Content-Type used for `setItem` (string values) when no per-call content-type
     * is given. Defaults to `text/plain; charset=utf-8`.
     */
    defaultContentType?: string;
    /**
     * Enable live `watch()` via Solid Notifications (WebSocketChannel2023). When
     * `false` (default), `watch()` is a graceful no-op. Watch always degrades
     * gracefully when the pod advertises no notification channel.
     */
    watch?: boolean;
    /**
     * Internal/testing seam: build a WebSocket from a `wss://` URL. Defaults to the
     * global `WebSocket`. Not part of the stable public contract.
     * @internal
     */
    wsFactory?: WatchSocketFactory;
    /**
     * Internal/testing seam: a logger invoked when `watch()` degrades. Defaults to
     * a no-op.
     * @internal
     */
    onWatchDegrade?: (reason: string) => void;
}
/** A precondition-failed (HTTP 412 / optimistic-concurrency) error. */
export declare class SolidPreconditionFailedError extends Error {
    readonly url: string;
    readonly status: number;
    constructor(url: string, status: number);
}
/** A non-success HTTP response the driver could not interpret as success/absence. */
export declare class SolidHttpError extends Error {
    readonly url: string;
    readonly status: number;
    constructor(method: string, url: string, status: number, statusText: string);
}
/**
 * The Solid unstorage driver. Mount it with unstorage's `createStorage`:
 *
 * ```ts
 * import { createStorage } from "unstorage";
 * import solidDriver from "@jeswr/unstorage-solid";
 * const storage = createStorage({
 *   driver: solidDriver({ base: "https://alice.pod.example/kv/", fetch: session.fetch }),
 * });
 * ```
 */
declare const solidDriver: (opts: SolidDriverOptions) => Driver<SolidDriverOptions, undefined>;
/**
 * Thrown when the driver refuses to follow a redirect on a pod request (the
 * credential-leak / SSRF guard — see the Security section of the README).
 */
export { SolidRedirectError } from "./scope.js";
/**
 * Internal testing seam types, re-exported so the `wsFactory` field on
 * {@link SolidDriverOptions} is resolvable in the public `.d.ts`. Not part of the
 * stable public contract.
 * @internal
 */
export type { WatchSocket, WatchSocketFactory } from "./watch.js";
export type { SolidDriverOptions as Options };
export default solidDriver;
//# sourceMappingURL=index.d.ts.map