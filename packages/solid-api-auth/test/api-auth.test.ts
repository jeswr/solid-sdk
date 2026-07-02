// @vitest-environment node
//
// The verifier is server-only code (node:crypto, jose, undici). It is tested in the `node`
// environment — NOT jsdom — because jose's `instanceof Uint8Array` signature checks fail across
// the jsdom/node realm boundary (jsdom ships its own typed arrays).
/**
 * api-auth.test.ts — the exhaustive, adversarial suite for the server-side DPoP-bound
 * access-token verifier + owner authorizer, ported VERBATIM (behaviour-preserving) from the
 * AccessRadar reference (`accessradar/src/lib/solid/api-auth.test.ts`, bead xh5.11). Every
 * threat case survives the extraction — this suite IS the spec. Security-critical.
 *
 * AUTHORED-BY Claude Opus 4.8
 *
 * All tokens + proofs are minted in-test with `jose` (a stubbed issuer: a local JWKS injected
 * via `resolveIssuer`, so no network). One test drives the REAL `dpop` package (the exact proof
 * generator a client's `upgrade()` uses) end-to-end against the verifier — the full
 * client↔server round trip. No live server, no network.
 */
import { createHash } from "node:crypto";
import * as DPoP from "dpop";
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ApiAuthError,
  assertSameOrigin,
  DpopApiVerifier,
  type DpopApiVerifierOptions,
  InProcessReplayStore,
  parseAuthorization,
  reconstructRequestUrl,
  TokenBucketRateLimiter,
} from "../src/index.js";

const ISSUER = "https://issuer.example";
const OWNER = "https://owner.example/profile/card#me";
const APP_URL = "https://app.example/api/scan";

// ── Test-key fixtures (built once) ─────────────────────────────────────────────

interface Keys {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  jwk: JWK; // public JWK
  jkt: string; // base64url sha-256 thumbprint of the public JWK
}

async function makeKeys(kid?: string): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.alg = "ES256";
  if (kid) {
    jwk.kid = kid;
  }
  const jkt = await calculateJwkThumbprint(jwk, "sha256");
  return { privateKey, publicKey, jwk, jkt };
}

let issuerKeys: Keys; // signs access tokens
let proofKeys: Keys; // the DPoP holder key (cnf.jkt binds to this)

beforeEach(async () => {
  issuerKeys = await makeKeys("issuer-key-1");
  proofKeys = await makeKeys();
});

/** A local JWKS resolver for the issuer (no network). */
function localResolver(): DpopApiVerifierOptions["resolveIssuer"] {
  const jwks = createLocalJWKSet({ keys: [{ ...issuerKeys.jwk, kid: "issuer-key-1" }] });
  return () => ({ jwks });
}

