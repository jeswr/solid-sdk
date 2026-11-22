// AUTHORED-BY Codex GPT-6
/** A certificate can replace quality checks only within its authenticated dataset scope. */
import { z } from "zod";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { DocumentResolver } from "../mechanisms/organizations.js";
import { verifyStatement } from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { SuiteValuesNode } from "../model/suite-values.js";

export const qualityCertificatePolicySchema = z.strictObject({
  references: z.record(z.string(), z.string().url()),
  certifier: z.string().url(),
  source: z.string().url(),
  dataset: z.string().url(),
  category: z.string(),
  policy: z.string().url(),
});
export const qualityCertificateSchema = z.strictObject({
  type: z.literal("QualityCertificate"),
  id: z.string().url(),
  issuer: z.string().url(),
  source: z.string().url(),
  dataset: z.string().url(),
  category: z.string(),
  policy: z.string().url(),
  claimType: z.literal("mortgage.product"),
  quality: z.strictObject({
    accurate: z.literal(true),
    current: z.literal(true),
    complete: z.literal(true),
  }),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export type QualityCertificatePolicy = z.infer<typeof qualityCertificatePolicySchema>;

async function checkCertifiedQuality(
  input: unknown,
  options: {
    policy: QualityCertificatePolicy;
    reference: string;
    resolver: DocumentResolver;
    trust: TrustStore;
    at: string;
    verifier: string;
    evaluatorParty?: string;
    carriedBy?: string;
    record: <T extends { type: string }>(record: T) => void;
  },
) {
  let claim: SuiteValuesNode;
  try {
    claim = SuiteValuesNode.fromSignedPayload(input);
  } catch {
    return false;
  }
  if (
    claim.string("claimType") !== "mortgage.product" ||
    claim.string("qualityDataset") !== options.policy.dataset ||
    claim.string("productCategory") !== options.policy.category ||
    (options.carriedBy !== options.policy.source &&
      options.evaluatorParty !== options.policy.source)
  )
    return false;
  let jws: string | undefined;
  try {
    jws = await options.resolver.resolve(options.reference);
  } catch {
    return false;
  }
  if (!jws) return false;
  const args = {
    trust: options.trust,
    typ: "awp-quality-certificate+jws",
    schema: qualityCertificateSchema,
    limits: DEFAULT_LIMITS,
    at: options.at,
    verifier: options.verifier,
  };
  let check = await verifyStatement(jws, { ...args, role: "issuer" });
  if (check.verification.outcome === "unknown-key")
    check = await verifyStatement(jws, { ...args, role: "party" });
  options.record(check.verification);
  const certificate = check.payload ? SuiteValuesNode.fromSignedPayload(check.payload) : undefined;
  if (
    !certificate ||
    check.signer?.subject !== options.policy.certifier ||
    certificate.string("issuer")! !== options.policy.certifier ||
    certificate.string("id")! !== options.reference ||
    certificate.string("source")! !== options.policy.source ||
    certificate.string("dataset")! !== options.policy.dataset ||
    certificate.string("category")! !== options.policy.category ||
    certificate.string("policy")! !== options.policy.policy ||
    Date.parse(certificate.string("validFrom")!) > Date.parse(options.at) ||
    Date.parse(certificate.string("validUntil")!) <= Date.parse(options.at)
  ) {
    options.record({
      type: "quality-certificate-fallback",
      reason:
        "The certificate does not cover this source, dataset, product category, policy and time.",
    });
    return false;
  }
  const authority = options.trust.assessSource({
    evaluator: options.verifier,
    source: certificate.string("issuer")!,
    claimType: "dataset.quality",
    subject: certificate.string("dataset")!,
    at: options.at,
  });
  options.record(authority);
  if (authority.outcome !== "accepted") return false;
  options.record({
    type: "certified-index-quality",
    certificate: jws,
    source: certificate.string("source")!,
    dataset: certificate.string("dataset")!,
    policy: certificate.string("policy")!,
  });
  return true;
}

export async function certifiedQuality(
  input: unknown,
  options: Parameters<typeof checkCertifiedQuality>[1],
): Promise<boolean> {
  try {
    return await checkCertifiedQuality(input, options);
  } catch {
    return false;
  }
}
