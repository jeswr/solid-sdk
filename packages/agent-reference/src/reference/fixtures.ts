// AUTHORED-BY Claude Opus 5.5
/**
 * Synthetic fixtures for the reference runs: the issuers named in the explorer model
 * (Harbour Bank for balances, Paywell for pay), their signed statements with method, date
 * and terms of use, North Bank's decision in principle, the reliance profile for a mortgage
 * application, and the plain names shown to Sam. Everyone and every figure is fictional.
 */
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import type { Iri, JsonObject } from "../core/types.js";
import { CLAIM, type EvidenceStatement, PREQUAL_OP, type WalletItem } from "../domains/mortgage.js";
import { NORTH, SAM } from "../fixtures/mortgage.js";
import type { ItemTerms, RelianceProfile } from "../gates/common.js";
import type { SigningKey } from "../mechanisms/jws.js";
import type { SourceAuthorityRule } from "../mechanisms/trust.js";
import { AWP, PURPOSE } from "../profile/vocabulary.js";
import { signClaim } from "../scenarios/common.js";

export const HARBOUR = "https://harbourbank.example/#org";
export const PAYWELL = "https://paywell.example/#org";
export const DECISION_CLAIM = "mortgage.decision-in-principle";
export const INCOME_ID = "urn:awp:evidence:paywell-income-2026-10";
export const DEPOSIT_ID = "urn:awp:evidence:harbourbank-deposit-2026-10";

/** The terms an issuer attaches: use and share for a mortgage application, 90 days, no marketing. */
export function issuerTerms(issuer: Iri, statement: Iri, label: string): ItemTerms {
  const purposes = [PURPOSE.mortgagePrequalification, PURPOSE.creditChecking];
  const policy: OdrlPolicy = {
    id: `${AWP}terms/${label}`,
    type: "Set",
    assigner: issuer,
    conflict: "prohibit",
    permissions: [
      {
        id: `${AWP}terms/${label}#use`,
        type: "permission",
        action: "use",
        target: statement,
        constraints: [{ leftOperand: "purpose", operator: "isAnyOf", rightOperand: purposes }],
      },
      {
        id: `${AWP}terms/${label}#share`,
        type: "permission",
        action: "distribute",
        target: statement,
        constraints: [{ leftOperand: "purpose", operator: "isAnyOf", rightOperand: purposes }],
      },
    ],
    prohibitions: [
      {
        id: `${AWP}terms/${label}#no-marketing`,
        type: "prohibition",
        action: "use",
        target: statement,
        constraints: [
          { leftOperand: "purpose", operator: "isAnyOf", rightOperand: [PURPOSE.marketing] },
        ],
      },
    ],
  };
  return {
    policy,
    deleteWithinDays: 90,
    recipientMustBe: { task: "mortgage lending", label: "a regulated lender" },
  };
}