function makeVerifier(overrides: Partial<DpopApiVerifierOptions> = {}): DpopApiVerifier {
  return new DpopApiVerifier({
    trustedIssuers: [ISSUER],
    ownerWebId: OWNER,
    webidClaim: "webid",
    bidirectionalMode: "off",
    resolveIssuer: localResolver(),
    replayStore: new InProcessReplayStore(),
    ...overrides,
  });
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Mint an access token signed by the issuer key. */
async function mintAccessToken(
  opts: {
    webid?: string;
    jkt?: string | null;
    iss?: string;
    sub?: string;
    clientId?: string;
    typ?: string;
    iat?: number;
    exp?: number;
    noExp?: boolean;
    noIat?: boolean;
    signWith?: CryptoKey;
  } = {},
): Promise<string> {
  const iat = opts.iat ?? nowSec();
  const payload: Record<string, unknown> = {
    iss: opts.iss ?? ISSUER,
    sub: opts.sub ?? "user-subject-1",
    client_id: opts.clientId ?? "https://app.example/client",
    webid: opts.webid ?? OWNER,
  };
  if (opts.jkt !== null) {
    payload.cnf = { jkt: opts.jkt ?? proofKeys.jkt };
  }
  let builder = new SignJWT(payload).setProtectedHeader({
    alg: "ES256",
    typ: opts.typ ?? "at+jwt",
    kid: "issuer-key-1",
  });
  if (!opts.noIat) {
    builder = builder.setIssuedAt(iat);
  }
  if (!opts.noExp) {
    builder = builder.setExpirationTime(opts.exp ?? iat + 300);
  }
  return builder.sign(opts.signWith ?? issuerKeys.privateKey);
}

/** Compute the RFC 9449 `ath` for an access token. */
function ath(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Mint a DPoP proof (full control over each field for adversarial cases). */
async function mintProof(opts: {
  accessToken: string;
  htu?: string;
  htm?: string;
  iat?: number;
  jti?: string;
  includeAth?: boolean;
  athValue?: string;
  typ?: string;
  proofKey?: Keys;
  noIat?: boolean;
}): Promise<string> {
  const key = opts.proofKey ?? proofKeys;
  const payload: Record<string, unknown> = {
    htu: opts.htu ?? APP_URL,
    htm: opts.htm ?? "POST",
    jti: opts.jti ?? `jti-${Math.random().toString(36).slice(2)}`,
  };
  if (opts.includeAth !== false) {
    payload.ath = opts.athValue ?? ath(opts.accessToken);
  }
  let builder = new SignJWT(payload).setProtectedHeader({
    alg: "ES256",
    typ: opts.typ ?? "dpop+jwt",
    jwk: key.jwk,
  });
  if (!opts.noIat) {
    builder = builder.setIssuedAt(opts.iat ?? nowSec());
  }
  return builder.sign(key.privateKey);
}

/** Build a POST request with the given auth headers. */
function mkRequest(
  opts: {
    authorization?: string;
    dpop?: string;
    method?: string;
    url?: string;
    origin?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (opts.authorization !== undefined) {
    headers.set("authorization", opts.authorization);
  }
  if (opts.dpop !== undefined) {
    headers.set("dpop", opts.dpop);
  }
  if (opts.origin !== undefined) {
    headers.set("origin", opts.origin);
  }
  return new Request(opts.url ?? APP_URL, { method: opts.method ?? "POST", headers });
}

/** Assert the promise rejects with an {@link ApiAuthError} of the given status. */
async function expectStatus(p: Promise<unknown>, status: number): Promise<ApiAuthError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiAuthError);
    expect((e as ApiAuthError).statusCode).toBe(status);
    return e as ApiAuthError;
  }
  throw new Error(`expected an ApiAuthError(${status}) but the promise resolved`);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("DpopApiVerifier — happy path", () => {
  it("200: valid DPoP-bound token + proof for the owner", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token });
    const creds = await makeVerifier().authorizeOwner(
      mkRequest({ authorization: `DPoP ${token}`, dpop: proof }),
    );
    expect(creds.webId).toBe(OWNER);
    expect(creds.issuer).toBe(ISSUER);
    expect(creds.clientId).toBe("https://app.example/client");
  });

  it("round trip: the real `dpop` package proof (as the client's upgrade() builds it) verifies", async () => {
    // Mirror the client: an ES256 DPoP keypair, a token bound to its thumbprint, and a proof
    // from the SAME `dpop` API the provider's upgrade() calls.
    const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
    const keyPair = { publicKey, privateKey };
    const jkt = await calculateJwkThumbprint(await exportJWK(publicKey), "sha256");
    const token = await mintAccessToken({ jkt });
    const proof = await DPoP.generateProof(keyPair, APP_URL, "POST", undefined, token);
    const creds = await makeVerifier().authorizeOwner(
      mkRequest({ authorization: `DPoP ${token}`, dpop: proof }),
    );
    expect(creds.webId).toBe(OWNER);
  });
});

