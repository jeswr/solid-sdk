import type { AgentDiscovery } from "./types.js";
/** Options for {@link discoverAgent}. */
export interface DiscoverOptions {
    /**
     * A `fetch` implementation (e.g. an authenticated Solid fetch).
     *
     * SECURITY — this fetch is the SSRF boundary. `discoverAgent` follows the
     * agent-pointer IRI read from a (possibly untrusted) WebID profile and fetches
     * it. In a **server / Node** context the default `globalThis.fetch` is NOT
     * SSRF-guarded, so a hostile profile could point the second fetch at an
     * internal address (e.g. cloud metadata). Callers resolving UNTRUSTED WebIDs on
     * a server SHOULD inject an SSRF-guarded fetch (e.g. `@jeswr/guarded-fetch`'s
     * node fetch, with DNS-pinning). In a browser, CORS only limits which
     * cross-origin RESPONSES your code can read — it does not stop the request
     * being issued to an internal target — so treat untrusted browser-side
     * discovery as only partially guarded. (This is distinct from the
     * subject-binding spoofing guard, which prevents a descriptor from *claiming* a
     * different agent IRI, not SSRF.)
     *
     * Independently of the injected fetch, `discoverAgent` REJECTS (skips) any
     * pointer whose object is not a well-formed absolute http(s) IRI — `file:`,
     * `javascript:`, `data:`, scheme-relative and authority-deficient forms never
     * reach the fetch at all. The injected guard is then responsible only for the
     * remaining http(s) SSRF surface (private ranges, DNS rebinding, redirects).
     */
    readonly fetch?: typeof globalThis.fetch;
    /**
     * When `true` (the default), follow the discovered agent pointer, fetch the
     * agent's Agent Description and verify it. When `false`, return the pointer(s)
     * only (no second fetch).
     */
    readonly resolveDescriptor?: boolean;
    /**
     * When `true`, require the resolved descriptor to carry EXACTLY ONE `ad:owner`
     * IRI equal to the WebID discovery started from — the check is exact AND
     * order-independent. Fail-closed on every deviation: zero owners, two-or-more
     * owners (ambiguous, even if one matches), a non-IRI owner term, or a single
     * non-matching owner. This is the OWNER BACK-LINK guard, the
     * bidirectional binding the accountability chain needs: the profile says
     * "this agent represents me" AND the agent's own description says "I
     * represent this WebID". Without it, a profile can point at any third
     * party's (well-formed) agent description and discovery still reports
     * `valid` — the descriptor never claimed to represent this WebID, but
     * nothing checked. Defaults to `false` (backwards compatible); either way
     * the result carries {@link AgentDiscovery.ownerMatchesWebId} so callers can
     * check cheaply. NOTE the equality is exact — `https://jeswr.org/#me` and
     * `https://www.jeswr.org/#me` are different IRIs; the descriptor's
     * `ad:owner` must use the canonical WebID spelling.
     */
    readonly requireOwnerMatch?: boolean;
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