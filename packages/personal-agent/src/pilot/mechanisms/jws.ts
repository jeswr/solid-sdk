/**
 * Integrity mechanism: JWS compact serialisation (RFC 7515) with EdDSA/Ed25519
 * (RFC 8037) or ES256, implemented by `jose` — no hand-rolled cryptography.
 *
 * Verification material comes ONLY from a caller-supplied resolver over the local pinned
 * trust store, keyed by the RFC 7638 thumbprint in `kid`. A header that tries to carry or
 * point at its own key (`jwk`, `jku`, `x5u`, `x5c`, `x5t`, `x5t#S256`) is refused, as is any
 * `crit` or `b64` extension, an unexpected `typ`, or an `alg` that differs from the pinned
 * key's algorithm. Successful verification establishes integrity of the exact bytes and
 * attribution to the pinned key — nothing about truth, authority or permission.
 */
import {
  CompactSign,
  type CryptoKey,
  calculateJwkThumbprint,
  compactVerify,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
} from "jose";
import { digestBytes } from "../core/canonical.js";
import { BoundsError, type PilotLimits, parseBoundedJson } from "../core/limits.js";

export type KeyAlg = "EdDSA" | "ES256";

export interface PublicKeyRecord {
  readonly kid: string;
  readonly alg: KeyAlg;
  readonly publicJwk: JWK;
}

export interface SigningKey extends PublicKeyRecord {
  readonly privateKey: CryptoKey;
}

const ALLOWED_HEADER_KEYS = new Set(["alg", "kid", "typ"]);

function publicOnly(jwk: JWK): JWK {
  const { kty, crv, x, y } = jwk;
  return { kty, crv, x, ...(y ? { y } : {}) } as JWK;
}

/** Generate a fresh extractable key pair. Returns the private JWK for runtime storage. */
export async function generateSigningKey(
  alg: KeyAlg = "EdDSA",
): Promise<{ key: SigningKey; privateJwk: JWK }> {
  const pair =
    alg === "EdDSA"
      ? await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true })
      : await generateKeyPair("ES256", { extractable: true });
  const privateJwk = await exportJWK(pair.privateKey);
  const publicJwk = publicOnly(await exportJWK(pair.publicKey));
  const kid = await calculateJwkThumbprint(publicJwk, "sha256");
  return { key: { kid, alg, publicJwk, privateKey: pair.privateKey as CryptoKey }, privateJwk };
}

/** Load a signing key from a stored private JWK. */
export async function loadSigningKey(privateJwk: JWK, alg: KeyAlg): Promise<SigningKey> {
  const privateKey = (await importJWK(privateJwk, alg)) as CryptoKey;
  const publicJwk = publicOnly(privateJwk);
  const kid = await calculateJwkThumbprint(publicJwk, "sha256");
  return { kid, alg, publicJwk, privateKey };
}

/** Re-derive a pinned record's thumbprint; a mismatch means the store is corrupt. */
export async function checkPinnedRecord(record: PublicKeyRecord): Promise<boolean> {
  if ("d" in record.publicJwk) return false;
  const kid = await calculateJwkThumbprint(publicOnly(record.publicJwk), "sha256");
  return kid === record.kid;
}

/** Sign a UTF-8 JSON payload as compact JWS with a fixed `typ`. */
export async function signCompact(key: SigningKey, typ: string, payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return new CompactSign(bytes)
    .setProtectedHeader({ alg: key.alg, kid: key.kid, typ })
    .sign(key.privateKey);
}

export type JwsVerification<R> =
  | {
      readonly outcome: "valid";
      readonly kid: string;
      readonly alg: KeyAlg;
      readonly pinned: R;
      readonly payload: unknown;
      readonly digest: string;
    }
  | {
      readonly outcome: "invalid" | "unknown-key" | "unsupported";
      readonly reason:
        | "malformed"
        | "bounds-exceeded"
        | "disallowed-header"
        | "unknown-key"
        | "bad-signature"
        | "configuration-mismatch";
      readonly detail: string;
      readonly digest: string;
      readonly kid?: string;
    };

export interface VerifyOptions<R extends PublicKeyRecord> {
  /** Resolve a thumbprint to a PINNED key record, or undefined. The only key source. */
  readonly resolve: (kid: string) => R | undefined;
  readonly typ: string;
  readonly allowedAlgs: readonly KeyAlg[];
  readonly limits: PilotLimits;
}

function b64urlDecode(part: string): string | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) return undefined;
  return Buffer.from(part, "base64url").toString("utf8");
}

