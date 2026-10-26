/**
 * Standalone Gmail provider adapter for the email binding.
 *
 * SETUP REQUIRED — this adapter has NOT been run against the live Gmail API. It holds no
 * credentials: the supervisor injects a narrowly scoped {@link GmailTransport} (for
 * example a function backed by its own authenticated connector). The adapter is the
 * executor boundary for email, so it trusts NOTHING in the review item (not its status
 * string, not its `to` field) and re-derives everything from the exact bytes it would send:
 *  - the base64url payload decodes to exactly the reviewed MIME (no divergent copies);
 *  - the embedded signed envelope verifies against THIS agent's own key, and its audience
 *    actor has exactly one pinned `mailto:` endpoint, which must also be allow-listed;
 *  - the MIME has only the headers this binding emits (so no Cc/Bcc/Resent/Reply-To),
 *    `From` is the configured source account, `To` is exactly that one pinned recipient,
 *    and every human-visible part is the exact rendering of the signed statement;
 *  - it is dry-run by default, so constructing it cannot send anything by accident;
 *  - it transmits the validated bytes, re-encoded here — never a separately supplied field;
 *  - the send itself goes through the agent runtime's transmission gate (`transmit`), which
 *    re-decides authorisation and expiry at send time and keeps a durable per-message
 *    record, so a repeated or uncertain send is never transmitted blindly (see
 *    `runtime/transmission.ts`);
 *  - recovery of an uncertain send uses POSITIVE evidence only: a search by Message-ID yields
 *    candidates, and one counts only if its stored copy carries the exact signed envelope,
 *    Message-ID, sender and single pinned recipient. Gmail offers no causally final absence
 *    (a timed-out request may still complete; search indexing lags; copies can be moved or
 *    deleted), so a miss, an empty or malformed result is `unknown` and the send stays
 *    uncertain — it is never re-sent automatically.
 */

import type {
  ProviderLookupResult,
  TransmissionIo,
  TransmitRequest,
  TransmitResult,
} from "../runtime/transmission.js";
import { wireDigest } from "../runtime/transmission.js";
import type { ProcessedOutbound } from "../service.js";
import {
  emailMessageIdFor,
  rawFromGmailMessage,
  validateOutboundEmail,
  verifyProviderCopy,
} from "./email.js";

/** What the adapter needs from the agent runtime (see `AgentRuntime.outboundVerifier`). */
export interface OutboundVerifier {
  verifyOwnEnvelope(
    jws: string,
  ): Promise<{ ok: boolean; audienceActor?: string; messageId?: string; detail: string }>;
  endpointsFor(actor: string): readonly string[];
  /** The runtime's transmission gate (authorisation at send time + durable records). */
  transmit(req: TransmitRequest, io: TransmissionIo): Promise<TransmitResult>;
  /** Authorisation-only check used by dry runs (records no transmission). */
  checkTransmission(req: TransmitRequest): Promise<{ ok: true } | TransmitResult>;
}

/** Thrown by a transport when the provider definitively refused the request (nothing sent). */
export class ProviderRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRejectedError";
  }
}

const GMAIL_BINDING = "gmail-api";

export const GMAIL_SETUP_REQUIRED = [
  "Inject a GmailTransport backed by the supervisor's authenticated connector (gmail.send + gmail.readonly or narrower).",
  "Provide the allow-list of recipient addresses (the pinned peer endpoints for the synthetic test accounts).",
  "Construct with dryRun: false only for an approved synthetic test run.",
  "Live round trip is unverified: no request has been made to gmail.googleapis.com from this code.",
] as const;

/** The narrowly scoped transport the supervisor injects. */
export interface GmailTransport {
  /** `users.messages.send` with a base64url RFC 5322 body. */
  send(request: { raw: string; threadId?: string }): Promise<{ id: string; threadId?: string }>;
  /** `users.messages.get?format=raw` for one message id. */
  getRaw(id: string): Promise<{ id: string; threadId?: string; raw: string }>;
  /**
   * Candidate provider ids for an RFC 5322 Message-ID (e.g. a search for `rfc822msgid:`).
   * Candidates are verified by fetching them (`getRaw`); an empty list is NOT evidence that
   * nothing was sent. Without this an uncertain send stays uncertain.
   */
  findByMessageId?(rfc822MessageId: string): Promise<GmailSearchResult>;
}

export type GmailSearchResult =
  | { readonly outcome: "candidates"; readonly ids: readonly string[] }
  | { readonly outcome: "unknown"; readonly detail: string };

