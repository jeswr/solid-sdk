/**
 * UC-02 orchestration on the shared runtime: remember a conventional scheduling endpoint
 * from a first-contact email, and later book through it with a fixed adapter — no LLM, no
 * generated email.
 *
 *   ingestEmail  → deterministic link extraction → registry match → candidate association
 *   confirm      → owner-signed approval over the association digest → accepted
 *   book         → usable association? → re-check service terms when due → availability →
 *                  deterministic slot choice (owner's zone/working hours, DST-aware) →
 *                  ActionIntent → runtime.runTask (mandate, write-ahead, idempotency key,
 *                  reconciliation) → confirmation only from provider evidence
 */
import { parseEmail } from "@jeswr/agentic-legacy-bridge";
import { digestOf } from "../../core/canonical.js";
import { DEFAULT_LIMITS } from "../../core/limits.js";
import type { ActionIntent, Iri, JsonObject } from "../../core/types.js";
import { verifyApproval } from "../../mechanisms/mandate.js";
import type { TrustStore } from "../../mechanisms/trust.js";
import { PURPOSE } from "../../profile/vocabulary.js";
import type { AgentRuntime } from "../../runtime/agent.js";
import type { SyntheticCalendar } from "../scheduling.js";
import { BOOKING_ADAPTER, bookingKey, type SlotsClient } from "./adapter.js";
import { type Association, type AssociationStore, associationDigest } from "./associations.js";
import {
  CONVENTIONAL_BOOK_OP,
  classifyLink,
  extractLinks,
  REGISTRY,
  type SupportedService,
} from "./registry.js";

export interface IngestResult {
  readonly sender?: string;
  readonly forwarded: boolean;
  readonly candidates: readonly {
    id: string;
    observedUrl: string;
    conflictsWith?: string;
    digest: string;
  }[];
  readonly disputed: readonly string[];
  readonly rejectedLinks: readonly { url: string; reason: string }[];
  readonly refused: readonly string[];
}

export type BookingOutcome =
  | {
      readonly status: "booked";
      readonly booking: JsonObject;
      readonly association: string;
      readonly task: Iri;
      readonly emailsGenerated: 0;
    }
  | {
      readonly status: "blocked";
      readonly reason: string;
      readonly association?: string;
      readonly fallback: string;
      readonly emailsGenerated: 0;
    }
  | {
      readonly status: "pending-approval" | "denied" | "not-executed" | "uncertain";
      readonly reason: string;
      readonly association: string;
      readonly task: Iri;
      readonly emailsGenerated: 0;
    };

const FALLBACK = "ask the owner, or use a communication channel (not automated here)";

export class ConventionalScheduler {
  constructor(
    private readonly deps: {
      runtime: AgentRuntime;
      trust: TrustStore;
      store: AssociationStore;
      /** Operator-configured clients per service id (the ONLY request targets). */
      clients: ReadonlyMap<string, SlotsClient>;
      registry?: readonly SupportedService[];
      owner: { actor: Iri; name: string; email: string; calendar: SyntheticCalendar };
      now: () => Date;
    },
  ) {}

  private at(): string {
    return this.deps.now().toISOString();
  }

  /** Remember supported links from a first-contact email as CANDIDATES (never usable yet). */
  ingestEmail(raw: string | Uint8Array): IngestResult {
    const email = parseEmail(raw);
    const sender = email.from?.address?.toLowerCase();
    const resent = email.headers.some(([n]) => n.startsWith("resent-") || n === "x-forwarded-for");
    const forwarded = /^\s*(fwd?|fw)\s*:/i.test(email.subject ?? "") || resent;
    const rejectedLinks: Array<{ url: string; reason: string }> = [];
    const candidates: Array<{
      id: string;
      observedUrl: string;
      conflictsWith?: string;
      digest: string;
    }> = [];
    const disputed: string[] = [];
    const refused: string[] = [];
    // Links in quoted lines are someone else's words: treat the whole claim as forwarded.
    const quoted = email.textBody
      .split("\n")
      .filter((l) => l.trimStart().startsWith(">"))
      .join("\n");
    for (const url of extractLinks(email.textBody)) {
      const v = classifyLink(url, this.deps.registry ?? REGISTRY);
      if (!v.ok) {
        rejectedLinks.push({ url: v.url, reason: v.reason });
        this.deps.runtime.recordObservation({
          type: "endpoint-rejected",
          observedBy: "conventional-scheduler",
          url: v.url,
          reason: v.reason,
          note: "never contacted",
        });
        continue;
      }
      if (!sender) {
        rejectedLinks.push({ url: v.canonical, reason: "no sender address" });
        continue;
      }
      const r = this.deps.store.recordCandidate({
        contact: sender,
        service: v.service,
        identifiers: v.identifiers,
        observedUrl: v.canonical,
        source: {
          rawSha256: `sha-256:${email.rawSha256}`,
          ...(email.messageId ? { emailMessageId: `<${email.messageId}>` } : {}),
          observedFrom: sender,
          ...(email.subject ? { subject: email.subject } : {}),
          receivedAt: this.at(),
          forwarded: forwarded || quoted.includes(url),
        },
        at: this.at(),
      });
      if (r.refused) {
        refused.push(r.refused);
        continue;
      }
      candidates.push({
        id: r.association.id,
        observedUrl: v.canonical,
        ...(r.association.conflictsWith ? { conflictsWith: r.association.conflictsWith } : {}),
        digest: associationDigest(r.association),
      });
      if (r.disputed) disputed.push(r.disputed.id);
      this.deps.runtime.recordObservation({
        type: "association-candidate",
        observedBy: "conventional-scheduler",
        association: r.association.id,
        contact: sender,
        service: v.service.id,
        source: `sha-256:${email.rawSha256}`,
        status: "candidate",
        note: "a claim from email text; not authority and not usable until the owner confirms",
      });
    }
    return {
      ...(sender ? { sender } : {}),
      forwarded,
      candidates,
      disputed,
      rejectedLinks,
      refused,
    };
  }

