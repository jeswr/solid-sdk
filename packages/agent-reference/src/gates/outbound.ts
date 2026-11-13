// AUTHORED-BY Codex GPT-6
import { isClaimEvidence, unverifiedEvidenceClaim } from "../mechanisms/selective.js";
// AUTHORED-BY Claude Opus 5.5
/**
 * The outbound gate. Every action and disclosure the core proposes is checked before anything
 * leaves: mandate, recipient, disclosure, data terms, limits and approval, evidence, in that
 * order. The gate answers go, ask the principal, or stop. The first check that fails stops the
 * release; no later check can make up for it.
 *
 * The mandate decision itself is the pilot's (`evaluateIntent`); the gate reads it, adds the
 * checks around it, and builds the request the principal sees from the rule and the facts.
 */

import type { OdrlRule } from "@jeswr/solid-odrl";
import { digestOf } from "../core/canonical.js";
import type {
  ActionIntent,
  AnyMessage,
  AuthorisationDecision,
  Iri,
  JsonObject,
} from "../core/types.js";
import { actionDigest, type OwnerMandate } from "../mechanisms/mandate.js";
import { type PolicyEngine, solidOdrlEngine } from "../mechanisms/policy-engine.js";
import { configurationById } from "../profile/configurations.js";
import {
  CORE_CONTENT_VOCABULARY,
  type ContentProfile,
  type ContentVocabulary,
  dataClaims,
  freeMessageStrings,
  freeStrings,
  hasOpenPublicData,
  identifiersIn,
  type KnownContent,
} from "../profile/content.js";
import type { WireMessage } from "../store/state.js";
import { packetView } from "../trace/packet.js";
import type { OutboundCheck, OutboundOutcome, TraceEventInput, Verdict } from "../trace/types.js";
import {
  type CheckVerdict,
  checkRefs,
  claimRequest,
  defaultName,
  type GateContext,
  type GateMemory,
  type ItemTerms,
  idWords,
  NOT_APPLICABLE,
  PASS_CODE,
  refsFor,
  resolutionView,
  ruleText,
} from "./common.js";
import { type PaymentLimit, paymentBinding } from "./payment.js";
import { evaluateItemTerms, fitnessOf, termsSummary } from "./quality.js";

/** Where the core took a proposed action from, when it came from a received message. */
export interface ProposalOrigin {
  /** The message id. */
  readonly message: string;
  /** Message kind ("receipt"). */
  readonly kind: string;
  /** Sender, by display name. */
  readonly from: string;
  /** The free text the core read. */
  readonly text: string;
}
export interface OutboundDeps {
  readonly recordRelease?: (intent: ActionIntent) => boolean;
  readonly identity: { readonly actor: Iri; readonly party?: Iri };
  readonly now: () => string;
  readonly mandate: () => OwnerMandate | undefined;
  readonly gate: GateContext;
  readonly memory: GateMemory;
  readonly policyEngine?: PolicyEngine;
  /** Whether `party` opened this conversation (a reply to its verified agent). */
  readonly isReplyTo: (conversation: Iri, party: Iri) => boolean;
  /** The offered terms with this digest, as received in this agent's conversations. */
  readonly offerTerms: (termsDigest: string) => JsonObject | undefined;
  readonly conversationPurpose?: (conversation: Iri) => Iri | undefined;
  readonly conversationRetentionDays?: (conversation: Iri) => number | undefined;
  /** A stronger approval the recipient asked for in a challenge to this kind of action. */
  readonly anonymousConversation?: (id: string) => boolean;
  readonly recipientBound?: (actor: string, party?: string) => boolean;
  readonly recipientPinned?: (
    party: string,
    purpose: string | undefined,
    actor?: string,
  ) => boolean;
  readonly paymentSpent?: (rule: string, currency: string, intent: ActionIntent) => number;
  readonly consumeApproval?: (intent: ActionIntent) => void;
  readonly reservePayment?: (intent: ActionIntent, releaseId: string) => void;
  readonly organisationApprovals?: (
    intent: ActionIntent,
    rule: import("./approvals.js").ApprovalsRule,
  ) => "pass" | "missing" | "invalid";
  readonly personApproved?: (intent: ActionIntent, role?: string) => boolean;
  readonly demandedApproval?: (intent: ActionIntent) =>
    | {
        readonly approval: Iri;
        readonly label: string;
        /** The principal's signed approval of this exact action, once given. */
        readonly approvedBy?: Iri;
      }
    | undefined;
}

export interface Release {
  readonly outcome: OutboundOutcome;
  readonly verdicts: readonly CheckVerdict[];
  /** The decision the runtime acts on (limits can turn an autonomous permit into an ask). */
  readonly decision: AuthorisationDecision;
}

const OUTCOME_VERDICT: Record<OutboundOutcome, Verdict> = {
  "ask-more": "ask-more",
  go: "pass",
  "ask-principal": "ask-principal",
  stop: "fail",
};

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

function mandateReason(decision: AuthorisationDecision): string {
  if (
    ["source-unknown", "excessive-scope", "expired", "mandate-withdrawn"].includes(decision.reason)
  )
    return decision.reason;
  if (decision.reason.startsWith("mandate-invalid")) return "mandate-invalid";
  if (decision.outcome === "indeterminate") return "indeterminate-policy";
  return "not-authorised";
}

export class OutboundGate {
  /** Releases that ended in go, waiting for the message or effect that carries them out. */
  private readonly pendingGo = new Set<string>();

  constructor(private readonly deps: OutboundDeps) {}

  private get name() {
    return this.deps.gate.name ?? defaultName;
  }

  private get owner(): string {
    return this.name(this.deps.identity.party);
  }

  private emit(event: TraceEventInput): void {
    this.deps.gate.sink?.emit(event);
  }

  private verdict(
    out: CheckVerdict[],
    subject: string,
    check: OutboundCheck | "fitness",
    verdict: Verdict,
    caption: string,
    extra: Partial<TraceEventInput> = {},
  ): void {
    // Every verdict carries a code; a pass without one of its own takes the check's pass code.
    if (verdict === "pass" && !extra.reason) extra = { ...extra, reason: PASS_CODE[check] };
    out.push({
      type: "check-verdict",
      gate: "outbound",
      check,
      verdict,
      ...(extra.reason ? { reason: extra.reason } : {}),
      ...(extra.rule ? { rule: extra.rule } : {}),
      subject,
      at: this.deps.now(),
    });
    this.emit({
      part: "outbound-gate",
      kind: "check",
      check,
      verdict,
      ...checkRefs(this.deps.gate, check),
      ...extra,
      caption,
    });
  }

  private decide(outcome: OutboundOutcome, caption: string, reason?: string): void {
    this.emit({
      part: "outbound-gate",
      kind: "decision",
      verdict: OUTCOME_VERDICT[outcome],
      outcome,
      ...(reason ? { reason } : {}),
      caption,
    });
  }

  rejectEffect(intent: ActionIntent, reason: string): readonly CheckVerdict[] {
    const verdicts: CheckVerdict[] = [];
    this.verdict(
      verdicts,
      digestOf(intent),
      "evidence",
      "fail",
      `The effect is stopped before execution: ${reason}.`,
      { reason },
    );
    this.decide("stop", "Required effect evidence is unavailable or withdrawn.", reason);
    return verdicts;
  }

  private findRule(id: string | undefined): { rule: OdrlRule; withApproval: boolean } | undefined {
    const m = this.deps.mandate();
    if (!m || !id) return undefined;
    const auto = m.autonomous.permissions?.find((r) => r.id === id);
    if (auto) return { rule: auto, withApproval: false };
    const ask = m.withApproval.permissions?.find((r) => r.id === id);
    return ask ? { rule: ask, withApproval: true } : undefined;
  }

  private labels(intent: ActionIntent): string[] {
    const ids = intent.parameters.evidence;
    return Array.isArray(ids)
      ? ids.map((id) => this.deps.memory.facts.get(String(id))?.label ?? "a statement")
      : [];
  }

  private describeAction(intent: ActionIntent): string {
    const p = intent.parameters;
    const task = this.deps.gate.taskLabel?.(intent.target);
    if (intent.action === "compensate")
      return `pay ${String(p.amount ?? "?")} ${String(p.currency ?? "")} to ${this.name(intent.recipient)}`;
    if (intent.action === "distribute") {
      const labels = this.labels(intent);
      return `share ${labels.length > 0 ? listWords(labels) : idWords(intent.target)} with ${this.name(intent.recipient)}`;
    }
    if (task && task !== intent.target)
      return `take the next step in ${task} with ${this.name(intent.recipient)}`;
    return `${intent.action} ${idWords(intent.target)} with ${this.name(intent.recipient)}`;
  }

