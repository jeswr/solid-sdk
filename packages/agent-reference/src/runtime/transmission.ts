/**
 * Provider transmission: the effect boundary for sending an already-signed outbound message
 * through an external provider (e.g. Gmail `users.messages.send`).
 *
 * A signed envelope proves only that this agent issued it in the past. Transmitting it is a
 * separate consequential act, so `AgentRuntime.transmit` re-decides at the moment of sending:
 *
 *  - the item must be an AUTHENTIC entry of this agent's own outbox (same wire bytes);
 *  - the message must not have expired;
 *  - a message whose emission was authorised as an action (it carries the `ActionIntent`
 *    recorded at emission — propose, accept, invoke, deliver under a mandate) is
 *    RE-AUTHORISED under the current mandate, persisted revocations and current approvals.
 *    Messages that carried no authorised action (describe, description, receipt, refuse,
 *    unsupported, indeterminate) follow the declared metadata rule: authentic + unexpired.
 *
 * Every provider send is recorded durably, keyed by the message id, with the stable RFC 5322
 * Message-ID derived from it: `attempting` is persisted BEFORE the provider is called, then
 * `sent`, `not-sent` (the provider definitively did not accept it) or `uncertain` (an error or
 * timeout after the request may have reached the provider). A repeated call for a `sent`
 * message transmits nothing. An `attempting`/`uncertain` record is never retried blindly:
 *
 *  - positive evidence (`found`, verified by the binding against the exact message) reconciles
 *    it as sent without another request;
 *  - `absent` permits another attempt ONLY when the I/O declares `finalAbsence` — the provider
 *    guarantees that an absent operation did not execute AND can no longer complete (for
 *    example, the lookup itself fences the operation key). A search miss is not that: a
 *    request that timed out may still be in flight, indexing may lag, and a copy may have
 *    been moved or deleted. Without the declaration `absent` is treated as `unknown`;
 *  - while a timed-out request from this process is still pending, nothing is re-attempted
 *    (a timeout does not cancel it); its late settlement is recorded when it arrives;
 *  - otherwise the record stays `uncertain` until positive evidence or an operator decision.
 *
 * This bounds what THIS runtime sends: at most one provider request per message unless the
 * provider declares final absence, and then at most `MAX_TRANSMISSION_ATTEMPTS`. It is not an
 * exactly-once delivery guarantee: a request whose outcome stays unknown may or may not have
 * been delivered, and delivery beyond the provider is outside this boundary. Peer-side replay
 * protection of the protocol is separate.
 */
import { digestOf } from "../core/canonical.js";
import type { Iri } from "../core/types.js";
import type { WireMessage } from "../store/state.js";

/** Digest identifying one wire unit (compared between the outbox and the send request). */
export function wireDigest(wire: WireMessage): string {
  return digestOf(wire as unknown as Parameters<typeof digestOf>[0]);
}

/** Maximum provider attempts per message (each after a declared-final "absent"). */
export const MAX_TRANSMISSION_ATTEMPTS = 3;

export type TransmissionStatus = "attempting" | "sent" | "not-sent" | "uncertain";

