// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createHash } from "node:crypto";
import { fetchRdf } from "@jeswr/fetch-rdf";
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  type JSONWebKeySet,
  jwtVerify,
} from "jose";
import { createDiscoveryCache } from "./cache.js";
import { safeUrl } from "./signatures.js";
import type { RelayStore } from "./store.js";

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
const oidcIssuer = "http://www.w3.org/ns/solid/terms#oidcIssuer";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid discovery object");
  return value as Record<string, unknown>;
}

export interface ResourceIdentity {
  webid: string;
  clientId: unknown;
  issuer: string;
  expiresAt: number;
}

/** Route-selected policies consume only a verified identity, never unverified token claims. */
export function mobileClientPolicy(clientId: string) {
  safeUrl(clientId);
  return (identity: ResourceIdentity): boolean => identity.clientId === clientId;
}

/** P6 supplies the sender from the stored topic; pod senders have no mobile-client rule. */
export function webhookSenderPolicy(sender: string) {
  return (identity: ResourceIdentity): boolean => identity.webid === sender;
}

/** Solid-OIDC resource server, with RFC 9449 proof verification and shared replay state. */
export function createResourceTokenVerifier(options: {
  publicUrl: string;
  outboundFetch: typeof fetch;
  store: RelayStore;
  now?: () => number;
  allowLoopbackForTests?: boolean;
}) {
  const base = safeUrl(options.publicUrl, options.allowLoopbackForTests);
  if (base.pathname !== "/" || base.search || base.hash)
    throw new Error("Relay URL must be an origin");
  const now = options.now ?? Date.now;
  const metadata = createDiscoveryCache<string>(now);
  const jwks = createDiscoveryCache<{
    keys: ReturnType<typeof createLocalJWKSet>;
    fetchedAt: number;
  }>(now);
  const profiles = createDiscoveryCache<string[]>(now);
  // Never forward inbound headers or credentials, including when fetchRdf calls this seam.
  const anonymousFetch: typeof fetch = (input, init) =>
    options.outboundFetch(input, { ...init, credentials: "omit" });
  async function json(url: string) {
    const response = await anonymousFetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Discovery unavailable");
    return response.json();
  }

  return async (request: Request): Promise<ResourceIdentity> => {
    const authorization = /^DPoP (\S+)$/iu.exec(request.headers.get("authorization") ?? "");
    const proof = request.headers.get("dpop");
    if (!authorization || !proof) throw new Error("Missing DPoP credentials");
    const token = authorization[1] as string;
    const issuer = decodeJwt(token).iss;
    const issuerUrl = safeUrl(issuer, options.allowLoopbackForTests);
    if (issuerUrl.search || issuerUrl.hash) throw new Error("Invalid issuer");
    const iss = issuer as string;
    const uri = await metadata(iss, async () => {
      const document = record(
        await json(`${iss.replace(/\/$/u, "")}/.well-known/openid-configuration`),
      );
      if (document.issuer !== iss) throw new Error("Issuer mismatch");
      const uri = safeUrl(document.jwks_uri, options.allowLoopbackForTests);
      if (uri.hash) throw new Error("Invalid JWKS URL");
      return uri.href;
    });
    const loadKeys = async () => ({
      keys: createLocalJWKSet((await json(uri)) as JSONWebKeySet),
      fetchedAt: now(),
    });
    let cached = await jwks(uri, loadKeys);
    const verifyAccessToken = async () =>
      jwtVerify(token, cached.keys, {
        algorithms,
        issuer: iss,
        audience: "solid",
        requiredClaims: ["iss", "aud", "exp", "webid", "cnf"],
        currentDate: new Date(now()),
      });
    let verified: Awaited<ReturnType<typeof verifyAccessToken>>;
    try {
      verified = await verifyAccessToken();
    } catch (error) {
      // A rotated issuer key: refetch the JWKS at most once a minute per JWKS URL, then retry.
      if (
        (error as { code?: unknown }).code !== "ERR_JWKS_NO_MATCHING_KEY" ||
        now() - cached.fetchedAt < 60_000
      )
        throw error;
      cached = await jwks(uri, loadKeys, true);
      verified = await verifyAccessToken();
    }
    const { payload } = verified;
    const webidUrl = safeUrl(payload.webid, options.allowLoopbackForTests);
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

    const issuers = await profiles(webid, async () => {
      webidUrl.hash = "";
      const { dataset } = await fetchRdf(webidUrl.href, {
        fetch: anonymousFetch,
        maxBytes: 262_144,
      });
      return [...dataset.match()]
        .filter(
          (quad) =>
            quad.subject.termType === "NamedNode" &&
            quad.subject.value === webid &&
            quad.predicate.value === oidcIssuer &&
            quad.object.termType === "NamedNode",
        )
        .map((quad) => quad.object.value);
    });
    if (!issuers.includes(iss)) throw new Error("Issuer not endorsed");
    return {
      webid,
      clientId: payload.client_id,
      issuer: iss,
      expiresAt: (payload.exp as number) * 1000,
    };
  };
}