function months(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2025, 10 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Sam's statements: Paywell's last 12 months of pay and Harbour Bank's October balance. */
export async function referenceWallet(keys: {
  paywell: SigningKey;
  harbour: SigningKey;
}): Promise<WalletItem[]> {
  const ms = months();
  const base = {
    type: "EvidenceStatement",
    subject: SAM.party,
    version: 1,
    currency: "USD",
    synthetic: true,
  } as const;
  const income: EvidenceStatement = {
    ...base,
    id: INCOME_ID,
    issuer: PAYWELL,
    claimType: CLAIM.incomeMonthly,
    period: { start: ms[0] as string, end: ms[11] as string },
    monthly: ms.map((m) => ({ month: m, gross: 7500 })),
    issuedAt: "2026-11-02T09:00:00Z",
    method: "recorded-by-authority",
    terms: issuerTerms(PAYWELL, INCOME_ID, "paywell-income") as unknown as Record<string, unknown>,
  };
  const deposit: EvidenceStatement = {
    ...base,
    id: DEPOSIT_ID,
    issuer: HARBOUR,
    claimType: CLAIM.depositBalance,
    period: { start: "2026-10", end: "2026-10" },
    balance: 90000,
    asOf: "2026-10-31T23:59:59Z",
    issuedAt: "2026-11-01T09:00:00Z",
    method: "recorded-by-authority",
    terms: issuerTerms(HARBOUR, DEPOSIT_ID, "harbourbank-deposit") as unknown as Record<
      string,
      unknown
    >,
  };
  return [
    { jws: await signClaim(keys.paywell, income), statement: income },
    { jws: await signClaim(keys.harbour, deposit), statement: deposit },
  ];
}

/** North Bank's signed decision in principle: an amount, a validity, and not binding. */
export function decisionInPrinciple(input: {
  amount: number;
  at: string;
  conversation: Iri;
}): JsonObject {
  const validUntil = new Date(Date.parse(input.at) + 92 * 86_400_000).toISOString();
  return {
    type: "DecisionInPrinciple",
    id: `${input.conversation}#decision-in-principle`,
    issuer: NORTH.party,
    subject: SAM.party,
    claimType: DECISION_CLAIM,
    method: "decided-by-authority",
    issuedAt: input.at,
    validUntil,
    decision: {
      operation: PREQUAL_OP.id,
      amount: input.amount,
      currency: "USD",
      binding: false,
      note: "a decision in principle, not an offer; synthetic and indicative only",
    },
    synthetic: true,
  };
}

/** Sam's own list: his own bank for balances, his employer's payroll for pay. */
export function samSourceRules(until: string): SourceAuthorityRule[] {
  return [
    {
      id: `${AWP}rule/sam/own-bank-balances`,
      version: "1",
      source: HARBOUR,
      claimTypes: ["deposit.*"],
      subjects: [SAM.party],
      validUntil: until,
      framework: "Sam's own list: Sam's own bank",
    },
    {
      id: `${AWP}rule/sam/payroll-income`,
      version: "1",
      source: PAYWELL,
      claimTypes: ["income.*"],
      subjects: [SAM.party],
      validUntil: until,
      framework: "Sam's own list: Sam's employer's payroll",
    },
  ];
}

/** North Bank's own list: payroll providers for income, account banks for balances. */
export function referenceLenderRules(until: string): SourceAuthorityRule[] {
  return [
    {
      id: `${AWP}rule/nb/paywell-income`,
      version: "1",
      source: PAYWELL,
      claimTypes: ["income.*"],
      subjects: "any",
      validUntil: until,
      framework: "North Bank source policy",
    },
    {
      id: `${AWP}rule/nb/harbourbank-deposits`,
      version: "1",
      source: HARBOUR,
      claimTypes: ["deposit.*"],
      subjects: "any",
      validUntil: until,
      framework: "North Bank source policy",
    },
  ];
}

/** The mortgage profile's reliance rules (method and age per kind of claim). */
export const MORTGAGE_RELIANCE: RelianceProfile = {
  id: `${AWP}reliance/mortgage-application`,
  rules: [
    {
      id: `${AWP}reliance/mortgage-application#income`,
      claimType: "income.*",
      methods: ["recorded-by-authority"],
      maxAgeDays: 92,
      text: "Income must be recorded by a payroll provider or tax authority and be at most three months old.",
    },
    {
      id: `${AWP}reliance/mortgage-application#balance`,
      claimType: "deposit.*",
      methods: ["recorded-by-authority"],
      maxAgeDays: 31,
      text: "A balance must be recorded by the bank that holds the account and be at most one month old.",
    },
    {
      id: `${AWP}reliance/mortgage-application#decision`,
      claimType: DECISION_CLAIM,
      methods: ["decided-by-authority"],
      maxAgeDays: 30,
      text: "A decision in principle must come from the lender itself and still be valid.",
    },
  ],
};

const NAMES: Record<string, string> = {
  [HARBOUR]: "Harbour Bank",
  [PAYWELL]: "Paywell",
};

function dateWords(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Plain names for statements, as Sam would say them. */
export function claimLabel(
  s: Readonly<Record<string, unknown>>,
  name: (iri: string) => string,
): string {
  const issuer = NAMES[String(s.issuer)] ?? name(String(s.issuer));
  if (String(s.claimType).startsWith("income"))
    return `${issuer}'s record of your pay for the last 12 months`;
  if (String(s.claimType).startsWith("deposit"))
    return `${issuer}'s balance at ${typeof s.asOf === "string" ? dateWords(s.asOf) : "the latest date"}`;
  if (s.claimType === DECISION_CLAIM) return `${issuer}'s decision in principle`;
  return `${issuer}'s statement`;
}

/** What Sam's agent tells Sam when North Bank's decision is admitted. */
export function tellSam(s: Readonly<Record<string, unknown>>): string | undefined {
  if (s.claimType !== DECISION_CLAIM) return undefined;
  const d = s.decision as { amount: number; currency: string };
  return `North Bank has given you a decision in principle: they would lend up to $${d.amount.toLocaleString("en-US")}. It is valid until ${dateWords(String(s.validUntil))}, and it is not a binding offer.`;
}