  private exceededLimit(intent: ActionIntent): string | undefined {
    const limits = this.deps.gate.principalLimits;
    const commitment = limits?.commitments?.[intent.operation];
    if (commitment && Number(intent.parameters.amount) > commitment.maxAmount)
      return `This commitment exceeds the principal's ${commitment.currency} ${commitment.maxAmount} limit.`;
    const days = intent.parameters.retentionDays;
    if (
      limits?.maxRetentionDays !== undefined &&
      typeof days === "number" &&
      days > limits.maxRetentionDays
    )
      return `You asked me not to let anyone keep your data for more than ${limits.maxRetentionDays} days; this asks for ${days}.`;
    return undefined;
  }

  /** The request the principal sees, built from the rule and the facts of the action. */
  approvalRequest(intent: ActionIntent, limitText: string | undefined): string {
    const p = intent.parameters;
    const who = this.name(intent.recipient);
    if (intent.action === "distribute") {
      const labels = this.labels(intent);
      const uses = [
        intent.purpose ? `use them for ${idWords(intent.purpose)}` : "",
        typeof p.retentionDays === "number" ? `keep them for ${p.retentionDays} days` : "",
        Array.isArray(p.onward) && p.onward.length > 0
          ? `pass them on only to ${listWords(p.onward.map((o) => this.name(String(o))))}`
          : "",
      ].filter(Boolean);
      return `${who} asks for ${labels.length === 1 ? "one" : labels.length === 2 ? "two" : labels.length} of your statements: ${listWords(labels)}. They would ${listWords(uses)}.${
        limitText ? ` ${limitText}` : ""
      } May I share them?`;
    }
    return `${who} asks me to ${this.describeAction(intent)}${
      intent.purpose ? ` for ${idWords(intent.purpose)}` : ""
    }.${limitText ? ` ${limitText}` : ""} May I go ahead?`;
  }

  /** Statements about the principal, or facts it holds, that a message carries. */
  private principalDataIn(message: AnyMessage): string[] {
    const party = this.deps.identity.party;
    const out: string[] = [];
    for (const e of message.evidence ?? []) {
      if (!isClaimEvidence(e)) continue;
      let payload: JsonObject = {};
      try {
        payload = unverifiedEvidenceClaim(e);
      } catch {
        out.push("an unreadable statement");
        continue;
      }
      const fact =
        typeof payload.id === "string" ? this.deps.memory.facts.get(payload.id) : undefined;
      if (fact) out.push(fact.label);
      else if (party && payload.subject === party) out.push(idWords(String(payload.claimType)));
    }
    return out;
  }

  private unsignedAllowed(message: AnyMessage): boolean {
    return (configurationById(message.configuration)?.unsignedRequestKinds ?? []).includes(
      message.kind,
    );
  }

  /** The principal's signed mandate, as loaded and verified: the rules every check reads. */
  mandateLoaded(): void {
    const m = this.deps.mandate();
    if (!m) return;
    const rules = [
      ...(m.autonomous.permissions ?? []).map((rule) => ({ rule, withApproval: false })),
      ...(m.withApproval.permissions ?? []).map((rule) => ({ rule, withApproval: true })),
    ].map(({ rule, withApproval }) =>
      ruleText(rule, { owner: this.owner, name: this.name, withApproval }),
    );
    this.emit({
      part: "record",
      kind: "record",
      rule: { id: m.id, text: rules.join(" ") },
      ...refsFor(this.deps.gate, ["authority", "usage-control"]),
      caption: `${this.owner} signed this mandate with their own key; the agent verified it, wrote it to its record, and every check reads it: ${rules.length} rules, valid until ${m.validUntil.slice(0, 10)}.`,
    });
  }

  /** The request the principal sees when a recipient asked for a stronger approval. */
  strongerApprovalRequest(intent: ActionIntent, label: string): string {
    const task = this.deps.gate.taskLabel?.(intent.operation) ?? idWords(intent.operation);
    return `Before ${this.name(intent.recipient)} will go ahead with ${task}, it asks you to approve with ${label}. May I ask you to do that now?`;
  }

  /**
   * The core proposes an action; the gate receives it. When the core took the idea from a
   * message, the caption says which one: the gate decides on the action all the same.
   */
  propose(intent: ActionIntent, origin?: ProposalOrigin): void {
    this.emit({
      part: "core",
      kind: "propose",
      caption: origin
        ? `The core proposes to ${this.describeAction(intent)}. It took this from the untrusted free text in ${origin.from}'s ${origin.kind} message (${origin.message}): "${origin.text}"`
        : `The core proposes to ${this.describeAction(intent)}.`,
    });
  }