const keyCache = new WeakMap<object, CryptoKey>();

async function importPinned(record: PublicKeyRecord): Promise<CryptoKey> {
  const cached = keyCache.get(record.publicJwk);
  if (cached) return cached;
  const key = (await importJWK(record.publicJwk, record.alg)) as CryptoKey;
  keyCache.set(record.publicJwk, key);
  return key;
}

/** Verify a compact JWS against pinned material only. Never throws on hostile input. */
export async function verifyCompact<R extends PublicKeyRecord>(
  jws: string,
  options: VerifyOptions<R>,
): Promise<JwsVerification<R>> {
  const digest = digestBytes(typeof jws === "string" ? jws : "");
  if (typeof jws !== "string" || Buffer.byteLength(jws, "utf8") > options.limits.maxEnvelopeBytes) {
    return { outcome: "invalid", reason: "bounds-exceeded", detail: "JWS too large", digest };
  }
  const parts = jws.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    return { outcome: "invalid", reason: "malformed", detail: "not a compact JWS", digest };
  }
  const headerText = b64urlDecode(parts[0] ?? "");
  if (headerText === undefined) {
    return { outcome: "invalid", reason: "malformed", detail: "bad header encoding", digest };
  }
  let header: Record<string, unknown>;
  try {
    const parsed = parseBoundedJson(headerText, options.limits);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("x");
    header = parsed as Record<string, unknown>;
  } catch {
    return { outcome: "invalid", reason: "malformed", detail: "bad header JSON", digest };
  }
  const extra = Object.keys(header).filter((k) => !ALLOWED_HEADER_KEYS.has(k));
  if (extra.length > 0) {
    return {
      outcome: "invalid",
      reason: "disallowed-header",
      detail: `header parameters not permitted: ${extra.join(", ")}`,
      digest,
    };
  }
  const { alg, kid, typ } = header;
  if (typ !== options.typ) {
    return {
      outcome: "invalid",
      reason: "malformed",
      detail: `unexpected typ ${String(typ)}`,
      digest,
    };
  }
  if (typeof alg !== "string" || !options.allowedAlgs.includes(alg as KeyAlg)) {
    return {
      outcome: "unsupported",
      reason: "configuration-mismatch",
      detail: `alg ${String(alg)} not allowed here`,
      digest,
    };
  }
  if (typeof kid !== "string" || kid.length === 0 || kid.length > 128) {
    return { outcome: "invalid", reason: "malformed", detail: "missing kid", digest };
  }
  const pinned = options.resolve(kid);
  if (!pinned) {
    return {
      outcome: "unknown-key",
      reason: "unknown-key",
      detail: "kid is not pinned locally",
      digest,
      kid,
    };
  }
  if (pinned.alg !== alg) {
    return {
      outcome: "invalid",
      reason: "configuration-mismatch",
      detail: `alg ${alg} differs from pinned key alg ${pinned.alg}`,
      digest,
      kid,
    };
  }
  let payloadBytes: Uint8Array;
  try {
    const key = await importPinned(pinned);
    const result = await compactVerify(jws, key, { algorithms: [alg] });
    payloadBytes = result.payload;
  } catch {
    return {
      outcome: "invalid",
      reason: "bad-signature",
      detail: "signature did not verify",
      digest,
      kid,
    };
  }
  let payload: unknown;
  try {
    payload = parseBoundedJson(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
      options.limits,
    );
  } catch (error) {
    return {
      outcome: "invalid",
      reason:
        error instanceof BoundsError && error.code !== "not-json" ? "bounds-exceeded" : "malformed",
      detail: "payload is not bounded JSON",
      digest,
      kid,
    };
  }
  return { outcome: "valid", kid, alg: alg as KeyAlg, pinned, payload, digest };
}

/** Decode a compact JWS header WITHOUT verifying (for routing/diagnostics only). */
export function peekHeader(jws: string): { kid?: string; typ?: string; alg?: string } {
  const head = typeof jws === "string" ? jws.split(".")[0] : undefined;
  const text = head ? b64urlDecode(head) : undefined;
  if (!text || text.length > 2048) return {};
  try {
    const h = JSON.parse(text) as Record<string, unknown>;
    return {
      ...(typeof h.kid === "string" ? { kid: h.kid } : {}),
      ...(typeof h.typ === "string" ? { typ: h.typ } : {}),
      ...(typeof h.alg === "string" ? { alg: h.alg } : {}),
    };
  } catch {
    return {};
  }
}
