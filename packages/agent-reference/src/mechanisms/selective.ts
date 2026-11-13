// AUTHORED-BY Codex GPT-6
/** Salted digest disclosure using existing JWS and SHA-256; no hidden-value proofs. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { randomBytes } from "crypto";
import { z } from "zod";
import { digestBytes, digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS, parseBoundedJson } from "../core/limits.js";
import { id, iso } from "../core/schema.js";
import type { EvidenceItem, JsonObject } from "../core/types.js";
import type { SigningKey } from "./jws.js";
import { type StatementCheck, signStatement, verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";

const claimSchema = z.strictObject({
  id,
  claimType: z.string().max(256),
  value: z.json(),
  terms: z.json().optional(),
});
const disclosureSchema = z.strictObject({ salt: z.string().min(32).max(128), claim: claimSchema });
const credentialSchema = z.strictObject({
  type: z.literal("SelectiveCredential"),
  id,
  issuer: id,
  subject: id,
  method: z.string(),
  asOf: iso,
  validUntil: iso.optional(),
  digests: z
    .array(z.string().regex(/^sha-256:[a-f0-9]{64}$/))
    .min(1)
    .max(64),
});
const presentationSchema = z.strictObject({
  credential: z.string().max(16384),
  disclosure: disclosureSchema,
});
type Disclosure = z.infer<typeof disclosureSchema>;
export async function issueSelectiveCredential(
  key: SigningKey,
  metadata: Omit<z.infer<typeof credentialSchema>, "type" | "digests">,
  claims: readonly z.infer<typeof claimSchema>[],
  fixtureSalts?: readonly string[],
) {
  if (!claims.length || new Set(claims.map((c) => c.id)).size !== claims.length)
    throw new Error("selective credential needs distinct claims");
  const disclosures = claims.map((claim, i) =>
    disclosureSchema.parse({
      salt: fixtureSalts?.[i] ?? randomBytes(32).toString("base64url"),
      claim,
    }),
  );
  const payload = credentialSchema.parse({
    ...metadata,
    type: "SelectiveCredential",
    digests: disclosures.map((d) => digestOf(d)),
  });
  return {
    credential: await signStatement(key, "awp-selective-credential+jws", payload),
    disclosures,
  };
}
export function presentSelective(
  issued: { credential: string; disclosures: readonly Disclosure[] },
  ids: readonly string[],
): EvidenceItem[] {
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !issued.disclosures.some((d) => d.claim.id === id))
  )
    throw new Error("unknown or duplicate disclosure");
  return ids.map((id) => ({
    role: "credential",
    format: "selective-disclosure+jws",
    value: JSON.stringify({
      credential: issued.credential,
      disclosure: issued.disclosures.find((d) => d.claim.id === id),
    }),
  }));
}
/** Inspection only. Callers must separately verify the actual evidence before relying on it. */
export function unverifiedEvidenceClaim(item: EvidenceItem): JsonObject {
  if (item.format !== "selective-disclosure+jws")
    return JSON.parse(
      Buffer.from(item.value.split(".")[1] ?? "", "base64url").toString(),
    ) as JsonObject;
  const presentation = presentationSchema.parse(parseBoundedJson(item.value, DEFAULT_LIMITS));
  const credential = credentialSchema.parse(
    JSON.parse(Buffer.from(presentation.credential.split(".")[1] ?? "", "base64url").toString()),
  );
  const { digests: _digests, type: _type, id: _id, ...metadata } = credential;
  return {
    ...metadata,
    ...presentation.disclosure.claim,
    selectiveCredentialDigest: digestBytes(presentation.credential),
  } as JsonObject;
}
export async function verifySelectivePresentation(
  item: EvidenceItem,
  trust: TrustStore,
  at: string,
  verifier: string,
): Promise<StatementCheck<JsonObject>> {
  let presentation: z.infer<typeof presentationSchema>;
  try {
    presentation = presentationSchema.parse(parseBoundedJson(item.value, DEFAULT_LIMITS));
  } catch {
    return {
      verification: {
        type: "verification",
        protectedObject: digestBytes(item.value),
        property: "integrity-and-key-attribution",
        mechanism: "salted-digest-disclosure",
        verifier,
        at,
        outcome: "invalid",
        limitations: ["malformed disclosure"],
      },
    };
  }
  const options = {
    trust,
    typ: "awp-selective-credential+jws",
    schema: credentialSchema,
    limits: DEFAULT_LIMITS,
    at,
    verifier,
  };
  let check = await verifyStatement(presentation.credential, { ...options, role: "issuer" });
  if (check.verification.outcome === "unknown-key")
    check = await verifyStatement(presentation.credential, { ...options, role: "party" });
  if (
    !check.payload ||
    check.signer?.subject !== check.payload.issuer ||
    new Set(check.payload.digests).size !== check.payload.digests.length ||
    !check.payload.digests.includes(digestOf(presentation.disclosure))
  )
    return {
      verification: {
        ...check.verification,
        protectedObject: digestBytes(item.value),
        outcome: "invalid",
        limitations: ["revealed disclosure does not match the issuer-signed digests"],
      },
    };
  return {
    ...check,
    verification: {
      ...check.verification,
      protectedObject: digestBytes(item.value),
      mechanism: "salted-digest-disclosure + JWS",
      limitations: [
        "revealed claim integrity and attribution only; no hidden-value predicate, unlinkability or zero-knowledge claim",
      ],
    },
    payload: unverifiedEvidenceClaim(item),
  };
}
export const isClaimEvidence = (item: EvidenceItem) =>
  item.role === "credential" &&
  ["jws-compact", "selective-disclosure+jws", "derivation+jws"].includes(item.format);
