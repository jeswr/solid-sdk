// AUTHORED-BY Codex GPT-6
/** One party's durable state machine. Network scheduling belongs to the binding.
 * No method runs another party's protocol function. All receive calls must follow
 * that party's ordinary inbound gate (the operation handler supplies its peer).
 */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { jointLimits, parseBoundedJson } from "../core/limits.js";
import type { Json, JsonObject } from "../core/types.js";
import type { FixedJointSession, JointOutcome, JointProtocol } from "../derive/verifiers.js";
import type { AgentRuntime } from "../runtime/agent.js";
import type { HandlerContext } from "../runtime/operations.js";
import type { StateStore } from "../store/state.js";

export const JOINT_OPERATIONS = ["open", "contribute", "partial", "outcome"].map(
  (s) => `urn:op:joint:${s}`,
);
const object = z.record(z.string(), z.json());
const outcomeSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("release"),
    count: z.number().optional(),
    sum: z.number().optional(),
    evidence: object,
  }),
  z.strictObject({ type: z.literal("threshold-verdict"), verdict: z.boolean(), evidence: object }),
  z.strictObject({ type: z.literal("below-minimum-group"), evidence: object }),
  z.strictObject({ type: z.literal("too-few-contributors"), evidence: object }),
]);
export const jointPayloadSchema = z.union([
  z.strictObject({ sessionId: z.string(), session: object, ruleDigest: z.string() }),
  z.strictObject({ sessionId: z.string(), contribution: object, share: object }),
  z.strictObject({ sessionId: z.string(), partial: object }),
  z.strictObject({ sessionId: z.string(), outcome: outcomeSchema, contributions: z.array(object) }),
]);
interface JointState {
  fixedDigest: string;
  opened: boolean;
  contributions: Record<string, JsonObject>;
  shares: Record<string, JsonObject>;
  partials: Record<string, JsonObject>;
  own?: JsonObject;
  localPartial?: JsonObject;
  outcome?: JointOutcome;
}
const inFlight = new WeakMap<StateStore, Set<string>>();
export class JointParty {
  private claim(key: string): (() => void) | undefined {
    const seen = inFlight.get(this.options.store) ?? new Set<string>();
    inFlight.set(this.options.store, seen);
    if (seen.has(key)) return undefined;
    seen.add(key);
    return () => seen.delete(key);
  }
  constructor(
    readonly options: {
      party: string;
      requester: string;
      protocol: JointProtocol;
      secretKeys: JsonObject;
      fixed: FixedJointSession;
      runtime: () => AgentRuntime;
      store: StateStore;
      inputs: readonly string[];
      purpose: string;
      recipient: string;
    },
  ) {}
  private load(): JointState {
    const fixedDigest = digestOf(this.options.fixed);
    const state = structuredClone(
      (this.options.store.load().domain.joint ?? {
        fixedDigest,
        opened: this.options.party === this.options.requester,
        contributions: {},
        shares: {},
        partials: {},
      }) as unknown as JointState,
    );
    if (state.fixedDigest !== fixedDigest) throw new Error("replay-conflict");
    return state;
  }
  private save(value: JointState) {
    const state = this.options.store.load();
    state.domain.joint = value as unknown as Json;
    this.options.store.save(state);
  }
  async receive(ctx: HandlerContext, operation: string, message: JsonObject) {
    const state = this.load(),
      fixed = this.options.fixed;
    if (message.sessionId !== fixed.session.sessionId || !ctx.peer.party)
      throw new Error("joint session or sender missing");
    const kind = operation.slice(operation.lastIndexOf(":") + 1) as
      | "open"
      | "contribute"
      | "partial"
      | "outcome";
    parseBoundedJson(
      JSON.stringify(message),
      jointLimits(kind, (fixed.session.roster as JsonObject[]).length),
    );
    const release = this.claim(`${message.sessionId}:${operation}:${ctx.peer.party}`);
    if (!release) return { ok: false, reason: "replay-conflict" };
    try {
      if (operation === "urn:op:joint:open") {
        if (state.opened) return { ok: false, reason: "replay-conflict" };
        if (
          ctx.peer.party !== this.options.requester ||
          digestOf(message.session) !== digestOf(fixed.session) ||
          message.ruleDigest !== fixed.ruleDigest
        )
          return { ok: false, reason: "rule-not-accepted" };
        if (fixed.session.wire) {
          const { ruleDigest, wire, ...params } = message.session as JsonObject;
          const computed = await this.options.protocol.newSession(
            params as unknown as import("../derive/verifiers.js").SessionParams,
          );
          if (
            computed.ruleDigest !== ruleDigest ||
            digestOf(computed.session) !== digestOf(fixed.session)
          )
            return { ok: false, reason: "rule-not-accepted" };
          void wire;
        }
        state.opened = true;
      } else {
        if (!state.opened) throw new Error("joint session was not opened");
        if (operation === "urn:op:joint:contribute") {
          const c = message.contribution as JsonObject;
          if (!c || c.party !== ctx.peer.party)
            throw new Error("joint contributor differs from authenticated sender");
          if (state.contributions[ctx.peer.party]) return { ok: false, reason: "replay-conflict" };
          state.contributions[ctx.peer.party] = c;
          if (message.share) state.shares[ctx.peer.party] = message.share as JsonObject;
        } else if (operation === "urn:op:joint:partial") {
          const p = message.partial as JsonObject;
          if (!p || p.party !== ctx.peer.party)
            throw new Error("joint partial differs from authenticated sender");
          if (fixed.session.wire) {
            const roster = fixed.session.roster as JsonObject[],
              index = roster.findIndex((p) => p.party === this.options.party);
            if (index < 0 || (p.message as JsonObject)?.recipient !== index)
              return { ok: false, reason: "source-not-accepted" };
          }
          if (
            state.partials[ctx.peer.party] &&
            digestOf(state.partials[ctx.peer.party]) !== digestOf(p)
          )
            throw new Error("conflicting partial");
          state.partials[ctx.peer.party] = p;
        } else if (operation === "urn:op:joint:outcome") {
          if (state.outcome) return { ok: false, reason: "replay-conflict" };
          const contributions = message.contributions as JsonObject[];
          const checked = await this.options.protocol.verifyOutcome({
            session: fixed.session,
            outcome: message.outcome as unknown as JointOutcome,
            contributions,
          });
          if (!checked.ok) {
            this.release("joint outcome", {
              evidenceOk: false,
              partyAtFault: checked.partyAtFault,
              record: {
                ...message,
                reason: checked.reason,
                check: checked.check ?? "unknown",
                index: checked.index ?? null,
              },
            });
            return { ok: false, reason: "derivation-not-verified" };
          }
          state.outcome = message.outcome as unknown as JointOutcome;
        }
      }
      this.save(state);
      ctx.record({
        type: "joint-message",
        operation,
        sender: ctx.peer.party,
        session: fixed.session.sessionId,
        ...(operation === "urn:op:joint:partial"
          ? { recipient: this.options.party, digest: digestOf(message) }
          : { evidence: message }),
      });
      return { ok: true };
    } finally {
      release();
    }
  }
  private release(
    way: "joint contribution" | "joint partial" | "joint outcome",
    extra: {
      evidenceOk?: boolean;
      partyAtFault?: string;
      suppressed?: boolean;
      record?: JsonObject;
    } = {},
  ) {
    return this.options.runtime().derivationRelease({
      subject: String(this.options.fixed.session.sessionId),
      purpose: this.options.purpose,
      recipient: this.options.recipient,
      minimumGroup: Number(this.options.fixed.session.minimumGroup),
      inputs: this.options.inputs,
      way,
      ...extra,
    });
  }
  async contribute() {
    const release = this.claim("own-contribution");
    if (!release) return { ok: false as const, reason: "replay-conflict" };
    try {
      const s = this.load();
      if (!s.opened) throw new Error("joint session was not opened");
      if (s.own) return { ok: false as const, reason: "replay-conflict" };
      const facts = this.options
        .runtime()
        .admittedStatements()
        .filter((s) => this.options.inputs.includes(String(s.id)));
      const computeOnly = (this.options.fixed.session.roster as JsonObject[]).some(
        (p) => p.party === this.options.party && p.computeOnly,
      );
      const count = computeOnly ? 0 : facts.find((f) => f.claimType === "joint.count")?.value;
      const sum = computeOnly ? 0 : facts.find((f) => f.claimType === "joint.sum")?.value;
      if (
        typeof count !== "number" ||
        typeof sum !== "number" ||
        !Number.isSafeInteger(count) ||
        !Number.isSafeInteger(sum) ||
        count < 0 ||
        sum < 0
      )
        throw new Error("joint inputs are unavailable or invalid");
      if (!this.release("joint contribution")) return { ok: false as const, reason: "prohibited" };
      const result = await this.options.protocol.contribute({
        session: this.options.fixed.session,
        party: this.options.party,
        secretKeys: this.options.secretKeys,
        count,
        sum,
      });
      s.contributions[this.options.party] = result.contribution;
      s.own = result as unknown as JsonObject;
      this.save(s);
      const { local, auditOpening, ...publicResult } = result;
      void local;
      void auditOpening;
      return { ok: true as const, ...publicResult };
    } finally {
      release();
    }
  }
  async partial() {
    const s = this.load();
    if (!s.opened) throw new Error("joint session was not opened");
    if (s.partials[this.options.party])
      return { ok: true as const, partial: s.partials[this.options.party] as JsonObject };
    const result = await this.options.protocol.receiveAndPartial({
      session: this.options.fixed.session,
      party: this.options.party,
      secretKeys: this.options.secretKeys,
      contributions: Object.values(s.contributions),
      shares: Object.values(s.shares),
      local: s.own?.local as JsonObject | undefined,
    });
    if (
      !this.release("joint partial", {
        evidenceOk: result.ok,
        ...(!result.ok ? { partyAtFault: result.partyAtFault } : {}),
        record: {
          contributions: Object.values(s.contributions),
          ...(!result.ok
            ? {
                reason: result.reason,
                check: result.check ?? "unknown",
                index: result.index ?? null,
              }
            : {}),
        },
      })
    )
      return { ok: false as const, reason: "derivation-not-verified" };
    if (result.ok) {
      s.partials[this.options.party] = result.partial;
      s.localPartial = result.local;
      this.save(s);
    }
    return result.ok ? { ok: true as const, partial: result.partial } : result;
  }
  async finish() {
    const release = this.claim("own-outcome");
    if (!release) return { ok: false as const, reason: "replay-conflict" };
    try {
      const s = this.load();
      if (!s.opened) throw new Error("joint session was not opened");
      if (s.outcome) return { ok: false as const, reason: "replay-conflict" };
      const contributions = Object.values(s.contributions);
      let outcome: JointOutcome;
      try {
        outcome = await this.options.protocol.finish({
          session: this.options.fixed.session,
          contributions,
          partials: Object.values(s.partials),
          party: this.options.party,
          secretKeys: this.options.secretKeys,
          local: s.localPartial,
        });
      } catch (error) {
        const failure = error as { reason?: unknown; check?: unknown; index?: unknown };
        const index = typeof failure.index === "number" ? failure.index : null;
        this.release("joint outcome", {
          evidenceOk: false,
          ...(index === null
            ? {}
            : {
                partyAtFault: String(
                  (this.options.fixed.session.roster as JsonObject[])[index]?.party ?? "unknown",
                ),
              }),
          record: {
            reason: typeof failure.reason === "string" ? failure.reason : "derivation-not-verified",
            check: typeof failure.check === "string" ? failure.check : "verifier-failed",
            index,
          },
        });
        return { ok: false as const, reason: "derivation-not-verified" };
      }
      const checked = await this.options.protocol.verifyOutcome({
        session: this.options.fixed.session,
        outcome,
        contributions,
      });
      if (!checked.ok) {
        this.release("joint outcome", {
          evidenceOk: false,
          partyAtFault: checked.partyAtFault,
          record: {
            contributions,
            reason: checked.reason,
            check: checked.check ?? "unknown",
            index: checked.index ?? null,
          },
        });
        return { ok: false as const, reason: "derivation-not-verified" };
      }
      const suppressed = ["below-minimum-group", "too-few-contributors"].includes(outcome.type);
      const released = this.release("joint outcome", {
        suppressed,
        record: { contributions, outcome: outcome as unknown as JsonObject },
      });
      s.outcome = outcome;
      this.save(s);
      return {
        ok: released,
        outcome,
        contributions,
        ...(suppressed ? { reason: "prohibited" } : {}),
      };
    } finally {
      release();
    }
  }
}
