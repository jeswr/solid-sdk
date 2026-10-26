/**
 * Protected statements other than interaction messages: owner mandates, representation
 * statements, owner approvals, and domain statements (evidence credentials, grants,
 * memberships, revocations). Each has its own JWS `typ`, so a statement of one kind can
 * never be replayed as another, and each is verified against a key of the ROLE that may
 * issue it (party keys for mandates/representation/approvals; issuer or actor keys for
 * domain statements).
 */
import type { JWK } from "jose";
import { z } from "zod";
import { isIri } from "../core/canonical.js";
import type { PilotLimits } from "../core/limits.js";
import { isIsoInstant } from "../core/schema.js";
import type { Iri, VerificationResult } from "../core/types.js";
import { type KeyAlg, type SigningKey, signCompact, verifyCompact } from "./jws.js";
import type { KeyRole, PinnedKey, TrustStore } from "./trust.js";

export const TYP = {
  message: "awp-message+jws",
  mandate: "awp-mandate+jws",
  representation: "awp-representation+jws",
  approval: "awp-approval+jws",
  statement: "awp-statement+jws",
} as const;

export const MECHANISM_ID = "jws-compact/rfc7515";

const instant = z.string().max(64).refine(isIsoInstant);
// Identifiers must be valid IRIs (profile 0.1.1): legacy `<iri#frag>#x` ids are rejected.
const iri = z.string().min(3).max(512).refine(isIri, "not a valid IRI (profile 0.1.1)");

export const representationSchema = z
  .object({
    type: z.literal("RepresentationStatement"),
    id: iri,
    party: iri,
    actor: iri,
    actorKid: z.string().min(16).max(128),
    operator: iri.optional(),
    operations: z.array(iri).min(1).max(64),
    validFrom: instant,
    validUntil: instant,
    issuedAt: instant,
  })
  .strict();
export type RepresentationStatement = z.infer<typeof representationSchema>;

export const approvalSchema = z
  .object({
    type: z.literal("OwnerApproval"),
    id: iri,
    issuer: iri,
    actor: iri,
    actionDigest: z.string().max(128),
    conversation: iri,
    decision: z.enum(["approve", "deny"]),
    issuedAt: instant,
    validUntil: instant,
    note: z.string().max(512).optional(),
  })
  .strict();
export type OwnerApproval = z.infer<typeof approvalSchema>;

/** Sign any statement with a fixed typ. */
export function signStatement(key: SigningKey, typ: string, payload: unknown): Promise<string> {
  return signCompact(key, typ, payload);
}

export interface StatementCheck<T> {
  readonly verification: VerificationResult;
  readonly payload?: T;
  readonly signer?: PinnedKey;
  readonly error?: string;
}

/**
 * Verify a statement's JWS against keys of `role` in the trust store, then validate its
 * payload with `schema`. Returns an explicit VerificationResult in every case.
 */
export async function verifyStatement<T>(
  jws: string,
  options: {
    trust: TrustStore;
    typ: string;
    role: KeyRole;
    schema: z.ZodType<T>;
    limits: PilotLimits;
    verifier: Iri;
    at: string;
    algs?: readonly KeyAlg[];
  },
): Promise<StatementCheck<T>> {
  const result = await verifyCompact(jws, {
    resolve: options.trust.resolver(options.role),
    typ: options.typ,
    allowedAlgs: options.algs ?? ["EdDSA", "ES256"],
    limits: options.limits,
  });
  const base = {
    type: "verification" as const,
    protectedObject: result.digest,
    property: "integrity-and-key-attribution" as const,
    mechanism: `${MECHANISM_ID} typ=${options.typ}`,
    verifier: options.verifier,
    at: options.at,
  };
  if (result.outcome !== "valid") {
    return {
      verification: {
        ...base,
        ...(result.kid ? { verificationMaterial: result.kid } : {}),
        outcome: result.outcome,
        limitations: [result.detail],
      },
      error: result.reason,
    };
  }
  const parsed = options.schema.safeParse(result.payload);
  const verification: VerificationResult = {
    ...base,
    verificationMaterial: result.kid,
    attributedTo: result.pinned.subject,
    outcome: parsed.success ? "valid" : "invalid",
    limitations: parsed.success
      ? [
          "establishes integrity of these bytes and attribution to the pinned key only",
          "does not establish truth, source authority or permission",
          "key state is the locally pinned state at verification time (no history)",
        ]
      : ["signature valid but payload does not match the statement schema"],
  };
  if (!parsed.success) {
    // A statement signed by an earlier pilot version with `<iri#frag>#x` identifiers is
    // reported distinctly so tools can tell the operator to re-initialise (no rewriting).
    const legacy = parsed.error.issues.some((i) => i.message.includes("not a valid IRI"));
    return {
      verification,
      signer: result.pinned,
      error: legacy ? "not a valid IRI (legacy identifier; profile 0.1.1)" : "malformed",
    };
  }
  return { verification, payload: parsed.data, signer: result.pinned };
}

/** Public, shareable form of a key for an introduction card (no private material). */
export function publicCard(key: SigningKey): { kid: string; alg: KeyAlg; publicJwk: JWK } {
  return { kid: key.kid, alg: key.alg, publicJwk: key.publicJwk };
}
