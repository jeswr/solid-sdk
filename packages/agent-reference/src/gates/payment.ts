// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import type { ActionIntent } from "../core/types.js";
import type { GateMemory } from "./common.js";
import { evaluateItemTerms } from "./quality.js";
export const paymentSchema = z.strictObject({
  payee: z.string(),
  amount: z
    .number()
    .positive()
    .finite()
    .refine(
      (n) =>
        Number.isSafeInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-7,
    ),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reference: z.string(),
  account: z.string().optional(),
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
