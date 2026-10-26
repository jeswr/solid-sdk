/**
 * The supervisor-facing processing interface: accept ONE provider-delivered input (a raw
 * RFC 5322 message, a Gmail `format=raw` message JSON, or a direct-binding envelope),
 * process it deterministically, and return validated OUTBOUND INTENTS — MIME plus a Gmail
 * `users.messages.send` body — for the supervisor's own authenticated connector to send.
 *
 * Nothing here sends, fetches, or holds a provider credential. Each outbound item is
 * self-checked (own signature re-verified, audience pinned, recipient address taken from
 * the pinned endpoint, MIME round-tripped through the inbound parser with parity) and is
 * marked `validated-not-sent`, or `blocked` with the failing check.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildEmail,
  EMAIL_BINDING,
  type EmailObservation,
  gmailSendPayload,
  parseInboundEmail,
  rawFromGmailMessage,
  validateOutboundEmail,
} from "./bindings/email.js";
import { digestBytes } from "./core/canonical.js";
import { DEFAULT_LIMITS, parseBoundedJson } from "./core/limits.js";
import type { Iri } from "./core/types.js";
import type { AgentRuntime, OutboundMessage, StepResult } from "./runtime/agent.js";
import type { WireMessage } from "./store/state.js";

export type InputFormat = "eml" | "gmail-json" | "envelope";

export interface EmailSettings {
  /** This agent's own mailbox address (the From of outbound email). */
  readonly selfAddress?: string;
  /** Reject on human-summary mismatch (default true). */
  readonly strictParity?: boolean;
  /** Max outbound MIME size. */
  readonly maxMimeBytes?: number;
}

/** Thread bookkeeping so replies stay in the provider's thread. Non-authoritative. */
export interface ThreadRecord {
  emailMessageIds: string[];
  gmailThreadId?: string;
}

export class ThreadStore {
  private data: Record<string, ThreadRecord>;
  constructor(private readonly path?: string) {
    this.data =
      path && existsSync(path)
        ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, ThreadRecord>)
        : {};
  }
  get(conversation: Iri): ThreadRecord | undefined {
    return this.data[conversation];
  }
  note(conversation: Iri, emailMessageId?: string, gmailThreadId?: string): void {
    const rec = this.data[conversation] ?? { emailMessageIds: [] };
    if (emailMessageId && !rec.emailMessageIds.includes(emailMessageId))
      rec.emailMessageIds = [...rec.emailMessageIds, emailMessageId].slice(-20);
    if (gmailThreadId && /^[A-Za-z0-9]{1,64}$/.test(gmailThreadId))
      rec.gmailThreadId = gmailThreadId;
    this.data[conversation] = rec;
    if (this.path) writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}

