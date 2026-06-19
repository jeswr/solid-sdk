import type { WatchCallback } from "unstorage";
/** The minimal WebSocket surface this module relies on (browser + ws compatible). */
export interface WatchSocket {
    addEventListener(type: "message", listener: (ev: {
        data: unknown;
    }) => void): void;
    addEventListener(type: "error", listener: (ev: unknown) => void): void;
    addEventListener(type: "close", listener: (ev: unknown) => void): void;
    close(): void;
}
/** Factory for a {@link WatchSocket} given a `wss://` URL. Injected for testing. */
export type WatchSocketFactory = (url: string) => WatchSocket;
/** Options for {@link startWatch}. */
export interface StartWatchOptions {
    /** The driver base container URL (already normalised; trailing slash). */
    readonly base: string;
    /** The (possibly authenticated) fetch. */
    readonly fetch: typeof globalThis.fetch;
    /** Callback fired per change. */
    readonly callback: WatchCallback;
    /**
     * Internal seam: build a WebSocket from a `wss://` URL. Defaults to the global
     * `WebSocket`. Tests inject a mock here.
     */
    readonly wsFactory?: WatchSocketFactory;
    /**
     * Internal seam: a logger for the graceful-degradation path. Defaults to a
     * no-op (so a pod without notifications stays quiet).
     */
    readonly onDegrade?: (reason: string) => void;
}
/** A started watch that can be disposed. */
export interface ActiveWatch {
    unwatch: () => void;
}
/**
 * Start watching `base` for changes. Resolves to an {@link ActiveWatch} whose
 * `unwatch` closes the socket. NEVER rejects — on any failure it degrades to a
 * no-op watch (logging via `onDegrade`).
 */
export declare function startWatch(options: StartWatchOptions): Promise<ActiveWatch>;
//# sourceMappingURL=watch.d.ts.map