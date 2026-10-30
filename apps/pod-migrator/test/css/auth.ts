// AUTHORED-BY Codex GPT-6
import { createHash, generateKeyPairSync, type KeyObject, randomUUID, sign } from "node:crypto";

export interface ProofKey {
  privateKey: KeyObject;
  jwk: { kty: string; crv: string; x: string; y: string };
}

export function createProofKey(): ProofKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const exported = publicKey.export({ format: "jwk" });
  if (!exported.kty || !exported.crv || !exported.x || !exported.y)
    throw new Error("Incomplete ES256 public key");
  return {
    privateKey,
    jwk: { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y },
  };
}

export function mintProof(
  key: ProofKey,
  method: string,
  url: string,
  options: { token?: string; nonce?: string; now?: number } = {},
): string {
  const target = new URL(url);
  target.search = "";
  target.hash = "";
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = [
    encode({ typ: "dpop+jwt", alg: "ES256", jwk: key.jwk }),
    encode({
      htm: method.toUpperCase(),
      htu: target.href,
      iat: Math.floor((options.now ?? Date.now()) / 1000),
      jti: randomUUID(),
      ...(options.token === undefined
        ? {}
        : { ath: createHash("sha256").update(options.token, "ascii").digest("base64url") }),
      ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
    }),
  ].join(".");
  // JWS ES256 uses fixed-width r || s, not OpenSSL's default DER encoding.
  const signature = sign("sha256", Buffer.from(input), {
    key: key.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${signature.toString("base64url")}`;
}

export const boundedFetch: typeof fetch = (input, init = {}) =>
  fetch(input, {
    ...init,
    redirect: "manual",
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });

/** Only disposable local CSS origins may receive this harness's credentials. */
export function localUrl(value: string, origin?: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "localhost" ||
    url.username ||
    url.password ||
    (origin !== undefined && url.origin !== origin)
  )
    throw new Error("Harness credentials must stay on the expected loopback origin");
  return url.href;
}

export async function exchangeToken(
  endpoint: string,
  credentials: { id: string; secret: string },
  key: ProofKey,
  fetcher: typeof fetch = boundedFetch,
): Promise<{ token: string; expiresAt: number }> {
  localUrl(endpoint);
  let nonce: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetcher(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: `Basic ${Buffer.from(
          `${encodeURIComponent(credentials.id)}:${encodeURIComponent(credentials.secret)}`,
        ).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        dpop: mintProof(key, "POST", endpoint, { nonce }),
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "webid" }),
    });
    const challenge = response.headers.get("dpop-nonce");
    if ([400, 401].includes(response.status) && challenge && attempt === 0) {
      nonce = challenge;
      await response.arrayBuffer();
      continue;
    }
    if (response.status !== 200) throw new Error(`CSS token exchange failed (${response.status})`);
    const value = (await response.json()) as Record<string, unknown>;
    if (
      typeof value.access_token !== "string" ||
      !value.access_token ||
      typeof value.token_type !== "string" ||
      value.token_type.toLowerCase() !== "dpop" ||
      typeof value.expires_in !== "number" ||
      value.expires_in <= 0
    )
      throw new Error("CSS did not issue an expiring DPoP-bound token");
    return { token: value.access_token, expiresAt: Date.now() + value.expires_in * 1000 };
  }
  throw new Error("CSS token nonce retry exhausted");
}

export async function createSession(
  endpoint: string,
  credentials: { id: string; secret: string },
  origins: string[],
  fetcher: typeof fetch = boundedFetch,
): Promise<typeof fetch> {
  const key = createProofKey();
  let token = await exchangeToken(endpoint, credentials, key, fetcher);
  let renewal: Promise<typeof token> | undefined;
  const nonces = new Map<string, string>();
  const allowed = new Set(origins.map((origin) => new URL(localUrl(origin)).origin));
  return async (input, init = {}) => {
    if (typeof input !== "string") throw new TypeError("Harness fetch requires a string URL");
    const url = new URL(localUrl(input));
    if (!allowed.has(url.origin)) throw new Error("Session origin is outside the test servers");
    if (token.expiresAt - Date.now() < 30_000) {
      renewal ??= exchangeToken(endpoint, credentials, key, fetcher);
      try {
        token = await renewal;
      } finally {
        renewal = undefined;
      }
    }
    const suppliedHeaders = new Headers(init.headers);
    if (suppliedHeaders.has("authorization") || suppliedHeaders.has("dpop"))
      throw new Error("Caller-supplied session credentials are refused");
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = new Headers(suppliedHeaders);
      headers.set("authorization", `DPoP ${token.token}`);
      headers.set(
        "dpop",
        mintProof(key, init.method ?? "GET", url.href, {
          token: token.token,
          nonce: nonces.get(url.origin),
        }),
      );
      const response = await fetcher(url.href, { ...init, headers, redirect: "manual" });
      const nonce = response.headers.get("dpop-nonce");
      if (nonce) nonces.set(url.origin, nonce);
      if (response.status === 401 && nonce && attempt === 0) {
        await response.arrayBuffer();
        continue;
      }
      if (response.status >= 300 && response.status < 400)
        throw new Error("Authenticated harness redirects are refused");
      return response;
    }
    throw new Error("CSS resource nonce retry exhausted");
  };
}