  /** Checks 1 to 5 for a proposed action, around the pilot's mandate decision. */
  release(intent: ActionIntent, decision: AuthorisationDecision): Release {
    const subject = actionDigest(intent);
    const verdicts: CheckVerdict[] = [];
    const ctx = this.deps.gate;
    const matched = this.findRule(decision.matchedRule);
    const ruleRef = matched
      ? {
          rule: {
            id: matched.rule.id ?? decision.policy.id,
            text: ruleText(matched.rule, {
              owner: this.owner,
              name: this.name,
              withApproval: matched.withApproval,
            }),
          },
        }
      : {};

    // 1. Mandate.
    if (decision.outcome === "deny" || decision.outcome === "indeterminate") {
      const reason = mandateReason(decision);
      this.verdict(
        verdicts,
        subject,
        "mandate",
        decision.outcome === "deny" ? "fail" : "indeterminate",
        decision.outcome === "deny"
          ? `${this.owner}'s mandate does not allow this: ${this.describeAction(intent)}.`
          : "The mandate cannot be decided for this action, so it is not allowed.",
        {
          reason,
          rule: {
            id: decision.policy.id,
            text: `No rule in ${this.owner}'s mandate lets the agent ${this.describeAction(intent)}${
              intent.purpose ? ` for ${idWords(intent.purpose)}` : ""
            } (${decision.reason}).`,
          },
        },
      );
      this.decide("stop", "The action is stopped; nothing leaves.", reason);
      return { outcome: "stop", verdicts, decision };
    }
    this.verdict(
      verdicts,
      subject,
      "mandate",
      "pass",
      `${this.owner}'s mandate covers this action${matched?.withApproval ? ", with approval" : ""}.`,
      ruleRef,
    );

    if (!this.commitmentShape(intent))
      return {
        outcome: "stop",
        verdicts,
        decision: { ...decision, outcome: "deny", reason: "malformed" },
      };

    const taskItems = this.deps.memory.context(ctx.taskId ?? intent.conversation);
    const supportIds = [intent.parameters.support, intent.parameters.evidence].flatMap((v) =>
      Array.isArray(v) ? v.map(String) : [],
    );
    const requiredClaims =
      ctx.actionClaims?.filter((r) => r.action === intent.action).flatMap((r) => r.claims) ?? [];
    const reliance = Object.values(this.deps.memory.relianceHolds).filter(
      (held) =>
        held.task === (ctx.taskId ?? intent.conversation) &&
        ctx.personMayRelyOn?.includes(String(held.statement.claimType)) &&
        (supportIds.includes(String(held.statement.id)) ||
          (!supportIds.length && requiredClaims.includes(String(held.statement.claimType)))),
    );
    const relianceIds = new Set(reliance.map((h) => String(h.statement.id)));

    for (const claimType of requiredClaims) {
      const admitted = [...this.deps.memory.facts.values()].some(
        (f) =>
          f.claimType === claimType &&
          taskItems.some((i) => i.id === f.id && i.accepted && i.digest === f.digest) &&
          !!f.statement &&
          fitnessOf(
            f.statement as unknown as import("./quality.js").QualityClaim,
            ctx.reliance,
            this.deps.now(),
          ).verdict === "pass" &&
          evaluateItemTerms(f.terms, {
            agent: this.deps.identity.actor,
            action: "use",
            target: f.id,
            purpose: intent.purpose,
            at: this.deps.now(),
          }).verdict === "pass",
      );
      const proposedSupport = [intent.parameters.support, intent.parameters.evidence].flatMap(
        (v) => (Array.isArray(v) ? v : []),
      );
      const reading = taskItems.find(
        (i) =>
          i.kind === "reading" && (i.claimType === claimType || proposedSupport.includes(i.id)),
      );
      if (!admitted) {
        if (reliance.some((h) => h.statement.claimType === claimType)) continue;
        const refusal = Object.entries(this.deps.memory.refusals).find(([key]) =>
          key.startsWith(`${ctx.taskId ?? intent.conversation}|${claimType}|`),
        )?.[1];
        if (refusal) {
          this.verdict(
            verdicts,
            subject,
            "fitness",
            "fail",
            `Required ${claimType} was refused: ${refusal}.`,
            { reason: refusal },
          );
          this.decide("stop", "A refused source cannot authorize the action.", refusal);
          return {
            outcome: "stop",
            verdicts,
            decision: { ...decision, outcome: "deny", reason: refusal },
          };
        }
        if (!reading && !taskItems.some((i) => i.kind === "content")) {
          this.verdict(verdicts, subject, "fitness", "fail", claimRequest(ctx, claimType), {
            reason: "evidence-missing",
          });
          this.decide("stop", "Required evidence is missing.", "evidence-missing");
          return {
            outcome: "stop",
            verdicts,
            decision: { ...decision, outcome: "deny", reason: "evidence-missing" },
          };
        }
        const original = taskItems.find((i) => i.digest === reading?.statement?.originalDigest);
        const acceptedSources = (ctx.claimSources?.[claimType] ?? []).filter(
          (source) =>
            (ctx.resolver?.resolveSource({
              evaluator: this.deps.identity.actor,
              source,
              claimType,
              subject: reading?.subject,
              at: this.deps.now(),
            }).outcome ?? "accepted") === "accepted",
        );
        const requestSource = acceptedSources[0] ?? original?.source ?? "unknown";
        this.verdict(
          verdicts,
          subject,
          "fitness",
          "ask-more",
          `Structured form required: ${claimType}; request source ${requestSource}; original ${reading?.statement?.originalDigest}. ${claimRequest(ctx, claimType, acceptedSources)}`,
          { reason: "structured-form-required" },
        );
        this.decide(
          "ask-more",
          `Ask source ${requestSource} for ${claimType}.`,
          "structured-form-required",
        );
        return {
          outcome: "ask-more",
          verdicts,
          decision: { ...decision, outcome: "ask-more", reason: "structured-form-required" },
        };
      }
    }

    // Labels, not the core's confidence, determine whether support is admitted (CORE-IN-16).
    const support = [intent.parameters.support, intent.parameters.evidence].flatMap((v) =>
      Array.isArray(v) ? v : [],
    );
    if (
      support.some((id) => !this.deps.memory.facts.has(String(id)) && !relianceIds.has(String(id)))
    ) {
      const unacceptedReading = taskItems.find(
        (i) => i.kind === "reading" && support.includes(i.id),
      );
      const failed = support
        .map((id) => this.deps.memory.refusals[`statement:${String(id)}`])
        .find(Boolean);
      const reason = failed ?? (unacceptedReading ? "method-not-accepted" : "evidence-invalid");
      this.verdict(
        verdicts,
        subject,
        unacceptedReading ? "fitness" : "evidence",
        "fail",
        "The proposed action relies on a statement that was not admitted.",
        { reason },
      );
      this.decide("stop", "Unaccepted support cannot authorize an action.", reason);
      return {
        outcome: "stop",
        verdicts,
        decision: { ...decision, outcome: "deny", reason },
      };
    }

    if (intent.action === "pay") {
      const reason = paymentBinding(
        intent,
        this.deps.memory,
        ctx.taskId ?? intent.conversation,
        this.deps.now(),
        this.deps.identity.actor,
        (label) => this.recipientAllows(intent.recipient, intent.operation, label),
      );
      if (reason) {
        const missing = reason === "structured-form-required";
        this.verdict(
          verdicts,
          subject,
          "disclosure",
          missing ? "ask-more" : "fail",
          "A structured payment needs an admitted payee-account binding from an accepted source. Required claim: payee-account.",
          { reason },
        );
        this.decide(
          missing ? "ask-more" : "stop",
          "The bank account cannot be taken from invoice content. Required claim: payee-account.",
          reason,
        );
        return {
          outcome: missing ? "ask-more" : "stop",
          verdicts,
          decision: { ...decision, outcome: missing ? "ask-more" : "deny", reason },
        };
      }
    }
    // 2. Recipient.
    if (
      !this.recipient(
        verdicts,
        subject,
        intent.recipient,
        intent.operation,
        intent.conversation,
        intent.purpose,
      )
    ) {
      this.decide(
        "stop",
        "The action is stopped: the recipient is not accepted.",
        "not-authorised",
      );
      return { outcome: "stop", verdicts, decision: { ...decision, outcome: "deny" } };
    }

    // 3. Disclosure, then 4. data terms: either can stop the release.
    // Without a configuration (the pilot's own callers) the gate adds no checks of its own.
    const blocked = ctx.configuration
      ? (this.disclosure(verdicts, subject, intent) ?? this.dataTerms(verdicts, subject, intent))
      : undefined;
    if (blocked) {
      this.decide("stop", "The action is stopped; nothing leaves.", blocked);
      return {
        outcome: "stop",
        verdicts,
        decision: { ...decision, outcome: "deny", reason: blocked },
      };
    }

    if (reliance.length) {
      const unsafe =
        intent.action === "pay" ||
        ((intent.action === "distribute" ||
          (Array.isArray(intent.parameters.evidence) && intent.parameters.evidence.length > 0)) &&
          reliance.some((h) => intent.recipient !== h.statement.issuer));
      const termsFailure = reliance
        .map((h) =>
          evaluateItemTerms(h.statement.terms as ItemTerms | undefined, {
            agent: this.deps.identity.actor,
            action: "use",
            target: String(h.statement.id),
            purpose: intent.purpose,
            at: this.deps.now(),
          }),
        )
        .find((v) => v.verdict !== "pass");
      const binding = digestOf(reliance.map((h) => h.digest).sort());
      const approved = this.deps.personApproved?.(intent) === true;
      const changed = approved && this.deps.memory.relianceBindings[subject] !== binding;
      if (unsafe || termsFailure || changed) {
        const reason = unsafe
          ? "not-authorised"
          : changed
            ? "approval-denied"
            : (termsFailure?.reason ?? "terms-not-acceptable");
        this.verdict(
          verdicts,
          subject,
          "limits-approval",
          "fail",
          "Personal reliance cannot override this action's safety, evidence binding or terms.",
          { reason },
        );
        this.decide("stop", "The action cannot rely on this statement.", reason);
        return { outcome: "stop", verdicts, decision: { ...decision, outcome: "deny", reason } };
      }
      if (!approved) {
        this.deps.memory.relianceBindings[subject] = binding;
        const request =
          `Action: ${JSON.stringify(intent)}. Action digest: ${subject}. ` +
          reliance
            .map(
              (h) =>
                `Statement: ${JSON.stringify(h.statement)}. Made by: ${String(h.statement.issuer)}. Nobody vouches for this statement. It was not admitted. Statement digest: ${h.digest}.`,
            )
            .join(" ") +
          " Do you choose to rely on it for this exact action only?";
        this.verdict(
          verdicts,
          subject,
          "limits-approval",
          "ask-principal",
          "The principal may choose whether to rely on this self-made statement.",
          {
            reason: "method-not-accepted",
            rule: {
              id: "RL-8",
              text: "The profile permits personal reliance for this kind of claim only.",
            },
          },
        );
        this.decide(
          "ask-principal",
          "The gate holds this exact action for the person's decision.",
          "method-not-accepted",
        );
        this.emit({
          part: "principal",
          kind: "ask-principal",
          reason: "method-not-accepted",
          chat: { who: "agent", text: request },
          caption:
            "The gate shows the self-made statement, its author and its lack of anyone vouching for it.",
        });
        return {
          outcome: "ask-principal",
          verdicts,
          decision: { ...decision, outcome: "approval-required", reason: "method-not-accepted" },
        };
      }
    }

    // 5. Limits and approval. Profile judgement and role approvals cannot be overridden by
    // an autonomous mandate or by the principal substituting their own signature.
    const person = ctx.personDecisions?.find((p) => p.action === intent.action);
    const approvals = (
      matched?.rule as
        | (OdrlRule & { approvals?: import("./approvals.js").ApprovalsRule })
        | undefined
    )?.approvals;
    const approvalState = approvals
      ? (this.deps.organisationApprovals?.(intent, approvals) ?? "missing")
      : "pass";
    if (approvalState === "invalid") {
      this.verdict(
        verdicts,
        subject,
        "limits-approval",
        "fail",
        "An approver lacks a current admitted role or is the requester.",
        { reason: "not-authorised" },
      );
      this.decide("stop", "The separation of duties requirement is not met.", "not-authorised");
      return {
        outcome: "stop",
        verdicts,
        decision: { ...decision, outcome: "deny", reason: "not-authorised" },
      };
    }
    if (
      approvalState === "missing" ||
      (person &&
        !this.deps.personApproved?.(
          intent,
          typeof person.decider === "object" ? person.decider.role : undefined,
        ))
    ) {
      const roles =
        approvals?.roles ??
        (person && typeof person.decider === "object" ? [person.decider.role] : []);
      this.verdict(
        verdicts,
        subject,
        "limits-approval",
        "ask-principal",
        "The required people must decide this exact action.",
        {
          reason: "approval-required",
          rule: {
            id: matched?.rule.id ?? subject,
            text: `Requires ${approvals?.count ?? 1} approval(s) from ${roles.join(", ") || "the principal"}.`,
          },
        },
      );
      this.decide(
        "ask-principal",
        "The action is held for the named decision makers.",
        "approval-required",
      );
      this.emit({
        part: "principal",
        kind: "ask-principal",
        reason: "approval-required",
        chat: {
          who: "agent",
          text: `${roles.length ? `To ${roles.join(", ")}: ` : ""}${this.approvalRequest(intent, undefined)} Action digest: ${subject}. Parameters: ${JSON.stringify(intent.parameters)}`,
        },
        caption: "The gate built this request from the action and the approval rule.",
      });
      return {
        outcome: "ask-principal",
        verdicts,
        decision: { ...decision, outcome: "approval-required", reason: "approval-required" },
      };
    }

    const paymentLimit = (matched?.rule as (OdrlRule & { limit?: PaymentLimit }) | undefined)
      ?.limit;
    const amount = Number(intent.parameters.amount);
    const paymentExceeded =
      intent.action === "pay" &&
      paymentLimit &&
      (intent.parameters.currency !== paymentLimit.currency ||
        amount * 100 > Math.round(paymentLimit.perAction * 100) ||
        (this.deps.paymentSpent?.(matched?.rule.id ?? "", paymentLimit.currency, intent) ??
          Infinity) +
          Math.round(amount * 100) >
          Math.round(paymentLimit.perPeriod * 100));
    const limitText = paymentExceeded
      ? "This payment exceeds the mandate's per-action or calendar-month limit."
      : this.exceededLimit(intent);
    if (paymentExceeded) {
      const m = this.deps.mandate();
      const mayAsk =
        m &&
        (this.deps.policyEngine ?? solidOdrlEngine).evaluate(m.withApproval, {
          agent: this.deps.identity.actor,
          action: intent.action,
          target: intent.target,
          purpose: intent.purpose,
          recipient: intent.recipient,
          at: this.deps.now(),
        }).effect === "permit";
      if (!mayAsk) {
        this.verdict(
          verdicts,
          subject,
          "limits-approval",
          "fail",
          limitText ?? "Payment limit exceeded.",
          { reason: "limit-exceeded" },
        );
        this.decide(
          "stop",
          "The mandate does not allow approval beyond this limit.",
          "limit-exceeded",
        );
        return {
          outcome: "stop",
          verdicts,
          decision: { ...decision, outcome: "deny", reason: "limit-exceeded" },
        };
      }
    }
    const limitRule = ctx.principalLimits && limitText ? { id: ctx.principalLimits.id } : undefined;
    // CORE-OUT-8: the recipient asked for a stronger approval; ask the principal in that form.
    const demanded = this.deps.demandedApproval?.(intent);
    const demandText =
      demanded && !demanded.approvedBy
        ? `${this.name(intent.recipient)} asked for ${demanded.label} before it will do this.`
        : undefined;
    let effective =
      paymentExceeded && this.deps.personApproved?.(intent)
        ? { ...decision, basis: "owner-approval" as const }
        : decision;
    if (
      decision.outcome === "permit" &&
      decision.basis === "autonomous" &&
      limitText &&
      !this.deps.personApproved?.(intent)
    ) {
      effective = {
        ...decision,
        outcome: "approval-required",
        reason: `principal limit: ${limitText}`,
      };
    } else if (decision.outcome === "permit" && decision.basis === "autonomous" && demandText) {
      effective = {
        ...decision,
        outcome: "approval-required",
        reason: `stronger approval asked for: ${demanded?.approval}`,
      };
    }
    if (effective.outcome === "approval-required") {
      const reason = limitText ? "limit-exceeded" : "approval-required";
      const request =
        demandText && demanded
          ? this.strongerApprovalRequest(intent, demanded.label)
          : this.approvalRequest(intent, limitText);
      this.verdict(
        verdicts,
        subject,
        "limits-approval",
        "ask-principal",
        limitText
          ? `This is outside ${this.owner}'s limits, so the gate asks ${this.owner}.`
          : demandText
            ? `${demandText} The gate asks ${this.owner} to approve in that form.`
            : `The mandate says to ask ${this.owner} first.`,
        {
          reason,
          rule: {
            id: limitRule?.id ?? demanded?.approval ?? matched?.rule.id ?? decision.policy.id,
            text: [ruleRef.rule?.text, limitText ?? demandText].filter(Boolean).join(" "),
          },
        },
      );
      this.decide("ask-principal", `The gate holds the action and asks ${this.owner}.`, reason);
      this.emit({
        part: "principal",
        kind: "ask-principal",
        chat: { who: "agent", text: request },
        caption: `${this.owner} is asked to approve this exact action; the approval will be bound to its digest.`,
      });
      return { outcome: "ask-principal", verdicts, decision: effective };
    }
    if (demanded?.approvedBy) {
      this.verdict(
        verdicts,
        subject,
        "limits-approval",
        "pass",
        `${this.owner} approved this exact action with ${demanded.label}, as ${this.name(intent.recipient)} asked; the attestation goes with the request.`,
        {
          reason: "approval-given",
          rule: {
            id: demanded.approvedBy,
            text: `${this.owner}'s signed approval, bound to digest ${subject.slice(0, 16)}….`,
          },
        },
      );
      this.pendingGo.add(subject);
      return { outcome: "go", verdicts, decision };
    }
    this.verdict(
      verdicts,
      subject,
      "limits-approval",
      "pass",
      effective.basis === "owner-approval"
        ? demanded
          ? `${this.owner} approved this exact action with ${demanded.label}, as ${this.name(intent.recipient)} asked.`
          : `${this.owner} approved this exact action.`
        : `Inside what the agent may do on its own, and within ${this.owner}'s limits.`,
      effective.basis === "owner-approval" && !decision.approval
        ? { reason: "approval-given" }
        : decision.approval
          ? {
              reason: "approval-given",
              rule: {
                id: decision.approval,
                text: `${this.owner}'s signed approval, bound to digest ${subject.slice(0, 16)}….`,
              },
            }
          : {},
    );
    this.pendingGo.add(subject);
    return { outcome: "go", verdicts, decision };
  }