/** At most this many candidates are fetched and verified per lookup. */
const MAX_CANDIDATES = 5;
const GMAIL_ID = /^[A-Za-z0-9]{1,64}$/;

function searchResultOf(value: unknown): GmailSearchResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as { outcome?: unknown; ids?: unknown; detail?: unknown };
  if (v.outcome === "unknown" && typeof v.detail === "string")
    return { outcome: "unknown", detail: v.detail };
  if (
    v.outcome === "candidates" &&
    Array.isArray(v.ids) &&
    v.ids.every((id) => typeof id === "string" && GMAIL_ID.test(id))
  )
    return { outcome: "candidates", ids: v.ids as string[] };
  return undefined;
}

export type SendOutcome =
  | { readonly status: "sent"; readonly providerId: string; readonly reconciled: boolean }
  | { readonly status: "duplicate"; readonly providerId?: string }
  | { readonly status: "dry-run"; readonly wouldSendTo: string; readonly bytes: number }
  | { readonly status: "refused"; readonly reason: string }
  | { readonly status: "not-sent"; readonly reason: string }
  | { readonly status: "uncertain"; readonly reason: string };

export class GmailProviderAdapter {
  private readonly allowed: ReadonlySet<string>;
  readonly dryRun: boolean;
  private readonly sourceAccount: string | undefined;
  private readonly verifier: OutboundVerifier | undefined;

  constructor(
    private readonly transport: GmailTransport | undefined,
    options: {
      allowedRecipients: readonly string[];
      /** The mailbox the transport sends from; `From` must equal it exactly. */
      sourceAccount?: string;
      /** Own-key signature + pinned endpoints (from the agent runtime). Required to send. */
      verifier?: OutboundVerifier;
      dryRun?: boolean;
    },
  ) {
    this.allowed = new Set(options.allowedRecipients);
    this.dryRun = options.dryRun ?? true;
    this.sourceAccount = options.sourceAccount;
    this.verifier = options.verifier;
  }

  get setupRequired(): readonly string[] {
    const missing = [
      ...(this.transport ? [] : [GMAIL_SETUP_REQUIRED[0]]),
      GMAIL_SETUP_REQUIRED[1],
      ...(this.dryRun ? [GMAIL_SETUP_REQUIRED[2]] : []),
      GMAIL_SETUP_REQUIRED[3],
    ];
    return missing;
  }

