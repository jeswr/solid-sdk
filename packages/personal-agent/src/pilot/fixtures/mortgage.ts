/**
 * SYNTHETIC mortgage (UC-01) fixture: the identities, owner mandates, source-authority anchors,
 * internal roles, evidence issuers and wallet statements used by BOTH the in-process scenario
 * (`scenarios/mortgage.ts`) and the durable per-directory roles (`roles/mortgage.ts`). All
 * institutions, people, figures and keys are synthetic; nothing here is a real lender, payroll
 * provider or credit process.
 */

import {
  CLAIM,
  DISCLOSURE_TARGET,
  type EvidenceStatement,
  PREQUAL_OP,
  UNDERWRITING_OP,
  VALUATION_OP,
  type WalletItem,
} from "../domains/mortgage.js";
import type { InternalRole } from "../domains/purpose-store.js";
import { PAYMENT_OP } from "../domains/scheduling.js";
import { generateSigningKey, type SigningKey } from "../mechanisms/jws.js";
import type { SourceAuthorityRule } from "../mechanisms/trust.js";
import { AWP, PURPOSE } from "../profile/vocabulary.js";
import { mandateOf, permit, signClaim } from "../scenarios/common.js";

export const SAM = {
  name: "sam",
  party: "https://sam.example/#me",
  actor: "https://agents.hostco.example/sam#agent",
  operator: "https://hostco.example/#org",
};
export const NORTH = {
  name: "northbank-intake",
  party: "https://northbank.example/#org",
  actor: "https://northbank.example/agents/intake#agent",
  operator: "https://northbank.example/#org",
};
export const VALLEY = {
  name: "valleybank-intake",
  party: "https://valleybank.example/#org",
  actor: "https://valleybank.example/agents/intake#agent",
  operator: "https://valleybank.example/#org",
};
export const UW = {
  name: "underwriter",
  party: "https://underwriter.example/#org",
  actor: "https://underwriter.example/agents/check#agent",
  operator: "https://underwriter.example/#org",
};
export const NB_ASSESS = "https://northbank.example/agents/assessment#agent";
export const NB_MARKETING = "https://northbank.example/agents/marketing#agent";
export const DATA_BROKER = "https://broker.example/#org";
export const PAYROLL = "https://payroll.example/#org";
export const DEPOSIT_BANK = "https://depositbank.example/#org";
export const VALUER = "https://valuer.example/#org";

/** Sam's owner mandate for the mortgage journey (also used by the policy-engine cases). */
export function samMortgageMandate() {
  return mandateOf(
    "mortgage",
    [
      permit(
        "use",
        PREQUAL_OP.id,
        [PURPOSE.mortgagePrequalification],
        [NORTH.party, VALLEY.party],
        "#compare",
      ),
    ],
    [
      permit(
        "distribute",
        DISCLOSURE_TARGET,
        [PURPOSE.creditChecking],
        [NORTH.party, VALLEY.party],
        "#disclose-with-approval",
      ),
      permit(
        "compensate",
        PAYMENT_OP,
        [PURPOSE.mortgagePrequalification],
        [NORTH.party],
        "#fees-with-approval",
      ),
    ],
  );
}

export function lenderMandate() {
  return mandateOf("lender-intake", [
    permit("use", PREQUAL_OP.id, [PURPOSE.creditChecking], undefined, "#evidence-requests"),
    permit(
      "distribute",
      UNDERWRITING_OP.id,
      [PURPOSE.creditChecking],
      [UW.party],
      "#onward-underwriting",
    ),
    permit(
      "use",
      VALUATION_OP.id,
      [PURPOSE.mortgagePrequalification],
      undefined,
      "#valuation-orders",
    ),
  ]);
}

export function valleyMandate() {
  return mandateOf("lender-intake", [permit("use", PREQUAL_OP.id, [PURPOSE.creditChecking])]);
}

export function underwriterMandate() {
  return mandateOf("underwriting", [
    permit("use", UNDERWRITING_OP.id, [PURPOSE.creditChecking], [NORTH.party]),
    permit("distribute", `${AWP}op/underwriting-result`, [PURPOSE.creditChecking], [NORTH.party]),
  ]);
}

/** Sam's own disclosure policy (checked by his handler before any approval is requested). */
export const SAM_POLICY = {
  requireProhibited: [PURPOSE.marketing],
  maxRetentionDays: 180,
  allowedOnward: [UW.party],
} as const;

