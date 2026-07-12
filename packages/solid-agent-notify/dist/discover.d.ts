import { type Store } from "n3";
import { type GuardedFetchOptions, type GuardedFetchResult } from "./security/guardedFetch.js";
/** Options shared by the discover / send / read helpers. */
export interface NotifyOptions {
    /**
     * TEST/DEV ONLY: permit loopback targets + loopback http. NEVER set in
     * production (it disables the loopback SSRF guard so a fixture server on
     * 127.0.0.1 is reachable).
     */
    allowLoopback?: boolean;
    /** Inject a DNS lookup (tests — e.g. the rebinding stub). */
    dnsLookup?: (host: string) => Promise<{
        address: string;
        family: number;
    }[]>;
    /** Total timeout (ms) for the underlying guarded fetch. */
    timeoutMs?: number;
    /** Override the guarded-fetch impl, TESTS ONLY — production must use the real chokepoint. */
    fetchImpl?: (url: string, opts?: GuardedFetchOptions) => Promise<GuardedFetchResult>;
    /**
     * ADVANCED (send-only): augment the notification dataset before it is serialised
     * to Turtle and POSTed — e.g. embed a shared `wf:Task` body alongside the
     * `as:Announce` (see `task.ts` / `notifyTaskAssigned`). Receives the n3 `Store`
     * holding the just-built activity; mutate it via TYPED accessors (never
     * hand-built quads). May be `async` — the send path `await`s it, so its mutations
     * are guaranteed complete BEFORE serialise + POST. Ignored by `discoverInbox` /
     * `readInbox` (no body there).
     */
    extend?: (store: Store) => void | Promise<void>;
}
/** Strip the fragment from a WebID to get its profile DOCUMENT URL (the RDF base). */
export declare function profileDocUrl(webId: string): string;
/**
 * Discover the recipient's LDN inbox.
 *
 * @returns the absolute `ldp:inbox` URI, or `undefined` when the WebID is
 *   unparseable, the profile is unreadable/unsafe (SSRF-refused), advertises no
 *   inbox, or advertises MULTIPLE inboxes (ambiguous — we refuse to guess).
 *
 * NOTE the SSRF guard's redirect handling: a GET may follow a same-origin /
 * re-validated redirect to the canonical card. The inbox value is resolved
 * against the FINAL document URL the profile resolved to (the RDF base).
 */
export declare function discoverInbox(webId: string, opts?: NotifyOptions): Promise<string | undefined>;
//# sourceMappingURL=discover.d.ts.map