  /** Re-derive and check the exact bytes; returns the raw to send, or why not. */
  async revalidate(
    item: ProcessedOutbound,
  ): Promise<
    | { ok: true; raw: Buffer; to: string; from: string; jws: string; request: TransmitRequest }
    | { ok: false; reason: string }
  > {
    if (!item.email) return { ok: false, reason: "no email in the item" };
    if (item.status === "blocked") return { ok: false, reason: "item was blocked at review" };
    if (!this.verifier || !this.sourceAccount)
      return { ok: false, reason: "setup required: verifier and source account" };
    const encoded = item.email.gmailSend.raw;
    if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]+$/.test(encoded))
      return { ok: false, reason: "provider payload is not base64url" };
    const raw = Buffer.from(encoded, "base64url");
    if (raw.toString("base64url") !== encoded)
      return { ok: false, reason: "provider payload is not canonical base64url" };
    if (!raw.equals(Buffer.from(item.email.raw, "utf8")))
      return { ok: false, reason: "provider payload differs from the reviewed MIME" };
    const threadId = item.email.gmailSend.threadId;
    if (threadId !== undefined && !/^[A-Za-z0-9]{1,64}$/.test(threadId))
      return { ok: false, reason: "invalid threadId" };
    if (item.envelope.format !== "awp-jws-compact/0.1")
      return { ok: false, reason: "only signed envelopes are sent by email" };
    const own = await this.verifier.verifyOwnEnvelope(item.envelope.jws);
    if (!own.ok || !own.audienceActor || !own.messageId) return { ok: false, reason: own.detail };
    const pinned = this.verifier
      .endpointsFor(own.audienceActor)
      .filter((e) => e.startsWith("mailto:"));
    if (pinned.length !== 1)
      return { ok: false, reason: "signed audience has no single pinned mailto endpoint" };
    const to = (pinned[0] as string).slice("mailto:".length);
    if (!this.allowed.has(to))
      return { ok: false, reason: "pinned recipient is not in the allow-list" };
    const exact = validateOutboundEmail(raw, {
      from: this.sourceAccount,
      to,
      jws: item.envelope.jws,
    });
    if (!exact.ok) return { ok: false, reason: exact.problems.join("; ") };
    return {
      ok: true,
      raw,
      to,
      from: this.sourceAccount,
      jws: item.envelope.jws,
      request: {
        messageId: own.messageId,
        binding: GMAIL_BINDING,
        externalId: emailMessageIdFor(own.messageId),
        wireDigest: wireDigest(item.envelope),
      },
    };
  }

  /**
   * Send one reviewed item after full revalidation, through the runtime's transmission gate:
   * authorisation and expiry are re-decided at send time, `attempting` is persisted before
   * the provider is called, a repeat of a sent message transmits nothing, and an uncertain
   * send is resolved only by a verified provider copy — never retried (Gmail declares no
   * final absence).
   */
  async sendReviewed(item: ProcessedOutbound): Promise<SendOutcome> {
    const checked = await this.revalidate(item);
    if (!checked.ok) return { status: "refused", reason: checked.reason };
    const verifier = this.verifier as OutboundVerifier;
    if (this.dryRun || !this.transport) {
      const now = await verifier.checkTransmission(checked.request);
      if ("ok" in now)
        return { status: "dry-run", wouldSendTo: checked.to, bytes: checked.raw.length };
      return toOutcome(now);
    }
    const transport = this.transport;
    const threadId = item.email?.gmailSend.threadId;
    const io: TransmissionIo = {
      send: async () => {
        try {
          const r = await transport.send({
            raw: checked.raw.toString("base64url"),
            ...(threadId ? { threadId } : {}),
          });
          return { outcome: "accepted", providerRef: r.id };
        } catch (error) {
          if (error instanceof ProviderRejectedError)
            return { outcome: "rejected", detail: error.message };
          throw error;
        }
      },
      ...(transport.findByMessageId ? { lookup: () => this.findVerifiedCopy(checked) } : {}),
      // No `finalAbsence`: a Gmail search miss never permits another send.
    };
    return toOutcome(await verifier.transmit(checked.request, io));
  }

  /** Positive evidence only: a stored copy that is exactly the message this agent sent. */
  private async findVerifiedCopy(checked: {
    raw: Buffer;
    to: string;
    from: string;
    jws: string;
    request: TransmitRequest;
  }): Promise<ProviderLookupResult> {
    const transport = this.transport as GmailTransport;
    const search = searchResultOf(
      await (transport.findByMessageId as NonNullable<GmailTransport["findByMessageId"]>)(
        checked.request.externalId,
      ),
    );
    if (!search) return { outcome: "unknown", detail: "malformed search result" };
    if (search.outcome === "unknown") return search;
    if (search.ids.length === 0)
      return {
        outcome: "unknown",
        detail: "no provider copy found (a search miss does not show the send failed)",
      };
    const problems: string[] = [];
    for (const id of search.ids.slice(0, MAX_CANDIDATES)) {
      try {
        const copy = await transport.getRaw(id);
        if (copy?.id !== id) {
          problems.push(`${id}: provider returned a different message`);
          continue;
        }
        const check = verifyProviderCopy(rawFromGmailMessage(copy), {
          from: checked.from,
          to: checked.to,
          jws: checked.jws,
          emailMessageId: checked.request.externalId,
          sent: checked.raw,
        });
        if (check.ok) return { outcome: "found", providerRef: id };
        problems.push(`${id}: ${check.detail}`);
      } catch (error) {
        problems.push(`${id}: ${(error as Error).message.slice(0, 100)}`);
      }
    }
    return {
      outcome: "unknown",
      detail: `no verified provider copy (${problems.join("; ").slice(0, 300)})`,
    };
  }

  /** Fetch one inbound message as a Gmail raw JSON object for `processInput`. */
  async fetchRaw(id: string): Promise<{ id: string; threadId?: string; raw: string }> {
    if (!this.transport) throw new Error("setup required: no Gmail transport injected");
    if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new Error("invalid Gmail message id");
    return this.transport.getRaw(id);
  }
}

function toOutcome(r: TransmitResult): SendOutcome {
  switch (r.status) {
    case "sent":
      return { status: "sent", providerId: r.providerRef, reconciled: r.reconciled };
    case "duplicate":
      return { status: "duplicate", ...(r.providerRef ? { providerId: r.providerRef } : {}) };
    case "refused":
      return { status: "refused", reason: `${r.reason}: ${r.detail}` };
    case "not-sent":
      return { status: "not-sent", reason: r.detail };
    case "uncertain":
      return { status: "uncertain", reason: r.detail };
  }
}

