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
import type {
  ActionIntent,
  AnyMessage,
  AuthorisationDecision,
  Iri,
  JsonObject,
} from "../core/types.js";
import { actionDigest, type OwnerMandate } from "../mechanisms/mandate.js";
import { configurationById } from "../profile/configurations.js";
import type { WireMessage } from "../store/state.js";
import { packetView } from "../trace/packet.js";
import type { OutboundCheck, OutboundOutcome, TraceEventInput, Verdict } from "../trace/types.js";
import {
  type CheckVerdict,
  checkRefs,
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
import { evaluateItemTerms, termsSummary } from "./quality.js";

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
  readonly identity: { readonly actor: Iri; readonly party?: Iri };
  readonly now: () => string;
  readonly mandate: () => OwnerMandate | undefined;
  readonly gate: GateContext;
  readonly memory: GateMemory;
  /** Whether `party` opened this conversation (a reply to its verified agent). */
  readonly isReplyTo: (conversation: Iri, party: Iri) => boolean;
  /** The offered terms with this digest, as received in this agent's conversations. */
  readonly offerTerms: (termsDigest: string) => JsonObject | undefined;
  /** A stronger approval the recipient asked for in a challenge to this kind of action. */
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
  go: "pass",
  "ask-principal": "ask-principal",
  stop: "fail",
};

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

function mandateReason(decision: AuthorisationDecision): string {
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
    check: OutboundCheck,
    verdict: Verdict,
    caption: string,
    extra: Partial<TraceEventInput> = {},
  ): void {
    // Every verdict carries a code; a pass without one of its own takes the check's pass code.
    if (verdict === "pass" && !extra.reason) extra = { reason: PASS_CODE[check], ...extra };
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
      if (e.role !== "credential" || e.format !== "jws-compact") continue;
      let payload: JsonObject = {};
      try {
        payload = JSON.parse(
          Buffer.from(e.value.split(".")[1] ?? "", "base64url").toString("utf8"),
        ) as JsonObject;
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

    // 2. Recipient.
    if (
      !this.recipient(verdicts, subject, intent.recipient, intent.operation, intent.conversation)
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
      return { outcome: "stop", verdicts, decision: { ...decision, outcome: "deny" } };
    }

    // 5. Limits and approval.
    const limitText = this.exceededLimit(intent);
    const limitRule = ctx.principalLimits && limitText ? { id: ctx.principalLimits.id } : undefined;
    // CORE-OUT-8: the recipient asked for a stronger approval; ask the principal in that form.
    const demanded = this.deps.demandedApproval?.(intent);
    const demandText =
      demanded && !demanded.approvedBy
        ? `${this.name(intent.recipient)} asked for ${demanded.label} before it will do this.`
        : undefined;
    let effective = decision;
    if (decision.outcome === "permit" && decision.basis === "autonomous" && limitText) {
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
      decision.basis === "owner-approval"
        ? demanded
          ? `${this.owner} approved this exact action with ${demanded.label}, as ${this.name(intent.recipient)} asked.`
          : `${this.owner} approved this exact action.`
        : `Inside what the agent may do on its own, and within ${this.owner}'s limits.`,
      decision.approval
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
  ): boolean {
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
      const requested = Array.isArray(offer?.evidenceRequest)
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
    if (Array.isArray(p.disclosed)) {
      this.verdict(
        verdicts,
        subject,
        "disclosure",
        "pass",
        `Only the fields the application needs go: ${listWords(p.disclosed.map((f) => idWords(String(f))))}.`,
        { reason: "minimal-disclosure" },
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

  /** Data terms: do the terms on each item allow this use and this recipient? */
  private dataTerms(
    verdicts: CheckVerdict[],
    subject: string,
    intent: ActionIntent,
  ): string | undefined {
    const p = intent.parameters;
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
        ...(typeof p.retentionDays === "number" ? { retentionDays: p.retentionDays } : {}),
        at: this.deps.now(),
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
            id: terms?.policy.id ?? "default-terms",
            text: terms
              ? `The issuer's terms: ${termsSummary(terms)}. They go out with the data.`
              : text,
          },
        },
      );
    }
    return blocked;
  }

  /** The principal declined a held action: it stops. */
  declined(intent: ActionIntent): void {
    this.pendingGo.delete(actionDigest(intent));
    this.decide("stop", `${this.owner} declined; the action is stopped.`, "approval-denied");
  }

  /** Evidence, then go, for a message about to leave (signed, recorded). */
  seal(
    message: AnyMessage,
    wire: WireMessage,
    opts: { intent?: ActionIntent; operation?: Iri },
  ): void {
    if (!this.deps.gate.sink) return;
    const verdicts: CheckVerdict[] = [];
    if (opts.intent) {
      this.pendingGo.delete(actionDigest(opts.intent));
    } else {
      const subject = message.id;
      // OPEN-DESIGN: the pilot authorises only messages that carry an action intent; protocol
      // messages pass the gate with no mandate decision and cannot be held here.
      this.verdict(
        verdicts,
        subject,
        "mandate",
        "not-applicable",
        "No action is proposed by this message, so there is no mandate decision.",
        { reason: NOT_APPLICABLE.noAction },
      );
      this.recipient(verdicts, subject, message.to?.party, opts.operation, message.conversation);
      // CORE-OUT-12: sending is itself an action. The gate looks for the principal's data
      // itself; not-applicable only when it finds none.
      const carried = this.principalDataIn(message);
      if (carried.length === 0) {
        this.verdict(
          verdicts,
          subject,
          "disclosure",
          "not-applicable",
          `The gate finds none of ${this.owner}'s data in this message: no statement about ${this.owner} and no stored fact.`,
          { reason: NOT_APPLICABLE.noPersonalData },
        );
        this.verdict(
          verdicts,
          subject,
          "data-terms",
          "not-applicable",
          `None of ${this.owner}'s data goes, so no terms apply.`,
          { reason: NOT_APPLICABLE.noPersonalData },
        );
      } else {
        // OPEN-DESIGN: a protocol message carrying the principal's data with no action behind
        // it has no request to measure the disclosure against. The gate shows it as
        // indeterminate; the pilot cannot hold protocol messages here.
        this.verdict(
          verdicts,
          subject,
          "disclosure",
          "indeterminate",
          `This message carries ${this.owner}'s data (${listWords(carried)}) with no action behind it.`,
          { reason: "missing-context" },
        );
        this.verdict(
          verdicts,
          subject,
          "data-terms",
          "indeterminate",
          "No action names a purpose to check the data's terms against.",
          { reason: "missing-context" },
        );
      }
      this.verdict(
        verdicts,
        subject,
        "limits-approval",
        "not-applicable",
        "No action, so no limit or approval applies.",
        {
          reason: NOT_APPLICABLE.noAction,
        },
      );
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
      }),
      ...refsFor(this.deps.gate, ["transport", "data-access", "meaning"]),
      caption: `${this.name(message.from.actor)} sends ${article(message.kind)} ${message.kind} message to ${this.name(message.to?.actor)}.`,
    });
  }

  /** Evidence, then go, for an effect (no message): the activity is recorded first. */
  sealEffect(intent: ActionIntent): void {
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
