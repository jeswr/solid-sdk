// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { id, iso, validateMessage } from "../core/schema.js";
import type { AnyMessage, JsonObject, ReasonCode } from "../core/types.js";
import { claimSchema as domainClaimSchema } from "../gates/inbound.js";
import { type EvidenceLedger, type LedgerEntry, verifyLedger } from "../store/ledger.js";
import type { StateStore } from "../store/state.js";
import type { TraceEventInput } from "../trace/types.js";
import type { SigningKey } from "./jws.js";
import { representationSchema, signStatement, TYP, verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";
export const RECORD_LIMITS = {
  ...DEFAULT_LIMITS,
  maxEnvelopeBytes: 2 * 1024 * 1024,
  maxStringLength: 1024 * 1024,
  maxJsonNodes: 100000,
  maxJsonDepth: 32,
  maxArrayLength: 4096,
};
export const recordEntrySchema = z
  .object({
    seq: z.number().int().positive(),
    at: iso,
    prev: z.string(),
    record: z.object({ type: z.string() }).passthrough(),
    hash: z.string(),
  })
  .strict();
export const recordSegmentSchema = z.strictObject({
  type: z.literal("RecordSegment"),
  actor: id,
  party: id,
  conversation: id,
  entries: z.array(z.strictObject({ entry: recordEntrySchema, proof: z.string() })).max(4096),
  messages: z
    .array(
      z.strictObject({ direction: z.enum(["in", "out"]), digest: z.string(), jws: z.string() }),
    )
    .max(512),
});
const claimSchema = z.strictObject({
  type: z.literal("ForumClaim"),
  id,
  actor: id,
  party: id,
  respondent: id,
  conversation: id,
  segment: z.string(),
  allegation: z.enum(["fee-not-agreed", "onward-leak", "records-differ"]),
  observation: z.string().optional(),
  at: iso,
});
const answerSchema = z.strictObject({
  type: z.literal("ForumAnswer"),
  case: id,
  actor: id,
  party: id,
  request: z.string(),
  segment: z.string(),
  at: iso,
});
const messageSchema = z
  .object({
    id,
    conversation: id,
    from: z.object({ actor: id, onBehalfOf: id }).passthrough(),
    body: z.record(z.string(), z.unknown()),
    kind: z.string(),
  })
  .passthrough();
interface Case {
  id: string;
  claim: z.infer<typeof claimSchema>;
  deadline: string;
  request: string;
  decision?: string;
}
interface Verified {
  party: string;
  entries: LedgerEntry[];
  messages: AnyMessage[];
  directions: Map<string, "in" | "out">;
}
export class LocalForum {
  readonly identity: string;
  constructor(
    private readonly options: {
      identity: string;
      key: SigningKey;
      trust: TrustStore;
      store: StateStore;
      ledger: EvidenceLedger;
      now: () => string;
      responseSeconds: number;
      observers: string[];
      sink: (e: TraceEventInput) => void;
    },
  ) {
    this.identity = options.identity;
  }
  private record(r: { type: string; [key: string]: unknown }) {
    this.options.ledger.append(r, this.options.now());
  }
  private check(
    check: "integrity" | "source" | "authority" | "terms" | "fitness",
    reason?: ReasonCode,
  ) {
    this.options.sink({
      part: "inbound-gate",
      kind: "check",
      check,
      verdict: reason ? "fail" : "pass",
      reason:
        reason ??
        (
          {
            integrity: "intact",
            source: "source-accepted",
            authority: "authority-valid",
            terms: "terms-acceptable",
            fitness: "fit-for-use",
          } as const
        )[check],
      caption: `The forum checks ${check}${reason ? `: ${reason}` : ""}.`,
    });
  }
  private cases() {
    return (this.options.store.load().domain.forumCases ?? {}) as unknown as Record<string, Case>;
  }
  private save(cases: Record<string, Case>) {
    const state = this.options.store.load();
    state.domain.forumCases = cases as unknown as JsonObject;
    this.options.store.save(state);
  }
  requestFor(id: string) {
    return this.cases()[id]?.request;
  }
  decisionFor(id: string) {
    return this.cases()[id]?.decision;
  }
  private async decision(
    c: Case,
    reason: ReasonCode,
    fault: string,
    point: JsonObject,
    settled = true,
  ) {
    const statement = {
      id: `${c.id}:decision`,
      issuer: this.identity,
      subject: c.claim.party,
      claimType: "forum.decision",
      method: "recorded-by-authority",
      asOf: this.options.now(),
      case: c.id,
      reason,
      fault,
      point,
      settled,
      terms: {
        policy: {
          id: `${c.id}:decision-terms`,
          permissions: [{ type: "permission", action: "use", target: `${c.id}:decision` }],
        },
      },
    };
    c.decision = await signStatement(this.options.key, TYP.statement, statement);
    const cases = this.cases();
    const existing = cases[c.id]?.decision;
    if (existing) return existing;
    this.record({ type: "forum-decision", case: c.id, reason, fault, point, settled });
    cases[c.id] = c;
    this.save(cases);
    this.options.sink({
      part: "inbound-gate",
      kind: "decision",
      outcome:
        reason === "record-unavailable" || reason === "evidence-invalid" ? "refuse" : "admit",
      reason,
      caption: `Forum decision: ${fault}; ${JSON.stringify(point)}. No core was re-run.`,
    });
    return c.decision;
  }
  private async segment(
    jws: string,
    party: string,
    conversation: string,
  ): Promise<{ ok: true; value: Verified } | { ok: false; reason: ReasonCode; point: JsonObject }> {
    const checked = await verifyStatement(jws, {
      trust: this.options.trust,
      typ: "awp-record-segment+jws",
      role: "actor",
      schema: recordSegmentSchema,
      limits: RECORD_LIMITS,
      at: this.options.now(),
      verifier: this.identity,
    });
    this.record(checked.verification as unknown as { type: string; [key: string]: unknown });
    const segment = checked.payload;
    if (
      !segment ||
      checked.signer?.subject !== segment.actor ||
      checked.signer.party !== party ||
      segment.party !== party ||
      segment.conversation !== conversation
    )
      return {
        ok: false,
        reason: "evidence-invalid",
        point: { problem: "invalid-segment-signature" },
      };
    const entries = segment.entries.map((s) => s.entry) as LedgerEntry[];
    const chain = verifyLedger(entries);
    if (!chain.ok)
      return {
        ok: false,
        reason: "record-unavailable",
        point: { problem: chain.problem ?? "record-gap", sequence: chain.firstBadSeq ?? 0 },
      };
    const checks = new Set<string>();
    for (const item of segment.entries) {
      if (
        item.entry.record.producer === "core" &&
        ["gate-check", "gate-decision", "message-in", "message-out"].includes(
          item.entry.record.type,
        )
      )
        return {
          ok: false,
          reason: "record-unavailable",
          point: { problem: "core-record-is-not-a-gate-decision", sequence: item.entry.seq },
        };
      const check = await verifyStatement(item.proof, {
        trust: this.options.trust,
        typ: "awp-record-entry+jws",
        role: "actor",
        schema: recordEntrySchema,
        limits: RECORD_LIMITS,
        at: this.options.now(),
        verifier: this.identity,
      });
      if (
        !check.payload ||
        check.signer?.subject !== segment.actor ||
        digestOf(check.payload) !== digestOf(item.entry)
      )
        return {
          ok: false,
          reason: "evidence-invalid",
          point: { problem: "entry-signature", sequence: item.entry.seq },
        };
      if (item.entry.record.type === "gate-check") checks.add(digestOf(item.entry.record));
      if (
        item.entry.record.type === "gate-decision" &&
        (!Array.isArray(item.entry.record.checks) ||
          item.entry.record.checks.length === 0 ||
          !(item.entry.record.checks as unknown[]).every(
            (c) => typeof c === "string" && checks.has(c),
          ))
      )
        return {
          ok: false,
          reason: "record-unavailable",
          point: { problem: "decision-check-missing", sequence: item.entry.seq },
        };
    }
    const messages: AnyMessage[] = [];
    const directions = new Map<string, "in" | "out">();
    for (const archived of segment.messages) {
      const message = await verifyStatement(archived.jws, {
        trust: this.options.trust,
        typ: TYP.message,
        role: "actor",
        schema: messageSchema,
        limits: RECORD_LIMITS,
        at: this.options.now(),
        verifier: this.identity,
      });
      if (
        !message.payload ||
        !validateMessage(message.payload).ok ||
        message.signer?.subject !== message.payload.from.actor ||
        message.signer.party !== message.payload.from.onBehalfOf ||
        digestOf(message.payload) !== archived.digest ||
        message.payload.conversation !== conversation
      )
        return { ok: false, reason: "evidence-invalid", point: { problem: "message-signature" } };
      if (
        !entries.some(
          (e) =>
            e.record.type === `message-${archived.direction}` &&
            e.record.digest === archived.digest,
        )
      )
        return {
          ok: false,
          reason: "record-unavailable",
          point: { problem: "message-entry-missing", message: message.payload.id },
        };
      const decoded = message.payload as unknown as AnyMessage;
      for (const evidence of decoded.evidence ?? []) {
        const representation =
          evidence.role === "representation" && evidence.format === "jws-compact";
        const credential = evidence.role === "credential" && evidence.format === "jws-compact";
        if (!representation && !credential)
          return {
            ok: false,
            reason: "record-unavailable",
            point: { problem: "unsupported-record-evidence", message: decoded.id },
          };
        const args = {
          trust: this.options.trust,
          typ: representation ? TYP.representation : TYP.statement,
          schema: representation
            ? (representationSchema as z.ZodType<unknown>)
            : (domainClaimSchema as z.ZodType<unknown>),
          limits: RECORD_LIMITS,
          at: this.options.now(),
          verifier: this.identity,
        };
        let original = await verifyStatement(evidence.value, {
          ...args,
          role: representation ? "party" : "issuer",
        });
        if (original.verification.outcome === "unknown-key")
          original = await verifyStatement(evidence.value, {
            ...args,
            role: representation ? "issuer" : "party",
          });
        const payload = original.payload as JsonObject | undefined;
        if (
          !payload ||
          original.signer?.subject !== (representation ? payload.party : payload.issuer)
        )
          return {
            ok: false,
            reason: "evidence-invalid",
            point: {
              problem: "embedded-signature",
              message: decoded.id,
              party: decoded.from.onBehalfOf ?? "unsettled",
            },
          };
      }
      messages.push(message.payload as unknown as AnyMessage);
      directions.set(message.payload.id, archived.direction);
    }
    for (const entry of entries)
      if (
        entry.record.conversation === conversation &&
        ["message-in", "message-out"].includes(entry.record.type) &&
        !segment.messages.some((m) => m.digest === entry.record.digest)
      )
        return {
          ok: false,
          reason: "record-unavailable",
          point: { problem: "message-payload-unavailable", sequence: entry.seq },
        };
    return { ok: true, value: { party, entries, messages, directions } };
  }
  async submit(jws: string) {
    const check = await verifyStatement(jws, {
      trust: this.options.trust,
      typ: "awp-forum-claim+jws",
      role: "actor",
      schema: claimSchema,
      limits: RECORD_LIMITS,
      at: this.options.now(),
      verifier: this.identity,
    });
    this.record(check.verification as unknown as { type: string; [key: string]: unknown });
    const claim = check.payload;
    if (!claim || check.signer?.subject !== claim.actor || check.signer.party !== claim.party) {
      this.check("integrity", "bad-signature");
      return { ok: false, reason: "bad-signature" };
    }
    this.check("integrity");
    this.check("source");
    this.check("authority");
    this.check("terms");
    const c: Case = {
      id: claim.id,
      claim,
      deadline: new Date(
        Date.parse(this.options.now()) + this.options.responseSeconds * 1000,
      ).toISOString(),
      request: "",
    };
    const current = this.cases()[c.id];
    if (current) return { ok: false, reason: "evidence-invalid" };
    const segment = await this.segment(claim.segment, claim.party, claim.conversation);
    if (!segment.ok) {
      this.check("fitness", segment.reason);
      await this.decision(c, segment.reason, claim.party, segment.point);
      return { ok: false, reason: segment.reason };
    }
    this.check("fitness");
    c.request = await signStatement(this.options.key, "awp-record-request+jws", {
      type: "RecordRequest",
      issuer: this.identity,
      case: c.id,
      conversation: claim.conversation,
      respondent: claim.respondent,
      deadline: c.deadline,
    });
    const cases = this.cases();
    if (cases[c.id]) return { ok: false, reason: "evidence-invalid" };
    this.record({
      type: "forum-record-requested",
      case: c.id,
      respondent: claim.respondent,
      deadline: c.deadline,
      request: c.request,
    });
    cases[c.id] = c;
    this.save(cases);
    this.options.sink({
      part: "outbound-gate",
      kind: "check",
      check: "recipient",
      verdict: "pass",
      reason: "recipient-established",
      caption: `The forum requests ${claim.respondent}'s record by ${c.deadline}.`,
    });
    return { ok: true, case: c.id, request: c.request };
  }
  async answer(jws: string) {
    const check = await verifyStatement(jws, {
      trust: this.options.trust,
      typ: "awp-forum-answer+jws",
      role: "actor",
      schema: answerSchema,
      limits: RECORD_LIMITS,
      at: this.options.now(),
      verifier: this.identity,
    });
    const answer = check.payload;
    const c = answer ? this.cases()[answer.case] : undefined;
    if (
      !answer ||
      !c ||
      check.signer?.subject !== answer.actor ||
      check.signer.party !== answer.party ||
      answer.party !== c.claim.respondent ||
      answer.request !== c.request
    ) {
      this.check("integrity", "evidence-invalid");
      return { ok: false, reason: "evidence-invalid" };
    }
    if (c.decision) return { ok: false, reason: "expired" };
    if (Date.parse(this.options.now()) > Date.parse(c.deadline)) {
      await this.decision(c, "record-unavailable", c.claim.respondent, {
        problem: "response-deadline-missed",
      });
      return { ok: false, reason: "record-unavailable" };
    }
    this.check("integrity");
    this.check("source");
    this.check("authority");
    this.check("terms");
    const a = await this.segment(c.claim.segment, c.claim.party, c.claim.conversation);
    const b = await this.segment(answer.segment, answer.party, c.claim.conversation);
    if (!a.ok || !b.ok) {
      const failed = !a.ok ? a : !b.ok ? b : undefined;
      if (!failed) throw Error("unreachable");
      this.check("fitness", failed.reason);
      await this.decision(c, failed.reason, !a.ok ? c.claim.party : answer.party, failed.point);
      return { ok: false, reason: failed.reason };
    }
    this.check("fitness");
    for (const [own, other] of [
      [a.value, b.value],
      [b.value, a.value],
    ] as const)
      for (const message of own.messages) {
        if (own.directions.get(message.id) !== "out") continue;
        const received = other.messages.find(
          (m) => m.id === message.id && other.directions.get(m.id) === "in",
        );
        if (!received || digestOf(received) !== digestOf(message)) {
          await this.decision(
            c,
            "record-unavailable",
            "unsettled",
            {
              problem: "message-differs",
              message: message.id,
              sender: own.party,
              receiver: other.party,
            },
            false,
          );
          return { ok: false, reason: "record-unavailable" };
        }
      }
    const messages = [...a.value.messages, ...b.value.messages];
    for (const message of messages)
      if (message.kind === "accept") {
        const offer = messages.find((m) => m.kind === "propose" && m.id === message.body.proposal);
        if (
          !offer ||
          offer.kind !== "propose" ||
          digestOf(offer.body.terms) !== message.body.termsDigest
        ) {
          await this.decision(c, "terms-digest-mismatch", message.from.onBehalfOf ?? "unsettled", {
            problem: "acceptance-terms-differ",
            message: message.id,
          });
          return { ok: true };
        }
      }
    if (c.claim.allegation === "fee-not-agreed")
      for (const charged of messages) {
        if (
          charged.kind !== "invoke" ||
          typeof charged.body.input.fee !== "number" ||
          charged.body.basis.kind !== "agreement"
        )
          continue;
        const agreement = charged.body.basis.agreement;
        const acceptance = messages.find(
          (m) => m.kind === "accept" && m.body.agreement === agreement,
        );
        const offer =
          acceptance?.kind === "accept"
            ? messages.find((m) => m.kind === "propose" && m.id === acceptance.body.proposal)
            : undefined;
        if (
          offer?.kind === "propose" &&
          typeof offer.body.terms.fee === "number" &&
          offer.body.terms.fee !== charged.body.input.fee
        ) {
          await this.decision(c, "not-authorised", charged.from.onBehalfOf ?? "unsettled", {
            problem: "fee-not-agreed",
            message: charged.id,
            agreedFee: offer.body.terms.fee,
            billedFee: charged.body.input.fee,
          });
          return { ok: true };
        }
      }
    if (c.claim.allegation === "onward-leak" && c.claim.observation) {
      const observation = await verifyStatement(c.claim.observation, {
        trust: this.options.trust,
        typ: TYP.statement,
        role: "issuer",
        schema: z
          .object({
            issuer: id,
            claimType: z.literal("onward.observation"),
            dataDigest: z.string(),
            receiver: id,
            subject: id,
          })
          .passthrough(),
        limits: RECORD_LIMITS,
        at: this.options.now(),
        verifier: this.identity,
      });
      const o = observation.payload;
      const offer = messages.find(
        (m) =>
          m.kind === "propose" &&
          m.body.terms.protectedDigest === o?.dataDigest &&
          m.body.terms.forbiddenRecipient === o?.subject,
      );
      const acceptance = offer
        ? messages.find(
            (m) =>
              m.kind === "accept" &&
              m.body.proposal === offer.id &&
              m.from.onBehalfOf === o?.receiver,
          )
        : undefined;
      if (
        o &&
        observation.signer?.subject === o.issuer &&
        this.options.observers.includes(o.issuer) &&
        acceptance
      ) {
        await this.decision(c, "prohibited", o.receiver, {
          problem: "observed-outside-gate",
          observation: digestOf(o),
          acceptance: acceptance.id,
          recipient: o.subject,
        });
        return { ok: true };
      }
    }
    await this.decision(
      c,
      "evidence-missing",
      "unsettled",
      { problem: "records-do-not-settle-allegation" },
      false,
    );
    return { ok: true };
  }
  async audit() {
    for (const c of Object.values(this.cases()))
      if (!c.decision && Date.parse(this.options.now()) > Date.parse(c.deadline))
        await this.decision(c, "record-unavailable", c.claim.respondent, {
          problem: "party-did-not-answer",
        });
    return Object.values(this.cases()).map((c) => ({ case: c.id, answered: !!c.decision }));
  }
}