  /** Recipient: looked up through the trust resolver. Returns false when it fails. */
  private recipient(
    verdicts: CheckVerdict[],
    subject: string,
    party: Iri | undefined,
    task: Iri | undefined,
    conversation?: Iri,
    purpose?: Iri,
  ): boolean {
    if (party && this.deps.recipientPinned && !this.deps.recipientPinned(party, purpose)) {
      this.verdict(
        verdicts,
        subject,
        "recipient",
        "fail",
        "The recipient has no own-list pin for this party, purpose and current time.",
        { reason: "source-unknown" },
      );
      return false;
    }
    const resolver = this.deps.gate.resolver;
    if (!party) {
      this.verdict(
        verdicts,
        subject,
        "recipient",
        "not-applicable",
        "The message goes to no one in particular.",
        {
          reason: NOT_APPLICABLE.noPrincipal,
        },
      );
      return true;
    }
    if (!resolver || !task) {
      this.verdict(
        verdicts,
        subject,
        "recipient",
        "pass",
        `${this.name(party)}'s agent is reached through the key pinned when the two were introduced.`,
      );
      return true;
    }
    const label = this.deps.gate.taskLabel?.(task) ?? idWords(task);
    const r = resolver.resolveRecipient({ party, task, taskLabel: label, at: this.deps.now() });
    const resolution = { resolution: resolutionView(r) };
    if (r.outcome === "accepted") {
      this.verdict(verdicts, subject, "recipient", "pass", `${this.name(party)}: ${r.answer}`, {
        ...resolution,
        ...(r.rule ? { rule: { id: r.rule.id, text: r.path.at(-1)?.says ?? r.answer } } : {}),
      });
      return true;
    }
    if (r.outcome === "no-route" && conversation && this.deps.isReplyTo(conversation, party)) {
      this.verdict(
        verdicts,
        subject,
        "recipient",
        "pass",
        `A reply to ${this.name(party)}'s verified agent, which opened this conversation; no register lists private persons.`,
        {
          ...resolution,
          rule: { id: conversation, text: "Replies go to the verified sender of the request." },
        },
      );
      return true;
    }
    if (r.outcome === "no-route") {
      this.verdict(
        verdicts,
        subject,
        "recipient",
        "indeterminate",
        `${this.name(party)}: ${r.answer}`,
        {
          reason: "lookup-failed",
          ...resolution,
        },
      );
      return false;
    }
    this.verdict(verdicts, subject, "recipient", "fail", `${this.name(party)}: ${r.answer}`, {
      reason: "not-authorised",
      ...resolution,
    });
    return false;
  }

