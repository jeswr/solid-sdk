// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createHash } from "node:crypto";
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
} from "jose";
import { createDiscoveryCache } from "./discovery-cache.js";
import { createIssuerKeyResolver, issuerUrl as safeUrl } from "./issuer-keys.js";
import { readWebIdIssuers } from "./webid-issuers.js";

const algorithms = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
  "Ed25519",
];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid discovery object");
  return value as Record<string, unknown>;
}

/** Authenticated resource caller; apply route authorization separately. */
export interface ResourceIdentity {
  /** Verified, issuer-endorsing WebID. */
  webid: string;
  /** Verified client_id claim, if supplied; the caller decides which values to authorize. */
  clientId: unknown;
  /** Verified issuer. */
  issuer: string;
  /** Token expiry in Unix milliseconds. */
  expiresAt: number;
}

/** Atomic shared replay reservation. TTLs are milliseconds; failures must reject. */
export interface ResourceReplayStore {
  /** Atomically reserve a hashed replay key for ttlMs milliseconds; false means replay. */
  insertIfAbsent(key: string, ttlMs: number): Promise<boolean>;
}

/** Options for the Solid-audience resource verifier. Supply an SSRF-guarded transport. */
export interface ResourceTokenVerifierOptions {
  /** Configured public origin used for DPoP URL binding. */
  publicUrl: string;
  /** Anonymous SSRF-guarded transport for discovery, JWKS and WebID profiles. */
  outboundFetch: typeof fetch;
  /** Shared atomic replay storage; errors reject verification. */
  store: ResourceReplayStore;
  /** Millisecond clock. Default Date.now. */
  now?: () => number;
  /** Explicit fixture-only loopback HTTP relaxation; never read from production environment. */
  allowLoopbackForTests?: boolean;
}

/** Solid-OIDC resource server, with RFC 9449 proof verification and shared replay state. */
export function createResourceTokenVerifier(options: ResourceTokenVerifierOptions) {
  const base = safeUrl(options.publicUrl, options.allowLoopbackForTests);
  if (base.pathname !== "/" || base.search || base.hash)
    throw new Error("Public URL must be an origin");
  const now = options.now ?? Date.now;
  const profiles = createDiscoveryCache<string[]>(now);
  const resolveIssuer = createIssuerKeyResolver({
    outboundFetch: options.outboundFetch,
    now,
    allowInsecureLoopback: options.allowLoopbackForTests,
  });
  // Never forward inbound headers or credentials, including when fetchRdf calls this seam.
  const anonymousFetch: typeof fetch = (input, init) =>
    options.outboundFetch(input, { ...init, credentials: "omit" });

  return async (request: Request): Promise<ResourceIdentity> => {
    const authorization = /^DPoP (\S+)$/iu.exec(request.headers.get("authorization") ?? "");
    const proof = request.headers.get("dpop");
    if (!authorization || !proof) throw new Error("Missing DPoP credentials");
    const token = authorization[1] as string;
    const iss = decodeJwt(token).iss as string;
    const keys = await resolveIssuer(iss as string);
    const verified = await jwtVerify(token, keys.jwks, {
      algorithms,
      issuer: iss,
      audience: "solid",
      requiredClaims: ["iss", "aud", "exp", "webid", "cnf"],
      currentDate: new Date(now()),
    });
    const { payload } = verified;
    safeUrl(payload.webid, options.allowLoopbackForTests);
    const webid = payload.webid as string;
    const header = decodeProtectedHeader(proof);
    const jwk = header.jwk;
    if (
      header.typ !== "dpop+jwt" ||
      !algorithms.includes(header.alg as string) ||
      !jwk ||
      ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((field) => field in jwk)
    )
      throw new Error("Invalid DPoP key");
    const { payload: claims } = await jwtVerify(proof, await importJWK(jwk, header.alg), {
      algorithms,
      requiredClaims: ["jti", "htm", "htu", "iat", "ath"],
      currentDate: new Date(now()),
    });
    // The public origin is configuration, never Host/Forwarded/X-Forwarded-* headers.
    const htu = `${base.origin}${new URL(request.url).pathname}`;
    const thumbprint = await calculateJwkThumbprint(jwk);
    if (
      typeof claims.jti !== "string" ||
      !claims.jti ||
      claims.htm !== request.method ||
      claims.htu !== htu ||
      typeof claims.iat !== "number" ||
      !Number.isFinite(claims.iat) ||
      Math.abs(now() / 1000 - claims.iat) > 60 ||
      claims.ath !== createHash("sha256").update(token).digest("base64url") ||
      record(payload.cnf).jkt !== thumbprint
    )
      throw new Error("Invalid DPoP proof");
    const replayKey = createHash("sha256")
      .update(JSON.stringify([thumbprint, claims.jti]))
      .digest("hex");
    if (!(await options.store.insertIfAbsent(`dpop:${replayKey}`, 300_000)))
      throw new Error("DPoP replay");

    const issuers = await profiles(webid, (signal) =>
      readWebIdIssuers(webid, (input, init) => anonymousFetch(input, { ...init, signal })),
    );
    if (!issuers.includes(iss)) throw new Error("Issuer not endorsed");
    return {
      webid,
      clientId: payload.client_id,
      issuer: iss,
      expiresAt: (payload.exp as number) * 1000,
    };
  };
}
