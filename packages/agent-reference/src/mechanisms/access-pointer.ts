// AUTHORED-BY Codex GPT-6
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import type { EvidenceItem } from "../core/types.js";
import type { ItemTerms } from "../gates/common.js";
import { inspectEvidenceJws } from "../wire/evidence-jws.js";
import type { SigningKey } from "./jws.js";
import { signStatement, verifyStatement } from "./statements.js";

const typ = "awp-access-pointer+jws";
const name = z.string().min(1).max(2048);
const policy = z.looseObject({ id: name, permissions: z.array(z.looseObject({})) });
const schema = z.strictObject({
  id: name,
  issuer: name,
  owner: name,
  resource: z.url({ protocol: /^https$/ }),
  digest: name,
  item: z.strictObject({ id: name, claimType: name, issuer: name }),
  reader: z.strictObject({ actor: name, party: name }),
  modes: z.tuple([z.literal("Read")]),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  purpose: name,
  agreement: name,
  terms: z.strictObject({
    supplier: z.looseObject({ policy }),
    grant: policy,
    termsDigest: name,
  }),
  copy: z.strictObject({ permitted: z.literal(true), deleteBy: z.iso.datetime() }),
  policies: z.array(name).min(1).optional(),
  remainder: z.array(z.string()).optional(),
});

export type AccessPointer = Omit<z.infer<typeof schema>, "terms"> & {
  terms: { supplier: ItemTerms; grant: OdrlPolicy; termsDigest: string };
};
export const accessRequests = z
  .array(
    z.strictObject({
      item: name,
      resource: name,
      reader: name,
      retentionDays: z.number().int().positive(),
    }),
  )
  .min(1);
export type AccessRequest = z.infer<typeof accessRequests>[number];

export function referenceTerms(supplier: ItemTerms, grant: OdrlPolicy): AccessPointer["terms"] {
  return { supplier, grant, termsDigest: digestOf({ supplier, grant }) };
}

export function deadline(at: string, days: number): string {
  return new Date(Date.parse(at) + days * 86_400_000).toISOString();
}

export function isAccessPointer(item: EvidenceItem): boolean {
  if (item.role !== "grant" || item.format !== "jws-compact") return false;
  try {
    return inspectEvidenceJws(item.value).header.typ === typ;
  } catch {
    return false;
  }
}

export function signAccessPointer(key: SigningKey, pointer: AccessPointer): Promise<string> {
  schema.parse(pointer);
  return signStatement(key, typ, pointer);
}

export function verifyAccessPointer(
  jws: string,
  options: Omit<Parameters<typeof verifyStatement>[1], "typ" | "role" | "schema">,
) {
  return verifyStatement(jws, { ...options, typ, role: "actor", schema });
}

/** The data-use grant derived from agreed evidence-request terms (ODRL, pilot subset). */
export function referenceGrant(
  agreementId: string,
  t: {
    purpose: string;
    onward: readonly { recipient: string; purpose: string }[];
    prohibitedPurposes: readonly string[];
  },
  consumer: string,
  lender: string,
): { target: string; policy: OdrlPolicy } {
  const target = `${agreementId}#evidence`;
  return {
    target,
    policy: {
      id: `${agreementId}#grant`,
      type: "Agreement",
      assigner: consumer,
      assignee: lender,
      conflict: "prohibit",
      permissions: [
        {
          id: `${agreementId}#read-for-purpose`,
          type: "permission",
          action: "read",
          target,
          constraints: [{ leftOperand: "purpose", operator: "isAnyOf", rightOperand: [t.purpose] }],
        },
        ...t.onward.map((o, i) => ({
          id: `${agreementId}#onward-${i}`,
          type: "permission" as const,
          action: "distribute" as const,
          target,
          constraints: [
            {
              leftOperand: "purpose" as const,
              operator: "isAnyOf" as const,
              rightOperand: [o.purpose],
            },
            {
              leftOperand: "recipient" as const,
              operator: "isAnyOf" as const,
              rightOperand: [o.recipient],
            },
          ],
        })),
      ],
      prohibitions: t.prohibitedPurposes.map((p, i) => ({
        id: `${agreementId}#prohibited-${i}`,
        type: "prohibition" as const,
        action: "use" as const,
        target,
        constraints: [
          { leftOperand: "purpose" as const, operator: "isAnyOf" as const, rightOperand: [p] },
        ],
      })),
    },
  };
}

export const referenceAgreement = z.object({
  purpose: name,
  retentionDays: z.number().int().positive().max(3650),
  application: z.object({ applicant: name }),
  evidenceRequest: z.array(z.object({ claimType: name, currency: name })),
  onward: z.array(z.object({ recipient: name, purpose: name })),
  prohibitedPurposes: z.array(name),
});
