/**
 * The OUTBOX EXECUTOR — the deterministic, NO-LLM enforcement point (§2/§5/§7 + the ODRL
 * mandate directive). It is the security boundary: it holds the per-channel send tokens, it
 * evaluates the owner's SIGNED ODRL mandate against EVERY outbound intent DENY-BY-DEFAULT,
 * and it is the only component that transmits anything.
 *
 * Per confirmed/pending proposal it:
 *  1. loads + signature-verifies the mandate ONCE; if that fails, REFUSES ALL ACTIONS
 *     (fail-closed — the mandate-tamper case);
 *  2. evaluates the intent (`@jeswr/solid-odrl` `evaluate`): `permit` → autonomous;
 *     `prohibited` → never; `confirm-required` → only if the owner explicitly confirmed;
 *  3. CLAIMS the proposal by compare-and-swap (`pending/confirmed → executed`) BEFORE sending,
 *     so two executor runs can never both send the same proposal (at-most-once);
 *  4. builds the §5.2 signed carrier (`buildReply` / `buildActionMetadata`) and transmits via
 *     the channel sender;
 *  5. writes an owner-private PROV receipt referencing the mandate + the specific permit (or
 *     the owner confirmation) that authorized the send.
 *
 * The LLM-side Actor cannot bypass any of this: it holds no send tokens and cannot write its
 * own mandate. An intent the Actor crafted to *look* permitted but that misses a constraint is
 * denied here at evaluation time.
 */
import type { ReplySigner } from "@jeswr/agentic-legacy-bridge";
import type { PodFetch } from "../config.js";
import type { MandateVerifier } from "../mandate/types.js";
import type { ChannelSender } from "./sender.js";
/** Config for {@link runOutboxOnce}. */
export interface ExecutorConfig {
    /** A pod authed `fetch` for reading proposals. */
    readonly readFetch: PodFetch;
    /** A pod authed `fetch` for CAS-updating proposals + writing receipts. */
    readonly writeFetch: PodFetch;
    /** The proposals container. */
    readonly proposals: string;
    /** The owner-private outbox container (receipts). */
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
    /** Number of intents left queued for owner confirmation (deny-by-default / unfulfilled duty). */
    readonly queuedForConfirmation: number;
    /** Number of intents blocked by an explicit ODRL prohibition. */
    readonly prohibited: number;
    /** Number of intents that failed to send. */
    readonly failed: number;
    /** Number of proposals skipped (already terminal, or lost the CAS race, or no ETag). */
    readonly skipped: number;
}
/** Run one deterministic, mandate-enforced outbox pass. */
export declare function runOutboxOnce(config: ExecutorConfig): Promise<ExecutorResult>;
//# sourceMappingURL=executor.d.ts.map