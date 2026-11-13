// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import type { ActionIntent } from "../core/types.js";
import type { GateMemory } from "./common.js";
import { evaluateItemTerms } from "./quality.js";
export const paymentSchema = z.strictObject({
  payee: z.string(),
  amount: z.union([
    z
      .string()
      .regex(/^(0|[1-9]\d*)(\.\d{1,2})?$/)
      .refine((s) => Number(s) > 0),
    z
      .number()
      .positive()
      .finite()
      .refine(
        (n) =>
          Number.isSafeInteger(Math.round(n * 100)) &&
          Math.abs(n * 100 - Math.round(n * 100)) < 1e-7,
      ),
  ]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reference: z.string(),
  account: z.string().optional(),
  agreement: z.string().optional(),
  instalment: z.number().int().positive().optional(),
  onceKey: z.string().optional(),
  validUntil: z.string().optional(),
});
export interface PaymentLimit {
  perAction: number;
  perPeriod: number;
  period: "calendar-month";
  currency: string;
}
export function paymentBinding(
  intent: ActionIntent,
  memory: GateMemory,
  task: string,
  at: string,
  actor: string,
  recipientAllowed?: (task: string) => boolean,
): string | undefined {
  const payment = paymentSchema.safeParse(intent.parameters);
  if (!payment.success) return "structured-form-required";
  const p = payment.data;
  const known = memory.knownIdentifiers(task, intent.conversation, {});
  if (!known.has(p.reference) || !known.has(p.payee)) return "structured-form-required";
  const bindings = memory
    .context(task)
    .filter(
      (i) =>
        i.accepted === true &&
        memory.facts.get(i.id)?.digest === i.digest &&
        i.claimType === "payee-account" &&
        i.statement?.payee === p.payee &&
        typeof i.statement?.account === "string" &&
        (!i.statement.validUntil || Date.parse(String(i.statement.validUntil)) > Date.parse(at)),
    );
  if (!bindings.length)
    return memory.refusals[`${task}|payee-account|${p.payee}`] ?? "structured-form-required";
  for (const binding of bindings) {
    if (!binding.terms && binding.admittedPurpose !== intent.purpose)
      return "purpose-not-permitted";
    const terms = evaluateItemTerms(binding.terms, {
      agent: actor,
      action: p.account === undefined ? "use" : "distribute",
      target: binding.id,
      purpose: intent.purpose,
      recipient: intent.recipient,
      at,
      recipientAllowed,
    });
    if (terms.verdict !== "pass") return terms.reason ?? "purpose-not-permitted";
  }
  if (
    new Set(bindings.map((i) => i.statement?.account)).size !== 1 ||
    (p.account !== undefined && bindings[0]?.statement?.account !== p.account)
  )
    return "not-authorised";
  return undefined;
}
export function periodKey(rule: string, currency: string, at: string): string {
  return `${rule}|${currency}|${at.slice(0, 7)}`;
}

/** All settlement decisions read RDF views, independently of protocol representation. */
import { digestOf } from "../core/canonical.js";
import {
  ODRL,
  type PaymentAccountNode,
  type PaymentAgreementNode,
  type PaymentFacts,
  paymentOnceKey,
  SCHEMA,
} from "../model/payment.js";
import { decimalParts } from "../settlement/money.js";
export interface PaymentRecord {
  now: string;
  agreement?: PaymentAgreementNode;
  proofsVerified: boolean;
  inEffect: boolean;
  /** The selected executable adapter guarantees a closed payment instruction. */
  protocolScoped: boolean;
  accountBindings?: readonly PaymentAccountNode[];
  binding: () => string | undefined;
  mandate: () => { reason?: string; ask?: boolean };
  approval: () => "approved" | "required" | "denied" | "unneeded";
  ordered: (onceKey: string) => boolean;
  /** Expected payer, supplied by the runtime, never by protocol objects or the core. */
  payer: string;
  purpose?: string;
}
export interface PaymentVerdict {
  check: "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "receipt";
  ok: boolean;
  fact: string;
  reason?: string;
  ask?: boolean;
}
export interface PaymentResult {
  ok: boolean;
  verdicts: PaymentVerdict[];
  reason?: string;
  ask?: boolean;
  digest?: string;
}
export function sameAmount(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  try {
    const a = decimalParts(left),
      b = decimalParts(right);
    return a.value * 10n ** BigInt(b.scale) === b.value * 10n ** BigInt(a.scale);
  } catch {
    return false;
  }
}
export function paymentDigest(facts: PaymentFacts): string {
  // The exact order fields, with decimal lexical spelling preserved, bind approval and release.
  return digestOf({
    id: facts.id,
    agreement: facts.agreement,
    payer: facts.payer,
    payee: facts.payee,
    account: facts.account,
    amount: facts.amount,
    currency: facts.currency,
    invoice: facts.invoice,
    onceKey: facts.onceKey,
    validUntil: facts.validUntil,
    instalment: facts.instalment,
  });
}
export function checkPayment(facts: PaymentFacts, record: PaymentRecord): PaymentResult {
  const verdicts: PaymentVerdict[] = [];
  const test = (
    check: PaymentVerdict["check"],
    ok: boolean,
    fact: string,
    reason: string,
    ask = false,
  ): boolean => {
    verdicts.push({ check, ok, fact, ...(!ok ? { reason, ...(ask ? { ask } : {}) } : {}) });
    return ok;
  };
  const finish = (): PaymentResult => {
    const failed = verdicts.find((v) => !v.ok);
    return {
      ok: !failed,
      verdicts,
      ...(failed ? { reason: failed.reason, ask: failed.ask } : { digest: paymentDigest(facts) }),
    };
  };
  const a = record.agreement;
  const held =
    !!a &&
    facts.agreement === a.digest &&
    !!a.offerProof &&
    !!a.acceptanceProof &&
    record.proofsVerified &&
    record.inEffect &&
    (!a.payer || a.payer === record.payer) &&
    (!a.purpose || a.purpose === record.purpose);
  const current =
    !!a?.validUntil &&
    Date.parse(a.validUntil) > Date.parse(record.now) &&
    !!a.validFrom &&
    Date.parse(a.validFrom) <= Date.parse(record.now);
  if (
    !test(
      "P1",
      held && current,
      held
        ? "The verified agreement is in its stated time window."
        : "The agent must hold the signed offer and authorised acceptance, in effect for these terms.",
      held ? "expired" : "no-agreement",
    )
  )
    return finish();
  const due = a?.duty?.constraint;
  if (
    !test(
      "P2",
      a?.duty?.action === ODRL + "compensate" &&
        due?.operand === ODRL + "payAmount" &&
        sameAmount(due?.amount, facts.amount) &&
        due?.currency === facts.currency,
      `The agreed amount is ${due?.amount ?? "missing"} ${due?.currency ?? ""}; the payment asks for ${facts.amount ?? "missing"} ${facts.currency ?? ""}.`,
      "amount-differs",
    )
  )
    return finish();
  if (
    !test(
      "P3",
      !!facts.payee &&
        facts.payee === a?.duty?.payee &&
        (record.accountBindings ?? []).every(
          (binding) => binding.account !== facts.account || binding.payee === a?.duty?.payee,
        ),
      "The payment recipient must be the party named by the agreement's compensation duty.",
      "payee-differs",
    )
  )
    return finish();
  const binding = record.binding();
  if (
    !test(
      "P4",
      !binding,
      "An accepted, current source binds this payee to the account, with terms permitting this use.",
      binding ?? "source-not-authoritative",
    )
  )
    return finish();
  const mandate = record.mandate();
  if (
    !test(
      "P5",
      !mandate.reason,
      "The mandate permits this purpose and amount within its payment and period limits.",
      mandate.reason ?? "not-authorised",
      mandate.ask,
    )
  )
    return finish();
  const approval = record.approval();
  if (
    !test(
      "P6",
      approval === "approved" || approval === "unneeded",
      "Approval covers the terms digest and this exact payment order where required.",
      approval === "denied" ? "approval-denied" : "approval-required",
      approval === "required",
    )
  )
    return finish();
  if (
    !test(
      "P7",
      !!facts.agreement &&
        facts.instalment === a?.instalment &&
        Number.isSafeInteger(facts.instalment) &&
        facts.instalment > 0 &&
        facts.onceKey === paymentOnceKey(facts.agreement, facts.instalment) &&
        !record.ordered(facts.onceKey),
      "This agreement and instalment have not been ordered before.",
      "replay-conflict",
    )
  )
    return finish();
  if (
    !test(
      "P8",
      record.protocolScoped &&
        !!facts.payee &&
        !!facts.account &&
        !!facts.invoice &&
        facts.payer === record.payer &&
        !!facts.amount &&
        decimalParts(facts.amount).value > 0n &&
        /^[A-Z]{3}$/.test(facts.currency ?? "") &&
        !!facts.validUntil &&
        Date.parse(facts.validUntil) > Date.parse(record.now) &&
        Date.parse(facts.validUntil) <= Date.parse(a?.validUntil ?? ""),
      "Only this payee, account, amount and currency may be paid, before the stated expiry.",
      "protocol-violation",
    )
  )
    return finish();
  return finish();
}
/** Called after the five ordinary inbound checks. Only the recorded provider can attest settlement. */
export function checkReceipt(
  receipt: PaymentFacts,
  order: PaymentFacts,
  provider: string,
): PaymentResult {
  const ok =
    receipt.kind === "payment-receipt" &&
    receipt.order === order.id &&
    receipt.provider === provider &&
    receipt.agreement === order.agreement &&
    receipt.payee === order.payee &&
    sameAmount(receipt.amount, order.amount) &&
    receipt.currency === order.currency &&
    receipt.status === SCHEMA + "CompletedActionStatus" &&
    !!receipt.ledgerReference;
  return {
    ok,
    ...(!ok ? { reason: "receipt-mismatch" } : {}),
    verdicts: [
      {
        check: "receipt",
        ok,
        fact: `The provider's receipt ${ok ? "matches" : "does not match"} the recorded agreement, payee and ${order.amount} ${order.currency} order.`,
        ...(!ok ? { reason: "receipt-mismatch" } : {}),
      },
    ],
  };
}
