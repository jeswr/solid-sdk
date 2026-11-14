// AUTHORED-BY Codex GPT-6
/** OpenID Federation entity-statement JWT admission. Only authenticated JWKS enter the next hop. */
import { calculateJwkThumbprint, type JWK } from "jose";
import { z } from "zod";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { PublicKeyRecord } from "../mechanisms/jws.js";
import { verifyCompact } from "../mechanisms/jws.js";
import { SuiteValuesNode } from "../model/suite-values.js";

const jwk = z.strictObject({
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.string().min(1),
  kid: z.string().optional(),
  alg: z.literal("EdDSA").optional(),
  use: z.literal("sig").optional(),
});
const metadata = z.strictObject({
  answerable: z.strictObject({
    claim_types: z.array(z.string()).max(64),
    purposes: z.array(z.string()).max(64),
  }),
});
const policy = z.strictObject({
  answerable: z.strictObject({
    claim_types: z.strictObject({ subset_of: z.array(z.string()).max(64) }),
    purposes: z.strictObject({ subset_of: z.array(z.string()).max(64) }),
  }),
});
export const entityStatementSchema = z.strictObject({
  iss: z.string().url(),
  sub: z.string().url(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  jwks: z.strictObject({ keys: z.array(jwk).min(1).max(8) }),
  authority_hints: z.array(z.string().url()).max(8),
  metadata,
  metadata_policy: policy.optional(),
});
export async function admitEntityStatement(
  jwt: string,
  keys: readonly PublicKeyRecord[],
  at: string,
): Promise<{ node: SuiteValuesNode; keys: readonly PublicKeyRecord[]; kid: string } | undefined> {
  const verified = await verifyCompact(jwt, {
    resolve: (kid) => keys.find((k) => k.kid === kid),
    typ: "entity-statement+jwt",
    allowedAlgs: ["EdDSA"],
    limits: DEFAULT_LIMITS,
  });
  if (verified.outcome !== "valid") return undefined;
  const parsed = entityStatementSchema.safeParse(verified.payload);
  if (!parsed.success) return undefined;
  const now = Math.floor(Date.parse(at) / 1000),
    value = parsed.data;
  if (!Number.isFinite(now) || value.iat > now || value.exp <= now || value.exp <= value.iat)
    return undefined;
  const admitted: PublicKeyRecord[] = [];
  for (const key of value.jwks.keys) {
    const publicJwk: JWK = { kty: key.kty, crv: key.crv, x: key.x };
    const thumb = await calculateJwkThumbprint(publicJwk, "sha256");
    if (key.kid && key.kid !== thumb) return undefined;
    if (admitted.some((k) => k.kid === thumb)) return undefined;
    admitted.push({ kid: thumb, alg: "EdDSA", publicJwk });
  }
  return { node: SuiteValuesNode.fromSignedPayload(value), keys: admitted, kid: verified.kid };
}