  /** Disclosure: is what goes out what the request and the purpose need, and no more? */
  private disclosure(
    verdicts: CheckVerdict[],
    subject: string,
    intent: ActionIntent,
  ): string | undefined {
    const p = intent.parameters;
    if (intent.action === "distribute" && Array.isArray(p.evidence)) {
      const offer =
        typeof p.termsDigest === "string" ? this.deps.offerTerms(p.termsDigest) : undefined;
      const requested = this.deps.recordRelease?.(intent)
        ? this.deps.gate.purposes?.[intent.purpose ?? ""]
        : Array.isArray(offer?.evidenceRequest)
          ? offer.evidenceRequest.map((r) => String((r as JsonObject).claimType))
          : undefined;
      const items = p.evidence.map((id) => this.deps.memory.facts.get(String(id)));
      if (!requested) {
        this.verdict(
          verdicts,
          subject,
          "disclosure",
          "indeterminate",
          "What the request needs cannot be found.",
          {
            reason: "missing-context",
          },
        );
        return "missing-context";
      }
      const extra = items.filter((f) => !f || !requested.includes(f.claimType));
      const missing = requested.filter((t) => !items.some((f) => f?.claimType === t));
      const rule = {
        id: String(p.termsDigest),
        text: `The request asks for ${listWords(requested.map((t) => idWords(t)))}; by value is the only form in this configuration.`,
      };
      if (extra.length > 0) {
        this.verdict(
          verdicts,
          subject,
          "disclosure",
          "fail",
          `${extra.length} item(s) would go that the request does not need.`,
          { reason: "excessive-scope", rule },
        );
        return "excessive-scope";
      }
      this.verdict(
        verdicts,
        subject,
        "disclosure",
        "pass",
        `Only what the request needs goes: ${listWords(this.labels(intent))}${
          missing.length > 0 ? ` (nothing held for ${listWords(missing)})` : ""
        }.`,
        { reason: "minimal-disclosure", rule },
      );
      return;
    }
    this.verdict(
      verdicts,
      subject,
      "disclosure",
      "not-applicable",
      "This action passes on no personal data.",
      {
        reason: NOT_APPLICABLE.noPersonalData,
      },
    );
  }

  private recipientAllows(party: string | undefined, operation: string, label: string): boolean {
    return (
      !!party &&
      this.deps.gate.resolver?.resolveRecipient({
        party,
        task: operation,
        taskLabel: label,
        at: this.deps.now(),
      }).outcome === "accepted"
    );
  }

  /** Data terms: do the terms on each item allow this use and this recipient? */
  private dataTerms(
    verdicts: CheckVerdict[],
    subject: string,
    intent: ActionIntent,
  ): string | undefined {
    const p = intent.parameters;
    // Issuer-authored text cannot hide unsupported machine terms on the actual items.
    for (const id of intent.action === "distribute" && Array.isArray(p.evidence)
      ? p.evidence
      : []) {
      const fact = this.deps.memory.facts.get(String(id));
      if (!fact?.terms) continue;
      const checked = evaluateItemTerms(fact.terms, {
        agent: this.deps.identity.actor,
        action: "distribute",
        target: fact.id,
        purpose: intent.purpose,
        recipient: intent.recipient,
        at: this.deps.now(),
      });
      if (checked.verdict === "indeterminate") {
        this.verdict(verdicts, subject, "data-terms", checked.verdict, checked.text, {
          reason: checked.reason,
        });
        return checked.reason ?? "unsupported-term";
      }
    }
    if (intent.action === "distribute" && typeof p.attachedTerms === "string") {
      // An issuer releasing its own statement: the terms it attaches travel with it.
      this.verdict(
        verdicts,
        subject,
        "data-terms",
        "pass",
        `${this.owner}'s own terms go with it: ${p.attachedTerms}`,
        typeof p.termsId === "string"
          ? { rule: { id: p.termsId, text: String(p.attachedTerms) } }
          : {},
      );
      return undefined;
    }
    if (intent.action !== "distribute" || !Array.isArray(p.evidence)) {
      this.verdict(
        verdicts,
        subject,
        "data-terms",
        "not-applicable",
        "This action passes on no personal data.",
        {
          reason: NOT_APPLICABLE.noPersonalData,
        },
      );
      return undefined;
    }
    let blocked: string | undefined;
    for (const id of p.evidence) {
      const fact = this.deps.memory.facts.get(String(id));
      const terms: ItemTerms | undefined = fact?.terms;
      const t = evaluateItemTerms(terms, {
        agent: this.deps.identity.actor,
        action: "distribute",
        target: String(id),
        ...(intent.purpose ? { purpose: intent.purpose } : {}),
        ...(intent.recipient ? { recipient: intent.recipient } : {}),
        ...(typeof p.retentionDays === "number" ? { retentionDays: p.retentionDays } : {}),
        at: this.deps.now(),
        recipientAllowed: (label) =>
          this.recipientAllows(intent.recipient, intent.operation, label),
      });
      let verdict = t.verdict;
      let text = t.text;
      let reason = t.reason;
      if (verdict === "pass" && terms?.recipientMustBe && intent.recipient) {
        const r = this.deps.gate.resolver?.resolveRecipient({
          party: intent.recipient,
          task: intent.operation,
          taskLabel: terms.recipientMustBe.task,
          at: this.deps.now(),
        });
        if (r?.outcome !== "accepted") {
          verdict = "fail";
          reason = "not-authorised";
          text = `Its terms allow sharing only with ${terms.recipientMustBe.label}; ${this.name(intent.recipient)} is not shown to be one.`;
        } else {
          text = `${text} ${this.name(intent.recipient)} is ${terms.recipientMustBe.label} (sector register).`;
        }
      }
      if (verdict !== "pass") blocked ??= reason ?? "indeterminate-policy";
      this.verdict(
        verdicts,
        subject,
        "data-terms",
        verdict,
        `${fact?.label ?? "An item"}: ${lower(text)}`,
        {
          ...(reason ? { reason } : {}),
          rule: {
            id: terms?.policy?.id ?? "default-terms",
            text: terms
              ? `The issuer's terms: ${termsSummary(terms)}. They go out with the data.`
              : text,
          },
        },
      );
    }
    return blocked;
  }

  stopEvidence(subject: string): void {
    this.verdict([], subject, "evidence", "fail", "The outgoing credential was not verified.", {
      reason: "evidence-invalid",
    });
    this.decide("stop", "Unverified evidence cannot leave.", "evidence-invalid");
  }

  stopLimit(subject: string, reason: "round-limit"): void {
    this.verdict(
      [],
      subject,
      "limits-approval",
      "fail",
      "The proposal would exceed the conversation's round limit.",
      { reason },
    );
    this.decide("stop", "The round limit stops the message before release.", reason);
  }

  /** The principal declined a held action: it stops. */
  declined(intent: ActionIntent): void {
    this.pendingGo.delete(actionDigest(intent));
    this.decide("stop", `${this.owner} declined; the action is stopped.`, "approval-denied");
  }

