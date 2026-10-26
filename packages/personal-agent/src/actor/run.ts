// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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
import { isSafeContainer } from "../config.js";
import { createProposal } from "../pod/proposal-store.js";
import { listContainer, readGraph } from "../pod/read.js";
import { deriveProposals } from "./derive.js";
import { readInboundContext, readInterpretations } from "./interpretations.js";

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
export async function runActorOnce(options: RunActorOptions): Promise<RunActorResult> {
  if (!isSafeContainer(options.inbox)) throw new Error("runActorOnce: unsafe inbox container");
  if (!isSafeContainer(options.proposals)) {
    throw new Error("runActorOnce: unsafe proposals container");
  }
  const now = options.now ?? (() => new Date());
  const children = await listContainer(options.readFetch, options.inbox);

  let graphsScanned = 0;
  let proposalsCreated = 0;
  for (const url of children) {
    if (!url.startsWith(options.inbox)) continue;
    if (!url.endsWith(".ttl") || url.endsWith(".chat.ttl") || url.endsWith(".acl")) continue;
    const slug = url.slice(options.inbox.length, url.length - ".ttl".length);
    if (slug.length === 0) continue;
    graphsScanned += 1;

    let store: Awaited<ReturnType<typeof readGraph>>["store"];
    try {
      ({ store } = await readGraph(options.readFetch, url));
    } catch {
      continue; // an unreadable graph never aborts the pass
    }
    const inbound = readInboundContext(store);
    const interps = readInterpretations(store);
    const proposals = deriveProposals(interps, {
      inbound,
      idPrefix: slug,
      now: now(),
      ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
    });
    for (const proposal of proposals) {
      const created = await createProposal(
        options.writeFetch,
        options.proposals,
        options.ownerWebId,
        proposal,
      );
      if (created) proposalsCreated += 1;
    }
  }
  return { graphsScanned, proposalsCreated };
}
