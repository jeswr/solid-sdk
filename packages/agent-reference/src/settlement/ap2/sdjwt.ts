// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/useNamingConvention: SD-JWT serialization uses _sd and _sd_alg. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash, randomBytes } from "crypto";
import { type CryptoKey, calculateJwkThumbprint, importJWK, type JWK } from "jose";
import { z } from "zod";
import { canonicalJson } from "../../core/canonical.js";
import { base64url, decodeBase64url, strictJson } from "../http.js";
import { signAp2Jwt, verifyAp2Jwt } from "./jwt.js";

const digestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const publicJwkSchema = z.strictObject({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: digestSchema,
  y: digestSchema,
});
export const confirmationSchema = z.strictObject({ jwk: publicJwkSchema });
const issuerEnvelopeSchema = z
  .object({
    _sd_alg: z.literal("sha-256"),
    _sd: z.array(digestSchema).max(64),
    cnf: confirmationSchema,
  })
  .catchall(z.json());
const keyBindingSchema = z.strictObject({
  aud: z.string().min(1),
  nonce: z.string().min(1),
  iat: z.number().int().nonnegative(),
  sd_hash: digestSchema,
});
const forbidden = new Set(["_sd", "_sd_alg", "cnf", "__proto__", "prototype", "constructor"]);
const registered = new Set(["vct", "iat", "exp", "iss", "sub", "nbf"]);
export interface IssuedSdJwt {
  issuerJwt: string;
  disclosures: readonly string[];
}
export interface Binding {
  audience: string;
  nonce: string;
  issuedAt: number;
}
export interface SdJwtVerifier {
  issuerKey: CryptoKey;
  audience: string;
  nonce: string;
  now: number;
  requiredClaims: readonly string[];
  expectedHolderJwk?: JWK;
  /** Local replay/freshness profile, not a research-specified constant. */
  maxBindingAgeSeconds?: number;
}
export function sdHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64url");
}

/** Top-level disclosures only. Engine selective.ts is a different JWS format. */
export async function issueSdJwt(
  claims: Record<string, unknown>,
  issuerKey: CryptoKey,
  holderJwk: JWK,
  selectiveClaims = Object.keys(claims).filter((key) => !registered.has(key)),
): Promise<IssuedSdJwt> {
  const jwk = publicJwkSchema.parse(holderJwk);
  await importJWK(jwk, "ES256");
  if (Object.keys(claims).some((key) => forbidden.has(key)))
    throw new Error("reserved SD-JWT claim");
  if (
    selectiveClaims.length > 64 ||
    new Set(selectiveClaims).size !== selectiveClaims.length ||
    selectiveClaims.some((key) => !Object.hasOwn(claims, key) || registered.has(key))
  )
    throw new Error("invalid selective claims");
  // z.json rejects values JCS/JSON serialization would silently drop or change.
  const visible = z.record(z.string(), z.json()).parse(claims);
  const disclosures = selectiveClaims.map((name) => {
    const disclosure = base64url(canonicalJson([base64url(randomBytes(16)), name, visible[name]]));
    delete visible[name];
    return disclosure;
  });
  const issuerJwt = await signAp2Jwt(
    { ...visible, _sd_alg: "sha-256", _sd: disclosures.map(sdHash), cnf: { jwk } },
    issuerKey,
    "sd-jwt",
  );
  return { issuerJwt, disclosures };
}

export async function presentSdJwt(
  issued: IssuedSdJwt,
  holderKey: CryptoKey,
  binding: Binding,
): Promise<string> {
  const prefix = `${[issued.issuerJwt, ...issued.disclosures].join("~")}~`;
  const payload = keyBindingSchema.parse({
    aud: binding.audience,
    nonce: binding.nonce,
    iat: binding.issuedAt,
    sd_hash: sdHash(prefix),
  });
  return `${prefix}${await signAp2Jwt(payload, holderKey, "kb+sd-jwt")}`;
}

export async function verifySdJwt(
  presentation: string,
  options: SdJwtVerifier,
): Promise<Record<string, unknown>> {
  if (presentation.length > 65_536) throw new Error("SD-JWT too large");
  const parts = presentation.split("~");
  if (parts.length < 2 || parts.length > 66 || parts.some((part) => !part))
    throw new Error("invalid SD-JWT serialization");
  const issuerJwt = parts[0] as string;
  const bindingJwt = parts.at(-1) as string;
  const issuer = issuerEnvelopeSchema.parse(
    await verifyAp2Jwt(issuerJwt, options.issuerKey, "sd-jwt", options.now),
  );
  if (new Set(issuer._sd).size !== issuer._sd.length) throw new Error("duplicate SD-JWT digest");
  if (
    options.expectedHolderJwk &&
    (await calculateJwkThumbprint(issuer.cnf.jwk)) !==
      (await calculateJwkThumbprint(publicJwkSchema.parse(options.expectedHolderJwk)))
  )
    throw new Error("wrong holder key");
  const holderKey = await importJWK(issuer.cnf.jwk, "ES256");
  const binding = keyBindingSchema.parse(
    await verifyAp2Jwt(
      bindingJwt,
      holderKey as CryptoKey,
      "kb+sd-jwt",
      options.now,
      options.audience,
    ),
  );
  if (binding.nonce !== options.nonce) throw new Error("wrong key-binding nonce");
  const maxAge = options.maxBindingAgeSeconds ?? 300;
  if (
    !Number.isSafeInteger(maxAge) ||
    maxAge < 0 ||
    binding.iat > options.now ||
    options.now - binding.iat > maxAge
  )
    throw new Error("stale key binding");
  const prefix = `${parts.slice(0, -1).join("~")}~`;
  if (binding.sd_hash !== sdHash(prefix)) throw new Error("wrong sd_hash");
  const { _sd, _sd_alg: _algorithm, ...claims } = issuer;
  const used = new Set<string>();
  for (const disclosure of parts.slice(1, -1)) {
    const digest = sdHash(disclosure);
    if (!_sd.includes(digest) || used.has(digest))
      throw new Error("uncommitted or duplicate disclosure");
    used.add(digest);
    const tuple = z
      .tuple([z.string().min(16), z.string().min(1), z.json()])
      .parse(strictJson(decodeBase64url(disclosure), 16_384));
    const name = tuple[1];
    if (forbidden.has(name) || registered.has(name) || Object.hasOwn(claims, name))
      throw new Error("disclosure claim collision");
    claims[name] = tuple[2];
  }
  if (options.requiredClaims.some((name) => !Object.hasOwn(claims, name)))
    throw new Error("missing required disclosure");
  return claims;
}