  /** UNS-9 / CORE-OUT-12: a real release boundary, independent of trace collection. */
  checkMessage(
    message: AnyMessage,
    opts: {
      intent?: ActionIntent;
      operation?: Iri;
      approved?: boolean;
      content?: ContentProfile;
      knownTerms?: ReadonlySet<string>;
    } = {},
  ): {
    outcome: OutboundOutcome;
    reason?: string;
    digest: string;
    intent: ActionIntent;
  } {
    const vocabulary = { ...this.deps.gate.vocabulary, ...opts.content?.vocabulary };
    const purposes = { ...opts.content?.purposes, ...this.deps.gate.purposes };
    const known = {
      identifiers: this.deps.memory.knownIdentifiers(
        this.deps.gate.taskId ?? message.conversation,
        message.conversation,
        { ...this.deps.gate, content: opts.content },
      ),
      terms: opts.knownTerms,
    };
    const digest = digestOf(message);
    const body = message.body as unknown as JsonObject;
    const purpose =
      opts.intent?.purpose ??
      this.deps.conversationPurpose?.(message.conversation) ??
      (typeof body.purpose === "string" ? body.purpose : undefined);
    const retentionDays =
      typeof opts.intent?.parameters.retentionDays === "number"
        ? opts.intent.parameters.retentionDays
        : this.deps.conversationRetentionDays?.(message.conversation);
    const intent: ActionIntent = {
      action: "distribute",
      operation: opts.operation ?? "urn:awp:send-message",
      target: opts.intent?.target ?? opts.operation ?? "urn:awp:send-message",
      recipient: message.to?.party ?? message.to?.actor,
      ...(purpose ? { purpose } : {}),
      conversation: message.conversation,
      parameters: {
        messageDigest: digest,
        textDigest: digestOf(freeMessageStrings(message, vocabulary, known)),
      },
    };
    const verdicts: CheckVerdict[] = [];
    const finish = (outcome: OutboundOutcome, reason?: string) => ({
      outcome,
      reason,
      digest,
      intent,
    });
    if (
      opts.intent?.action === "pay" &&
      (message.kind !== "invoke" ||
        digestOf(body.input) !== digestOf(opts.intent.parameters) ||
        (body.operation as JsonObject | undefined)?.id !== opts.intent.operation)
    ) {
      this.verdict(
        [],
        digest,
        "mandate",
        "fail",
        "The actual payment instruction must match the exact authorised action.",
        { reason: "not-authorised" },
      );
      this.decide("stop", "The payment bytes differ from the authorised action.", "not-authorised");
      return finish("stop", "not-authorised");
    }
    // A public read configuration removes requester authentication, never commitment authority.
    if (!message.from.onBehalfOf && ["propose", "accept"].includes(message.kind)) {
      this.verdict(verdicts, digest, "mandate", "fail", "A commitment must name its principal.", {
        reason: "representation-missing",
      });
      this.decide("stop", "An anonymous sender cannot commit anyone.", "representation-missing");
      return finish("stop", "representation-missing");
    }
    const anonymous =
      !message.from.actor &&
      configurationById(message.configuration)?.requesterAuthentication === "not-applicable";
    if (
      (message.to?.actor &&
        this.deps.recipientBound &&
        !this.deps.recipientBound(message.to.actor, message.to.party)) ||
      (["pay", "distribute"].includes(opts.intent?.action ?? "") &&
        opts.intent?.recipient &&
        opts.intent.recipient !== (message.to?.party ?? message.to?.actor))
    ) {
      this.verdict(
        [],
        digest,
        "recipient",
        "fail",
        "The actual recipient actor, party and authorised recipient must agree with the introduced key binding.",
        { reason: "not-authorised" },
      );
      this.decide(
        "stop",
        "The core cannot substitute a recipient or encode data in an address.",
        "not-authorised",
      );
      return finish("stop", "not-authorised");
    }
    if (
      anonymous &&
      (!known.identifiers.has(message.conversation) ||
        (this.deps.anonymousConversation && !this.deps.anonymousConversation(message.conversation)))
    ) {
      this.verdict(
        [],
        digest,
        "disclosure",
        "fail",
        "An anonymous request cannot carry a core-invented conversation identifier.",
        { reason: "context-not-clear" },
      );
      this.decide("stop", "The public read header contains unapproved text.", "context-not-clear");
      return finish("stop", "context-not-clear");
    }
    if (
      this.deps.recipientPinned &&
      message.to &&
      !this.deps.recipientPinned(
        message.to.party ?? message.to.actor ?? "",
        purpose,
        message.to.actor,
      )
    ) {
      this.verdict(
        verdicts,
        digest,
        "recipient",
        "fail",
        "This exact recipient key has no current pin for the party and purpose.",
        { reason: "source-unknown" },
      );
      this.decide("stop", "A pin never widens to another key or scope.", "source-unknown");
      return finish("stop", "source-unknown");
    }
    if (anonymous) {
      // Only installed public parameters are available here. Context knowledge is not a
      // permission to put a person's identifier, facts, or prose in a public query.
      const publicBody = dataClaims(body, { ...CORE_CONTENT_VOCABULARY, ...vocabulary }, "", {
        identifiers: new Set(
          identifiersIn({
            operation: opts.operation,
            vocabulary: this.deps.gate.vocabulary,
            identifiers: this.deps.gate.identifiers,
            purposes: this.deps.gate.purposes,
            sources: this.deps.gate.claimSources,
            content: opts.content,
          }),
        ),
      });
      const mandate = this.deps.mandate();
      const request = {
        agent: this.deps.identity.actor,
        action: "read",
        target: opts.operation ?? intent.target,
        recipient: intent.recipient,
        purpose,
        at: this.deps.now(),
      };
      const excluded =
        mandate &&
        [mandate.autonomous, mandate.withApproval].some(
          (policy) =>
            (this.deps.policyEngine ?? solidOdrlEngine).evaluate(policy, request).effect ===
            "prohibited",
        );
      if (excluded) {
        this.verdict(
          verdicts,
          digest,
          "mandate",
          "fail",
          "The mandate excludes this public read.",
          { reason: "prohibited" },
        );
        this.decide("stop", "The public read is prohibited.", "prohibited");
        return finish("stop", "prohibited");
      }
      if (
        publicBody.unknown ||
        hasOpenPublicData(body, { ...CORE_CONTENT_VOCABULARY, ...vocabulary }) ||
        publicBody.claims.length ||
        message.evidence?.length ||
        message.authorship
      ) {
        this.verdict(
          verdicts,
          digest,
          "disclosure",
          "fail",
          "Anonymous reads carry only installed, structured public query parameters.",
          { reason: "excessive-scope" },
        );
        this.decide(
          "stop",
          "Personal data, evidence and free text need an authorised represented action.",
          "excessive-scope",
        );
        return finish("stop", "excessive-scope");
      }
    }
    if (
      !opts.intent &&
      message.from.onBehalfOf &&
      ["invoke", "propose", "accept"].includes(message.kind)
    ) {
      this.verdict(
        verdicts,
        digest,
        "mandate",
        "fail",
        "A consequential message requires an authorised structured action.",
        { reason: "not-authorised" },
      );
      this.decide("stop", "No action authority was supplied; nothing leaves.", "not-authorised");
      return finish("stop", "not-authorised");
    }
    if (!opts.intent) {
      this.verdict(
        verdicts,
        digest,
        "mandate",
        "not-applicable",
        "This protocol message proposes no additional action.",
        { reason: NOT_APPLICABLE.noAction },
      );
      if (
        !this.recipient(
          verdicts,
          digest,
          intent.recipient,
          opts.operation,
          message.conversation,
          purpose,
        )
      ) {
        this.decide("stop", "The recipient is not established; nothing leaves.", "not-authorised");
        return finish("stop", "not-authorised");
      }
    }
    if (
      opts.intent &&
      opts.intent.recipient !== intent.recipient &&
      !this.recipient(
        verdicts,
        digest,
        intent.recipient,
        opts.operation,
        message.conversation,
        purpose,
      )
    ) {
      this.decide("stop", "The actual message recipient is not established.", "not-authorised");
      return finish("stop", "not-authorised");
    }
    for (const evidence of message.evidence ?? []) {
      if (!isClaimEvidence(evidence)) continue;
      try {
        const claim = unverifiedEvidenceClaim(evidence);
        const fact = this.deps.memory.facts.get(String(claim.id));
        if (claim.terms) {
          const checked = evaluateItemTerms(claim.terms as unknown as ItemTerms, {
            agent: this.deps.identity.actor,
            action: "distribute",
            target: String(claim.id),
            purpose,
            recipient: intent.recipient,
            at: this.deps.now(),
          });
          if (checked.verdict === "indeterminate") {
            this.verdict(verdicts, digest, "data-terms", checked.verdict, checked.text, {
              reason: checked.reason,
            });
            this.decide(
              "stop",
              "An unknown attached term cannot be passed as permission.",
              checked.reason,
            );
            return finish("stop", checked.reason);
          }
        }
        if (!fact && claim.issuer !== this.deps.identity.party) {
          this.stopEvidence(digest);
          return finish("stop", "evidence-invalid");
        }
        if (fact) {
          const needed = purpose ? purposes?.[purpose] : undefined;
          const reason = !needed
            ? "missing-context"
            : !needed.includes(fact.claimType)
              ? "excessive-scope"
              : undefined;
          this.verdict(
            verdicts,
            digest,
            "disclosure",
            reason ? "indeterminate" : "pass",
            "The gate checks the actual credential against the declared purpose.",
            { reason },
          );
          if (reason) {
            this.decide("stop", "The credential is not necessary for this purpose.", reason);
            return finish("stop", reason);
          }
          const blocked = this.dataTerms(verdicts, digest, {
            ...intent,
            action: "distribute",
            parameters: {
              evidence: [fact.id],
              ...(retentionDays === undefined ? {} : { retentionDays }),
            },
          });
          if (blocked) {
            this.decide("stop", "The actual credential's terms prohibit release.", blocked);
            return finish("stop", blocked);
          }
        }
        if (fact?.digest && fact.digest !== digestOf(claim)) {
          this.verdict(
            verdicts,
            digest,
            "evidence",
            "fail",
            "The outgoing statement differs from the one admitted under this identifier.",
            { reason: "evidence-invalid" },
          );
          this.decide(
            "stop",
            "A fact's identifier cannot substitute for its admitted bytes.",
            "evidence-invalid",
          );
          return finish("stop", "evidence-invalid");
        }
      } catch {
        this.verdict(
          verdicts,
          digest,
          "evidence",
          "fail",
          "The outgoing statement cannot be read.",
          { reason: "evidence-invalid" },
        );
        this.decide("stop", "Uninspectable evidence cannot leave.", "evidence-invalid");
        return finish("stop", "evidence-invalid");
      }
    }
    let bodyHasPersonalData = false;
    const payloadKey =
      message.kind === "propose"
        ? "terms"
        : message.kind === "invoke"
          ? "input"
          : message.kind === "deliver"
            ? "output"
            : message.kind === "receipt"
              ? "observed"
              : undefined;
    if (payloadKey && body[payloadKey]) {
      const payload = dataClaims(body[payloadKey], vocabulary ?? {}, payloadKey, known);
      bodyHasPersonalData = payload.claims.length > 0;
      const needs = purpose ? purposes?.[purpose] : undefined;
      const reason =
        payload.claims.length > 0 && !needs
          ? "missing-context"
          : payload.claims.some((c) => !needs?.includes(c))
            ? "excessive-scope"
            : undefined;
      if (reason) {
        this.verdict(
          verdicts,
          digest,
          "disclosure",
          "indeterminate",
          "The gate cannot establish this payload as necessary for the declared purpose.",
          { reason },
        );
        this.decide("stop", "The payload is held before release.", reason);
        return finish("stop", reason);
      }
      // Unknown strings go through UNS-9 below. Unknown non-string data cannot be assumed public.
      if (
        payload.unknown &&
        freeStrings(body, { ...CORE_CONTENT_VOCABULARY, ...vocabulary }, known).length === 0
      ) {
        this.verdict(
          verdicts,
          digest,
          "disclosure",
          "indeterminate",
          "An untyped payload cannot be declared free of personal data.",
          { reason: "missing-context" },
        );
        this.decide("stop", "The untyped payload is held.", "missing-context");
        return finish("stop", "missing-context");
      }
      for (const item of this.deps.memory.context(this.deps.gate.taskId ?? message.conversation)) {
        if (!payload.claims.includes(item.claimType)) continue;
        const terms = evaluateItemTerms(item.terms, {
          agent: this.deps.identity.actor,
          action: "distribute",
          target: item.id,
          purpose,
          recipient: intent.recipient,
          ...(retentionDays === undefined ? {} : { retentionDays }),
          at: this.deps.now(),
          recipientAllowed: (label) =>
            this.recipientAllows(intent.recipient, intent.operation, label),
        });
        this.verdict(
          verdicts,
          digest,
          "data-terms",
          terms.verdict,
          `${item.label}: ${terms.text}`,
          { reason: terms.reason },
        );
        if (terms.verdict !== "pass") {
          this.decide(
            "stop",
            "The structured payload's item terms prohibit release.",
            terms.reason,
          );
          return finish("stop", terms.reason);
        }
      }
      if (payload.claims.length)
        this.verdict(
          verdicts,
          digest,
          "disclosure",
          "pass",
          `The vocabulary identifies only the necessary claims: ${payload.claims.join(", ")}.`,
        );
      else if (!payload.unknown && opts.intent)
        this.verdict(
          verdicts,
          digest,
          "disclosure",
          "not-applicable",
          "The gate establishes from the vocabulary that the actual payload is only public query parameters.",
          { reason: "no-personal-data" },
        );
    }
    const free = freeMessageStrings(message, vocabulary, known);
    if ((message.kind === "accept" || message.kind === "propose") && free.length > 0) {
      this.verdict(
        verdicts,
        digest,
        "disclosure",
        "fail",
        "Free text cannot form the terms or selection of a structured commitment.",
        { reason: "structured-form-required" },
      );
      this.decide("stop", "Free text never commits the principal.", "structured-form-required");
      return finish("stop", "structured-form-required");
    }
    const context = this.deps.memory.context(this.deps.gate.taskId ?? message.conversation);
    const needed = purpose ? purposes?.[purpose] : undefined;
    let contextClear = true;
    if (free.length > 0) {
      // Every item is assessed separately, including items about someone other than our principal.
      for (const item of context) {
        const minimal = !!needed?.includes(item.claimType);
        this.verdict(
          verdicts,
          digest,
          "disclosure",
          minimal ? "pass" : "ask-principal",
          `Context item ${item.label} (${item.subject ?? "unknown subject"}) ${minimal ? "is needed" : "is not established as needed"} for this purpose.`,
          { reason: minimal ? "minimal-disclosure" : "context-not-clear" },
        );
        const terms = evaluateItemTerms(item.terms, {
          agent: this.deps.identity.actor,
          action: "distribute",
          target: item.id,
          purpose,
          recipient: intent.recipient,
          ...(retentionDays === undefined ? {} : { retentionDays }),
          at: this.deps.now(),
          recipientAllowed: (label) =>
            this.recipientAllows(intent.recipient, intent.operation, label),
        });
        let termsOK = terms.verdict === "pass";
        if (termsOK && item.terms?.recipientMustBe)
          termsOK =
            this.deps.gate.resolver?.resolveRecipient({
              party: intent.recipient ?? "",
              task: intent.operation,
              taskLabel: item.terms.recipientMustBe.task,
              at: this.deps.now(),
            }).outcome === "accepted";
        this.verdict(
          verdicts,
          digest,
          "data-terms",
          termsOK ? "pass" : "ask-principal",
          `${item.label}: ${terms.text}`,
          { reason: termsOK ? "terms-allow" : "context-not-clear" },
        );
        contextClear &&= minimal && termsOK;
      }
      if (!contextClear && !opts.approved) {
        const m = this.deps.mandate();
        const request = {
          agent: this.deps.identity.actor,
          action: intent.action,
          target: intent.target,
          purpose,
          recipient: intent.recipient,
          ...(retentionDays === undefined ? {} : { retentionDays }),
          at: this.deps.now(),
        };
        const canAsk =
          this.deps.gate.freeTextApproval !== false &&
          m &&
          Date.parse(m.validFrom) <= Date.parse(this.deps.now()) &&
          Date.parse(m.validUntil) > Date.parse(this.deps.now()) &&
          (this.deps.policyEngine ?? solidOdrlEngine).evaluate(m.withApproval, request).effect ===
            "permit" &&
          (this.deps.policyEngine ?? solidOdrlEngine).evaluate(m.autonomous, request).effect !==
            "prohibited";
        const outcome = canAsk ? "ask-principal" : "stop";
        this.decide(
          outcome,
          "The task context is not clear for this text, recipient and purpose.",
          "context-not-clear",
        );
        if (canAsk)
          this.emit({
            part: "principal",
            kind: "ask-principal",
            reason: "context-not-clear",
            chat: {
              who: "agent",
              text: `May I send this exact text to ${this.name(intent.recipient)} for ${purpose ?? "an undeclared purpose"}?\n${free.map((f) => f.text).join("\n")}`,
            },
            caption: `The text is held before release; approval binds message digest ${digest}.`,
          });
        return finish(outcome, "context-not-clear");
      }
      if (context.length === 0 || opts.approved) {
        this.verdict(
          verdicts,
          digest,
          "disclosure",
          "pass",
          opts.approved
            ? "The principal approved these exact bytes for this recipient and purpose."
            : "No restricted item entered this task's context.",
          { reason: opts.approved ? "approval-given" : "minimal-disclosure" },
        );
        this.verdict(verdicts, digest, "data-terms", "pass", "The context rule permits this text.");
      }
    }
    // Actual relayed statements are checked even when the core supplied no action intent.
    const carried = this.principalDataIn(message);
    if (!opts.intent && carried.length > 0) {
      const ids = (message.evidence ?? [])
        .filter((e) => e.role === "credential")
        .map((e) => {
          try {
            return String(unverifiedEvidenceClaim(e).id);
          } catch {
            return "unknown";
          }
        });
      const items = ids.map((id) => this.deps.memory.facts.get(id));
      const reason = !needed
        ? "missing-context"
        : items.some((f) => !f || !needed.includes(f.claimType))
          ? "excessive-scope"
          : undefined;
      this.verdict(
        verdicts,
        digest,
        "disclosure",
        reason ? "indeterminate" : "pass",
        "The gate checks the carried statements against the conversation's purpose.",
        { reason: reason ?? "minimal-disclosure" },
      );
      const termsReason =
        reason ?? this.dataTerms(verdicts, digest, { ...intent, parameters: { evidence: ids } });
      if (termsReason) {
        this.decide(
          "stop",
          "The message's disclosure is not permitted; nothing leaves.",
          termsReason,
        );
        return finish("stop", termsReason);
      }
    } else if (!opts.intent && bodyHasPersonalData) {
      this.verdict(
        verdicts,
        digest,
        "data-terms",
        "pass",
        "The vocabulary identifies original structured data for this interaction; matching context terms were checked.",
      );
    } else if (!opts.intent && free.length === 0) {
      this.verdict(
        verdicts,
        digest,
        "disclosure",
        message.kind === "description" ? "pass" : "not-applicable",
        "The gate finds no personal data in this protocol message.",
        {
          reason:
            message.kind === "description" ? "minimal-disclosure" : NOT_APPLICABLE.noPersonalData,
        },
      );
      this.verdict(
        verdicts,
        digest,
        "data-terms",
        message.kind === "description" ? "pass" : "not-applicable",
        "The gate finds no data terms to apply.",
        { reason: message.kind === "description" ? "terms-allow" : NOT_APPLICABLE.noPersonalData },
      );
    }
    if (!opts.intent)
      this.verdict(
        verdicts,
        digest,
        "limits-approval",
        opts.approved ? "pass" : "not-applicable",
        "The message release check is complete.",
        { reason: opts.approved ? "approval-given" : NOT_APPLICABLE.noAction },
      );
    return finish("go");
  }