describe("DpopApiVerifier — authentication failures (401)", () => {
  it("401: no Authorization header", async () => {
    const err = await expectStatus(makeVerifier().authorizeOwner(mkRequest()), 401);
    expect(err.wwwAuthenticate).toMatch(/^DPoP /);
  });

  it("401: Bearer-only (non-DPoP) token is refused", async () => {
    const token = await mintAccessToken();
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `Bearer ${token}` })),
      401,
    );
    expect(err.wwwAuthenticate).toMatch(/^DPoP /);
    expect(err.message).toMatch(/Bearer not accepted/i);
  });

  it("401: DPoP scheme but no DPoP proof header", async () => {
    const token = await mintAccessToken();
    await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}` })),
      401,
    );
  });

  it("401: wrong-key DPoP proof (cnf.jkt != proof-key thumbprint)", async () => {
    const token = await mintAccessToken(); // cnf.jkt binds to proofKeys
    const otherKey = await makeKeys();
    const proof = await mintProof({ accessToken: token, proofKey: otherKey });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/cnf\.jkt|confirmation/i);
  });

  it("401: replayed jti", async () => {
    const verifier = makeVerifier();
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token, jti: "fixed-jti-1" });
    // First use: accepted.
    await verifier.authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof }));
    // Replay: same proof (same jti) → rejected.
    const err = await expectStatus(
      verifier.authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/replay/i);
  });

  it("401: untrusted issuer", async () => {
    const token = await mintAccessToken({ iss: "https://evil.example" });
    const proof = await mintProof({ accessToken: token });
    // Signed by our issuer key but claims a different iss → not in the trusted list.
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/issuer is not trusted/i);
  });

  it("401: forged signature (token signed by a different key)", async () => {
    const attackerKey = await makeKeys("issuer-key-1");
    const token = await mintAccessToken({ signWith: attackerKey.privateKey });
    const proof = await mintProof({ accessToken: token });
    await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
  });

  it("401: expired access token", async () => {
    const past = nowSec() - 10_000;
    const token = await mintAccessToken({ iat: past, exp: past + 100 });
    const proof = await mintProof({ accessToken: token });
    await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
  });

  it("401: access token with NO exp claim (fail-closed temporal enforcement)", async () => {
    const token = await mintAccessToken({ noExp: true });
    const proof = await mintProof({ accessToken: token });
    await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
  });

  it("401: access token with NO iat claim (fail-closed temporal enforcement)", async () => {
    const token = await mintAccessToken({ noIat: true });
    const proof = await mintProof({ accessToken: token });
    await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
  });

  it("401: token not DPoP-bound (cnf claim entirely absent → requiredClaims rejects)", async () => {
    const token = await mintAccessToken({ jkt: null });
    const proof = await mintProof({ accessToken: token });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/cnf/i);
  });

  it("401: token has cnf but no jkt (present-but-malformed binding rejected)", async () => {
    // cnf present (passes requiredClaims) but without jkt → the explicit binding check fails.
    const iat = nowSec();
    const token = await new SignJWT({
      iss: ISSUER,
      sub: "s",
      client_id: "c",
      webid: OWNER,
      cnf: {},
    })
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "issuer-key-1" })
      .setIssuedAt(iat)
      .setExpirationTime(iat + 300)
      .sign(issuerKeys.privateKey);
    const proof = await mintProof({ accessToken: token });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/not DPoP-bound|cnf\.jkt/i);
  });

  it("401: proof htu mismatch (proof bound to a different URL)", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token, htu: "https://app.example/api/other" });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/htu/i);
  });

  it("401: proof htm mismatch (proof for GET, request is POST)", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token, htm: "GET" });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/htm/i);
  });

  it("401: proof iat too old (stale proof)", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token, iat: nowSec() - 10_000 });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/iat/i);
  });

  it("401: proof missing iat (presence enforced, not only range)", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token, noIat: true });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/iat/i);
  });

  it("401: proof missing ath", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token, includeAth: false });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/ath/i);
  });

  it("401: proof ath bound to a DIFFERENT access token", async () => {
    const token = await mintAccessToken();
    const otherToken = await mintAccessToken({ sub: "other" });
    const proof = await mintProof({ accessToken: token, athValue: ath(otherToken) });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/ath/i);
  });

  it("401: missing webid claim", async () => {
    // Mint a token with cnf but no webid.
    const iat = nowSec();
    const token = await new SignJWT({
      iss: ISSUER,
      sub: "s",
      client_id: "c",
      cnf: { jkt: proofKeys.jkt },
    })
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: "issuer-key-1" })
      .setIssuedAt(iat)
      .setExpirationTime(iat + 300)
      .sign(issuerKeys.privateKey);
    const proof = await mintProof({ accessToken: token });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/webid/i);
  });

  it("401: webid claim is not an https: URL", async () => {
    const token = await mintAccessToken({ webid: "http://owner.example/card#me" });
    const proof = await mintProof({ accessToken: token });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    expect(err.message).toMatch(/https/i);
  });

  it("401: proof typ is not dpop+jwt", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token, typ: "jwt" });
    await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
  });
});

describe("DpopApiVerifier — authorization (403 / owner)", () => {
  it("403: valid token but the WebID is not the owner", async () => {
    const token = await mintAccessToken({ webid: "https://intruder.example/card#me" });
    const proof = await mintProof({ accessToken: token });
    const err = await expectStatus(
      makeVerifier().authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      403,
    );
    expect(err.wwwAuthenticate).toBeUndefined();
  });

  it("authenticate() (no owner check) returns the non-owner identity", async () => {
    const token = await mintAccessToken({ webid: "https://intruder.example/card#me" });
    const proof = await mintProof({ accessToken: token });
    const creds = await makeVerifier().authenticate(
      mkRequest({ authorization: `DPoP ${token}`, dpop: proof }),
    );
    expect(creds.webId).toBe("https://intruder.example/card#me");
  });
});

describe("DpopApiVerifier — fail-closed configuration (503)", () => {
  it("503: owner WebID unset refuses ALL writes, even with a valid token", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token });
    const verifier = makeVerifier({ ownerWebId: undefined });
    await expectStatus(
      verifier.authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      503,
    );
  });

  it("503: owner WebID empty string is treated as unset", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token });
    const verifier = makeVerifier({ ownerWebId: "" });
    await expectStatus(
      verifier.authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      503,
    );
  });

  it("throws at construction when no trusted issuers are configured", () => {
    expect(() => makeVerifier({ trustedIssuers: [] })).toThrow(/at least one trusted issuer/i);
  });
});

describe("bidirectional WebID↔issuer check (SSRF-guarded, injected fetch)", () => {
  const profileTurtle = (issuers: string[]) =>
    `@prefix solid: <http://www.w3.org/ns/solid/terms#> .\n<${OWNER}> ${issuers
      .map((i) => `solid:oidcIssuer <${i}>`)
      .join(" ; ")} .\n`;

  const fetchStub = (body: string): typeof fetch =>
    (async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      })) as unknown as typeof fetch;

  it("passes strict mode when the profile lists the issuer", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token });
    const verifier = makeVerifier({
      bidirectionalMode: "strict",
      webidFetch: fetchStub(profileTurtle([ISSUER])),
    });
    const creds = await verifier.authorizeOwner(
      mkRequest({ authorization: `DPoP ${token}`, dpop: proof }),
    );
    expect(creds.webId).toBe(OWNER);
  });

  it("401 in strict mode when the profile does NOT list the issuer", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token });
    const verifier = makeVerifier({
      bidirectionalMode: "strict",
      webidFetch: fetchStub(profileTurtle(["https://other-idp.example"])),
    });
    const err = await expectStatus(
      verifier.authorizeOwner(mkRequest({ authorization: `DPoP ${token}`, dpop: proof })),
      401,
    );
    // Constant, non-oracle message.
    expect(err.message).toMatch(/WebID issuer check failed/i);
  });

  it("warn mode accepts a mismatch (logs, does not throw)", async () => {
    const token = await mintAccessToken();
    const proof = await mintProof({ accessToken: token });
    const verifier = makeVerifier({
      bidirectionalMode: "warn",
      webidFetch: fetchStub(profileTurtle(["https://other-idp.example"])),
    });
    const creds = await verifier.authorizeOwner(
      mkRequest({ authorization: `DPoP ${token}`, dpop: proof }),
    );
    expect(creds.webId).toBe(OWNER);
  });
});

describe("assertSameOrigin — CSRF defence-in-depth", () => {
  it("allows a same-origin POST", () => {
    expect(() => assertSameOrigin(mkRequest({ origin: "https://app.example" }))).not.toThrow();
  });

  it("allows a POST with no Origin header (non-browser client)", () => {
    expect(() => assertSameOrigin(mkRequest())).not.toThrow();
  });

  it("rejects a cross-origin POST (403)", () => {
    try {
      assertSameOrigin(mkRequest({ origin: "https://evil.example" }));
    } catch (e) {
      expect(e).toBeInstanceOf(ApiAuthError);
      expect((e as ApiAuthError).statusCode).toBe(403);
      return;
    }
    throw new Error("expected a cross-origin rejection");
  });
});

describe("TokenBucketRateLimiter — abuse cap", () => {
  it("allows up to capacity, then 429-blocks", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 3, refillPerSec: 0, now: () => 0 });
    expect(rl.tryRemove("owner")).toBe(true);
    expect(rl.tryRemove("owner")).toBe(true);
    expect(rl.tryRemove("owner")).toBe(true);
    expect(rl.tryRemove("owner")).toBe(false); // 4th within the window → blocked
  });

  it("refills over time", () => {
    let t = 0;
    const rl = new TokenBucketRateLimiter({ capacity: 2, refillPerSec: 1, now: () => t });
    expect(rl.tryRemove("k")).toBe(true);
    expect(rl.tryRemove("k")).toBe(true);
    expect(rl.tryRemove("k")).toBe(false);
    t = 1000; // 1s later → 1 token refilled
    expect(rl.tryRemove("k")).toBe(true);
    expect(rl.tryRemove("k")).toBe(false);
  });

  it("keys are independent (one owner's flood does not block another key)", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 1, refillPerSec: 0, now: () => 0 });
    expect(rl.tryRemove("a")).toBe(true);
    expect(rl.tryRemove("a")).toBe(false);
    expect(rl.tryRemove("b")).toBe(true); // different key, own bucket
  });
});

describe("helpers", () => {
  it("parseAuthorization lower-cases the scheme + trims the token", () => {
    expect(parseAuthorization("DPoP abc")).toEqual({ scheme: "dpop", token: "abc" });
    expect(parseAuthorization("Bearer   xyz")).toEqual({ scheme: "bearer", token: "xyz" });
    expect(parseAuthorization(undefined)).toBeUndefined();
    expect(parseAuthorization("DPoP")).toBeUndefined();
  });

  it("reconstructRequestUrl strips the query and honours X-Forwarded-*", () => {
    const req = new Request("http://internal-host/api/scan?x=1", {
      method: "POST",
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "app.example" },
    });
    expect(reconstructRequestUrl(req)).toBe("https://app.example/api/scan");
  });
});