export interface OutboundCheck {
  readonly check: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface ProcessedOutbound {
  readonly id: Iri;
  readonly kind: string;
  readonly conversation: Iri;
  readonly toActor?: Iri;
  readonly envelope: WireMessage;
  readonly email?: {
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly emailMessageId: string;
    readonly raw: string;
    readonly gmailSend: { raw: string; threadId?: string };
  };
  readonly checks: readonly OutboundCheck[];
  readonly status: "validated-not-sent" | "blocked";
  /**
   * Set when a PROTECTED disclosure's authorisation basis does not hold now: local renderings
   * (operator list, spool files) then omit the envelope and email. Sending adapters re-check
   * it independently at transmission.
   */
  readonly withheld?: string;
}

export interface ProcessReport {
  readonly agent: Iri;
  readonly at: string;
  readonly input?: {
    readonly format: InputFormat;
    readonly digest: string;
    readonly binding: string;
    /** Transport that carried an email-format input (e.g. the local MCP interface). */
    readonly carrier?: string;
    readonly bindingOutcome: string;
    readonly email?: EmailObservation;
    readonly parity?: string;
    readonly bindingDetail?: string;
    readonly structuredCopies?: number;
  };
  readonly step?: {
    readonly disposition: string;
    readonly reason?: string;
    readonly detail?: string;
    readonly messageId?: Iri;
    readonly kind?: string;
    readonly conversation?: Iri;
    readonly phase?: string;
    readonly pendingApproval?: {
      actionDigest: string;
      operation: Iri;
      action: string;
      recipient?: Iri;
    };
    readonly decisions: ReadonlyArray<{ outcome: string; reason: string; actionDigest: string }>;
  };
  readonly outbound: readonly ProcessedOutbound[];
  readonly notice: string;
}

export const NOT_SENT_NOTICE =
  "Nothing was sent. Outbound items are reviewed intents for the supervisor's provider connector.";

export function summariseStep(step: StepResult): NonNullable<ProcessReport["step"]> {
  return {
    disposition: step.disposition,
    ...(step.reason ? { reason: step.reason } : {}),
    ...(step.detail ? { detail: step.detail } : {}),
    ...(step.messageId ? { messageId: step.messageId } : {}),
    ...(step.kind ? { kind: step.kind } : {}),
    ...(step.conversation ? { conversation: step.conversation } : {}),
    ...(step.phase ? { phase: step.phase } : {}),
    ...(step.pendingApproval
      ? {
          pendingApproval: {
            actionDigest: step.pendingApproval.actionDigest,
            operation: step.pendingApproval.intent.operation,
            action: step.pendingApproval.intent.action,
            ...(step.pendingApproval.intent.recipient
              ? { recipient: step.pendingApproval.intent.recipient }
              : {}),
          },
        }
      : {}),
    decisions: step.decisions.map((d) => ({
      outcome: d.outcome,
      reason: d.reason,
      actionDigest: d.actionDigest,
    })),
  };
}

/** Prepare reviewed outbound items (email when a pinned mailto endpoint exists). */
export async function prepareOutbound(
  rt: AgentRuntime,
  outbound: readonly OutboundMessage[],
  settings: EmailSettings,
  threads: ThreadStore,
  now: Date,
): Promise<ProcessedOutbound[]> {
  const items: ProcessedOutbound[] = [];
  for (const out of outbound) {
    const checks: OutboundCheck[] = [];
    const sig = await rt.selfCheck(out.wire);
    checks.push({ check: "own-signature-verifies", ok: sig.ok, detail: sig.detail });
    const endpoints = out.toActor ? rt.endpointsFor(out.toActor) : [];
    checks.push(
      out.toActor
        ? {
            check: "audience-is-pinned-actor",
            ok: rt.isPinnedActor(out.toActor),
            detail: out.toActor,
          }
        : {
            check: "audience-is-pinned-actor",
            ok: out.kind !== "propose" && out.kind !== "accept",
            detail: "public reply to an anonymous requester",
          },
    );
    const mailto = endpoints.find((e) => e.startsWith("mailto:"));
    let email: ProcessedOutbound["email"];
    if (mailto && settings.selfAddress && out.wire.format === "awp-jws-compact/0.1") {
      const to = mailto.slice("mailto:".length);
      const thread = threads.get(out.conversation);
      const lastId = thread?.emailMessageIds.at(-1);
      const built = buildEmail({
        out,
        from: settings.selfAddress,
        to,
        date: now,
        ...(lastId ? { inReplyToEmailId: lastId } : {}),
        ...(thread ? { references: thread.emailMessageIds } : {}),
      });
      checks.push({ check: "recipient-from-pinned-endpoint", ok: true, detail: mailto });
      const size = Buffer.byteLength(built.raw, "utf8");
      checks.push({
        check: "mime-size-bound",
        ok: size <= (settings.maxMimeBytes ?? 256 * 1024),
        detail: `${size} bytes`,
      });
      const round = parseInboundEmail(built.raw, { strictParity: true });
      const same =
        round.ok && round.wire.format === "awp-jws-compact/0.1" && round.wire.jws === out.wire.jws;
      checks.push({
        check: "mime-roundtrip-and-human-parity",
        ok: same,
        detail: round.ok
          ? `parity ${round.parity}, copies ${round.structuredCopies}`
          : round.reason,
      });
      const exact = validateOutboundEmail(built.raw, {
        from: settings.selfAddress,
        to,
        jws: out.wire.jws,
      });
      checks.push({
        check: "exact-outbound-bytes",
        ok: exact.ok,
        detail: exact.ok
          ? "headers, sender, single recipient, structured copy and parity"
          : exact.problems.join("; "),
      });
      threads.note(out.conversation, built.emailMessageId);
      email = {
        from: built.from,
        to: built.to,
        subject: built.subject,
        emailMessageId: built.emailMessageId,
        raw: built.raw,
        gmailSend: gmailSendPayload(built, thread?.gmailThreadId),
      };
    } else {
      checks.push({
        check: "email-endpoint",
        ok: true,
        detail: "no pinned mailto endpoint or no self address; direct envelope only",
      });
    }
    const hold = rt.disclosureHold(out.id);
    if (hold.protected)
      checks.push({
        check: "disclosure-conditions-hold",
        ok: hold.holds,
        detail: hold.reason ?? "authorisation basis holds now; re-checked at every transmission",
      });
    const blocked = checks.some((c) => !c.ok);
    items.push({
      id: out.id,
      kind: out.kind,
      conversation: out.conversation,
      ...(out.toActor ? { toActor: out.toActor } : {}),
      envelope: out.wire,
      ...(email && !blocked ? { email } : {}),
      checks,
      status: blocked ? "blocked" : "validated-not-sent",
      ...(hold.protected && !hold.holds ? { withheld: hold.reason ?? "condition fails" } : {}),
    });
  }
  return items;
}

/** Process one provider-delivered input. Deterministic given the agent state and clock. */
export async function processInput(
  rt: AgentRuntime,
  input: {
    format: InputFormat;
    data: Buffer | string;
    gmailThreadId?: string;
    /**
     * The binding that carried the input when it is not the format's own: an `envelope`
     * delivered through the local MCP interface is `mcp-tool/0.1`; email formats keep the
     * email binding (its MIME/parity rules apply) and record the carrier separately.
     */
    carrier?: string;
  },
  settings: EmailSettings,
  threads: ThreadStore,
  now: Date,
): Promise<ProcessReport> {
  const at = now.toISOString();
  const digest = digestBytes(input.data);
  let wire: WireMessage | undefined;
  let emailObs: EmailObservation | undefined;
  let parity: string | undefined;
  let parityDetail: string | undefined;
  let copies: number | undefined;
  let binding = input.carrier ?? "direct-local/0.1";
  let bindingOutcome = "ok";
  let gmailThreadId = input.gmailThreadId;

  try {
    if (input.format === "envelope") {
      const value = parseBoundedJson(input.data.toString(), DEFAULT_LIMITS) as WireMessage;
      wire = value;
    } else {
      binding = EMAIL_BINDING;
      let raw: Buffer | string = input.data;
      if (input.format === "gmail-json") {
        const obj = parseBoundedJson(input.data.toString(), {
          ...DEFAULT_LIMITS,
          maxEnvelopeBytes: 40 * 1024 * 1024,
          maxStringLength: 40 * 1024 * 1024,
        }) as { threadId?: unknown };
        raw = rawFromGmailMessage(obj);
        if (typeof obj.threadId === "string") gmailThreadId = obj.threadId;
      }
      const parsed = parseInboundEmail(raw, { strictParity: settings.strictParity ?? true });
      emailObs = parsed.email;
      copies = parsed.structuredCopies;
      if (parsed.ok) {
        wire = parsed.wire;
        parity = parsed.parity;
      } else {
        bindingOutcome = parsed.reason;
        parityDetail = parsed.detail;
      }
    }
  } catch (error) {
    bindingOutcome = "malformed";
    rt.recordBindingEvent({
      type: "binding-rejection",
      binding,
      reason: "malformed",
      detail: (error as Error).message.slice(0, 300),
      digest,
    });
  }

  const inputSummary = {
    format: input.format,
    digest,
    binding,
    ...(input.carrier && input.carrier !== binding ? { carrier: input.carrier } : {}),
    bindingOutcome,
    ...(emailObs ? { email: emailObs } : {}),
    ...(parity ? { parity } : {}),
    ...(parityDetail ? { bindingDetail: parityDetail } : {}),
    ...(copies !== undefined ? { structuredCopies: copies } : {}),
  };

  if (!wire) {
    if (bindingOutcome !== "malformed") {
      rt.recordBindingEvent({
        type: "binding-rejection",
        binding,
        reason: bindingOutcome,
        digest,
        ...(emailObs ? { emailFrom: emailObs.from ?? "unknown" } : {}),
      });
    }
    return {
      agent: rt.identity.actor,
      at,
      input: inputSummary,
      outbound: [],
      notice: NOT_SENT_NOTICE,
    };
  }

  const step = await rt.receive(wire, {
    binding:
      input.carrier && input.carrier !== binding ? `${binding} via ${input.carrier}` : binding,
  });
  if (step.conversation && emailObs?.emailMessageId)
    threads.note(step.conversation, emailObs.emailMessageId, gmailThreadId);
  if (step.messageId && emailObs) {
    const expected = step.messageId
      ? rt.conversation(step.conversation ?? "")?.peer.actor
      : undefined;
    const pinned = expected ? rt.endpointsFor(expected) : [];
    rt.recordBindingEvent({
      type: "channel-observation",
      binding,
      message: step.messageId,
      emailFrom: emailObs.from ?? "unknown",
      matchesPinnedEndpoint: Boolean(
        emailObs.from && pinned.includes(`mailto:${emailObs.from.toLowerCase()}`),
      ),
      note: "observation only; authority comes from the verified statement, not the mailbox",
    });
  }
  const outbound = await prepareOutbound(rt, step.outbound, settings, threads, now);
  return {
    agent: rt.identity.actor,
    at,
    input: inputSummary,
    step: summariseStep(step),
    outbound,
    notice: NOT_SENT_NOTICE,
  };
}
