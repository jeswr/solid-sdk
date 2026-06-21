// node_modules/@jeswr/solid-dpop/dist/esm/authCode.js
import { createHash as createHash2, randomBytes, randomUUID as randomUUID2 } from "node:crypto";

// node_modules/@jeswr/solid-dpop/dist/esm/dpop.js
import { createHash, randomUUID } from "node:crypto";
var josePromise;
function loadJose() {
  if (!josePromise) {
    josePromise = import("jose");
  }
  return josePromise;
}
var DPOP_ALG = "ES256";
function canonicalHtu(uri) {
  const u = new URL(uri);
  u.search = "";
  u.hash = "";
  return u.toString();
}
function accessTokenHash(accessToken) {
  return createHash("sha256").update(accessToken, "ascii").digest("base64url");
}
async function toDpopKeyPair(publicKey, privateKey) {
  const { exportJWK, calculateJwkThumbprint } = await loadJose();
  const publicJwk = await exportJWK(publicKey);
  const thumbprint = await calculateJwkThumbprint(publicJwk);
  return { publicKey, privateKey, publicJwk, thumbprint };
}
async function generateDpopKeyPair() {
  const { generateKeyPair } = await loadJose();
  const { publicKey, privateKey } = await generateKeyPair(DPOP_ALG, { extractable: true });
  return toDpopKeyPair(publicKey, privateKey);
}
async function exportDpopKeyPairJwk(keyPair) {
  const { exportJWK } = await loadJose();
  return exportJWK(keyPair.privateKey);
}
async function importDpopKeyPairJwk(jwk) {
  if (!jwk.d) {
    throw new Error("importDpopKeyPairJwk: JWK has no private component (`d`); cannot reconstruct keypair.");
  }
  const { importJWK } = await loadJose();
  const { d: _d, ...publicJwkInput } = jwk;
  const privateKey = await importJWK({ ...jwk, alg: DPOP_ALG }, DPOP_ALG, {
    extractable: true
  });
  const publicKey = await importJWK({ ...publicJwkInput, alg: DPOP_ALG }, DPOP_ALG);
  return toDpopKeyPair(publicKey, privateKey);
}
async function createDpopProof(params) {
  const { keyPair, htm, htu, accessToken, nonce } = params;
  const payload = {
    htm: htm.toUpperCase(),
    htu: canonicalHtu(htu),
    jti: randomUUID()
  };
  if (accessToken !== void 0) {
    payload["ath"] = accessTokenHash(accessToken);
  }
  if (nonce !== void 0) {
    payload["nonce"] = nonce;
  }
  const { SignJWT } = await loadJose();
  return new SignJWT(payload).setProtectedHeader({
    typ: "dpop+jwt",
    alg: DPOP_ALG,
    jwk: keyPair.publicJwk
  }).setIssuedAt().sign(keyPair.privateKey);
}