/** The lender's synthetic source-authority anchors, configured locally at provisioning. */
export function lenderSourceRules(until: string): SourceAuthorityRule[] {
  return [
    {
      id: `${AWP}rule/nb/payroll-income`,
      version: "1",
      source: PAYROLL,
      claimTypes: ["income.*"],
      subjects: "any",
      validUntil: until,
      framework: "North Bank synthetic source policy",
    },
    {
      id: `${AWP}rule/nb/bank-deposits`,
      version: "1",
      source: DEPOSIT_BANK,
      claimTypes: ["deposit.*"],
      subjects: "any",
      validUntil: until,
    },
    {
      id: `${AWP}rule/nb/valuer-property`,
      version: "1",
      source: VALUER,
      claimTypes: ["property.valuation"],
      subjects: "any",
      validUntil: until,
    },
    {
      id: `${AWP}rule/nb/underwriting-results`,
      version: "1",
      source: UW.party,
      claimTypes: ["underwriting.result"],
      subjects: "any",
      validUntil: until,
    },
  ];
}

export function underwriterSourceRules(until: string): SourceAuthorityRule[] {
  return [
    {
      id: `${AWP}rule/uw/lender-attestations`,
      version: "1",
      source: NORTH.party,
      claimTypes: [CLAIM.consentBasis, CLAIM.applicationFacts],
      subjects: "any",
      validUntil: until,
      framework: "synthetic underwriting participation rules",
    },
  ];
}

/** North Bank's internal agents at its purpose-bound enforcement point. */
export function lenderInternalRoles(): InternalRole[] {
  return [
    {
      agent: NB_ASSESS,
      label: "assessment agent",
      purposes: [PURPOSE.creditChecking],
      actions: ["read"],
    },
    {
      agent: NB_MARKETING,
      label: "marketing agent",
      purposes: [PURPOSE.marketing],
      actions: ["read", "use"],
    },
    {
      agent: NORTH.actor,
      label: "intake agent",
      purposes: [PURPOSE.creditChecking],
      actions: ["read", "distribute"],
    },
  ];
}

function months(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(2025, 9 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export interface SyntheticIssuers {
  readonly payroll: SigningKey;
  readonly deposit: SigningKey;
  readonly valuer: SigningKey;
}

export async function newSyntheticIssuers(): Promise<SyntheticIssuers> {
  const gen = async () => (await generateSigningKey("EdDSA")).key;
  return { payroll: await gen(), deposit: await gen(), valuer: await gen() };
}

/** Issuer public keys, for the lender's local pinning (never private material). */
export function issuerPublicKeys(issuers: SyntheticIssuers) {
  return [
    { issuer: PAYROLL, key: issuers.payroll },
    { issuer: DEPOSIT_BANK, key: issuers.deposit },
    { issuer: VALUER, key: issuers.valuer },
  ].map(({ issuer, key }) => ({
    issuer,
    kid: key.kid,
    alg: key.alg,
    publicJwk: key.publicJwk,
  }));
}

/**
 * Sam's wallet: payroll series and deposit balance, plus two adversarial items — an income
 * statement signed by the property valuer (not authoritative for income) and a tampered copy
 * of the deposit statement (integrity fails).
 */
export async function samWallet(issuers: SyntheticIssuers): Promise<WalletItem[]> {
  const base = {
    type: "EvidenceStatement",
    subject: SAM.party,
    version: 1,
    currency: "USD",
    issuedAt: "2026-10-01T09:00:00Z",
    synthetic: true,
  } as const;
  const ms = months();
  const payroll: EvidenceStatement = {
    ...base,
    id: "urn:awp:evidence:payroll-2026-09",
    issuer: PAYROLL,
    claimType: CLAIM.incomeMonthly,
    period: { start: ms[0] as string, end: ms[11] as string },
    monthly: ms.map((m) => ({ month: m, gross: 7500 })),
  };
  const deposit: EvidenceStatement = {
    ...base,
    id: "urn:awp:evidence:deposit-2026-09",
    issuer: DEPOSIT_BANK,
    claimType: CLAIM.depositBalance,
    period: { start: "2026-09", end: "2026-09" },
    balance: 90000,
    asOf: "2026-09-30T23:59:59Z",
  };
  const valuerIncome: EvidenceStatement = {
    ...payroll,
    id: "urn:awp:evidence:valuer-income",
    issuer: VALUER,
    monthly: ms.map((m) => ({ month: m, gross: 20000 })),
  };
  const depositJws = await signClaim(issuers.deposit, deposit);
  const [h, , s] = depositJws.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...deposit, id: "urn:awp:evidence:deposit-tampered", balance: 900000 }),
  ).toString("base64url");
  return [
    { jws: await signClaim(issuers.payroll, payroll), statement: payroll },
    { jws: depositJws, statement: deposit },
    { jws: await signClaim(issuers.valuer, valuerIncome), statement: valuerIncome },
    {
      jws: `${h}.${tamperedPayload}.${s}`,
      statement: { ...deposit, id: "urn:awp:evidence:deposit-tampered" },
    },
  ];
}

export const DEPOSIT_ID = "urn:awp:evidence:deposit-2026-09";
export const APPLICATION = { propertyPrice: 450000, loanAmount: 380000 } as const;
