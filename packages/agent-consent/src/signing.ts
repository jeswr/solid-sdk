// AUTHORED-BY Claude Opus 5.5
/**
 * The principal's consent records are signed on their own device. The key is a P-256 key
 * made with Web Crypto and kept non-extractable; only its public JWK is registered with the
 * agent (pinned at setup). The agent's gate verifies every record before relying on it:
 * a record with a bad signature, a different key, an unexpected header or a payload that is
 * not exactly the canonical form of what it claims is ignored (fail closed).
 *
 * Two record types, both compact JWS (ES256) over RFC 8785 canonical JSON:
 * - `approval`: "go ahead with this exact action", bound to the action's digest, short-lived;
 * - `spending-rule`: a standing permission (see rules.ts) that the gate may rely on.
 */
import { canonicalJson, digestOf } from "@jeswr/agent-model/core/canonical";
import { CompactSign, compactVerify, importJWK, type JWK } from "jose";
import { isSpendingRule, type SpendingRule } from "./rules.js";

export const CONSENT_TYPE = "application/agent-consent+json";
const MAX_JWS = 16 * 1024;

export interface DeviceKey {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
  /** RFC 7638-style thumbprint of the public key, used as `kid`. */
  readonly kid: string;
}

export interface ApprovalRecord {
  readonly type: "approval";
  readonly id: string;
  readonly actionDigest: string;
  readonly decision: "approve" | "deny";
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SpendingRuleRecord {
  readonly type: "spending-rule";
  readonly rule: SpendingRule;
  readonly issuedAt: string;
}

export interface RevocationRecord {
  readonly type: "revocation";
  readonly ruleId: string;
  readonly issuedAt: string;
}

export type ConsentRecord = ApprovalRecord | SpendingRuleRecord | RevocationRecord;

function thumbprint(jwk: JWK): string {
  return digestOf({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }).slice("sha-256:".length);
}

/** A fresh non-extractable device key. */
export async function createDeviceKey(): Promise<DeviceKey> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JWK;
  const publicJwk: JWK = { kty: "EC", crv: "P-256", x: raw.x, y: raw.y };
  return { privateKey: pair.privateKey, publicJwk, kid: thumbprint(publicJwk) };
}

export async function signRecord(key: DeviceKey, record: ConsentRecord): Promise<string> {
  return new CompactSign(new TextEncoder().encode(canonicalJson(record)))
    .setProtectedHeader({ alg: "ES256", kid: key.kid, typ: CONSENT_TYPE })
    .sign(key.privateKey);
}

function wellFormed(value: unknown): value is ConsentRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(",");
  const at = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  if (r.type === "approval")
    return (
      keys === "actionDigest,decision,expiresAt,id,issuedAt,type" &&
      typeof r.id === "string" &&
      typeof r.actionDigest === "string" &&
      /^sha-256:[0-9a-f]{64}$/.test(r.actionDigest) &&
      (r.decision === "approve" || r.decision === "deny") &&
      at(r.issuedAt) &&
      at(r.expiresAt) &&
      (r.issuedAt as string) < (r.expiresAt as string)
    );
  if (r.type === "spending-rule")
    return keys === "issuedAt,rule,type" && at(r.issuedAt) && isSpendingRule(r.rule);
  if (r.type === "revocation")
    return keys === "issuedAt,ruleId,type" && typeof r.ruleId === "string" && at(r.issuedAt);
  return false;
}

/**
 * Verify a record against the principal's pinned public key. Returns the record, or
 * `undefined` for anything the gate must not rely on. Never throws.
 */
export async function verifyRecord(jws: string, pinned: JWK): Promise<ConsentRecord | undefined> {
  try {
    if (typeof jws !== "string" || jws.length > MAX_JWS) return undefined;
    const key = await importJWK(
      { kty: pinned.kty, crv: pinned.crv, x: pinned.x, y: pinned.y },
      "ES256",
    );
    const { payload, protectedHeader } = await compactVerify(jws, key, { algorithms: ["ES256"] });
    const headerKeys = Object.keys(protectedHeader).sort().join(",");
    if (
      headerKeys !== "alg,kid,typ" ||
      protectedHeader.typ !== CONSENT_TYPE ||
      protectedHeader.kid !== thumbprint(pinned)
    )
      return undefined;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    const value: unknown = JSON.parse(text);
    if (!wellFormed(value) || canonicalJson(value) !== text) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** The digest an approval binds to: the exact action, canonicalized. */
export function actionDigest(action: unknown): string {
  return digestOf(action);
}
