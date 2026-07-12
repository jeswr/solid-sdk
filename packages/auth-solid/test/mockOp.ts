// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * A Map-backed fake Solid-OIDC Provider + resource server for the test suite — NO live IdP, NO
 * network, NO ports.
 *
 * It is deliberately FAITHFUL where the security tests depend on it: the token endpoint VERIFIES
 * the inbound DPoP proof for real (parses the JWS header `jwk`, verifies the signature with `jose`,
 * checks `typ=dpop+jwt`, `htm`/`htu`, an asymmetric ES256 `alg`, and a fresh `jti`), and the ID
 * token is a REAL ES256-signed JWS carrying a `webid` claim. The token endpoint exercises the RFC
 * 9449 §8 nonce flow: the first proof WITHOUT a nonce gets a 400 `use_dpop_nonce` + `DPoP-Nonce`
 * header; the retried proof WITH the matching nonce gets a DPoP-bound token set.
 *
 * The fake `fetch` it produces is injected as the `underlying` fetch for the DPoP customFetch and
 * the pod `solidDpopFetch`, and answers discovery / JWKS / token / userinfo / resource requests.
 */

import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWK,
  jwtVerify,
  SignJWT,
} from "jose";

/** A request the fake OP / RS captured, for assertions. */
export interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export interface MockOpOptions {
  readonly issuer: string;
  readonly clientId: string;
  /** The WebID to put in the `webid` claim of the ID token. Omit to mint NO webid claim. */
  readonly webId?: string | undefined;
  /** Return a non-DPoP `token_type` (e.g. "Bearer") to test the DPoP-downgrade detection. */
  readonly tokenTypeOverride?: string | undefined;
  /** Use an http: (insecure) base for discovery URLs (a loopback dev OP). */
  readonly insecure?: boolean | undefined;
}

export interface DecodedJws {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
}