// src/dpopFetch.ts
var NONCE_RETRY_LIMIT = 1;
function isLoopbackHost2(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost") {
    return true;
  }
  const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (unbracketed === "::1") {
    return true;
  }
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(unbracketed)) {
    const octets = unbracketed.split(".").map(Number);
    return octets.every((o) => o >= 0 && o <= 255);
  }
  return false;
}
function assertSecureTransport(rawUrl, allowInsecure, makeError) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw makeError(`not a valid URL: ${rawUrl}`);
  }
  if (u.protocol === "https:") {
    return;
  }
  if (u.protocol === "http:") {
    if (allowInsecure && isLoopbackHost2(u.hostname)) {
      return;
    }
    throw makeError(
      `refusing an insecure http: URL (${rawUrl}). https is required; http: is permitted only for a loopback host with \`allowInsecure: true\`.`
    );
  }
  throw makeError(`unsupported URL scheme in ${rawUrl} (expected https:).`);
}
function effectiveUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}
function effectiveMethod(input, init) {
  const fromInit = init?.method;
  if (typeof fromInit === "string" && fromInit.length > 0) {
    return fromInit.toUpperCase();
  }
  if (typeof input !== "string" && !(input instanceof URL)) {
    return (input.method || "GET").toUpperCase();
  }
  return "GET";
}
function headerValue(headers, name) {
  if (!headers) {
    return void 0;
  }
  const target = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(target) ?? void 0;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (k.toLowerCase() === target) {
        return v;
      }
    }
    return void 0;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return v;
    }
  }
  return void 0;
}
function effectiveContentType(input, init) {
  const fromInit = headerValue(init?.headers, "content-type");
  if (fromInit !== void 0) {
    return fromInit;
  }
  if (typeof input !== "string" && !(input instanceof URL)) {
    return input.headers.get("content-type") ?? void 0;
  }
  return void 0;
}
function isTokenEndpointLeg(input, init) {
  if (effectiveMethod(input, init) !== "POST") {
    return false;
  }
  const ct = effectiveContentType(input, init);
  return ct?.toLowerCase().includes("application/x-www-form-urlencoded") === true;
}
async function isUseDpopNonceChallenge(res) {
  if (res.status < 400 || res.status >= 500) {
    return false;
  }
  if (res.headers.get("dpop-nonce")) {
    return true;
  }
  try {
    const cloned = res.clone();
    const text = await cloned.text();
    if (text.length === 0) {
      return false;
    }
    const parsed = JSON.parse(text);
    return parsed.error === "use_dpop_nonce";
  } catch {
    return false;
  }
}
function buildDpopCustomFetch(keyPair, underlying, allowInsecure) {
  const dpopFetch = async (input, init) => {
    if (!isTokenEndpointLeg(input, init)) {
      return underlying(input, init);
    }
    const url = effectiveUrl(input);
    assertSecureTransport(
      url,
      allowInsecure,
      (msg) => new Error(`auth-solid customFetch: ${msg} \u2014 refusing the token request over plaintext.`)
    );
    const method = "POST";
    const send = async (nonce) => {
      const proof = await createDpopProof(
        nonce === void 0 ? { keyPair, htm: method, htu: url } : { keyPair, htm: method, htu: url, nonce }
      );
      const headers = new Headers(init?.headers ?? void 0);
      if (typeof input !== "string" && !(input instanceof URL)) {
        input.headers.forEach((v, k) => {
          if (!headers.has(k)) {
            headers.set(k, v);
          }
        });
      }
      headers.set("dpop", proof);
      return underlying(url, { ...init ?? {}, method, headers });
    };
    const res = await send();
    if (await isUseDpopNonceChallenge(res)) {
      const serverNonce = res.headers.get("dpop-nonce");
      if (serverNonce) {
        await res.body?.cancel().catch(() => {
        });
        return send(serverNonce);
      }
    }
    return res;
  };
  return dpopFetch;
}
function resolveResourceUrl(input) {
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof input !== "string") {
    return input.url;
  }
  const g = globalThis;
  const base = g.document?.baseURI ?? g.location?.href;
  try {
    return base !== void 0 ? new URL(input, base).toString() : new URL(input).toString();
  } catch {
    throw new Error(
      `solidDpopFetch: \`${input}\` is not an absolute URL and there is no document base to resolve it against (server-side). Pass an absolute https URL.`
    );
  }
}
var DEFAULT_MAX_REPLAY_BODY_BYTES = 10 * 1024 * 1024;
function abortReason(signal) {
  const reason = signal.reason;
  if (reason !== void 0) {
    return reason;
  }
  return new DOMException("The operation was aborted.", "AbortError");
}
async function bufferStream(stream, signal, maxBytes) {
  const reader = stream.getReader();
  let removeAbortListener;
  const abortRace = signal === void 0 ? void 0 : new Promise((_resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });
  abortRace?.catch(() => {
  });
  const chunks = [];
  let total = 0;
  try {
    if (signal?.aborted) {
      throw abortReason(signal);
    }
    for (; ; ) {
      const result = abortRace ? await Promise.race([reader.read(), abortRace]) : await reader.read();
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > maxBytes) {
        throw new Error(
          `solidDpopFetch: request stream body exceeds the ${maxBytes}-byte replay buffer cap. Raise \`maxReplayBodyBytes\` to upload a larger body (it is buffered so the \xA78 DPoP-nonce retry can replay it), or pass an already-replayable body (string / Uint8Array / Blob).`
        );
      }
      chunks.push(result.value);
    }
  } catch (err) {
    await reader.cancel(err).catch(() => {
    });
    throw err;
  } finally {
    removeAbortListener?.();
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer.slice(0, total);
}
function requestTransportFields(req) {
  return {
    redirect: req.redirect,
    cache: req.cache,
    credentials: req.credentials,
    integrity: req.integrity,
    keepalive: req.keepalive,
    mode: req.mode,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
    ...req.signal ? { signal: req.signal } : {}
  };
}
function buildSolidDpopFetch(state, options = {}) {
  const underlying = options.fetch ?? globalThis.fetch;
  const allowInsecure = options.allowInsecure === true;
  const maxReplayBodyBytes = options.maxReplayBodyBytes ?? DEFAULT_MAX_REPLAY_BODY_BYTES;
  const accessToken = state.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("solidDpopFetch: SolidAuthState.accessToken is missing/empty.");
  }
  const keyJwk = state.dpopKeyJwk;
  if (keyJwk === void 0 || keyJwk === null || typeof keyJwk !== "object") {
    throw new Error("solidDpopFetch: SolidAuthState.dpopKeyJwk is missing/invalid.");
  }
  let keyPairPromise;
  const getKeyPair = () => {
    if (!keyPairPromise) {
      keyPairPromise = importDpopKeyPairJwk(keyJwk);
    }
    return keyPairPromise;
  };
  return async (input, init) => {
    const url = resolveResourceUrl(input);
    assertSecureTransport(
      url,
      allowInsecure,
      (msg) => new Error(`solidDpopFetch: ${msg} \u2014 refusing to send the DPoP token over plaintext.`)
    );
    const method = effectiveMethod(input, init);
    const keyPair = await getKeyPair();
    const reqInput = typeof input !== "string" && !(input instanceof URL) ? input : void 0;
    const effectiveSignal = init && "signal" in init ? init.signal ?? void 0 : reqInput?.signal ?? void 0;
    let bufferedBody;
    if (init && "body" in init) {
      const b = init.body ?? void 0;
      bufferedBody = b instanceof ReadableStream ? await bufferStream(b, effectiveSignal, maxReplayBodyBytes) : b;
    } else if (reqInput && reqInput.body !== null) {
      bufferedBody = await bufferStream(
        reqInput.clone().body,
        effectiveSignal,
        maxReplayBodyBytes
      );
    }
    const send = async (nonce) => {
      const proof = await createDpopProof(
        nonce === void 0 ? { keyPair, htm: method, htu: url, accessToken } : { keyPair, htm: method, htu: url, accessToken, nonce }
      );
      const headers = new Headers(reqInput?.headers ?? void 0);
      if (init?.headers) {
        new Headers(init.headers).forEach((v, k) => {
          headers.set(k, v);
        });
      }
      headers.set("authorization", `DPoP ${accessToken}`);
      headers.set("dpop", proof);
      const reqInit = {
        ...reqInput ? requestTransportFields(reqInput) : {},
        ...init ?? {},
        method,
        headers
      };
      delete reqInit.body;
      if (bufferedBody !== void 0) {
        reqInit.body = bufferedBody;
      }
      return underlying(url, reqInit);
    };
    const res = await send();
    if (res.status === 401) {
      const serverNonce = res.headers.get("dpop-nonce");
      if (serverNonce) {
        await res.body?.cancel().catch(() => {
        });
        return send(serverNonce);
      }
    }
    return res;
  };
}
var DPOP_NONCE_RETRY_LIMIT = NONCE_RETRY_LIMIT;

