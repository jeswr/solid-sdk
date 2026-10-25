/**
 * The OUTBOX EXECUTOR — the deterministic, NO-LLM enforcement point (§2/§5/§7 + the ODRL
 * mandate directive). It is the security boundary: it holds the per-channel send tokens, it
 * evaluates the owner's SIGNED ODRL mandate against EVERY outbound intent DENY-BY-DEFAULT,
 * and it is the only component that transmits anything.
 *
 * CRITICALLY, it derives NO authorization or idempotency state from the Actor-writable
 * proposal resource (whose `status` field a deceived/prompt-injected Actor could forge):
 *  1. the mandate is loaded + signature-verified ONCE; if that fails, it REFUSES ALL ACTIONS
 *     (fail-closed — the mandate-tamper case);
 *  2. idempotency is the presence of a RECEIPT in the OUTBOX — an Actor-UNWRITABLE container —
 *     so a re-run (or an Actor resetting the proposal's status) can never cause a double-send;
 *  3. `evaluate()` decides `permit` (autonomous) / `prohibited` (never) / `confirm-required`;
 *  4. a `confirm-required` intent is authorized ONLY by an owner CONFIRMATION in the
 *     Actor-UNWRITABLE confirmations container, content-locked to the proposal's CURRENT digest
 *     (so the Actor can neither forge a confirmation nor swap the body after it was confirmed);
 *  5. the send is CLAIMED by a create-only receipt write (at-most-once) before transmitting;
 *  6. every outcome (sent / rejected / failed) is a PROV receipt referencing the mandate + the
 *     authorizing permit (or the owner confirmation).
 */
import type { ReplySigner } from "@jeswr/agentic-legacy-bridge";
import type { PodFetch } from "../config.js";
import type { MandateVerifier } from "../mandate/types.js";
import type { ChannelSender } from "./sender.js";
/** Config for {@link runOutboxOnce}. */
export interface ExecutorConfig {
    /** A pod authed `fetch` for reading proposals / confirmations / receipts. */
    readonly readFetch: PodFetch;
    /** A pod authed `fetch` for writing receipts. */
    readonly writeFetch: PodFetch;
    /** The proposals container (Actor-writable — its content is UNTRUSTED for authorization). */
    readonly proposals: string;
    /** The owner-only confirmations container (Actor-UNwritable — the confirm gate's sink). */
    readonly confirmations: string;
    /** The owner-only outbox container (Actor-UNwritable — receipts = the idempotency marker). */
    readonly outbox: string;
    /** The pod owner's WebID (the mandate MUST verify as issued by this WebID). */
    readonly ownerWebId: string;
    /** The signed-mandate loader/verifier (fail-closed). */
    readonly verifier: MandateVerifier;
    /** Per-channel senders. The ONLY place send-scope tokens live. */
    readonly senders: Readonly<Record<string, ChannelSender>>;
    /** The acting agent's WebID (`prov:wasAttributedTo` on receipts + carrier `sender`). */
    readonly agentWebId?: string;
    /** The optional `@jeswr/solid-vc` Data-Integrity signer for the outbound carrier. */
    readonly sign?: ReplySigner;
    /** "Now" (send + claim time), injectable. */
    readonly now?: () => Date;
}
/** The outcome of one executor pass. */
export interface ExecutorResult {
    /** False when the mandate could not be loaded/verified — then NOTHING was sent (fail-closed). */
    readonly mandateLoaded: boolean;
    /** Number of messages actually transmitted. */
    readonly sent: number;
    /** Number of intents left queued for owner confirmation (deny-by-default / no valid confirm). */
    readonly queuedForConfirmation: number;
    /** Number of intents blocked by an explicit ODRL prohibition. */
    readonly prohibited: number;
    /** Number of intents that failed to send. */
    readonly failed: number;
    /** Number of proposals skipped (already have a receipt, or lost the claim race). */
    readonly skipped: number;
}
/** Run one deterministic, mandate-enforced outbox pass. */
export declare function runOutboxOnce(config: ExecutorConfig): Promise<ExecutorResult>;
//# sourceMappingURL=executor.d.ts.map