  /** Apply an owner-signed approval (or denial) bound to one association's digest. */
  async confirm(associationId: string, approvalJws: string): Promise<Association> {
    const a = this.deps.store.get(associationId);
    if (!a) throw new Error("unknown association");
    const v = await verifyApproval(approvalJws, {
      trust: this.deps.trust,
      actor: this.deps.owner.actor,
      limits: DEFAULT_LIMITS,
      at: this.at(),
    });
    if (!v.ok) throw new Error(`approval not accepted: ${v.reason}`);
    if (v.approval.actionDigest !== associationDigest(a))
      throw new Error("approval is for different association content");
    const next = this.deps.store.decide(a.id, v.approval.decision, v.approval.id, this.at());
    this.deps.runtime.recordObservation({
      type: "association-decision",
      observedBy: "owner",
      association: a.id,
      decision: v.approval.decision,
      approval: v.approval.id,
      status: next.status,
    });
    return next;
  }

  /** Book a meeting through the remembered service for `contact`, if and only if allowed. */
  async book(request: {
    requestId: string;
    contact: string;
    window: { start: string; end: string };
    durationMinutes: number;
  }): Promise<BookingOutcome> {
    const u = this.deps.store.usable(request.contact, this.at());
    if ("blocked" in u) {
      this.deps.runtime.recordObservation({
        type: "conventional-booking-blocked",
        observedBy: "conventional-scheduler",
        contact: request.contact,
        reason: u.blocked,
      });
      return {
        status: "blocked",
        reason: u.blocked,
        ...(u.association ? { association: u.association.id } : {}),
        fallback: FALLBACK,
        emailsGenerated: 0,
      };
    }
    const a = u.association;
    // Idempotent per request: a concluded booking is reported, never repeated.
    const done = this.deps.runtime
      .tasks()
      .find(
        (t) =>
          t.id ===
          `urn:awp:task:${digestOf({ requestId: request.requestId, association: a.id }).slice(9, 41)}`,
      );
    const doneEffect = done
      ? this.deps.runtime
          .effectStates()
          .find((e) => e.key === bookingKey(a.serviceId, done.id.slice("urn:awp:task:".length)))
      : undefined;
    if (
      done?.status === "concluded" &&
      doneEffect?.conclusion === "completed" &&
      doneEffect.observed
    ) {
      return {
        status: "booked",
        booking: doneEffect.observed as JsonObject,
        association: a.id,
        task: done.id,
        emailsGenerated: 0,
      };
    }
    const client = this.deps.clients.get(a.serviceId);
    if (!client)
      return {
        status: "blocked",
        reason: `no configured adapter endpoint for ${a.serviceId}`,
        association: a.id,
        fallback: FALLBACK,
        emailsGenerated: 0,
      };
    const { user, event } = a.identifiers;

    // Re-check the service's terms when due (and before first use).
    let terms: JsonObject;
    try {
      terms = await client.eventType(user, event);
    } catch (error) {
      const reason = `service re-check failed: ${(error as Error).message}`;
      if (u.needsRecheck) this.deps.store.markChanged(a.id, reason, this.at());
      return {
        status: "blocked",
        reason,
        association: a.id,
        fallback: FALLBACK,
        emailsGenerated: 0,
      };
    }
    const verified = {
      durationMinutes: Number(terms.durationMinutes),
      feeAmount: Number((terms.fee as JsonObject | undefined)?.amount ?? Number.NaN),
      requiredFields: [...((terms.requiredFields as string[] | undefined) ?? [])].sort(),
    };
    if (u.needsRecheck) {
      const after = this.deps.store.markVerified(a.id, verified, this.at());
      this.deps.runtime.recordObservation({
        type: "association-revalidated",
        observedBy: "conventional-scheduler",
        association: a.id,
        status: after.status,
        terms: verified,
      });
      if (after.status !== "accepted")
        return {
          status: "blocked",
          reason: "service terms changed since last verification; owner must re-confirm",
          association: a.id,
          fallback: FALLBACK,
          emailsGenerated: 0,
        };
    } else if (digestOf(verified) !== digestOf(a.verifiedTerms ?? {})) {
      this.deps.store.markChanged(a.id, "service terms changed", this.at());
      return {
        status: "blocked",
        reason: "service terms changed; owner must re-confirm",
        association: a.id,
        fallback: FALLBACK,
        emailsGenerated: 0,
      };
    }
    if (verified.durationMinutes !== request.durationMinutes)
      return {
        status: "blocked",
        reason: "service duration differs from the request",
        association: a.id,
        fallback: FALLBACK,
        emailsGenerated: 0,
      };
    if (!(verified.feeAmount === 0))
      return {
        status: "blocked",
        reason: "service now charges a fee; a scheduling mandate does not cover payment",
        association: a.id,
        fallback: FALLBACK,
        emailsGenerated: 0,
      };
    if (verified.requiredFields.some((f) => f !== "name" && f !== "email"))
      return {
        status: "blocked",
        reason: "service requires disclosure beyond name and email",
        association: a.id,
        fallback: FALLBACK,
        emailsGenerated: 0,
      };

    // Current availability (a cached slot is never treated as a reservation).
    const avail = await client.availability(user, event, request.window.start, request.window.end);
    const now = Date.parse(this.at());
    const slot = ((avail.slots as Array<{ start: string; end: string }> | undefined) ?? [])
      .filter((s) => Date.parse(s.end) - Date.parse(s.start) === request.durationMinutes * 60_000)
      .sort((x, y) => Date.parse(x.start) - Date.parse(y.start))
      .find((s) => this.deps.owner.calendar.acceptable(s, now));
    if (!slot)
      return {
        status: "blocked",
        reason: "no provider slot fits the owner's window and working hours",
        association: a.id,
        fallback: FALLBACK,
        emailsGenerated: 0,
      };

    const idem = digestOf({ requestId: request.requestId, association: a.id }).slice(9, 41);
    const taskId = `urn:awp:task:${idem}`;
    const intent: ActionIntent = {
      operation: CONVENTIONAL_BOOK_OP.id,
      action: "use",
      target: CONVENTIONAL_BOOK_OP.id,
      purpose: PURPOSE.scheduling,
      recipient: `mailto:${a.contact}`,
      parameters: {
        association: a.id,
        service: a.serviceId,
        adapterVersion: a.adapterVersion,
        start: slot.start,
        durationMinutes: request.durationMinutes,
        disclosure: ["email", "name"],
        fee: 0,
      },
      conversation: taskId,
    };
    const r = await this.deps.runtime.runTask({
      taskId,
      kind: "conventional-booking",
      plan: {
        adapter: BOOKING_ADAPTER,
        key: bookingKey(a.serviceId, idem),
        params: {
          user,
          event,
          start: slot.start,
          inviteeName: this.deps.owner.name,
          inviteeEmail: this.deps.owner.email,
        },
        intent,
        activityType: "https://schema.org/ReserveAction",
      },
    });
    const effect = r.effect;
    if (r.pendingApproval)
      return {
        status: "pending-approval",
        reason: "owner approval required for this exact booking",
        association: a.id,
        task: taskId,
        emailsGenerated: 0,
      };
    if (r.task.status === "denied")
      return {
        status: "denied",
        reason: "owner declined",
        association: a.id,
        task: taskId,
        emailsGenerated: 0,
      };
    if (effect?.conclusion === "completed" && effect.observed) {
      return {
        status: "booked",
        booking: effect.observed as JsonObject,
        association: a.id,
        task: taskId,
        emailsGenerated: 0,
      };
    }
    const reason =
      r.decisions.find((d) => d.outcome !== "permit")?.reason ??
      effect?.conclusion ??
      "not executed";
    return {
      status: effect?.conclusion === "uncertain" ? "uncertain" : "not-executed",
      reason,
      association: a.id,
      task: taskId,
      emailsGenerated: 0,
    };
  }
}
