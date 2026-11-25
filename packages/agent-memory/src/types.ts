// AUTHORED-BY Codex GPT-6.1-Sol
import type { verifyApproval } from "@jeswr/agent-mandate";
import type { Fact, MemoryMandate, Nanopublications } from "@jeswr/pkg-memory";
import type { RdfEngine } from "@jeswr/rdf-engine";
import type { StorageClient } from "@jeswr/storage-client";

export type { MemoryMandate } from "@jeswr/pkg-memory";
export interface RecallQuery {
  readonly about?: string;
  readonly categories?: readonly string[];
  readonly purpose: string;
  readonly limit: number;
}
/** Only the four graphs of this permitted nanopub, never sibling assertions or batch metadata. */
export interface RecalledMemory extends Nanopublications {
  readonly resource: string;
}
/** All fields come from trusted host context, never an untrusted model tool argument. */
export type RememberOrigin =
  | { readonly kind: "owner-conversation"; readonly source: string; readonly quote: string }
  | {
      readonly kind: "inference";
      readonly source: string;
      readonly rule: string;
      readonly quote?: string;
    };
export interface RememberClaim {
  readonly fact: Fact;
  readonly categories: readonly string[];
  readonly origin: RememberOrigin;
}
/** Render the supplied TriG to the owner; its exact bytes and destination are approval-bound. */
export interface RememberProposal {
  readonly kind: "remember";
  readonly id: string;
  readonly target: string;
  readonly termsDigest: string;
  readonly trig: string;
  readonly nanopublications: readonly string[];
}
export interface CommunicationRulesImport {
  readonly yaml: string;
  /** Full source revision, recorded as communication-rules.yaml@<commit>. */
  readonly commit: string;
  readonly source: string;
}
export interface AgentMemoryOptions {
  readonly storage: StorageClient;
  /** Existing owner-private agent/memory/ container; pending/ must also already exist. */
  readonly container: string;
  readonly ownerWebId: string;
  readonly agentId: string;
  /** Must verify integrity, revocation and the signed scope, applying purpose policy if required. */
  readonly loadMandate: (query: RecallQuery) => Promise<MemoryMandate | undefined>;
  /** Durable, idempotent upsert into the host's approval queue, keyed by proposal.id. */
  readonly queueApproval: (proposal: RememberProposal) => Promise<void>;
  readonly webIdKeyResolver: Parameters<typeof verifyApproval>[1]["webIdKeyResolver"];
  /** Canonical knowledge-graph/shapes.ttl supplied by the host; never fetched implicitly. */
  readonly shapes: string;
  /** Defaults to the real Node rdf-engine. CI may inject a pyshacl adapter. Errors fail closed. */
  readonly validator?: Pick<RdfEngine, "validate">;
  readonly now?: () => Date;
  readonly maxResources?: number;
  readonly maxResourceBytes?: number;
}
export interface AgentMemory {
  recall(query: RecallQuery): Promise<RecalledMemory[]>;
  proposeRemember(claim: RememberClaim): Promise<RememberProposal>;
  /** Verify a signed owner approval, validate the approved snapshot, copy then conditionally delete. */
  approveRemember(proposal: string, approval: { id: string; document: string }): Promise<string>;
  /** Import once per owner; pending imports are requeued, approved imports are never rewritten. */
  importCommunicationRules(input: CommunicationRulesImport): Promise<RememberProposal>;
}