export interface TransmissionRecord {
  readonly messageId: Iri;
  readonly binding: string;
  /** Stable provider-visible identifier (the RFC 5322 Message-ID). */
  readonly externalId: string;
  readonly wireDigest: string;
  readonly status: TransmissionStatus;
  readonly attempts: number;
  readonly providerRef?: string;
  readonly detail?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What the provider said about one send request. */
export type ProviderSendResult =
  | { readonly outcome: "accepted"; readonly providerRef: string }
  /** The provider definitively refused before accepting (no message was created). */
  | { readonly outcome: "rejected"; readonly detail: string };

/** What the provider says about an earlier request for this message. */
export type ProviderLookupResult =
  /** Positive evidence, already checked by the binding against the exact message sent. */
  | { readonly outcome: "found"; readonly providerRef: string }
  /** The operation did not execute; acted on only with `TransmissionIo.finalAbsence`. */
  | { readonly outcome: "absent" }
  | { readonly outcome: "unknown"; readonly detail: string };

export interface TransmissionIo {
  /**
   * Perform the provider request. A throw, a timeout (which does not cancel the request) or
   * a result that is not a well-formed `ProviderSendResult` is treated as `uncertain`.
   */
  send(): Promise<ProviderSendResult>;
  /** Look up an earlier request. Without it, an uncertain send stays uncertain. */
  lookup?(): Promise<ProviderLookupResult>;
  /**
   * Declares causal finality of `absent`: the provider guarantees that an operation it reports
   * absent did not execute and cannot subsequently complete. Only then does `absent` permit
   * another attempt; otherwise it is `unknown`. Do not set this for search-based lookups.
   */
  readonly finalAbsence?: true;
  /**
   * Declares that the RECEIVER deduplicates by the signed message id (the profile's replay
   * protection, within the message's validity), so re-sending the IDENTICAL signed message
   * after an unresolved attempt cannot duplicate a business effect. An unresolved record may
   * then be resolved by an identical resend — re-authorised like a first attempt — instead of
   * a lookup. A refused or failed resend leaves the record unresolved (never "not sent").
   * Direct peer bindings (A2A) only; never for provider mailboxes.
   */
  readonly idempotentResend?: true;
  /** Per-binding attempt bound (default MAX_TRANSMISSION_ATTEMPTS). */
  readonly maxAttempts?: number;
}

const PROVIDER_REF = /^[A-Za-z0-9._:-]{1,256}$/;
const has = (v: object, keys: readonly string[]) => Object.keys(v).every((k) => keys.includes(k));

/** Validate a send result at the provider boundary; undefined if malformed. */
export function providerSendResultOf(value: unknown): ProviderSendResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (v.outcome === "accepted" && has(v, ["outcome", "providerRef"]))
    return typeof v.providerRef === "string" && PROVIDER_REF.test(v.providerRef)
      ? { outcome: "accepted", providerRef: v.providerRef }
      : undefined;
  if (v.outcome === "rejected" && has(v, ["outcome", "detail"]))
    return typeof v.detail === "string" ? { outcome: "rejected", detail: v.detail } : undefined;
  return undefined;
}

/** Validate a lookup result at the provider boundary; undefined if malformed. */
export function providerLookupResultOf(value: unknown): ProviderLookupResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (v.outcome === "found" && has(v, ["outcome", "providerRef"]))
    return typeof v.providerRef === "string" && PROVIDER_REF.test(v.providerRef)
      ? { outcome: "found", providerRef: v.providerRef }
      : undefined;
  if (v.outcome === "absent" && has(v, ["outcome"])) return { outcome: "absent" };
  if (v.outcome === "unknown" && has(v, ["outcome", "detail"]))
    return typeof v.detail === "string" ? { outcome: "unknown", detail: v.detail } : undefined;
  return undefined;
}

export type TransmissionRefusal =
  | "unknown-message"
  | "wire-mismatch"
  | "expired"
  | "not-authorised"
  | "approval-required"
  | "attempt-limit"
  /** A protected disclosure's authorisation basis no longer holds (or cannot be checked). */
  | "condition-failed";

export type TransmitResult =
  | { readonly status: "sent"; readonly providerRef: string; readonly reconciled: boolean }
  | { readonly status: "duplicate"; readonly providerRef?: string }
  | { readonly status: "refused"; readonly reason: TransmissionRefusal; readonly detail: string }
  | { readonly status: "not-sent"; readonly detail: string }
  | { readonly status: "uncertain"; readonly detail: string };

export interface TransmitRequest {
  readonly messageId: Iri;
  readonly binding: string;
  readonly externalId: string;
  /** Digest of the wire unit the binding is about to send (must equal the outbox entry's). */
  readonly wireDigest: string;
}

/** Transmission records that still need an authoritative resolution. */
export function unresolvedTransmissions(
  records: Readonly<Record<Iri, TransmissionRecord>>,
): TransmissionRecord[] {
  return Object.values(records).filter(
    (r) => r.status === "attempting" || r.status === "uncertain",
  );
}