export interface MockOp {
  /** The fake `fetch` to inject as the underlying fetch (discovery, JWKS, token, userinfo, resource). */
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Every request the OP / RS captured (for assertions, e.g. the token / resource DPoP proof). */
  readonly captured: CapturedRequest[];
  /** The OP signing public JWK. */
  readonly opPublicJwk: JWK;
  /** The token endpoint URL. */
  readonly tokenEndpoint: string;
  /** The discovery URL. */
  readonly discoveryUrl: string;
  /** The most recent token-endpoint DPoP proof header captured (decoded + verified), if any. */
  lastTokenDpop(): DecodedJws | undefined;
  /** The most recent resource-request DPoP proof header captured (decoded), if any. */
  lastResourceDpop(): DecodedJws | undefined;
  /** How many times the token endpoint was hit (to assert the §8 retry happened exactly once). */
  tokenCallCount(): number;
  /** Force the NEXT resource request to answer 401 with a `DPoP-Nonce` (the §8 challenge). */
  challengeNextResourceWithNonce(nonce: string): void;
  /** The set of `jti` values the token endpoint has seen (to assert single-use / freshness). */
  seenJtis(): ReadonlySet<string>;
  /** Verify a captured DPoP proof JWS fully (signature + claims) the way a real server would. */
  verifyDpopProof(
    jws: string,
    expected: { htm: string; htu: string; requireAth?: boolean; nonce?: string },
  ): Promise<{ ok: boolean; reason?: string; jkt: string }>;
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

function decodeJws(jws: string): DecodedJws {
  const [h, p] = jws.split(".");
  return { header: decodeJwtPart(h as string), payload: decodeJwtPart(p as string) };
}

/** Strip query/fragment to compute the canonical htu the way a server does. */
function canonicalHtu(uri: string): string {
  const u = new URL(uri);
  u.search = "";
  u.hash = "";
  return u.toString();
}

export async function createMockOp(opts: MockOpOptions): Promise<MockOp> {
  const issuer = opts.issuer;
  const base = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;

  // OP signing keypair (ES256) — the ID token is signed with this.
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const opPublicJwk = await exportJWK(publicKey);
  opPublicJwk.kid = "op-key-1";
  opPublicJwk.alg = "ES256";
  opPublicJwk.use = "sig";

  const captured: CapturedRequest[] = [];
  const seenJtis = new Set<string>();
  let lastTokenProof: DecodedJws | undefined;
  let lastResourceProof: DecodedJws | undefined;
  let nextResourceNonce: string | undefined;
  let tokenCalls = 0;
  let accessTokenCounter = 0;
  // The §8 nonce the token endpoint expects on the retry, set on the first (nonce-less) call.
  const tokenNonce = "srv-token-nonce-abc";

  const tokenEndpoint = `${base}/token`;
  const discoveryUrl = `${base}/.well-known/openid-configuration`;

  const discoveryDoc = {
    issuer,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: tokenEndpoint,
    userinfo_endpoint: `${base}/userinfo`,
    jwks_uri: `${base}/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "webid", "offline_access"],
    dpop_signing_alg_values_supported: ["ES256"],
  };

  async function verifyDpopProof(
    jws: string,
    expected: { htm: string; htu: string; requireAth?: boolean; nonce?: string },
  ): Promise<{ ok: boolean; reason?: string; jkt: string }> {
    let decoded: DecodedJws;
    try {
      decoded = decodeJws(jws);
    } catch {
      return { ok: false, reason: "undecodable", jkt: "" };
    }
    const header = decoded.header;
    // Asymmetric ES256 only — a symmetric (HS*) or `none` alg is rejected outright.
    if (header.alg !== "ES256") {
      return { ok: false, reason: `bad alg ${String(header.alg)}`, jkt: "" };
    }
    if (header.typ !== "dpop+jwt") {
      return { ok: false, reason: `bad typ ${String(header.typ)}`, jkt: "" };
    }
    const jwk = header.jwk as JWK | undefined;
    if (jwk === undefined || typeof jwk !== "object") {
      return { ok: false, reason: "no header jwk", jkt: "" };
    }
    // A private JWK in the header would be a leak — reject it (`d` must NOT be present).
    if ((jwk as { d?: unknown }).d !== undefined) {
      return { ok: false, reason: "private key leaked in proof header", jkt: "" };
    }
    if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
      return { ok: false, reason: "not an EC P-256 (asymmetric) key", jkt: "" };
    }
    const jkt = await calculateJwkThumbprint(jwk);
    // Verify the signature against the header's own public key (the DPoP self-signed model).
    let payload: Record<string, unknown>;
    try {
      const { importJWK } = await import("jose");
      const key = await importJWK(jwk, "ES256");
      const verified = await jwtVerify(jws, key, { typ: "dpop+jwt" });
      payload = verified.payload as Record<string, unknown>;
    } catch (err) {
      return { ok: false, reason: `signature verify failed: ${String(err)}`, jkt };
    }
    if (payload.htm !== expected.htm.toUpperCase()) {
      return { ok: false, reason: `htm mismatch ${String(payload.htm)}`, jkt };
    }
    if (payload.htu !== canonicalHtu(expected.htu)) {
      return { ok: false, reason: `htu mismatch ${String(payload.htu)}`, jkt };
    }
    const jti = payload.jti;
    if (typeof jti !== "string" || jti.length === 0) {
      return { ok: false, reason: "missing jti", jkt };
    }
    if (seenJtis.has(jti)) {
      return { ok: false, reason: "replayed jti", jkt };
    }
    seenJtis.add(jti);
    if (expected.requireAth === true && typeof payload.ath !== "string") {
      return { ok: false, reason: "missing ath", jkt };
    }
    if (expected.requireAth === false && payload.ath !== undefined) {
      return { ok: false, reason: "unexpected ath on token-endpoint proof", jkt };
    }
    if (expected.nonce !== undefined && payload.nonce !== expected.nonce) {
      return { ok: false, reason: `nonce mismatch ${String(payload.nonce)}`, jkt };
    }
    return { ok: true, jkt };
  }

  async function mintIdToken(webId: string | undefined, jkt: string): Promise<string> {
    const payload: Record<string, unknown> = { sub: webId ?? "the-subject" };
    if (webId !== undefined) {
      payload.webid = webId;
    }
    // cnf.jkt binds the ID token's session to the DPoP key (informational here).
    payload.cnf = { jkt };
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "ES256", kid: "op-key-1", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(opts.clientId)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  }

  async function mintAccessToken(): Promise<string> {
    accessTokenCounter += 1;
    return `access-token-${accessTokenCounter}`;
  }

  async function handle(url: string, init: RequestInit | undefined): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = normalizeHeaders(init?.headers);
    const body = await readBody(init?.body);
    captured.push(body !== undefined ? { url, method, headers, body } : { url, method, headers });

    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "/";

    if (path === "/.well-known/openid-configuration") {
      return json(discoveryDoc);
    }
    if (path === "/jwks") {
      return json({ keys: [opPublicJwk] });
    }
    if (path === "/token" && method === "POST") {
      return tokenEndpointHandler(body, headers, url);
    }
    if (path === "/userinfo") {
      return json({ sub: "the-subject", webid: opts.webId });
    }
    // Any other path under the issuer base is the resource server.
    return resourceEndpoint(url, method, headers);
  }

  async function tokenEndpointHandler(
    body: string | undefined,
    headers: Record<string, string>,
    url: string,
  ): Promise<Response> {
    tokenCalls += 1;
    const dpop = headers.dpop;
    if (!dpop) {
      return json({ error: "invalid_dpop_proof", error_description: "no DPoP proof" }, 400);
    }
    lastTokenProof = decodeJws(dpop);
    const proofPayload = lastTokenProof.payload;

    // RFC 9449 §8: the FIRST proof has no nonce → challenge with `use_dpop_nonce` + `DPoP-Nonce`.
    if (proofPayload.nonce === undefined) {
      return new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
        status: 400,
        headers: { "content-type": "application/json", "dpop-nonce": tokenNonce },
      });
    }

    // The retried proof carries the nonce — verify the proof FULLY (no ath on the token leg).
    const verdict = await verifyDpopProof(dpop, {
      htm: "POST",
      htu: url,
      requireAth: false,
      nonce: tokenNonce,
    });
    if (!verdict.ok) {
      return json({ error: "invalid_dpop_proof", error_description: verdict.reason }, 400);
    }

    const params = new URLSearchParams(body ?? "");
    const grantType = params.get("grant_type");
    const accessToken = await mintAccessToken();
    const idToken = await mintIdToken(opts.webId, verdict.jkt);
    const out: Record<string, unknown> = {
      access_token: accessToken,
      token_type: opts.tokenTypeOverride ?? "DPoP",
      expires_in: 600,
      scope: "openid webid offline_access",
      id_token: idToken,
    };
    if (grantType === "authorization_code" || grantType === "refresh_token") {
      out.refresh_token = `refresh-${accessTokenCounter}`;
    }
    return json(out);
  }

  async function resourceEndpoint(
    url: string,
    method: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    const dpop = headers.dpop;
    if (dpop) {
      lastResourceProof = decodeJws(dpop);
    }
    if (nextResourceNonce !== undefined) {
      const nonce = nextResourceNonce;
      nextResourceNonce = undefined; // single challenge
      return new Response("", {
        status: 401,
        headers: { "dpop-nonce": nonce, "www-authenticate": 'DPoP error="use_dpop_nonce"' },
      });
    }
    return json({
      ok: true,
      sawDpop: typeof dpop === "string",
      authorization: headers.authorization,
      method,
      url,
    });
  }

  return {
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const reqInit =
        input instanceof Request
          ? { method: input.method, headers: input.headers, ...(init ?? {}) }
          : init;
      return handle(url, reqInit);
    },
    captured,
    opPublicJwk,
    tokenEndpoint,
    discoveryUrl,
    lastTokenDpop: () => lastTokenProof,
    lastResourceDpop: () => lastResourceProof,
    tokenCallCount: () => tokenCalls,
    challengeNextResourceWithNonce(nonce: string) {
      nextResourceNonce = nonce;
    },
    seenJtis: () => seenJtis,
    verifyDpopProof,
  };
}

async function readBody(body: unknown): Promise<string | undefined> {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  try {
    return await new Request("https://body.invalid/", {
      method: "POST",
      body: body as BodyInit,
    }).text();
  } catch {
    return undefined;
  }
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) {
    return out;
  }
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) {
      out[k.toLowerCase()] = v;
    }
  } else {
    for (const [k, v] of Object.entries(h)) {
      out[k.toLowerCase()] = v as string;
    }
  }
  return out;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