  checkEffect(intent: ActionIntent, parameters: JsonObject): boolean {
    if (!this.commitmentShape(intent)) return false;
    const bounded = !!this.deps.gate.principalLimits?.commitments?.[intent.operation];
    if (
      (!bounded && intent.action !== "pay") ||
      digestOf(parameters) === digestOf(intent.parameters)
    )
      return true;
    const verdicts: CheckVerdict[] = [];
    this.verdict(
      verdicts,
      actionDigest(intent),
      "mandate",
      "fail",
      "The actual adapter parameters differ from the authorised action.",
      { reason: "not-authorised" },
    );
    this.decide("stop", "The actual effect was not authorised.", "not-authorised");
    return false;
  }

  private commitmentShape(intent: ActionIntent): boolean {
    const cap = this.deps.gate.principalLimits?.commitments?.[intent.operation];
    if (!cap) return true;
    const amount = intent.parameters.amount;
    if (
      typeof amount === "number" &&
      Number.isFinite(amount) &&
      amount >= 0 &&
      Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7 &&
      intent.parameters.currency === cap.currency
    )
      return true;
    this.verdict(
      [],
      actionDigest(intent),
      "limits-approval",
      "fail",
      "A bounded commitment requires a nonnegative amount in the configured currency.",
      { reason: "malformed" },
    );
    this.decide("stop", "The bounded commitment is malformed.", "malformed");
    return false;
  }