// src/provider.ts
import { customFetch } from "@auth/core";
var DEFAULT_SCOPE2 = "openid webid offline_access";
var SOLID_CHECKS = ["pkce", "state", "nonce"];
function normalizeScope(scope) {
  if (scope === void 0 || scope.trim() === "") {
    return DEFAULT_SCOPE2;
  }
  const parts = scope.split(/\s+/).filter((s) => s.length > 0);
  if (!parts.includes("openid")) {
    parts.unshift("openid");
  }
  return [...new Set(parts)].join(" ");
}
function isHttpUri(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
function extractVerifiedWebId(claims) {
  const webidClaim = claims.webid;
  if (typeof webidClaim === "string" && isHttpUri(webidClaim)) {
    return webidClaim;
  }
  const sub = claims.sub;
  if (typeof sub === "string" && isHttpUri(sub)) {
    return sub;
  }
  throw new Error(
    "auth-solid: the Solid login produced no resolvable `webid` claim in the VERIFIED ID token; refusing to create a session without a verified WebID (fail-closed). The WebID is never trusted from an unverified access token."
  );
}
async function Solid(config) {
  if (typeof config.issuer !== "string" || config.issuer.length === 0) {
    throw new Error("Solid(): `issuer` is required (the Solid OP URL).");
  }
  if (typeof config.clientId !== "string" || config.clientId.length === 0) {
    throw new Error("Solid(): `clientId` is required.");
  }
  const allowInsecure = config.allowInsecure === true;
  assertSecureTransport(config.issuer, allowInsecure, (msg) => new Error(`Solid(): issuer ${msg}`));
  const scope = normalizeScope(config.scope);
  const dpopKeyPair = config.dpopKeyJwk ? await importDpopKeyPairJwk(config.dpopKeyJwk) : await generateDpopKeyPair();
  const underlying = globalThis.fetch;
  const dpopFetch = buildDpopCustomFetch(dpopKeyPair, underlying, allowInsecure);
  const hasSecret = typeof config.clientSecret === "string" && config.clientSecret.length > 0;
  const provider = {
    id: config.id ?? "solid",
    name: config.name ?? "Solid",
    type: "oidc",
    issuer: config.issuer,
    clientId: config.clientId,
    // A public client (Client Identifier Document) has no secret; only set it for a confidential
    // client.
    ...hasSecret ? { clientSecret: config.clientSecret } : {},
    // SECURITY (token-endpoint client auth): Auth.js does NOT default a public client to `none` — an
    // UNDEFINED `token_endpoint_auth_method` falls into its `client_secret_basic` branch, which would
    // send `Authorization: Basic base64(clientId:undefined)` and break a public Solid client (Client
    // Identifier Document). So we set the method EXPLICITLY: `none` for a public client (no secret),
    // and `client_secret_basic` for a confidential one (Auth.js's effective default, made explicit so
    // an `undefined` never silently selects basic-with-no-secret). A roborev (High) finding.
    client: { token_endpoint_auth_method: hasSecret ? "client_secret_basic" : "none" },
    // PKCE S256 + state + nonce — ALL mandatory for Solid-OIDC.
    checks: [...SOLID_CHECKS],
    authorization: { params: { scope } },
    // Keep the token fields a Solid session needs. We return ONLY these (plus the defaults Auth.js
    // keeps), so an OP's extra token-response fields are not silently persisted into the account.
    // Fields are included only when present (exactOptionalPropertyTypes: a `TokenSet` property is
    // either a value or absent, never an explicit `undefined`).
    account(account) {
      const kept = /* @__PURE__ */ new Set([
        "access_token",
        "refresh_token",
        "id_token",
        "expires_at",
        "token_type",
        "scope"
      ]);
      const out = { ...account };
      for (const key of Object.keys(out)) {
        if (!kept.has(key)) {
          delete out[key];
        }
      }
      return out;
    },
    // Map the VERIFIED `webid` claim → the Auth.js user (fail-closed). `claims` is the verified
    // ID-token claim set Auth.js passes here.
    profile(claims) {
      const record = claims;
      const webid = extractVerifiedWebId(record);
      const sub = record.sub;
      const iss = record.iss;
      const name = record.name;
      return {
        id: webid,
        webid,
        ...typeof sub === "string" ? { sub } : {},
        ...typeof iss === "string" ? { iss } : {},
        ...typeof name === "string" ? { name } : {}
      };
    },
    [customFetch]: dpopFetch,
    dpopKeyPair,
    dpopKeyJwkForPersistence: () => exportDpopKeyPairJwk(dpopKeyPair)
  };
  return provider;
}

// src/session.ts
var SOLID_JWT_KEY = "solid";
function persistSolidTokensIntoJwt(input) {
  const { account, dpopKeyJwk } = input;
  const accessToken = account.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error(
      "persistSolidTokensIntoJwt: the Auth.js account carries no `access_token`; cannot build a Solid auth state (fail-closed)."
    );
  }
  if (dpopKeyJwk === void 0 || dpopKeyJwk === null || typeof dpopKeyJwk !== "object") {
    throw new Error("persistSolidTokensIntoJwt: `dpopKeyJwk` is required (the DPoP private key).");
  }
  if (typeof dpopKeyJwk.d !== "string" || dpopKeyJwk.d.length === 0) {
    throw new Error(
      "persistSolidTokensIntoJwt: `dpopKeyJwk` has no private component (`d`); a public-only JWK cannot sign DPoP proofs after a restart (fail-closed)."
    );
  }
  const tokenType = account.token_type;
  if (typeof tokenType !== "string" || tokenType.toLowerCase() !== "dpop") {
    throw new Error(
      `persistSolidTokensIntoJwt: Solid-OIDC requires DPoP-bound (sender-constrained) tokens, but the account token_type is "${tokenType ?? "none"}". Refusing to persist a non-DPoP token (fail-closed).`
    );
  }
  return {
    accessToken,
    dpopKeyJwk,
    ...typeof account.refresh_token === "string" ? { refreshToken: account.refresh_token } : {},
    ...typeof account.id_token === "string" ? { idToken: account.id_token } : {},
    ...typeof account.expires_at === "number" ? { expiresAt: account.expires_at } : {},
    ...typeof input.webid === "string" ? { webid: input.webid } : {},
    ...typeof input.issuer === "string" ? { issuer: input.issuer } : {}
  };
}
function extractSolidAuthState(source) {
  if (source === null || source === void 0 || typeof source !== "object") {
    return void 0;
  }
  const nested = source[SOLID_JWT_KEY];
  const state = nested !== void 0 ? nested : source;
  if (state === null || typeof state !== "object") {
    return void 0;
  }
  const s = state;
  const accessToken = s.accessToken;
  const dpopKeyJwk = s.dpopKeyJwk;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return void 0;
  }
  if (dpopKeyJwk === void 0 || dpopKeyJwk === null || typeof dpopKeyJwk !== "object") {
    return void 0;
  }
  return {
    accessToken,
    dpopKeyJwk,
    ...typeof s.issuer === "string" ? { issuer: s.issuer } : {},
    ...typeof s.webid === "string" ? { webid: s.webid } : {}
  };
}
export {
  DEFAULT_MAX_REPLAY_BODY_BYTES,
  DEFAULT_SCOPE2 as DEFAULT_SCOPE,
  DPOP_NONCE_RETRY_LIMIT,
  SOLID_CHECKS,
  SOLID_JWT_KEY,
  Solid,
  buildDpopCustomFetch,
  extractSolidAuthState,
  isLoopbackHost2 as isLoopbackHost,
  persistSolidTokensIntoJwt,
  buildSolidDpopFetch as solidDpopFetch
};
//# sourceMappingURL=index.js.map
