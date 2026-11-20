// AUTHORED-BY Codex GPT-6
/** Corroboration uses admitted signed observations, never a core-supplied source count. */
import { z } from "zod";
import type { RelianceProfile } from "../gates/common.js";
import { evaluateItemTerms, fitnessOf } from "../gates/quality.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { SuiteValuesNode } from "../model/suite-values.js";

const roots = z.array(z.string().url()).min(1).max(32);
export const incomeProvenanceSchema = z.strictObject({ rootRecords: roots });
export const salaryCreditsSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  period: z.strictObject({ start: z.string(), end: z.string() }),
  monthly: z
    .array(z.strictObject({ month: z.string(), amount: z.number().finite().nonnegative() }))
    .min(1)
    .max(36),
  method: z.literal("recorded-by-authority"),
  rootRecords: roots,
});
export const relianceCorroborationSchema = z.strictObject({
  receivers: z.array(z.string().url()),
  payroll: z.string().url(),
  bank: z.string().url(),
  tolerance: z.number().finite().nonnegative(),
});
export type CorroborationSettings = z.infer<typeof relianceCorroborationSchema>;
export function corroborateIncome(
  claim: unknown,
  candidates: readonly unknown[],
  options: {
    settings: CorroborationSettings;
    trust: TrustStore;
    reliance?: RelianceProfile;
    at: string;
    verifier: string;
    purpose?: string;
    record: <T extends { type: string }>(record: T) => void;
  },
) {
  const fail = () => ({ ok: false as const, reason: "evidence-missing" as const });
  try {
    const payroll = SuiteValuesNode.fromSignedPayload(claim);
    const roots = payroll.node("incomeProvenance")?.strings("rootRecords") ?? [];
    const monthly = payroll.records("monthly");
    if (payroll.string("issuer") !== options.settings.payroll || !monthly.length || !roots.length)
      return fail();
    const controllers = options.trust.data.controllers ?? {};
    if (
      !controllers[options.settings.payroll] ||
      !controllers[options.settings.bank] ||
      controllers[options.settings.payroll] === controllers[options.settings.bank]
    )
      return fail();
    for (const candidate of candidates) {
      try {
        const bank = SuiteValuesNode.fromSignedPayload(candidate);
        const credits = bank.node("salaryCredits");
        if (
          bank.string("issuer") !== options.settings.bank ||
          bank.string("subject") !== payroll.string("subject") ||
          bank.string("claimType") !== "deposit.balance" ||
          !credits ||
          credits.string("method") !== "recorded-by-authority" ||
          credits.string("currency") !== payroll.string("currency") ||
          !credits.node("period") ||
          credits.node("period")!.contentDigest !== payroll.node("period")?.contentDigest
        )
          continue;
        const bankRoots = credits.strings("rootRecords");
        if (
          !credits.fieldsOnly(["currency", "period", "monthly", "method", "rootRecords"]) ||
          !bankRoots.length ||
          roots.some((root) => bankRoots.includes(root))
        )
          continue;
        if (fitnessOf(bank.quality, options.reliance, options.at).verdict !== "pass") continue;
        const authority = options.trust.assessSource({
          evaluator: options.verifier,
          source: options.settings.bank,
          claimType: "income.salary-credits",
          subject: bank.string("subject"),
          at: options.at,
        });
        options.record(authority);
        if (authority.outcome !== "accepted") continue;
        if (
          evaluateItemTerms(bank.terms, {
            agent: options.verifier,
            action: "use",
            target: bank.string("id")!,
            purpose: options.purpose,
            at: options.at,
          }).verdict !== "pass"
        )
          continue;
        const observed = credits.records("monthly");
        const months = new Map(observed.map((m) => [m.string("month"), m.number("amount")]));
        if (
          months.size !== observed.length ||
          monthly.length !== months.size ||
          new Set(monthly.map((m) => m.string("month"))).size !== months.size
        )
          continue;
        if (
          !monthly.every(
            (m) =>
              m.string("month") &&
              m.number("gross") !== undefined &&
              months.get(m.string("month")) !== undefined &&
              Math.abs(m.number("gross")! - months.get(m.string("month"))!) <=
                options.settings.tolerance,
          )
        )
          continue;
        options.record({
          type: "income-corroboration",
          payroll: payroll.string("id"),
          payrollDigest: payroll.contentDigest,
          bank: bank.string("id"),
          bankDigest: bank.contentDigest,
          rootRecords: [roots, bankRoots],
          tolerance: options.settings.tolerance,
          currency: payroll.string("currency"),
          period: payroll.node("period")?.toObject(),
        });
        return { ok: true as const };
      } catch {
        /* A malformed or unqualified observation contributes no source. */
      }
    }
    return fail();
  } catch {
    return fail();
  }
}