  /** Evidence and the transport hand-off are recorded only after a successful checkMessage. */
  seal(
    message: AnyMessage,
    wire: WireMessage,
    opts: {
      intent?: ActionIntent;
      operation?: Iri;
      vocabulary?: ContentVocabulary;
      known?: KnownContent;
    },
  ): void {
    const verdicts: CheckVerdict[] = [];
    if (opts.intent) {
      this.deps.reservePayment?.(opts.intent, message.id);
      this.deps.consumeApproval?.(opts.intent);
      this.pendingGo.delete(actionDigest(opts.intent));
    }
    const signed = wire.format === "awp-jws-compact/0.1";
    const header = signed
      ? (JSON.parse(
          Buffer.from(wire.jws.split(".")[0] ?? "", "base64url").toString("utf8"),
        ) as JsonObject)
      : {};
    this.verdict(
      verdicts,
      message.id,
      "evidence",
      signed || this.unsignedAllowed(message) ? "pass" : "fail",
      signed
        ? `Signed (JWS ${String(header.alg)}) with ${this.name(this.deps.identity.actor)}'s pinned key, and written to the record.`
        : this.unsignedAllowed(message)
          ? "Sent unsigned and with no identifier, as the public read configuration requires; written to the record."
          : "Sent unsigned; written to the record.",
      {
        ...(signed || this.unsignedAllowed(message) ? {} : { reason: "evidence-missing" }),
        rule: {
          id: message.configuration,
          text: "Every outgoing message is signed over its exact bytes and its decision appended to the hash-chained record.",
        },
      },
    );
    this.decide("go", `The ${message.kind} message goes to ${this.name(message.to?.actor)}.`);
    this.emit({
      part: "transport",
      kind: "message-out",
      packet: packetView(message, wire, {
        carriageSuite: this.deps.gate.configuration?.layers.transport ?? "unknown",
        carriageSummary: "Handed to the carriage.",
        name: this.name,
        vocabulary: opts.vocabulary ?? this.deps.gate.vocabulary,
        known: opts.known,
      }),
      ...refsFor(this.deps.gate, ["transport", "data-access", "meaning"]),
      caption: `${this.name(message.from.actor)} sends ${article(message.kind)} ${message.kind} message to ${this.name(message.to?.actor)}.`,
    });
  }

  stopDisclosure(subject: string, reason = "excessive-scope"): void {
    this.verdict(
      [],
      subject,
      "disclosure",
      "fail",
      "The actual payload is outside the authorized item scope.",
      { reason },
    );
    this.decide("stop", "The disclosure is stopped before release.", reason);
  }

  /** Evidence, then go, for an effect (no message): the activity is recorded first. */
  sealEffect(intent: ActionIntent, releaseId: string = actionDigest(intent)): void {
    this.deps.reservePayment?.(intent, releaseId);
    this.deps.consumeApproval?.(intent);
    this.pendingGo.delete(actionDigest(intent));
    const verdicts: CheckVerdict[] = [];
    this.verdict(
      verdicts,
      actionDigest(intent),
      "evidence",
      "pass",
      "The activity is written to the record before it runs.",
      {
        rule: {
          id: actionDigest(intent),
          text: "Write-ahead: the intended activity is recorded first.",
        },
      },
    );
    this.decide("go", `The action goes: ${this.describeAction(intent)}.`);
  }

  /** The principal starts something in chat. */
  instruction(text: string): void {
    this.emit({
      part: "principal",
      kind: "principal-instruction",
      chat: { who: "principal", text },
      caption: `${this.owner} asks the agent in chat. This starts a task; it authorizes nothing by itself: the mandate does.`,
    });
  }

  /** The principal's own words, as a chat line. */
  principal(text: string, caption: string): void {
    this.emit({
      part: "principal",
      kind: "principal-reply",
      chat: { who: "principal", text },
      caption,
    });
  }
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "nothing";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
