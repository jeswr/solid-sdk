// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Shared configuration types for the personal agent (NOW-PERSONAL-AGENT.md §2).
 *
 * The four halves — Reader, pod, Actor, outbox — meet ONLY at the pod. This module
 * holds the pod-container layout and owner identity they share, plus the credential
 * SEAMS. Every credential (a Gmail OAuth token, the pod's authenticated `fetch`, the
 * per-channel send tokens, the billed Anthropic API key) is an INJECTED seam — this
 * package never reads a secret from disk, an env var, or a URL, and never logs one.
 *
 * @packageDocumentation
 */

/**
 * A pod authenticated `fetch` (Solid-OIDC / DPoP), supplied by the caller. The pod is
 * the OWNER's own trusted origin, so — unlike the untrusted channel remotes — pod
 * reads/writes are NOT routed through the SSRF guard (matching `importInbound`'s
 * contract). Writes still set `redirect: "manual"` and refuse a 3xx.
 */
export type PodFetch = typeof globalThis.fetch;

/**
 * The owner-private pod containers this system uses. All three MUST be absolute
 * http(s) container IRIs ending in `/`, with no query/fragment. They are locked
 * owner-only (fail-closed WAC ACL written BEFORE any content — the §7 invariant).
 */
export interface PodLayout {
  /**
   * The inbox container — channel-derived items land here (raw bytes + agentic graph
   * + CanonicalMessage), owner-private, written ACL-first by `importInbound`.
   */
  readonly inbox: string;
  /**
   * The proposals container — the ONLY container the Actor may write to (a narrowly
   * scoped write allowance). Holds `agentic:ActionProposal` records the outbox
   * executor consumes. The Actor holds NO channel send tokens; it only proposes.
   */
  readonly proposals: string;
  /**
   * The confirmations container — the human-confirm gate's OWNER-ONLY sink. The Actor has
   * NO write access here (its gate only allows the proposals container), so it cannot forge a
   * confirmation. Each record binds a proposal id to a CONTENT DIGEST, so a confirmation
   * authorizes exactly the content the owner saw — not a later Actor-swapped body.
   */
  readonly confirmations: string;
  /**
   * The outbox container — the executor's send receipts + PROV bundles. Owner-private and
   * Actor-unwritable, so a receipt is the unforgeable "already handled" marker (idempotency).
   */
  readonly outbox: string;
}

/** The owner + agent identities carried onto the PROV records this system writes. */
export interface AgentIdentity {
  /** The pod OWNER's WebID — granted full control by every owner-only ACL. */
  readonly ownerWebId: string;
  /** The agent's own WebID (`prov:wasAssociatedWith` on interpretations + receipts). */
  readonly agentWebId?: string;
  /** The ODRL mandate the agent acts under (`prov:hadPlan`), when known. */
  readonly mandateIri?: string;
}

/** Assert that `container` is a syntactically safe owner-private container IRI. */
export function isSafeContainer(container: unknown): container is string {
  if (typeof container !== "string" || container.length === 0) return false;
  let url: URL;
  try {
    url = new URL(container);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.search !== "" || url.hash !== "") return false;
  if (url.username !== "" || url.password !== "") return false;
  return url.pathname.endsWith("/");
}
