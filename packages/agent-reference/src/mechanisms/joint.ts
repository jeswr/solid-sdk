// AUTHORED-BY Codex GPT-6
/** One party's durable state machine. Network scheduling belongs to the binding.
 * No method runs another party's protocol function. All receive calls must follow
 * that party's ordinary inbound gate (the operation handler supplies its peer).
 */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
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
  outcome?: JointOutcome;
}
export class JointParty {
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
    if (operation === "urn:op:joint:open") {
      if (
        ctx.peer.party !== this.options.requester ||
        digestOf(message.session) !== digestOf(fixed.session) ||
        message.ruleDigest !== fixed.ruleDigest
      )
        throw new Error("joint session differs from receiver-fixed roster and digest");
      state.opened = true;
    } else {
      if (!state.opened) throw new Error("joint session was not opened");
      if (operation === "urn:op:joint:contribute") {
        const c = message.contribution as JsonObject;
        if (!c || c.party !== ctx.peer.party)
          throw new Error("joint contributor differs from authenticated sender");
        if (
          state.contributions[ctx.peer.party] &&
          digestOf(state.contributions[ctx.peer.party]) !== digestOf(c)
        )
          throw new Error("conflicting contribution");
        state.contributions[ctx.peer.party] = c;
        if (message.share) state.shares[ctx.peer.party] = message.share as JsonObject;
      } else if (operation === "urn:op:joint:partial") {
        const p = message.partial as JsonObject;
        if (!p || p.party !== ctx.peer.party)
          throw new Error("joint partial differs from authenticated sender");
        if (
          state.partials[ctx.peer.party] &&
          digestOf(state.partials[ctx.peer.party]) !== digestOf(p)
        )
          throw new Error("conflicting partial");
        state.partials[ctx.peer.party] = p;
      } else if (operation === "urn:op:joint:outcome") {
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
            record: message,
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
      evidence: message,
    });
    return { ok: true };
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
    const s = this.load();
    if (!s.opened) throw new Error("joint session was not opened");
    if (s.own)
      return {
        ok: true as const,
        ...(s.own as unknown as Awaited<ReturnType<JointProtocol["contribute"]>>),
      };
    const facts = this.options
      .runtime()
      .admittedStatements()
      .filter((s) => this.options.inputs.includes(String(s.id)));
    const count = facts.find((f) => f.claimType === "joint.count")?.value;
    const sum = facts.find((f) => f.claimType === "joint.sum")?.value;
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
    return { ok: true as const, ...result };
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
    });
    if (
      !this.release("joint partial", {
        evidenceOk: result.ok,
        ...(!result.ok ? { partyAtFault: result.partyAtFault } : {}),
        record: { contributions: Object.values(s.contributions) },
      })
    )
      return { ok: false as const, reason: "derivation-not-verified" };
    if (result.ok) {
      s.partials[this.options.party] = result.partial;
      this.save(s);
    }
    return result;
  }
  async finish() {
    const s = this.load();
    if (!s.opened) throw new Error("joint session was not opened");
    const contributions = Object.values(s.contributions);
    const outcome = await this.options.protocol.finish({
      session: this.options.fixed.session,
      contributions,
      partials: Object.values(s.partials),
    });
    const checked = await this.options.protocol.verifyOutcome({
      session: this.options.fixed.session,
      outcome,
      contributions,
    });
    if (!checked.ok) {
      this.release("joint outcome", {
        evidenceOk: false,
        partyAtFault: checked.partyAtFault,
        record: { contributions },
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
  }
}
