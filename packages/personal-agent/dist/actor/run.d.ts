/**
 * `runActorOnce` — the Actor's DETERMINISTIC pre-pass (§5.1), the part that runs with ZERO
 * LLM tokens and drives the golden-master flow. It reads the owner-private inbox graphs the
 * Reader landed, derives proposal INTENTS deterministically, and writes them (create-only,
 * ACL-first) into the proposals container. The Actor only PROPOSES here — nothing is sent.
 *
 * The conversational LLM loop (the §3.3 Claude Agent SDK `query()`) runs on TOP of this: it
 * reads the same pod through the read-only MCP tools for residual prose and writes proposals
 * through the one proposals-scoped write tool. Both paths land the SAME proposal records the
 * outbox executor governs — so the deterministic path is fully exercised without an API key.
 */
import type { PodFetch } from "../config.js";
/** Options for {@link runActorOnce}. */
export interface RunActorOptions {
    /** A pod authed `fetch` for reading the inbox graphs. */
    readonly readFetch: PodFetch;
    /** A pod authed `fetch` for writing proposal records. */
    readonly writeFetch: PodFetch;
    /** The owner-private inbox container. */
    readonly inbox: string;
    /** The proposals container (the Actor's only writable surface). */
    readonly proposals: string;
    /** The pod owner's WebID (granted full control by the proposals ACL). */
    readonly ownerWebId: string;
    /** "Now" (proposal creation time), injectable. */
    readonly now?: () => Date;
    /** Minimum deterministic confidence (default 0.9). */
    readonly minConfidence?: number;
}
/** The outcome of one Actor deterministic pass. */
export interface RunActorResult {
    /** Number of inbox graphs scanned. */
    readonly graphsScanned: number;
    /** Number of NEW proposals created (existing ones are never clobbered). */
    readonly proposalsCreated: number;
}
/** Run the deterministic Actor pass once over the inbox. */
export declare function runActorOnce(options: RunActorOptions): Promise<RunActorResult>;
//# sourceMappingURL=run.d.ts.map