/**
 * Candidates from a `users.messages.list` body. Only a well-formed list (optional
 * `messages` array of `{id, threadId}`, optional numeric `resultSizeEstimate`, optional string
 * `nextPageToken`, nothing else) yields candidates; anything else is `unknown`. An empty list
 * yields no candidates — which the adapter treats as unknown, never as absence.
 */
export function listCandidates(body: unknown): GmailSearchResult {
  const bad = (detail: string): GmailSearchResult => ({
    outcome: "unknown",
    detail: `gmail list: ${detail}`,
  });
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("not an object");
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b))
    if (!["messages", "resultSizeEstimate", "nextPageToken"].includes(k))
      return bad(`unexpected member ${k.slice(0, 40)}`);
  if (b.resultSizeEstimate !== undefined && typeof b.resultSizeEstimate !== "number")
    return bad("malformed resultSizeEstimate");
  if (b.nextPageToken !== undefined && typeof b.nextPageToken !== "string")
    return bad("malformed nextPageToken");
  if (b.messages === undefined) return { outcome: "candidates", ids: [] };
  if (!Array.isArray(b.messages)) return bad("messages is not a list");
  const ids: string[] = [];
  for (const m of b.messages) {
    const id = (m as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !GMAIL_ID.test(id)) return bad("malformed message entry");
    ids.push(id);
  }
  return { outcome: "candidates", ids: ids.slice(0, MAX_CANDIDATES) };
}

/**
 * A transport over an INJECTED authorised fetch (the supervisor's connector supplies it;
 * this module never sees a token). Endpoints are fixed; redirects are refused.
 */
export function createGmailRestTransport(input: {
  authorizedFetch: (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; redirect: "error" },
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  userId?: "me";
}): GmailTransport {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  return {
    async send(request) {
      const res = await input.authorizedFetch(`${base}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        redirect: "error",
      });
      // 400: the request was refused as invalid, so no message was created. Anything else
      // (5xx, 429, network) may or may not have reached the mailbox: the caller treats a
      // plain throw as uncertain and reconciles by Message-ID.
      if (res.status === 400) throw new ProviderRejectedError("gmail send refused: HTTP 400");
      if (!res.ok) throw new Error(`gmail send failed: HTTP ${res.status}`);
      const body = (await res.json()) as { id?: unknown; threadId?: unknown } | null;
      // A 2xx without a valid id is still "may have been sent": thrown, hence uncertain.
      if (typeof body?.id !== "string" || !GMAIL_ID.test(body.id))
        throw new Error("gmail send: no valid id in response");
      return {
        id: body.id,
        ...(typeof body.threadId === "string" ? { threadId: body.threadId } : {}),
      };
    },
    async getRaw(id) {
      if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new Error("invalid Gmail message id");
      const res = await input.authorizedFetch(`${base}/${id}?format=raw`, {
        method: "GET",
        headers: {},
        redirect: "error",
      });
      if (!res.ok) throw new Error(`gmail get failed: HTTP ${res.status}`);
      const body = (await res.json()) as { id?: unknown; threadId?: unknown; raw?: unknown };
      if (typeof body.raw !== "string" || typeof body.id !== "string")
        throw new Error("gmail get: missing raw");
      return {
        id: body.id,
        raw: body.raw,
        ...(typeof body.threadId === "string" ? { threadId: body.threadId } : {}),
      };
    },
    async findByMessageId(rfc822MessageId) {
      // Only the Message-IDs this binding mints are looked up (no query injection).
      if (!/^<awp-[0-9a-f]{40}@awp-pilot\.invalid>$/.test(rfc822MessageId))
        return { outcome: "unknown", detail: "not a Message-ID minted by this binding" };
      // Any label (a copy may have been moved out of Sent); candidates are verified by content.
      const q = encodeURIComponent(`rfc822msgid:${rfc822MessageId} in:anywhere`);
      const res = await input.authorizedFetch(`${base}?q=${q}&maxResults=${MAX_CANDIDATES}`, {
        method: "GET",
        headers: {},
        redirect: "error",
      });
      if (!res.ok) return { outcome: "unknown", detail: `gmail list failed: HTTP ${res.status}` };
      return listCandidates(await res.json());
    },
  };
}
