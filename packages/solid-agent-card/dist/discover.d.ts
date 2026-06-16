import type { AgentDiscovery } from "./types.js";
/** Options for {@link discoverAgent}. */
export interface DiscoverOptions {
    /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
    readonly fetch?: typeof globalThis.fetch;
    /**
     * When `true` (the default), follow the discovered agent pointer, fetch the
     * agent's Agent Description and verify it. When `false`, return the pointer(s)
     * only (no second fetch).
     */
    readonly resolveDescriptor?: boolean;
}
/**
 * Discover the agent that represents the holder of `webId`.
 *
 * 1. Fetch + parse the WebID profile (Turtle / JSON-LD conneg).
 * 2. Read the person→agent pointer(s) across the standard predicates
 *    (`interop:hasAuthorizationAgent`, then `schema:agent`).
 * 3. Unless `resolveDescriptor === false`, fetch the first agent's Agent
 *    Description and verify it.
 *
 * @param webId - the person's WebID (or profile document URL).
 * @returns the pointer(s) found, plus the resolved + verified descriptor.
 */
export declare function discoverAgent(webId: string, options?: DiscoverOptions): Promise<AgentDiscovery>;
/**
 * The ANP Agent Description discovery URL for an origin — `<origin>` +
 * `/.well-known/agent-descriptions`. Aligned with ANP (NOT a bespoke path).
 *
 * @param origin - a pod / host URL; any path/query/fragment is discarded.
 */
export declare function agentDescriptionsUrl(origin: string): string;
/**
 * The A2A Agent Card discovery URL for an origin — `<origin>` +
 * `/.well-known/agent-card.json` (RFC 8615). A pinned watch item (the A2A path /
 * schema is LF-governed and fast-moving).
 */
export declare function agentCardUrl(origin: string): string;
//# sourceMappingURL=discover.d.ts.map