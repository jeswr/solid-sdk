// src/controller.ts
import { fetchRdf } from "@jeswr/fetch-rdf";

// ../solid-auth-core/node_modules/@jeswr/solid-session-restore/dist/remembered-account.js
var DEFAULT_REMEMBERED_ACCOUNT_KEY = "solid-session-restore.remembered-account";
var RememberedAccount = class {
  #key;
  /**
   * @param storageKey The localStorage key for this app's pointer. MUST be unique
   *   per app on a shared origin. Defaults to {@link DEFAULT_REMEMBERED_ACCOUNT_KEY};
   *   every real app SHOULD pass its own (e.g. `"pod-mail.remembered-account"`).
   */
  constructor(storageKey = DEFAULT_REMEMBERED_ACCOUNT_KEY) {
    this.#key = storageKey;
  }
  /** The localStorage key this instance reads/writes (for diagnostics / tests). */
  get key() {
    return this.#key;
  }
  /** Read the pointer, or null when absent / unavailable / corrupt / no-webId. */
  read() {
    let raw;
    try {
      raw = globalThis.localStorage?.getItem(this.#key) ?? null;
    } catch {
      return null;
    }
    if (!raw)
      return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.webId !== "string" || parsed.webId.length === 0)
        return null;
      const hasIssuer = typeof parsed.issuer === "string" && parsed.issuer.length > 0;
      return hasIssuer ? { webId: parsed.webId, issuer: parsed.issuer } : { webId: parsed.webId };
    } catch {
      return null;
    }
  }
  /**
   * Remember the now-active account (WebID + its resolved issuer) so a later reload
   * can attempt a silent refresh-token restore. Overwrites any prior pointer (a new
   * identity supersedes the old one). Best-effort: a storage error degrades to
   * in-memory-only behaviour (the next load shows login), never a failed login.
   */
  write(webId, issuer) {
    try {
      globalThis.localStorage?.setItem(this.#key, JSON.stringify({ webId, issuer }));
    } catch {
    }
  }
  /**
   * Clear the pointer (logout / account change). Idempotent; swallows storage
   * errors. Clearing the pointer means the next load will not attempt a silent
   * restore — the credential in IndexedDB is cleared separately (forgetPersisted).
   */
  clear() {
    try {
      globalThis.localStorage?.removeItem(this.#key);
    } catch {
    }
  }
};

// ../solid-auth-core/node_modules/@jeswr/solid-session-restore/dist/restore-session.js
import * as oauth from "oauth4webapi";
var EXPIRY_SKEW_MS = 3e4;
var isLoopback = (host) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";
function expiresAtFrom(token) {
  return token.expires_in === void 0 ? void 0 : Date.now() + token.expires_in * 1e3 - EXPIRY_SKEW_MS;
}
function webIdFromClaims(claims) {
  if (!claims)
    return void 0;
  const webid = claims.webid;
  if (typeof webid === "string" && webid.length > 0)
    return webid;
  if (typeof claims.sub === "string" && claims.sub.length > 0)
    return claims.sub;
  return void 0;
}
function isInvalidGrantError(e) {
  if (e && typeof e === "object") {
    const err = e;
    if (err.error === "invalid_grant")
      return true;
    try {
      if (err.cause?.parameters?.get("error") === "invalid_grant")
        return true;
    } catch {
    }
  }
  return false;
}
function httpOptions(issuer, options) {
  const out = {};
  if (options.signal)
    out.signal = options.signal;
  if (options.fetch) {
    const appFetch = options.fetch;
    out[oauth.customFetch] = (url, opts) => appFetch(url, opts);
  }
  if (options.allowInsecureLoopback && isLoopback(issuer.hostname)) {
    out[oauth.allowInsecureRequests] = true;
  }
  return out;
}
async function discover(issuer, http) {
  const discoveryResponse = await oauth.discoveryRequest(issuer, http);
  return oauth.processDiscoveryResponse(issuer, discoveryResponse);
}
function isConfidentialMethod(method) {
  return method === "client_secret_basic" || method === "client_secret_post";
}
function isSupportedMethod(method) {
  return method === "none" || method === "client_secret_basic" || method === "client_secret_post";
}
async function resolveClient(authorizationServer, options, stored, http) {
  const clientId = options.clientId ?? stored.clientId;
  const requestedMethod = options.tokenEndpointAuthMethod ?? stored.tokenEndpointAuthMethod;
  const supported = requestedMethod === void 0 || isSupportedMethod(requestedMethod);
  const authMethod = supported ? requestedMethod ?? "none" : "client_secret_basic";
  const secret = options.clientSecret ?? stored.clientSecret;
  if (clientId !== void 0 && clientId !== "") {
    return {
      client: {
        client_id: clientId,
        token_endpoint_auth_method: authMethod,
        ...options.callbackUri ? { redirect_uris: [options.callbackUri] } : {},
        response_types: ["code"]
      },
      authMethod,
      secret: supported && isConfidentialMethod(authMethod) ? secret : void 0,
      unsupported: !supported
    };
  }
  const registrationResponse = await oauth.dynamicClientRegistrationRequest(authorizationServer, options.callbackUri ? { redirect_uris: [options.callbackUri] } : {}, http);
  const registered = await oauth.processDynamicClientRegistrationResponse(registrationResponse);
  const registeredMethod = typeof registered.token_endpoint_auth_method === "string" ? registered.token_endpoint_auth_method : void 0;
  const freshSecret = typeof registered.client_secret === "string" && registered.client_secret !== "" ? registered.client_secret : void 0;
  const effectiveMethod = registeredMethod ?? (freshSecret !== void 0 ? "client_secret_basic" : "none");
  const freshSupported = isSupportedMethod(effectiveMethod);
  const freshMethod = freshSupported ? effectiveMethod : "client_secret_basic";
  return {
    client: registered,
    authMethod: freshMethod,
    secret: freshSupported && isConfidentialMethod(freshMethod) ? freshSecret : void 0,
    unsupported: !freshSupported
  };
}
function noUrlEncodeClientSecretBasic(clientSecret) {
  return (_as, client, _body, headers) => {
    headers.set("authorization", `Basic ${btoa(`${client.client_id}:${clientSecret}`)}`);
  };
}
var ESS_NO_URL_ENCODE_HOST = "login.inrupt.com";
function isEssNoUrlEncodeIssuer(issuer) {
  try {
    return new URL(issuer).hostname === ESS_NO_URL_ENCODE_HOST;
  } catch {
    return false;
  }
}
function clientSecretBasicFor(issuer) {
  return isEssNoUrlEncodeIssuer(issuer) ? noUrlEncodeClientSecretBasic : oauth.ClientSecretBasic;
}
function buildClientAuth(issuer, resolved) {
  if (resolved.unsupported)
    return void 0;
  if (!isConfidentialMethod(resolved.authMethod))
    return oauth.None();
  const secret = resolved.secret;
  if (secret === void 0 || secret === "")
    return void 0;
  return resolved.authMethod === "client_secret_post" ? oauth.ClientSecretPost(secret) : clientSecretBasicFor(issuer)(secret);
}
async function refreshGrant(authorizationServer, clientRegistration, clientAuth, dpopHandle, refreshToken, http) {
  const grant = () => oauth.refreshTokenGrantRequest(authorizationServer, clientRegistration, clientAuth, refreshToken, { DPoP: dpopHandle, ...http });
  try {
    return await oauth.processRefreshTokenResponse(authorizationServer, clientRegistration, await grant());
  } catch (e) {
    if (!oauth.isDPoPNonceError(e))
      throw e;
    return await oauth.processRefreshTokenResponse(authorizationServer, clientRegistration, await grant());
  }
}
async function persistRotatedSession(store, issuer, stored, restored, resolved) {
  const secret = resolved.secret;
  const confidential = isConfidentialMethod(resolved.authMethod) && secret !== void 0 && secret !== "";
  const resolvedClientId = typeof resolved.client.client_id === "string" && resolved.client.client_id !== "" ? resolved.client.client_id : void 0;
  const persistedClientId = stored.clientId !== void 0 && stored.clientId !== "" ? stored.clientId : void 0;
  const clientId = resolvedClientId ?? persistedClientId;
  try {
    await store.put({
      issuer: issuer.href,
      webId: restored.webId,
      refreshToken: restored.refreshToken,
      dpopKey: stored.dpopKey,
      ...clientId !== void 0 ? { clientId } : {},
      ...confidential ? {
        tokenEndpointAuthMethod: resolved.authMethod,
        clientSecret: secret
      } : {},
      ...restored.expiresAt !== void 0 ? { expiresAt: restored.expiresAt } : {}
    });
  } catch {
  }
}
async function restoreSession(options) {
  const { store, issuer } = options;
  let stored;
  try {
    stored = await store.get(issuer.href);
  } catch {
    return void 0;
  }
  if (stored === void 0 || stored.refreshToken === void 0 || stored.refreshToken === "") {
    return void 0;
  }
  try {
    const http = httpOptions(issuer, options);
    const authorizationServer = await discover(issuer, http);
    const resolved = await resolveClient(authorizationServer, options, stored, http);
    const clientRegistration = resolved.client;
    const clientAuth = buildClientAuth(authorizationServer.issuer, resolved);
    if (clientAuth === void 0)
      return void 0;
    const dpopHandle = oauth.DPoP(clientRegistration, stored.dpopKey);
    const tokenResult = await refreshGrant(authorizationServer, clientRegistration, clientAuth, dpopHandle, stored.refreshToken, http);
    const refreshToken = tokenResult.refresh_token ?? stored.refreshToken;
    const webId = webIdFromClaims(oauth.getValidatedIdTokenClaims(tokenResult)) ?? stored.webId;
    const restored = {
      webId,
      accessToken: tokenResult.access_token,
      refreshToken,
      dpopKey: stored.dpopKey,
      dpopHandle,
      expiresAt: expiresAtFrom(tokenResult),
      issuer: issuer.href
    };
    await persistRotatedSession(store, issuer, stored, restored, resolved);
    return restored;
  } catch (e) {
    if (isInvalidGrantError(e))
      await clearPersisted(store, issuer);
    return void 0;
  }
}
async function clearPersisted(store, issuer) {
  try {
    await store.delete(issuer.href);
  } catch {
  }
}
async function hasPersisted(store, issuer) {
  try {
    return await store.get(issuer.href) !== void 0 ? "present" : "absent";
  } catch {
    return "unknown";
  }
}

// ../solid-auth-core/node_modules/@jeswr/solid-session-restore/dist/session-persistence.js
var DEFAULT_DB_NAME = "solid-session-restore:sessions";
var DB_VERSION = 1;
var STORE_NAME = "sessions";
var IndexedDbSessionStore = class {
  #factory;
  #dbName;
  constructor(options = {}) {
    this.#factory = options.factory ?? globalThis.indexedDB;
    this.#dbName = options.dbName ?? DEFAULT_DB_NAME;
  }
  #open() {
    return new Promise((resolve, reject) => {
      const request = this.#factory.open(this.#dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "issuer" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  /**
   * Run one request inside a transaction and resolve when it is DURABLE.
   *
   * Writes (put/delete) resolve from `tx.oncomplete` — the transaction has
   * COMMITTED — so the caller never treats a credential as persisted/deleted
   * before it actually hit disk (resolving on `request.success` alone races the
   * commit). Reads (get) resolve from `request.onsuccess` with the read value (a
   * read has no durable mutation to await — its result IS the value, and the
   * readonly transaction completing carries no extra meaning). Either way a
   * `tx.onabort`/`tx.onerror` rejects, and the connection is closed in `finally`.
   */
  async #tx(mode, run) {
    const db = await this.#open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = run(tx.objectStore(STORE_NAME));
        if (mode === "readonly") {
          request.onsuccess = () => resolve(request.result);
        } else {
          let result;
          request.onsuccess = () => {
            result = request.result;
          };
          tx.oncomplete = () => resolve(result);
        }
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  async get(issuer) {
    const result = await this.#tx("readonly", (store) => store.get(issuer));
    return result ?? void 0;
  }
  async put(session) {
    await this.#tx("readwrite", (store) => store.put(session));
  }
  async delete(issuer) {
    await this.#tx("readwrite", (store) => store.delete(issuer));
  }
};
function indexedDbAvailable() {
  return typeof globalThis.indexedDB !== "undefined";
}

// ../solid-auth-core/node_modules/@jeswr/solid-session-restore/dist/session-restore.js
async function decideSilentRestore(inputs) {
  const { lastActiveWebId, remembered, restoreIssuer } = inputs;
  const equal = inputs.webIdsEqual ?? webIdsEqual;
  if (!lastActiveWebId)
    return { outcome: "login", reason: "no-account" };
  const issuer = remembered.find((a) => equal(a.webId, lastActiveWebId))?.issuer;
  if (!issuer)
    return { outcome: "login", reason: "no-issuer" };
  let restored;
  try {
    restored = await restoreIssuer(issuer);
  } catch {
    return { outcome: "login", reason: "restore-failed" };
  }
  if (restored === void 0)
    return { outcome: "login", reason: "restore-failed" };
  if (!equal(restored.webId, lastActiveWebId)) {
    return { outcome: "login", reason: "webid-mismatch" };
  }
  return { outcome: "restored", webId: restored.webId, issuer };
}
function shouldDropRememberedPointer(reason, credential) {
  switch (reason) {
    case "no-account":
    case "no-issuer":
    case "webid-mismatch":
      return true;
    case "restore-failed":
      return credential === "absent";
  }
}
function webIdsEqual(a, b) {
  if (!a || !b)
    return false;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host.toLowerCase() === ub.host.toLowerCase() && ua.pathname === ub.pathname && ua.search === ub.search && ua.hash === ub.hash;
  } catch {
    return false;
  }
}

// src/controller.ts
import { Agent } from "@solid/object";
import * as DPoP2 from "dpop";
import { DataFactory } from "n3";
import * as oauth2 from "oauth4webapi";

// src/pristine.ts
var PRISTINE_BASE = /* @__PURE__ */ Symbol.for("@jeswr/solid-auth-core:pristine-base");
var MAX_UNWRAP = 32;
function brandFetchWrapper(wrapper, base) {
  try {
    Object.defineProperty(wrapper, PRISTINE_BASE, {
      value: base,
      enumerable: false,
      configurable: true,
      writable: false
    });
  } catch {
  }
  return wrapper;
}
function resolvePristineFetch(candidate) {
  let current = candidate;
  for (let i = 0; i < MAX_UNWRAP; i++) {
    const base = current[PRISTINE_BASE];
    if (typeof base !== "function") return current;
    current = base;
  }
  return current;
}
var MODULE_PRISTINE_FETCH = (() => {
  if (typeof globalThis === "undefined" || typeof globalThis.fetch !== "function") {
    return void 0;
  }
  const raw = globalThis.fetch;
  const resolved = resolvePristineFetch(raw);
  return resolved === raw ? raw.bind(globalThis) : resolved;
})();

// src/redirect.ts
var ES256_JWK_IMPORT_ALG = { name: "ECDSA", namedCurve: "P-256" };
var AUTOLOGIN_FRAGMENT_PREFIX = "#autologin/";
function readPersistedRedirectFlow(storage, key) {
  let raw;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.codeVerifier !== "string" || typeof parsed.state !== "string" || typeof parsed.nonce !== "string" || typeof parsed.issuer !== "string" || typeof parsed.redirectUri !== "string" || typeof parsed.client !== "object" || parsed.client === null || typeof parsed.client.client_id !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function writePersistedRedirectFlow(storage, key, flow) {
  if (!storage) {
    throw new Error(
      "Cannot start a redirect login: no sessionStorage is available to persist the in-flight login state across the full-page redirect."
    );
  }
  try {
    storage.setItem(key, JSON.stringify(flow));
  } catch (e) {
    throw new Error(
      `Could not persist the redirect login state to sessionStorage: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
function clearPersistedRedirectFlow(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
  }
}
function parseAutologinFragment(hash) {
  if (!hash.startsWith(AUTOLOGIN_FRAGMENT_PREFIX)) return null;
  const encoded = hash.slice(AUTOLOGIN_FRAGMENT_PREFIX.length);
  if (!encoded) return null;
  try {
    const webId = decodeURIComponent(encoded);
    return webId.length > 0 ? webId : null;
  } catch {
    return null;
  }
}
function hasAuthCodeParams(search) {
  const params = new URLSearchParams(search);
  return params.has("code") && params.has("state");
}
function hasAuthErrorParams(search) {
  const params = new URLSearchParams(search);
  return params.has("error") && params.has("state");
}
function authErrorFrom(search) {
  return new URLSearchParams(search).get("error");
}
function cleanedUrl(href) {
  try {
    const u = new URL(href);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return href;
  }
}
var AUTH_CALLBACK_PARAMS = [
  "code",
  "state",
  "error",
  "error_description",
  "error_uri",
  "iss",
  "session_state"
];
function stripAuthCallbackParams(href) {
  try {
    const u = new URL(href);
    for (const p of AUTH_CALLBACK_PARAMS) u.searchParams.delete(p);
    if (parseAutologinFragment(u.hash) !== null) u.hash = "";
    return u.toString();
  } catch {
    return href;
  }
}
function planRedirect(inputs) {
  if (inputs.loggedIn) return { kind: "none" };
  if (inputs.hasPendingRedirect && inputs.hasCodeParams) {
    return { kind: "complete" };
  }
  if (inputs.hasPendingRedirect && inputs.hasErrorParams) {
    return { kind: "abort" };
  }
  if (inputs.fragmentWebId) {
    if (inputs.sentinel !== null && inputs.webIdsEqual(inputs.sentinel, inputs.fragmentWebId)) {
      return { kind: "clear-sentinel" };
    }
    return { kind: "begin", webId: inputs.fragmentWebId };
  }
  return { kind: "none" };
}

// src/controller.ts
var AmbiguousIssuerError = class extends Error {
  webId;
  issuers;
  constructor(webId, issuers) {
    super(
      `This WebID advertises ${issuers.length} OIDC issuers \u2014 supply a 'chooseIssuer' callback so the user can pick one (${webId}).`
    );
    this.name = "AmbiguousIssuerError";
    this.webId = webId;
    this.issuers = issuers;
  }
};
var NoSolidIssuerError = class extends Error {
  webId;
  constructor(webId) {
    super(`This WebID has no solid:oidcIssuer, so it can't be used for Solid login (${webId}).`);
    this.name = "NoSolidIssuerError";
    this.webId = webId;
  }
};
var InvalidWebIdError = class extends Error {
  constructor(input, reason) {
    super(`Not a valid WebID (${reason}): ${input}`);
    this.name = "InvalidWebIdError";
  }
};
var MissingAuthFlowError = class extends Error {
  constructor() {
    super(
      "login() requires an 'authFlow' (the interactive popup driver), but none was supplied to createSolidAuth. Pass options.authFlow to enable interactive login. (Silent restore via restore() does not need it.)"
    );
    this.name = "MissingAuthFlowError";
  }
};
var isLoopback2 = (host) => host === "localhost" || host === "127.0.0.1" || host === "[::1]";
function defaultSessionStorage() {
  try {
    return globalThis.sessionStorage ?? void 0;
  } catch {
    return void 0;
  }
}
function noUrlEncodeClientSecretBasic2(clientSecret) {
  return (_as, client, _body, headers) => {
    headers.set("authorization", `Basic ${btoa(`${client.client_id}:${clientSecret}`)}`);
  };
}
var ESS_NO_URL_ENCODE_HOST2 = "login.inrupt.com";
function isEssNoUrlEncodeIssuer2(issuer) {
  try {
    return new URL(issuer).hostname === ESS_NO_URL_ENCODE_HOST2;
  } catch {
    return false;
  }
}
function clientSecretBasicFor2(issuer) {
  return isEssNoUrlEncodeIssuer2(issuer) ? noUrlEncodeClientSecretBasic2 : oauth2.ClientSecretBasic;
}
var EXPIRY_SKEW_MS2 = 3e4;
function expiresAtFrom2(expiresIn) {
  return expiresIn === void 0 ? void 0 : Date.now() + expiresIn * 1e3 - EXPIRY_SKEW_MS2;
}
function computeAllowedOrigins(inputs) {
  const origins = /* @__PURE__ */ new Set();
  const add = (value) => {
    if (!value) return;
    let url;
    try {
      url = new URL(value);
    } catch {
      return;
    }
    if (url.protocol === "https:") {
      origins.add(url.origin);
    } else if (url.protocol === "http:" && inputs.allowInsecureLoopback && isLoopback2(url.hostname)) {
      origins.add(url.origin);
    }
  };
  for (const o of inputs.allowedOrigins ?? []) add(o);
  if (inputs.includeWebIdOrigin !== false) add(inputs.webId);
  if (inputs.includeIssuerOrigin !== false) add(inputs.issuer);
  return origins;
}
function isOriginAllowed(allowed, requestUrl) {
  try {
    return allowed.has(new URL(requestUrl).origin);
  } catch {
    return false;
  }
}
function htuOf(requestUrl) {
  try {
    const u = new URL(requestUrl);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return requestUrl;
  }
}
function isUseDpopNonceChallenge(response) {
  const header = response.headers.get("WWW-Authenticate");
  if (!header) return false;
  let sawNonce = false;
  for (const challenge of parseWwwAuthenticate(header)) {
    if (challenge.scheme.toLowerCase() !== "dpop") continue;
    const error = challenge.params.get("error")?.toLowerCase();
    if (error === void 0) continue;
    if (error === "use_dpop_nonce") sawNonce = true;
    else return false;
  }
  return sawNonce;
}
var CHALLENGE_ATOM_SEPARATORS = /* @__PURE__ */ new Set([",", " ", "	"]);
function tokenizeChallengeHeader(header) {
  const atoms = [];
  let buf = "";
  let bufIsQuoted = false;
  let inQuotes = false;
  const flush = () => {
    if (buf || bufIsQuoted) {
      atoms.push({ kind: bufIsQuoted ? "quoted" : "word", text: buf });
      buf = "";
      bufIsQuoted = false;
    }
  };
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (inQuotes) {
      if (c === "\\" && i + 1 < header.length) {
        buf += header[++i];
      } else if (c === '"') {
        inQuotes = false;
      } else {
        buf += c;
      }
      continue;
    }
    if (c === '"') {
      flush();
      inQuotes = true;
      bufIsQuoted = true;
    } else if (c === "=") {
      flush();
      atoms.push({ kind: "eq" });
    } else if (CHALLENGE_ATOM_SEPARATORS.has(c)) {
      flush();
    } else {
      buf += c;
    }
  }
  flush();
  return atoms;
}
function walkChallengeAtoms(atoms) {
  const challenges = [];
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    if (atom.kind !== "word") continue;
    if (atoms[i + 1]?.kind !== "eq") {
      challenges.push({ scheme: atom.text, params: /* @__PURE__ */ new Map() });
      continue;
    }
    const valueAtom = atoms[i + 2];
    const value = valueAtom && valueAtom.kind !== "eq" ? valueAtom.text : "";
    challenges[challenges.length - 1]?.params.set(atom.text.toLowerCase(), value);
    i += 2;
  }
  return challenges;
}
function parseWwwAuthenticate(header) {
  return walkChallengeAtoms(tokenizeChallengeHeader(header));
}
var MemorySessionStore = class {
  /**
   * BRAND: this fallback store is NON-DURABLE — it lives only for the page lifetime, so
   * a credential "persisted" here cannot survive a reload. The controller checks this so
   * it does NOT write the silent-restore pointer for an in-memory put (which would make
   * the next load attempt — and fail — a restore that has nothing behind it; the roborev
   * finding). An INJECTED `options.store` is assumed durable (the consumer's contract).
   */
  durable = false;
  #map = /* @__PURE__ */ new Map();
  async get(issuer) {
    return this.#map.get(issuer);
  }
  async put(session) {
    this.#map.set(session.issuer, session);
  }
  async delete(issuer) {
    this.#map.delete(issuer);
  }
};
var MAX_RECENT_ACCOUNTS = 8;
function admissibleAvatarUrl(value) {
  if (typeof value !== "string") return void 0;
  try {
    const proto = new URL(value).protocol;
    return proto === "https:" || proto === "http:" ? value : void 0;
  } catch {
    return void 0;
  }
}
function normalizeRecentAccount(raw) {
  if (typeof raw !== "object" || raw === null) return void 0;
  const rec = raw;
  if (typeof rec.webId !== "string" || rec.webId.length === 0) return void 0;
  const avatarUrl = admissibleAvatarUrl(rec.avatarUrl);
  const hasName = typeof rec.displayName === "string" && rec.displayName.length > 0;
  return {
    webId: rec.webId,
    displayName: hasName ? rec.displayName : rec.webId,
    ...avatarUrl !== void 0 ? { avatarUrl } : {}
  };
}
var RecentAccountsList = class {
  #key;
  constructor(key) {
    this.#key = key;
  }
  list() {
    try {
      const raw = globalThis.localStorage?.getItem(this.#key) ?? null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out = [];
      for (const a of parsed) {
        const entry = normalizeRecentAccount(a);
        if (entry !== void 0) out.push(entry);
      }
      return out;
    } catch {
      return [];
    }
  }
  /**
   * Add or refresh an account, moving it to the front. Best-effort. MERGE-PRESERVING
   * so the engine's own internal re-record on a later login/restore (which passes
   * only `{ webId }`, i.e. displayName defaulted to the WebID) never CLOBBERS a human
   * name/avatar an app attached via the public writer:
   *  - displayName — an explicit non-empty name OTHER than the WebID wins; else a
   *    previously-recorded human name is kept; else it defaults to the WebID.
   *  - avatarUrl — an admissible http(s) URL wins; else a previously-recorded avatar
   *    is kept. (A hostile-scheme avatar is dropped.)
   */
  remember(account) {
    try {
      const current = this.list();
      const existing = current.find((a) => a.webId === account.webId);
      const rest = current.filter((a) => a.webId !== account.webId);
      const explicit = account.displayName;
      const displayName = explicit !== void 0 && explicit.length > 0 && explicit !== account.webId ? explicit : existing !== void 0 && existing.displayName.length > 0 && existing.displayName !== account.webId ? existing.displayName : account.webId;
      const avatarUrl = admissibleAvatarUrl(account.avatarUrl) ?? existing?.avatarUrl;
      const entry = {
        webId: account.webId,
        displayName,
        ...avatarUrl !== void 0 ? { avatarUrl } : {}
      };
      globalThis.localStorage?.setItem(
        this.#key,
        JSON.stringify([entry, ...rest].slice(0, MAX_RECENT_ACCOUNTS))
      );
    } catch {
    }
  }
};
function createSolidAuth(options) {
  return new SolidAuthEngine(options);
}
var SolidAuthEngine = class {
  /**
   * The pristine, credential-free fetch — the foreign-origin boundary. We DO NOT
   * re-read the (possibly already-patched) `globalThis.fetch` at construction; we use
   * the explicitly injected {@link SolidAuthConfig.publicFetch}, else
   * the module-load snapshot taken before any patching. A last-resort rejecting fetch
   * is only ever reached in a non-DOM env with no fetch at all (never returns a
   * possibly-patched global as "publicFetch").
   */
  #publicFetch;
  #profileFetch;
  #opts;
  #store;
  /**
   * Whether {@link #store} actually SURVIVES a reload. The built-in in-memory fallback
   * (used when IndexedDB is unavailable) does NOT, so a "successful" put to it must not
   * cause the silent-restore pointer to be written (the next load would attempt — and
   * fail — a restore with nothing behind it). An INJECTED store is assumed durable.
   */
  #storeIsDurable;
  /**
   * The configured Client Identifier Document URL, NORMALIZED so an empty string is
   * treated as ABSENT (`undefined`). A `clientId: ""` would otherwise leak through
   * `??`-style fallbacks — e.g. #persist would store `""` instead of the server-assigned
   * dynamic client id, breaking later silent restore (the roborev finding). Read this
   * everywhere instead of `#opts.clientId` so the empty-string case is handled once.
   */
  #clientId;
  #remembered;
  #recentAccounts;
  /** The full-page navigation seam (defaults to `location.assign`). */
  #navigate;
  /** The transient store for the redirect flow's in-between state (sessionStorage). */
  #redirectStorage;
  /** The sessionStorage key the redirect record is persisted under. */
  #redirectFlowKey;
  /** The sessionStorage key for the one-shot autologin loop-guard sentinel. */
  #redirectSentinelKey;
  // The token provider, built lazily so construction has no side effects until a
  // login/restore actually happens.
  #provider;
  // The STABLE controller-owned global `fetch` wrapper (created once when patchGlobalFetch
  // is enabled). Kept as a reference so we can RE-ASSERT it onto globalThis.fetch whenever
  // a session is (re)established — if another controller/library overwrote the global since
  // we installed it, the next login/restore re-installs OURS (the option's contract).
  #globalFetchWrapper;
  // The single live session (this controller is single-account at a time).
  #session;
  /** Bumped on logout / new login so a stale async result is ignored. */
  #generation = 0;
  /**
   * The AbortController of the CURRENTLY in-flight interactive login (its popup). Tracked
   * on the instance so a NEWER login or a logout can abort it IMMEDIATELY — proactively
   * cancelling a still-open popup rather than waiting for getCode to return (the roborev
   * finding). Cleared when the attempt settles.
   */
  #activeLoginAbort;
  /**
   * The in-flight refresh / silent-restore GRANTS (restoreSession), each as its
   * AbortController + a `settled` promise. Two mechanisms protect the refresh-token-rotation
   * lifecycle (the roborev findings):
   *  - ABORT (logout, or a NON-blocking supersede): cancel the grant's token-endpoint
   *    request so the token isn't redeemed under a stale generation.
   *  - DRAIN-BEFORE-BUMP (login): before `login()` advances #generation, it ABORTS then
   *    AWAITS the in-flight grants to settle — so a grant the OP ALREADY processed despite
   *    the abort gets its rotation write to land under its STILL-VALID generation, instead
   *    of being generation-skipped (which would strand the prior session on a spent token if
   *    the new login later failed). The abort bounds the wait (the grant bails promptly).
   * Each grant adds itself on start and removes itself on settle.
   */
  #activeGrants = /* @__PURE__ */ new Set();
  constructor(options) {
    this.#opts = options;
    this.#clientId = options.clientId !== void 0 && options.clientId !== "" ? options.clientId : void 0;
    this.#publicFetch = resolvePristineFetch(
      options.publicFetch ?? MODULE_PRISTINE_FETCH ?? (() => Promise.reject(
        new Error("No pristine fetch available in this environment")
      ))
    );
    this.#profileFetch = options.profileFetch ?? this.#publicFetch;
    brandFetchWrapper(this.#ownAuthenticatedFetch, this.#publicFetch);
    this.#store = options.store ?? (indexedDbAvailable() ? new IndexedDbSessionStore({ dbName: options.dbName }) : new MemorySessionStore());
    this.#storeIsDurable = this.#store.durable !== false;
    this.#remembered = new RememberedAccount(options.rememberedAccountsKey);
    this.#recentAccounts = new RecentAccountsList(
      options.recentAccountsKey ?? `${options.rememberedAccountsKey ?? "solid-elements"}.recent-accounts`
    );
    const keyBase = options.dbName ?? "solid-auth-core";
    this.#navigate = options.navigate ?? ((url) => {
      globalThis.location?.assign(url);
    });
    this.#redirectStorage = options.redirectFlowStorage ?? defaultSessionStorage();
    this.#redirectFlowKey = options.redirectFlowKey ?? `${keyBase}.redirect-flow`;
    this.#redirectSentinelKey = options.redirectSentinelKey ?? `${keyBase}.redirect-sentinel`;
  }
  get publicFetch() {
    return this.#publicFetch;
  }
  get authenticatedFetch() {
    if (!this.#session) return this.#publicFetch;
    return this.#ownAuthenticatedFetch;
  }
  /**
   * The controller-owned authenticated fetch: run on the KNOWN-PRISTINE fetch and,
   * on a 401 from an allowed origin with a live session, attach the DPoP-bound token
   * (refreshing if expired) via the provider and retry ONCE. Never touches/reads the
   * global fetch, so it can't pick up another controller's patched global.
   */
  #ownAuthenticatedFetch = ((input, init) => this.#authenticatedFetchOver(this.#publicFetch, input, init));
  /**
   * The SINGLE authenticated-fetch implementation, run over an explicit `base` fetch.
   * Used by BOTH `.authenticatedFetch` (base = the known-pristine #publicFetch) AND the
   * `patchGlobalFetch` global wrapper (also base = #publicFetch, NOT the live global) —
   * so the global-patch path has the EXACT same credential boundary + DPoP-nonce handling
   * as the owned fetch, and crucially does NOT chain through a global another controller
   * patched (the roborev findings against the old ReactiveFetchManager path). For an
   * ALLOWED-origin request with a live session the token is attached PROACTIVELY (first
   * request, refreshing only on a KNOWN-passed expiry); a non-allowed origin / no session
   * is left unauthenticated (the foreign-origin boundary). RFC 9449 §8 resource-server
   * DPoP nonces are cached per-origin + embedded, and a 401 is retried ONCE.
   */
  async #authenticatedFetchOver(base, input, init) {
    const request = new Request(input, init);
    const provider = this.#provider;
    if (provider && await provider.matches(request)) {
      const retrySource = request.clone();
      const upgraded = await provider.upgrade(request);
      const response = await base(upgraded);
      const nonceChanged = provider.rememberNonce(response, request);
      if (response.status === 401 && (nonceChanged || await provider.matches(request))) {
        const pureNonceChallenge = nonceChanged && isUseDpopNonceChallenge(response);
        const retried = await provider.upgrade(retrySource, !pureNonceChallenge);
        const retryResponse = await base(retried);
        provider.rememberNonce(retryResponse, request);
        return retryResponse;
      }
      return response;
    }
    return base(request);
  }
  get webId() {
    return this.#session?.webId ?? null;
  }
  get issuer() {
    return this.#session?.issuer.href ?? null;
  }
  /** Session-change listeners (see {@link SolidAuth.onSessionChange}). */
  #sessionListeners = /* @__PURE__ */ new Set();
  onSessionChange(listener) {
    this.#sessionListeners.add(listener);
    return () => {
      this.#sessionListeners.delete(listener);
    };
  }
  /**
   * Notify listeners of the CURRENT identity after a state-settling operation
   * (login success / logout teardown / a resolved restore). A throwing listener
   * never disturbs the auth flow. Reads the live state at call time, so a
   * superseding op's listeners always see the winner's state.
   */
  #emitSessionChange() {
    const snapshot = { webId: this.webId };
    for (const listener of this.#sessionListeners) {
      try {
        listener(snapshot);
      } catch {
      }
    }
  }
  recentAccounts() {
    return this.#recentAccounts.list();
  }
  rememberAccount(webId, displayName, avatarUrl) {
    this.#recentAccounts.remember({
      webId,
      ...displayName !== void 0 ? { displayName } : {},
      ...avatarUrl !== void 0 ? { avatarUrl } : {}
    });
  }
  #safeReadRemembered() {
    try {
      return this.#remembered.read();
    } catch {
      return null;
    }
  }
  /**
   * Write the credential-free remembered pointer, SWALLOWING any storage error
   * (quota / private mode). This pointer is a convenience for next-load silent
   * restore — its write FAILING must NEVER make a SUCCESSFUL login/restore report
   * logged-out while the controller actually holds a live session (the roborev
   * finding). Worst case on failure: no silent restore next load (a re-login), never
   * an inconsistent reported state. (`RememberedAccount.write` already tries to
   * swallow, but we guard here too so the invariant doesn't depend on that.)
   */
  #safeWriteRemembered(webId, issuer) {
    try {
      this.#remembered.write(webId, issuer);
    } catch {
    }
  }
  /**
   * Controller-scoped SINGLE-FLIGHT restore. Two callers sharing ONE controller (e.g. two
   * panels, or a panel + an app on the same controller) must NOT run concurrent
   * refresh-token restores against the SAME stored credential: with refresh-token
   * ROTATION, one restore rotates the token, then the SECOND restore — having read the now
   * superseded old token — hits `invalid_grant` and DELETES the freshly-rotated credential,
   * leaving memory logged in but durable restore/refresh state wiped (the roborev race).
   * Sharing the in-flight promise makes concurrent callers observe ONE restore + result.
   */
  #restoreInFlightPromise;
  async restore() {
    if (this.#restoreInFlightPromise) return this.#restoreInFlightPromise;
    const run = this.#doRestore();
    this.#restoreInFlightPromise = run;
    try {
      const outcome = await run;
      this.#emitSessionChange();
      return outcome;
    } finally {
      if (this.#restoreInFlightPromise === run) this.#restoreInFlightPromise = void 0;
    }
  }
  // ESSENTIAL COMPLEXITY (intentionally over the cognitive-complexity warn threshold —
  // the linter flags it; that flag is a "review this carefully" signal, not a cleanup
  // target): every branch here guards a fail-closed silent-restore invariant — the
  // generation supersession fence around the awaited grant, the webid-mismatch teardown,
  // the tri-state credential-presence pointer decision. Each maps to an externally-
  // observable security property (never expose the wrong account, never restore a
  // logged-out pointer); collapsing one would change behaviour. Per the Brooks
  // essential-vs-accidental rule we PRESERVE + document + test it (the characterization +
  // auth-controller suites) rather than flatten it.
  async #doRestore() {
    const generation = this.#generation;
    const superseded = () => generation !== this.#generation;
    try {
      const record = this.#safeReadRemembered();
      const decision = await decideSilentRestore({
        lastActiveWebId: record?.webId,
        remembered: record ? [record] : [],
        // Pass the EXPECTED (remembered) WebID so #restoreIssuer only pins the session
        // AFTER confirming the restored WebID matches — so a mismatched credential is
        // never transiently exposed via controller.webId / authenticatedFetch during
        // the restore window (the roborev finding). decideSilentRestore also re-checks.
        restoreIssuer: (issuer) => this.#restoreIssuer(new URL(issuer), record?.webId),
        webIdsEqual
      });
      if (superseded()) {
        const current = this.#session?.webId ?? null;
        return current !== null ? { outcome: "restored", webId: current } : { outcome: "login" };
      }
      if (decision.outcome === "restored") {
        this.#safeWriteRemembered(decision.webId, decision.issuer);
        this.#recentAccounts.remember({ webId: decision.webId, displayName: decision.webId });
        return { outcome: "restored", webId: decision.webId };
      }
      if (decision.reason === "webid-mismatch") {
        this.#session = void 0;
        this.#generation++;
        this.#safeClearRemembered();
        if (record?.issuer) {
          try {
            await this.#forget(new URL(record.issuer));
          } catch {
          }
        }
        return { outcome: "login" };
      }
      const presence = record?.issuer ? await hasPersisted(this.#store, new URL(record.issuer)) : "absent";
      if (!superseded() && shouldDropRememberedPointer(decision.reason, presence)) {
        this.#safeClearRemembered();
      }
      return { outcome: "login" };
    } catch {
      return { outcome: "login" };
    }
  }
  /**
   * The thin restore wrapper the pure decision calls: redeem the persisted
   * refresh token for `issuer`, pin the rebuilt session in memory (so a later 401
   * upgrade reuses it), under the generation fence. Returns `{ webId }` or
   * undefined (nothing/dead/transient — all fail-closed in restoreSession).
   *
   * `expectedWebId` is the remembered WebID this restore is FOR: the session is pinned
   * ONLY after confirming the restored WebID matches it, so a mismatched credential is
   * never transiently exposed via `controller.webId` / `authenticatedFetch` during the
   * restore window. (decideSilentRestore also re-checks; this closes the pin-then-check
   * window.)
   */
  async #restoreIssuer(issuer, expectedWebId) {
    const generation = this.#generation;
    const guarded = this.#guardedStore(generation);
    const restored = await this.#withGrantAbort(
      (signal) => restoreSession({
        store: guarded.store,
        issuer,
        clientId: this.#clientId,
        callbackUri: this.#opts.callbackUri,
        allowInsecureLoopback: this.#opts.allowInsecureLoopback,
        signal,
        // Discovery + the grant use the pristine fetch (out of the reactive loop).
        fetch: this.#publicFetch
      })
    );
    if (!restored) return void 0;
    if (generation !== this.#generation) return void 0;
    if (!guarded.rotationPersisted()) return void 0;
    if (expectedWebId !== void 0 && expectedWebId !== null && !webIdsEqual(restored.webId, expectedWebId)) {
      return { webId: restored.webId };
    }
    try {
      validateWebId(restored.webId, this.#opts.allowInsecureLoopback ?? false);
    } catch {
      if (generation === this.#generation) await this.#forget(issuer);
      return void 0;
    }
    this.#pinRestoredSession(
      generation,
      issuer,
      restored.webId,
      restored.accessToken,
      restored.dpopKey,
      restored.expiresAt
    );
    return { webId: restored.webId };
  }
  #pinRestoredSession(generation, issuer, webId, accessToken, dpopKey, expiresAt) {
    this.#session = {
      generation,
      issuer,
      webId,
      accessToken,
      dpopKey,
      dpopHandle: oauth2.DPoP({}, dpopKey),
      allowedOrigins: this.#allowedOriginsFor(webId, issuer),
      ...expiresAt !== void 0 ? { expiresAt } : {},
      // Lazily discovered on first refresh; placeholders are never used directly.
      authorizationServer: { issuer: issuer.href },
      client: { client_id: this.#clientId ?? "" }
    };
    this.#ensureProvider();
  }
  /**
   * Refresh the live session's access token from the persisted refresh token (via
   * the audited {@link restoreSession} — discovery → reattach the bound key →
   * refresh grant → rotation + re-persist). Mutates the live session's access token
   * + expiry IN PLACE (the controller and the provider share the object reference),
   * under the generation fence. Single-flight so concurrent 401s share one refresh.
   * Returns true when the token was refreshed; false when it could not be (then the
   * caller attaches the existing token as a best effort).
   */
  // The single-flight refresh is SCOPED to the session it is refreshing — concurrent
  // 401s for the SAME session share it, but a NEW session (login/restore) is never
  // blocked behind a stale old-session refresh (it would otherwise reuse an expired
  // token until the old refresh resolved — the roborev finding). Cleared in `finally`.
  #refreshInFlight;
  async #refreshSession(session) {
    if (session.generation !== this.#generation) {
      return false;
    }
    if (this.#refreshInFlight && this.#refreshInFlight.session === session) {
      return this.#refreshInFlight.promise;
    }
    const generation = session.generation;
    const promise = (async () => {
      try {
        const guarded = this.#guardedStore(generation);
        const restored = await this.#withGrantAbort(
          (signal) => restoreSession({
            store: guarded.store,
            issuer: session.issuer,
            clientId: this.#clientId,
            callbackUri: this.#opts.callbackUri,
            allowInsecureLoopback: this.#opts.allowInsecureLoopback,
            signal,
            fetch: this.#publicFetch
            // out of the reactive loop
          })
        );
        if (!restored || this.#session !== session || !guarded.rotationPersisted()) {
          return false;
        }
        if (!webIdsEqual(restored.webId, session.webId)) {
          return false;
        }
        session.accessToken = restored.accessToken;
        session.expiresAt = restored.expiresAt;
        session.dpopKey = restored.dpopKey;
        session.dpopHandle = restored.dpopHandle;
        return true;
      } catch {
        return false;
      } finally {
        if (this.#refreshInFlight?.session === session) this.#refreshInFlight = void 0;
      }
    })();
    this.#refreshInFlight = { session, promise };
    return promise;
  }
  /**
   * The resource origins the session token may be attached to — the credential
   * boundary the provider enforces. Union of the configured {@link
   * SolidAuthConfig.allowedOrigins} plus (by default) the WebID's
   * origin and the issuer's origin. Fail-closed: an unparseable entry is skipped,
   * and an empty result means the token is attached to NOTHING.
   */
  #allowedOriginsFor(webId, issuer) {
    return computeAllowedOrigins({
      allowedOrigins: this.#opts.allowedOrigins,
      webId,
      issuer: issuer.href,
      includeWebIdOrigin: this.#opts.includeWebIdOrigin,
      includeIssuerOrigin: this.#opts.includeIssuerOrigin,
      allowInsecureLoopback: this.#opts.allowInsecureLoopback
    });
  }
  /**
   * Build the token PROVIDER once (used by our OWN authenticated fetch), and — only
   * when `patchGlobalFetch` is requested — install a CONTROLLER-OWNED global `fetch`
   * wrapper so bare `fetch()` callers also upgrade. `.authenticatedFetch` does NOT
   * depend on this (it uses the provider + the pristine fetch directly).
   *
   * IMPORTANT (the roborev findings): we do NOT use `ReactiveFetchManager` for the
   * global patch. That manager (a) captures the CURRENT `globalThis.fetch` as its base,
   * so if another controller/library already patched the global it would CHAIN through
   * that patched fetch — letting a bare `fetch()` be authenticated by ANOTHER session
   * before our provider runs (credential-boundary breach); and (b) passes only the
   * request to `provider.upgrade()`, discarding 401 response headers, so it cannot honour
   * RFC 9449 §8 resource-server DPoP-nonce challenges. Instead the global wrapper runs the
   * SAME {@link #authenticatedFetchOver} as `.authenticatedFetch`, ANCHORED on the
   * known-pristine {@link #publicFetch} (never the live, possibly-patched global) — so it
   * has the identical credential boundary + nonce handling and cannot pick up another
   * controller's patched global.
   */
  #ensureProvider() {
    if (!this.#provider) {
      this.#provider = new WebIdDPoPTokenProvider(
        () => this.#session,
        (session) => this.#refreshSession(session)
      );
    }
    if (this.#opts.patchGlobalFetch && typeof globalThis !== "undefined") {
      if (!this.#globalFetchWrapper) {
        this.#globalFetchWrapper = brandFetchWrapper(
          ((input, init) => this.#authenticatedFetchOver(this.#publicFetch, input, init)),
          this.#publicFetch
        );
      }
      if (globalThis.fetch !== this.#globalFetchWrapper) {
        globalThis.fetch = this.#globalFetchWrapper;
      }
    }
    return this.#provider;
  }
  // ESSENTIAL COMPLEXITY (intentionally over the cognitive-complexity warn threshold —
  // the linter flags it; that flag is a "review this carefully" signal, not a cleanup
  // target): login() is the credential-establishment epoch fence. Its branches enforce
  // the generation-supersession contract (a slower earlier attempt must never overwrite a
  // newer login's session / persisted credential / remembered pointer), the
  // drain-before-bump refresh-token-rotation lifecycle, the account-switch credential
  // cleanup (same- and cross-issuer), and the fail-closed re-sync of a survivor session
  // on a failed switch. Every branch maps to an observable cross-account credential-leak
  // / fail-closed property — collapsing one is a CVE, not a cleanup. Per the Brooks rule
  // it is PRESERVED + documented + exhaustively tested (the auth-controller suite), not
  // flattened. (Decomposition would only relocate the branches; the interleaved post-await
  // generation re-checks must stay co-located to be reviewable as one fence.)
  async login(webId) {
    this.#abortActiveLogin();
    while (this.#activeGrants.size > 0) {
      await this.#drainActiveGrants();
    }
    const generation = ++this.#generation;
    this.#abortActiveLogin();
    const priorSession = this.#session;
    const previousIssuer = priorSession?.issuer.href ?? this.#safeReadRemembered()?.issuer;
    const previousWebId = priorSession?.webId ?? this.#safeReadRemembered()?.webId;
    const targetWebId = webId ?? this.#safeReadRemembered()?.webId ?? this.#recentAccounts.list()[0]?.webId;
    try {
      if (!this.#opts.authFlow) {
        throw new MissingAuthFlowError();
      }
      if (!targetWebId) {
        throw new InvalidWebIdError(String(webId), "no WebID supplied");
      }
      const validated = validateWebId(targetWebId, this.#opts.allowInsecureLoopback ?? false);
      const issuer = await this.#resolveIssuer(validated);
      const session = await this.#authenticate(generation, issuer, validated);
      return await this.#finalizeAuthenticatedSession(
        generation,
        session,
        previousIssuer,
        previousWebId
      );
    } catch (e) {
      if (priorSession && this.#session === priorSession && generation === this.#generation) {
        priorSession.generation = this.#generation;
      }
      throw e;
    } finally {
      if (generation === this.#generation) this.#activeLoginAbort = void 0;
    }
  }
  /**
   * Establish an authenticated {@link LiveSession} into the controller: persist the
   * DPoP-bound refresh credential, pin the session + provider, write/clear the
   * silent-restore pointer, remember the account, run account-switch cleanup, and
   * emit the session-change event — all under the interleaved generation-supersession
   * fences. Shared by {@link login} (popup path) AND {@link completeRedirectLogin}
   * (full-page-redirect path): both authenticate a WebID and then need the IDENTICAL
   * post-auth establishment, so this is its ONE audited home rather than two copies of
   * the security-critical fence logic. Returns the {@link LoginResult}; throws the same
   * `AbortError` the callers propagate when a newer login/logout superseded this one.
   *
   * @param previousIssuer the issuer of the session/pointer this login is REPLACING
   *   (for cross-issuer credential cleanup); undefined when there is none.
   * @param previousWebId the WebID being replaced (gates the same-issuer account-switch
   *   cleanup so a plain same-WebID re-login never drops a still-valid credential).
   */
  // ESSENTIAL COMPLEXITY (intentionally over the cognitive-complexity warn threshold —
  // the linter flags it; that flag is a "review this carefully" signal, not a cleanup
  // target): every branch is a fail-closed cross-account credential-leak fence — the
  // interleaved post-await generation re-checks, the durable-vs-wrote persist split, the
  // same-/cross-issuer account-switch cleanup gated on a DIFFERENT WebID. This is the
  // VERBATIM block that previously lived inline in login() (extracted so the redirect
  // path reuses ONE audited copy); collapsing a branch is a CVE, not a simplification.
  async #finalizeAuthenticatedSession(generation, session, previousIssuer, previousWebId) {
    if (generation !== this.#generation) {
      throw new DOMException("Login superseded", "AbortError");
    }
    const { wrote: credentialWritten, durable: credentialRestorable } = await this.#persist(
      session,
      generation
    );
    if (generation !== this.#generation) {
      throw new DOMException("Login superseded", "AbortError");
    }
    session.refreshToken = void 0;
    this.#session = session;
    this.#ensureProvider();
    if (credentialRestorable) {
      this.#safeWriteRemembered(session.webId, session.issuer.href);
    } else {
      this.#safeClearRemembered();
    }
    this.#recentAccounts.remember({ webId: session.webId, displayName: session.webId });
    let normalizedPrevIssuer = null;
    try {
      normalizedPrevIssuer = previousIssuer ? new URL(previousIssuer).href : null;
    } catch {
      normalizedPrevIssuer = null;
    }
    if (normalizedPrevIssuer && normalizedPrevIssuer !== session.issuer.href) {
      try {
        await this.#forget(new URL(normalizedPrevIssuer));
      } catch {
      }
    } else if (!credentialWritten && normalizedPrevIssuer === session.issuer.href && previousWebId !== void 0 && !webIdsEqual(previousWebId, session.webId)) {
      try {
        await this.#forget(session.issuer);
      } catch {
      }
    }
    if (generation !== this.#generation || this.#session !== session) {
      throw new DOMException("Login superseded", "AbortError");
    }
    this.#emitSessionChange();
    return { webId: session.webId };
  }
  /** Abort the in-flight interactive login's popup (if any) and drop the handle. */
  #abortActiveLogin() {
    const abort = this.#activeLoginAbort;
    if (abort) {
      this.#activeLoginAbort = void 0;
      abort.abort();
    }
  }
  /**
   * Abort every in-flight refresh / silent-restore GRANT (logout / non-blocking supersede)
   * so a grant superseded mid-flight cancels its token-endpoint request rather than
   * redeeming the refresh token under a stale generation (the roborev finding).
   */
  #abortActiveGrants() {
    for (const g of this.#activeGrants) g.abort.abort();
  }
  /**
   * ABORT then AWAIT the in-flight grants to SETTLE — used by `login()` /
   * `completeRedirectLogin()` / `dropLiveSession()` BEFORE they bump the generation, so a
   * grant the OP already processed gets its rotation write to land under its still-valid
   * generation instead of being generation-skipped (the roborev finding). The abort
   * bounds the wait. Snapshot the set first (members remove themselves on settle).
   *
   * ONE PASS ONLY — every drain-before-bump call site MUST invoke this in an INLINE
   * `while (this.#activeGrants.size > 0)` loop (the dropLiveSession roborev follow-up): a
   * grant that registers DURING an awaited pass is missed by that pass's snapshot, and
   * the loop cannot live inside an async helper — the caller's `await` resumption would
   * add a microtask hop between the final empty-check and the bump, reopening the
   * window. Inline, loop-exit → bump is synchronous, so no grant can hold the
   * pre-bump generation past the bump.
   */
  async #drainActiveGrants() {
    if (this.#activeGrants.size === 0) return;
    const grants = [...this.#activeGrants];
    for (const g of grants) g.abort.abort();
    await Promise.allSettled(grants.map((g) => g.settled));
  }
  /** Run a refresh/restore grant under a tracked AbortController so supersession cancels it. */
  async #withGrantAbort(run) {
    const abort = new AbortController();
    let resolveSettled;
    const settled = new Promise((res) => {
      resolveSettled = res;
    });
    const entry = { abort, settled };
    this.#activeGrants.add(entry);
    try {
      return await run(abort.signal);
    } finally {
      this.#activeGrants.delete(entry);
      resolveSettled();
    }
  }
  async logout() {
    const issuer = this.#session?.issuer ?? this.#rememberedIssuer();
    this.#session = void 0;
    this.#generation++;
    this.#abortActiveLogin();
    this.#abortActiveGrants();
    this.#safeClearRemembered();
    this.#emitSessionChange();
    if (issuer) {
      const deleted = await this.#forget(issuer);
      if (!deleted) {
        throw new Error(
          "Logged out locally, but the persisted credential could not be deleted from durable storage (it may remain until the next successful logout / store write)."
        );
      }
    }
  }
  /**
   * Drop the LIVE in-memory session but KEEP the durable credential + the
   * silent-restore pointer — the TRANSIENT-failure teardown (see the interface doc
   * on {@link SolidAuth.dropLiveSession} for the dropLiveSession-vs-logout decision
   * rule). The next page load (or a later `restore()` on this controller) silently
   * re-establishes the session from the kept credential; `logout()` remains the
   * definitive teardown that deletes it.
   *
   * ORDERING (mirrors `login()`'s drain-before-bump, for the OPPOSITE reason
   * logout() skips it): logout deletes the credential anyway, so it may abort
   * in-flight grants and bump immediately. dropLiveSession's whole purpose is to keep
   * the credential RESTORABLE — so it must first ABORT + AWAIT the in-flight
   * refresh/restore grants (#drainActiveGrants). A grant the OP already processed
   * despite the abort then lands its rotation write under its STILL-VALID
   * generation; bumping first would generation-skip that write, leaving the store
   * holding the OLD (now server-spent) refresh token — the next load's silent
   * restore would hit `invalid_grant` and DELETE the credential, recreating the
   * exact permanent-re-login failure this method exists to prevent. A grant the
   * abort DID cancel never redeems the token at all (it stays unspent + valid).
   * The abort bounds the wait, so dropLiveSession resolves promptly.
   */
  async dropLiveSession() {
    this.#abortActiveLogin();
    while (this.#activeGrants.size > 0) {
      await this.#drainActiveGrants();
    }
    this.#session = void 0;
    this.#generation++;
    this.#abortActiveLogin();
    this.#emitSessionChange();
  }
  /**
   * @deprecated Renamed to {@link dropLiveSession}. Thin alias kept only so existing
   * consumers do not break; it delegates VERBATIM. Migrate to `dropLiveSession()`.
   */
  async dropSession() {
    return this.dropLiveSession();
  }
  /**
   * Widen the LIVE session's credential boundary with `origins` and re-arm it
   * atomically — an IN-MEMORY re-snapshot only, no token grant, no durable write.
   * Replaces the "widen an allowed-origins array then call restore() again to
   * re-snapshot" self-heal (which wastefully redeems + rotates the refresh token).
   * See {@link SolidAuth.reArmAllowedOrigins} for the full contract.
   *
   * ADDITIVE + SCOPED to the current live session: the admissible origins are
   * UNIONED into the session's boundary; the NEXT arm (a fresh login / silent
   * restore) recomputes the boundary from configuration alone, so a widened origin
   * can never silently carry across identities. Reassigns `session.allowedOrigins`
   * (never mutates the frozen-by-contract Set) — the provider reads it live via the
   * session getter, so the wider boundary takes effect immediately.
   *
   * Returns `true` iff there is a live session AND every given origin is now covered
   * (fail-closed: no session, or any cleartext/unparseable origin dropped → false).
   */
  reArmAllowedOrigins(origins) {
    const session = this.#session;
    if (!session) return false;
    const additions = computeAllowedOrigins({
      allowedOrigins: origins,
      includeWebIdOrigin: false,
      includeIssuerOrigin: false,
      allowInsecureLoopback: this.#opts.allowInsecureLoopback
    });
    session.allowedOrigins = /* @__PURE__ */ new Set([...session.allowedOrigins, ...additions]);
    return origins.every((origin) => isOriginAllowed(session.allowedOrigins, origin));
  }
  /**
   * Serialized durable delete (chained with persists so ordering is deterministic).
   * Returns whether the delete DURABLY SUCCEEDED (so logout() can surface a failure). We
   * call the store's `delete` DIRECTLY rather than `forgetPersisted` (which swallows store
   * errors and always "succeeds") — so a genuine delete fault is observable and logout no
   * longer silently reports complete while the credential lingers (the roborev finding).
   */
  async #forget(issuer) {
    const run = this.#persistChain.then(async () => {
      await this.#store.delete(issuer.href);
      return true;
    });
    this.#persistChain = run.then(
      () => void 0,
      () => void 0
    );
    return run.catch(() => false);
  }
  #rememberedIssuer() {
    const record = this.#safeReadRemembered();
    if (!record?.issuer) return void 0;
    try {
      return new URL(record.issuer);
    } catch {
      return void 0;
    }
  }
  #safeClearRemembered() {
    try {
      this.#remembered.clear();
    } catch {
    }
  }
  // ── Issuer resolution: WebID profile → solid:oidcIssuer (never regex) ──────
  async #resolveIssuer(webId) {
    const { dataset } = await fetchRdf(webId, { fetch: this.#profileFetch });
    const agent = new Agent(webId, dataset, DataFactory);
    const issuers = [...agent.oidcIssuer];
    if (issuers.length === 0) throw new NoSolidIssuerError(webId);
    if (issuers.length === 1) return new URL(issuers[0]);
    const choose = this.#opts.chooseIssuer;
    if (!choose) throw new AmbiguousIssuerError(webId, issuers);
    const chosen = await choose(issuers, webId);
    const chosenUrl = new URL(chosen);
    const advertised = issuers.some((i) => {
      try {
        return new URL(i).href.replace(/\/$/, "") === chosenUrl.href.replace(/\/$/, "");
      } catch {
        return false;
      }
    });
    if (!advertised) {
      throw new Error(
        `chooseIssuer returned an issuer (${chosen}) that the WebID profile does not advertise.`
      );
    }
    return chosenUrl;
  }
  #httpOptions(issuer) {
    if (this.#opts.allowInsecureLoopback && isLoopback2(issuer.hostname)) {
      return { [oauth2.allowInsecureRequests]: true };
    }
    return {};
  }
  /**
   * Resolve the OAuth client (static Client Identifier Document or dynamic reg).
   *
   * `overrides` (the FULL-PAGE-redirect path): the redirect login returns to the
   * APP ROOT, not the popup `callbackUri`, and may use a different `clientId`. When
   * a `redirectUri` distinct from `callbackUri` is passed it is registered ALONGSIDE
   * the callback (the OP rejects a redirect_uri it was never told about, so the
   * dynamic-registration path must register it; for a static client the document
   * itself must list it — the OP is authoritative off the document). With no
   * overrides the popup path is byte-identical to before.
   */
  async #resolveClient(authorizationServer, http, overrides) {
    const clientId = overrides?.clientId ?? this.#clientId;
    const redirectUri = overrides?.redirectUri ?? this.#opts.callbackUri;
    const redirectUris = redirectUri !== this.#opts.callbackUri ? [this.#opts.callbackUri, redirectUri] : [this.#opts.callbackUri];
    if (clientId !== void 0) {
      return {
        client_id: clientId,
        token_endpoint_auth_method: "none",
        redirect_uris: redirectUris,
        response_types: ["code"]
      };
    }
    const registrationResponse = await oauth2.dynamicClientRegistrationRequest(
      authorizationServer,
      {
        redirect_uris: redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      },
      { ...http, [oauth2.customFetch]: this.#oauthFetch() }
    );
    return oauth2.processDynamicClientRegistrationResponse(registrationResponse);
  }
  /** oauth4webapi customFetch bound to the pristine fetch (out of the reactive loop). */
  #oauthFetch() {
    const f = this.#publicFetch;
    return (url, opts) => f(url, opts);
  }
  /**
   * The token-endpoint client authentication for `client` (the roborev finding —
   * dynamic registration may return a CONFIDENTIAL client even though we request
   * `token_endpoint_auth_method: "none"`; RFC 7591 lets the OP override, and its
   * DEFAULT for a secret-issuing registration is `client_secret_basic`). Always
   * using `oauth.None()` would fail the code exchange against such an OP, and
   * dropping the method/secret at persist time would leave the refresh token
   * unredeemable on restore (the grant must authenticate as the SAME client —
   * RFC 6749 §6).
   *
   * Resolution (kept in lockstep with what @jeswr/solid-session-restore's restore
   * grant supports — `none` / `client_secret_basic` / `client_secret_post`):
   *   • no secret + method absent/`none`      → public (`None`), nothing persisted
   *   • secret + `client_secret_basic`/absent → Basic (7591 default), persisted
   *   • secret + `client_secret_post`         → Post, persisted
   *   • secret + explicit `none`              → public; the unused secret is NOT
   *     persisted (never store a credential the flows won't use)
   *   • a confidential method WITHOUT a secret, or any UNSUPPORTED method
   *     (`client_secret_jwt`, `private_key_jwt`, `tls_client_auth`, …) → throw a
   *     targeted error BEFORE the grant, so the misconfiguration is explicit
   *     rather than a confusing token-endpoint 401 now or a broken silent
   *     restore later.
   */
  #resolveClientAuth(issuer, client) {
    const method = client.token_endpoint_auth_method;
    const rawSecret = client.client_secret;
    const secret = typeof rawSecret === "string" && rawSecret.length > 0 ? rawSecret : void 0;
    const basicFor = clientSecretBasicFor2(issuer);
    if (method === void 0 || method === "none") {
      if (method === void 0 && secret !== void 0) {
        return {
          clientAuth: basicFor(secret),
          confidential: { tokenEndpointAuthMethod: "client_secret_basic", clientSecret: secret }
        };
      }
      return { clientAuth: oauth2.None() };
    }
    if (method === "client_secret_basic" || method === "client_secret_post") {
      if (secret === void 0) {
        throw new Error(
          `The identity provider registered this client for ${String(method)} but returned no client_secret \u2014 the token exchange cannot authenticate. (Incoherent dynamic registration; configure a static Client Identifier Document instead.)`
        );
      }
      return {
        clientAuth: method === "client_secret_basic" ? basicFor(secret) : oauth2.ClientSecretPost(secret),
        confidential: { tokenEndpointAuthMethod: method, clientSecret: secret }
      };
    }
    throw new Error(
      `The identity provider registered this client with token_endpoint_auth_method="${String(method)}", which this client (and its silent-restore grant) does not support \u2014 supported: none, client_secret_basic, client_secret_post. Configure a static Client Identifier Document (a public client) instead.`
    );
  }
  /**
   * The interactive authorization-code + PKCE + DPoP grant, requesting
   * `offline_access` so the OP issues a refresh token, then minting a DPoP-bound
   * access token. Drives `authFlow.getCode` for the popup; retries once without
   * `prompt=none` when the OP needs interaction.
   */
  async #authenticate(generation, issuer, expectedWebId) {
    const authFlow = this.#opts.authFlow;
    if (!authFlow) {
      throw new MissingAuthFlowError();
    }
    const baseHttp = this.#httpOptions(issuer);
    const customFetch3 = this.#oauthFetch();
    const http = { ...baseHttp, [oauth2.customFetch]: customFetch3 };
    const discoveryResponse = await oauth2.discoveryRequest(issuer, http);
    const authorizationServer = await oauth2.processDiscoveryResponse(issuer, discoveryResponse);
    const client = await this.#resolveClient(authorizationServer, baseHttp);
    const { clientAuth } = this.#resolveClientAuth(authorizationServer.issuer, client);
    const dpopKey = await oauth2.generateKeyPair("ES256", { extractable: false });
    const dpopHandle = oauth2.DPoP(client, dpopKey);
    let dpopJkt;
    try {
      dpopJkt = await dpopHandle.calculateThumbprint();
    } catch {
      dpopJkt = void 0;
    }
    const codeVerifier = oauth2.generateRandomCodeVerifier();
    const state = oauth2.generateRandomState();
    const nonce = oauth2.generateRandomNonce();
    const codeChallenge = await oauth2.calculatePKCECodeChallenge(codeVerifier);
    const buildUrl = (withPromptNone) => {
      const url = new URL(authorizationServer.authorization_endpoint);
      url.searchParams.set("client_id", client.client_id);
      url.searchParams.set("redirect_uri", this.#opts.callbackUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid webid offline_access");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("prompt", withPromptNone ? "none" : "select_account consent");
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      if (dpopJkt) url.searchParams.set("dpop_jkt", dpopJkt);
      return url;
    };
    const abort = new AbortController();
    if (generation === this.#generation) {
      this.#activeLoginAbort = abort;
    }
    const getCode = authFlow.getCode.bind(authFlow);
    const runLeg = async (withPromptNone) => {
      if (generation !== this.#generation) {
        abort.abort();
        throw new DOMException("Login superseded", "AbortError");
      }
      const code = await getCode(buildUrl(withPromptNone), abort.signal);
      if (generation !== this.#generation) {
        abort.abort();
        throw new DOMException("Login superseded", "AbortError");
      }
      const params = oauth2.validateAuthResponse(authorizationServer, client, new URL(code), state);
      const exchange = async () => {
        const tokenResponse = await oauth2.authorizationCodeGrantRequest(
          authorizationServer,
          client,
          // The resolved client auth: `None` for a public client (static
          // Client Identifier Document / public dynamic registration), Basic/
          // Post when the OP issued a confidential dynamic registration — the
          // exchange must authenticate as the client the OP actually minted
          // (the roborev finding).
          clientAuth,
          params,
          this.#opts.callbackUri,
          codeVerifier,
          // PKCE always on (S256) — never oauth.nopkce for a browser client
          { DPoP: dpopHandle, ...http }
        );
        return oauth2.processAuthorizationCodeResponse(authorizationServer, client, tokenResponse, {
          expectedNonce: nonce
        });
      };
      let tokenResult2;
      try {
        tokenResult2 = await exchange();
      } catch (e) {
        if (!oauth2.isDPoPNonceError(e)) throw e;
        tokenResult2 = await exchange();
      }
      if (tokenResult2.token_type.toLowerCase() !== "dpop") {
        throw new Error(
          `Expected a DPoP-bound token but the identity provider returned token_type="${tokenResult2.token_type}".`
        );
      }
      const webId2 = webIdFromClaims2(oauth2.getValidatedIdTokenClaims(tokenResult2));
      if (!webId2) {
        throw new Error("The identity provider did not return a WebID for this session.");
      }
      return { tokenResult: tokenResult2, webId: webId2 };
    };
    let result;
    let needInteractiveRetry = false;
    try {
      result = await runLeg(true);
      if (!webIdsEqual(result.webId, expectedWebId)) needInteractiveRetry = true;
    } catch (e) {
      if (!needsInteraction(e)) throw e;
      needInteractiveRetry = true;
    }
    if (needInteractiveRetry) {
      result = await runLeg(false);
    }
    const { tokenResult, webId } = result;
    if (!webIdsEqual(webId, expectedWebId)) {
      throw new Error(
        `Signed in as a different WebID than requested (asked for ${expectedWebId}, got ${webId}).`
      );
    }
    return {
      generation,
      issuer,
      webId,
      accessToken: tokenResult.access_token,
      dpopKey,
      dpopHandle,
      authorizationServer,
      client,
      allowedOrigins: this.#allowedOriginsFor(webId, issuer),
      expiresAt: expiresAtFrom2(tokenResult.expires_in),
      // Stash the refresh token transiently for persist(); cleared right after.
      refreshToken: tokenResult.refresh_token
    };
  }
  /**
   * Persist the DPoP-bound refresh token + key for silent restore next load.
   *
   * RETURNS a {@link PersistResult} distinguishing two DIFFERENT facts (conflating them
   * was a roborev finding):
   *   • `wrote` — a credential for THIS session was actually `put` into the store and
   *     survived (so the CURRENT, this-page session can refresh against it). True even
   *     for the in-memory fallback store (the put is real for the page lifetime).
   *   • `durable` — that credential will SURVIVE A RELOAD (restorable next load), which
   *     additionally requires a DURABLE store. This drives whether `login()` writes the
   *     SILENT-RESTORE pointer; a pointer to a non-restorable session would make the
   *     next load attempt silent restore and fall back.
   *
   * Both are false when: the OP issued NO refresh token; a LATER login/logout superseded
   * this attempt before/while writing; or the store `put` THREW. `wrote` is true but
   * `durable` false ONLY for a successful put to the NON-DURABLE in-memory fallback.
   *
   * SERIALIZED + generation-guarded (the roborev race fix): durable writes are
   * chained through {@link #persistChain} so they apply STRICTLY in call order, and
   * each write re-checks its login `generation` (synchronously, immediately before
   * issuing the store `put`, after acquiring its turn) — so a SUPERSEDED earlier
   * login's write is SKIPPED rather than landing after (and overwriting) a later
   * login's credential. Without this, two overlapping logins could race their async
   * `put`s and leave the WRONG (stale) refresh token persisted, breaking the next
   * silent restore.
   */
  #persistChain = Promise.resolve();
  async #persist(session, generation) {
    if (!session.refreshToken) return { wrote: false, durable: false };
    const confidential = this.#resolveClientAuth(session.authorizationServer.issuer, session.client).confidential ?? {};
    const run = this.#persistChain.then(async () => {
      if (generation !== this.#generation) return { wrote: false, durable: false };
      try {
        let previous;
        try {
          previous = await this.#store.get(session.issuer.href);
        } catch {
          previous = void 0;
        }
        const clientId = session.client.client_id;
        await this.#store.put({
          issuer: session.issuer.href,
          webId: session.webId,
          refreshToken: session.refreshToken,
          dpopKey: session.dpopKey,
          ...clientId !== void 0 && clientId !== "" ? { clientId } : {},
          // The confidential-client carry-forward (resolved above; empty for a
          // public client).
          ...confidential
        });
        if (generation !== this.#generation) {
          if (previous !== void 0) {
            await this.#store.put(previous).catch(() => {
            });
          } else {
            await this.#store.delete(session.issuer.href).catch(() => {
            });
          }
          return { wrote: false, durable: false };
        }
        return { wrote: true, durable: this.#storeIsDurable };
      } catch {
        return { wrote: false, durable: false };
      }
    });
    this.#persistChain = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  /**
   * Wrap the store so restoreSession's INTERNAL rotation-write (its own `put` after
   * a successful refresh grant) goes through the SAME serialized + generation-guarded
   * lifecycle as login/logout. Without this, a logout during an in-flight restore /
   * refresh could delete the credential and then the restore's rotation `put` could
   * re-persist it AFTER — leaving a durable session behind after sign-out (the roborev
   * finding). Reads pass through unchanged; BOTH mutations (`put` AND `delete`) are
   * chained + skipped when the generation has advanced (logout/relogin) since the
   * operation started — so a stale restore that hits `invalid_grant` cannot delete a
   * NEWER login's freshly-persisted credential, and a stale rotation cannot re-create
   * one a newer logout deleted.
   *
   * Returns the wrapped store PLUS a `rotationPersisted()` flag: whether restoreSession's
   * rotation `put` actually DURABLY SUCCEEDED (ran, was not generation-skipped, and did
   * not throw). The caller pins/applies the refreshed in-memory token ONLY when this is
   * true — otherwise the store would keep the OLD (now server-spent) refresh token while
   * memory ran on the new access token, stranding the session once that token expired
   * (the roborev finding). A store whose `put` throws (private mode / quota) therefore
   * does NOT desynchronise memory from durable state.
   */
  #guardedStore(generation) {
    const inner = this.#store;
    let rotationPersisted = false;
    const guard = (op, onPut) => {
      const run = this.#persistChain.then(async () => {
        if (generation !== this.#generation) return void 0;
        const result = await op();
        if (onPut) rotationPersisted = true;
        return result;
      });
      this.#persistChain = run.then(
        () => void 0,
        () => void 0
      );
      return run;
    };
    return {
      rotationPersisted: () => rotationPersisted,
      store: {
        get: (issuer) => inner.get(issuer),
        put: async (s) => {
          rotationPersisted = false;
          await guard(() => inner.put(s), true);
        },
        delete: async (issuer) => {
          await guard(() => inner.delete(issuer), false);
        }
      }
    };
  }
  // ── FULL-PAGE-redirect login (the `#autologin/<webid>` launch contract) ──────
  //
  // The redirect counterpart to the popup login(): it survives a full-page
  // navigation by persisting its in-between state (PKCE verifier + EXPORTED DPoP JWK
  // + state/nonce + the exact client/issuer/redirect_uri) to sessionStorage between
  // beginRedirectLogin (before the nav) and completeRedirectLogin (after the broker
  // redirects back). The pure decision/parsing/persist pieces live in ./redirect.ts;
  // the credential-redeeming machinery is HERE (it needs the engine's discovery,
  // client-auth resolution, pristine OIDC fetch, and session establishment). Every
  // OIDC hop rides the pristine #oauthFetch (the login-stall unrepresentability
  // guarantee) exactly like the popup path.
  hasPendingRedirect() {
    return readPersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey) !== null;
  }
  async beginRedirectLogin(options) {
    let issuer;
    let requestedWebId;
    if (options.webId !== void 0 && options.webId !== "") {
      const validated = validateWebId(options.webId, this.#opts.allowInsecureLoopback ?? false);
      issuer = await this.#resolveIssuer(validated);
      requestedWebId = validated;
    } else if (options.oidcIssuer !== void 0 && options.oidcIssuer !== "") {
      issuer = this.#requireSecureIssuer(options.oidcIssuer);
      requestedWebId = null;
    } else {
      throw new InvalidWebIdError("", "beginRedirectLogin requires a webId or an oidcIssuer");
    }
    const redirectUri = options.redirectUri ?? this.#opts.redirectUri ?? this.#opts.callbackUri;
    const prompt = options.prompt ?? "consent";
    const baseHttp = this.#httpOptions(issuer);
    const http = { ...baseHttp, [oauth2.customFetch]: this.#oauthFetch() };
    const discoveryResponse = await oauth2.discoveryRequest(issuer, http);
    const authorizationServer = await oauth2.processDiscoveryResponse(issuer, discoveryResponse);
    const client = await this.#resolveClient(authorizationServer, baseHttp, {
      clientId: options.clientId,
      redirectUri
    });
    const dpopKey = await oauth2.generateKeyPair("ES256", { extractable: true });
    const dpopHandle = oauth2.DPoP(client, dpopKey);
    let dpopJkt;
    try {
      dpopJkt = await dpopHandle.calculateThumbprint();
    } catch {
      dpopJkt = void 0;
    }
    const dpopPrivateJwk = await globalThis.crypto.subtle.exportKey("jwk", dpopKey.privateKey);
    const dpopPublicJwk = await globalThis.crypto.subtle.exportKey("jwk", dpopKey.publicKey);
    const codeVerifier = oauth2.generateRandomCodeVerifier();
    const state = oauth2.generateRandomState();
    const nonce = oauth2.generateRandomNonce();
    const codeChallenge = await oauth2.calculatePKCECodeChallenge(codeVerifier);
    const url = new URL(authorizationServer.authorization_endpoint);
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid webid offline_access");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("prompt", prompt === "none" ? "none" : "select_account consent");
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (dpopJkt) url.searchParams.set("dpop_jkt", dpopJkt);
    const flow = {
      dpopPrivateJwk,
      dpopPublicJwk,
      codeVerifier,
      state,
      nonce,
      issuer: issuer.href,
      client,
      redirectUri,
      webId: requestedWebId
    };
    writePersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey, flow);
    const authorizationUrl = url.toString();
    this.#navigate(authorizationUrl);
    return { authorizationUrl };
  }
  async completeRedirectLogin(callbackUrl = globalThis.location?.href ?? "") {
    const flow = readPersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey);
    if (!flow) {
      clearPersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey);
      throw new Error("No pending redirect login to complete (no persisted state found).");
    }
    try {
      this.#abortActiveLogin();
      while (this.#activeGrants.size > 0) {
        await this.#drainActiveGrants();
      }
      const generation = ++this.#generation;
      this.#abortActiveLogin();
      const priorSession = this.#session;
      const previousIssuer = priorSession?.issuer.href ?? this.#safeReadRemembered()?.issuer;
      const previousWebId = priorSession?.webId ?? this.#safeReadRemembered()?.webId;
      try {
        const session = await this.#exchangeRedirectCode(generation, flow, callbackUrl);
        return await this.#finalizeAuthenticatedSession(
          generation,
          session,
          previousIssuer,
          previousWebId
        );
      } catch (e) {
        if (priorSession && this.#session === priorSession && generation === this.#generation) {
          priorSession.generation = this.#generation;
        }
        throw e;
      } finally {
        if (generation === this.#generation) this.#activeLoginAbort = void 0;
      }
    } finally {
      clearPersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey);
    }
  }
  /**
   * The DPoP-bound authorization-code exchange for the FULL-PAGE-redirect path,
   * resuming purely from the persisted {@link PersistedRedirectFlow}: reconstruct the
   * EXACT client, re-import the DPoP key, VALIDATE the persisted `state`, exchange the
   * code (nonce-retry like #authenticate, `expectedNonce` = the persisted nonce),
   * ENFORCE the DPoP token type + the https WebID guard + the requested-WebID match
   * (all fail-closed BEFORE any session state is written), and return the
   * {@link LiveSession} for {@link #finalizeAuthenticatedSession} to establish.
   */
  async #exchangeRedirectCode(generation, flow, callbackUrl) {
    const issuer = new URL(flow.issuer);
    const baseHttp = this.#httpOptions(issuer);
    const http = { ...baseHttp, [oauth2.customFetch]: this.#oauthFetch() };
    const discoveryResponse = await oauth2.discoveryRequest(issuer, http);
    const authorizationServer = await oauth2.processDiscoveryResponse(issuer, discoveryResponse);
    if (generation !== this.#generation) throw new DOMException("Login superseded", "AbortError");
    const client = flow.client;
    const { clientAuth } = this.#resolveClientAuth(authorizationServer.issuer, client);
    const privateKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      flow.dpopPrivateJwk,
      ES256_JWK_IMPORT_ALG,
      false,
      ["sign"]
    );
    const publicKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      flow.dpopPublicJwk,
      ES256_JWK_IMPORT_ALG,
      true,
      ["verify"]
    );
    if (generation !== this.#generation) throw new DOMException("Login superseded", "AbortError");
    const dpopKey = { privateKey, publicKey };
    const dpopHandle = oauth2.DPoP(client, dpopKey);
    const params = oauth2.validateAuthResponse(
      authorizationServer,
      client,
      new URL(callbackUrl),
      flow.state
    );
    const exchange = async () => {
      const tokenResponse = await oauth2.authorizationCodeGrantRequest(
        authorizationServer,
        client,
        clientAuth,
        params,
        // The redirect_uri MUST be byte-identical to the authorization request's.
        flow.redirectUri,
        flow.codeVerifier,
        // PKCE always on (S256) — single-use against the code.
        { DPoP: dpopHandle, ...http }
      );
      return oauth2.processAuthorizationCodeResponse(authorizationServer, client, tokenResponse, {
        expectedNonce: flow.nonce
      });
    };
    let tokenResult;
    try {
      tokenResult = await exchange();
    } catch (e) {
      if (!oauth2.isDPoPNonceError(e)) throw e;
      tokenResult = await exchange();
    }
    if (generation !== this.#generation) throw new DOMException("Login superseded", "AbortError");
    if (tokenResult.token_type.toLowerCase() !== "dpop") {
      throw new Error(
        `Expected a DPoP-bound token but the identity provider returned token_type="${tokenResult.token_type}".`
      );
    }
    const claimedWebId = webIdFromClaims2(oauth2.getValidatedIdTokenClaims(tokenResult));
    if (!claimedWebId) {
      throw new Error("The identity provider did not return a WebID for this session.");
    }
    const webId = validateWebId(claimedWebId, this.#opts.allowInsecureLoopback ?? false);
    if (flow.webId !== null && !webIdsEqual(webId, flow.webId)) {
      throw new Error(
        `Signed in as a different WebID than requested (asked for ${flow.webId}, got ${webId}).`
      );
    }
    return {
      generation,
      issuer,
      webId,
      accessToken: tokenResult.access_token,
      dpopKey,
      dpopHandle,
      authorizationServer,
      client,
      allowedOrigins: this.#allowedOriginsFor(webId, issuer),
      expiresAt: expiresAtFrom2(tokenResult.expires_in),
      // Stash the refresh token transiently for #persist; cleared right after.
      refreshToken: tokenResult.refresh_token
    };
  }
  async handleRedirect(currentUrl = globalThis.location?.href ?? "") {
    try {
      const url = new URL(currentUrl);
      const fragmentWebId = parseAutologinFragment(url.hash);
      const plan = planRedirect({
        loggedIn: this.webId !== null,
        hasPendingRedirect: this.hasPendingRedirect(),
        hasCodeParams: hasAuthCodeParams(url.search),
        hasErrorParams: hasAuthErrorParams(url.search),
        fragmentWebId,
        sentinel: this.#readSentinel(),
        webIdsEqual
      });
      switch (plan.kind) {
        case "none": {
          const isRedirectReturn = hasAuthCodeParams(url.search) || hasAuthErrorParams(url.search);
          if (this.hasPendingRedirect()) {
            clearPersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey);
            this.#clearSentinel();
          }
          if (isRedirectReturn) {
            this.#cleanAddressBar(currentUrl);
          }
          if (isRedirectReturn && this.webId === null) {
            clearPersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey);
            return {
              outcome: "error",
              error: authErrorFrom(url.search) ?? "redirect_state_missing"
            };
          }
          return { outcome: "none" };
        }
        case "complete": {
          const result = await this.completeRedirectLogin(currentUrl);
          this.#clearSentinel();
          this.#cleanAddressBar(currentUrl);
          return { outcome: "completed", webId: result.webId };
        }
        case "abort": {
          const flow = readPersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey);
          const returnedState = new URLSearchParams(url.search).get("state");
          if (!flow || returnedState !== flow.state) {
            return { outcome: "none" };
          }
          const error = authErrorFrom(url.search) ?? "login_failed";
          clearPersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey);
          this.#clearSentinel();
          this.#cleanAddressBar(currentUrl);
          return { outcome: "error", error };
        }
        case "begin": {
          this.#writeSentinel(plan.webId);
          await this.beginRedirectLogin({
            webId: plan.webId,
            prompt: "none",
            redirectUri: this.#opts.redirectUri ?? cleanedUrl(currentUrl)
          });
          return { outcome: "redirecting" };
        }
        case "clear-sentinel": {
          this.#clearSentinel();
          return { outcome: "none" };
        }
      }
    } catch (e) {
      clearPersistedRedirectFlow(this.#redirectStorage, this.#redirectFlowKey);
      this.#clearSentinel();
      this.#cleanAddressBar(currentUrl);
      return { outcome: "error", error: e instanceof Error ? e.message : String(e) };
    }
  }
  /** Parse + require a SECURE (https, or loopback http under the opt-in) issuer URL. */
  #requireSecureIssuer(raw) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      throw new Error(`The OIDC issuer is not a valid URL: ${raw}`);
    }
    if (u.protocol === "https:") return u;
    if (u.protocol === "http:" && (this.#opts.allowInsecureLoopback ?? false) && isLoopback2(u.hostname)) {
      return u;
    }
    throw new Error(
      `The OIDC issuer must be https (http is allowed only for a loopback dev host with allowInsecureLoopback): ${raw}`
    );
  }
  /**
   * Scrub the OAuth callback params (`?code`/`?state`/`?error`) + fragment from the
   * address bar after a redirect return, via `history.replaceState` (no navigation, no
   * new history entry). Best-effort: a non-DOM host (SSR) / a `history` that throws is
   * simply skipped. Keeps the single-use code out of the visible URL + browser history
   * so a copy-paste / back-button cannot resurface it (the roborev finding).
   */
  #cleanAddressBar(currentUrl) {
    try {
      const cleaned = stripAuthCallbackParams(currentUrl);
      if (cleaned !== currentUrl) {
        globalThis.history?.replaceState(globalThis.history.state, "", cleaned);
      }
    } catch {
    }
  }
  /** The one-shot autologin loop-guard sentinel (best-effort; storage may be absent). */
  #readSentinel() {
    try {
      return this.#redirectStorage?.getItem(this.#redirectSentinelKey) ?? null;
    } catch {
      return null;
    }
  }
  #writeSentinel(webId) {
    try {
      this.#redirectStorage?.setItem(this.#redirectSentinelKey, webId);
    } catch {
    }
  }
  #clearSentinel() {
    try {
      this.#redirectStorage?.removeItem(this.#redirectSentinelKey);
    } catch {
    }
  }
};
var WebIdDPoPTokenProvider = class {
  #getSession;
  #refresh;
  /**
   * RFC 9449 §8 resource-server DPoP nonces, cached per RESOURCE ORIGIN. A protected
   * resource may REQUIRE the DPoP proof to carry a server-chosen `nonce` claim: it
   * answers an unaccompanied request with `401` + `WWW-Authenticate: DPoP
   * error="use_dpop_nonce"` and a `DPoP-Nonce` response header, and rotates that nonce
   * on subsequent responses. Without echoing it back the RS rejects every request even
   * with a perfectly fresh access token (the roborev finding). We key by origin (a
   * nonce is scoped to the issuing server) so the user's nonce for pod A is never sent
   * to pod B. {@link rememberNonce} feeds it from observed responses; {@link upgrade}
   * embeds the current one in the proof.
   */
  #nonces = /* @__PURE__ */ new Map();
  constructor(getSession, refresh) {
    this.#getSession = getSession;
    this.#refresh = refresh;
  }
  /** True only for an allowed-origin request while a session is live. */
  async matches(request) {
    return this.#allowed(this.#getSession(), request);
  }
  /**
   * Record a resource server's `DPoP-Nonce` for its origin (from a 401 challenge or a
   * rotated nonce on any response), so the NEXT proof to that origin embeds it. Only
   * stored for an ALLOWED origin with a live session — we never retain a nonce for an
   * origin the token is not attached to. Returns whether the stored nonce CHANGED (so
   * the caller can decide a 401 is worth retrying with the new nonce).
   */
  rememberNonce(response, request) {
    const nonce = response.headers.get("DPoP-Nonce");
    if (!nonce) return false;
    const session = this.#getSession();
    if (!this.#allowed(session, request)) return false;
    let origin;
    try {
      origin = new URL(request.url).origin;
    } catch {
      return false;
    }
    const changed = this.#nonces.get(origin) !== nonce;
    this.#nonces.set(origin, nonce);
    return changed;
  }
  /** The cached resource-server DPoP nonce for `url`'s origin, if any. */
  #nonceFor(url) {
    try {
      return this.#nonces.get(new URL(url).origin);
    } catch {
      return void 0;
    }
  }
  /**
   * Attach the session's DPoP-bound token to `request` (allowed-origin only).
   * `forceRefresh` separates the two call sites:
   *  - PROACTIVE first attach (false): refresh ONLY when a KNOWN expiry has passed —
   *    a provider that omits `expires_in` must NOT trigger a refresh on EVERY fetch
   *    (token-rotation / rate-limit risk); the existing token is attached as-is.
   *  - 401 RETRY (true): the server REJECTED the token, so refresh even when the
   *    expiry is unknown (the 401 is the proof the token is stale).
   */
  async upgrade(request, forceRefresh = false) {
    let session = this.#getSession();
    if (!this.#allowed(session, request) || !session) return request;
    if (shouldRefresh(session.expiresAt, forceRefresh)) {
      await this.#refresh(session);
      const current = this.#getSession();
      if (current !== session || !this.#allowed(current, request)) return request;
      session = current;
    }
    const headers = new Headers(request.headers);
    headers.set(
      "DPoP",
      await DPoP2.generateProof(
        session.dpopKey,
        // RFC 9449 §4.2: the `htu` claim is the request URI WITHOUT query + fragment.
        // Pass a normalized htu (query/hash stripped) so a protected request like
        // `…?q=…#frag` produces a valid proof the RS will accept.
        htuOf(request.url),
        request.method,
        // RFC 9449 §8: embed the resource server's cached `nonce` (from a prior
        // `use_dpop_nonce` 401 / a rotated `DPoP-Nonce` response header) so a server
        // that REQUIRES a nonce accepts the proof; `undefined` for servers that don't.
        this.#nonceFor(request.url),
        session.accessToken
      )
    );
    headers.set("Authorization", `DPoP ${session.accessToken}`);
    return new Request(request, { headers });
  }
  /** Whether `request`'s origin is in the live session's allowed set (fail-closed). */
  #allowed(session, request) {
    if (!session) return false;
    return isOriginAllowed(session.allowedOrigins, request.url);
  }
};
function shouldRefresh(expiresAt, force) {
  if (force) return true;
  if (expiresAt === void 0) return false;
  return Date.now() >= expiresAt;
}
var INTERACTION_REQUIRED_ERRORS = /* @__PURE__ */ new Set([
  "interaction_required",
  "login_required",
  "consent_required",
  "account_selection_required"
]);
function needsInteraction(e) {
  if (e instanceof oauth2.AuthorizationResponseError && INTERACTION_REQUIRED_ERRORS.has(e.error)) {
    return true;
  }
  try {
    const err = e.cause?.parameters?.get("error");
    return err !== void 0 && err !== null && INTERACTION_REQUIRED_ERRORS.has(err);
  } catch {
    return false;
  }
}
function webIdFromClaims2(claims) {
  if (!claims) return void 0;
  const webid = claims.webid;
  if (typeof webid === "string" && webid.length > 0) return webid;
  if (typeof claims.sub === "string" && claims.sub.length > 0) return claims.sub;
  return void 0;
}
function validateWebId(input, allowInsecureLoopback = false) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidWebIdError(input, "not a URL");
  }
  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:") {
    if (allowInsecureLoopback && isLoopback2(url.hostname)) return url.toString();
    throw new InvalidWebIdError(
      input,
      "must be https (http is allowed only for a loopback dev host with allowInsecureLoopback)"
    );
  }
  throw new InvalidWebIdError(input, "scheme must be https");
}

// src/proactive-fetch.ts
function isReactiveAuthResetError(e) {
  return e instanceof Error && e.name === "ReactiveAuthResetError";
}
function isProviderOAuthRequest(request, issuerOrigins) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (!issuerOrigins.has(url.origin)) return false;
  if (request.headers.has("dpop")) return true;
  const path = url.pathname.toLowerCase();
  return path.startsWith("/.well-known/") || path.startsWith("/.oidc/");
}
function deriveProactiveAllowedOrigins(inputs) {
  const allowedOrigins = [];
  if (inputs.podRoot) allowedOrigins.push(inputs.podRoot);
  if (inputs.extraOrigins) allowedOrigins.push(...inputs.extraOrigins);
  return computeAllowedOrigins({
    allowedOrigins,
    webId: inputs.webId,
    issuer: inputs.issuer,
    ...inputs.includeWebIdOrigin !== void 0 ? { includeWebIdOrigin: inputs.includeWebIdOrigin } : {},
    ...inputs.includeIssuerOrigin !== void 0 ? { includeIssuerOrigin: inputs.includeIssuerOrigin } : {},
    ...inputs.allowInsecureLoopback !== void 0 ? { allowInsecureLoopback: inputs.allowInsecureLoopback } : {}
  });
}
function shouldAttachToken(state, request) {
  if (!isOriginAllowed(state.allowedOrigins, request.url)) return false;
  if (state.issuerOrigins && isProviderOAuthRequest(request, state.issuerOrigins)) return false;
  if (state.canAttachNonInteractively && !state.canAttachNonInteractively(request)) return false;
  return true;
}
async function proactiveAuthenticatedFetch(state, base, input, init, config) {
  const isSuperseded = config?.isSuperseded ?? isReactiveAuthResetError;
  const request = new Request(input, init);
  const { provider } = state;
  if (!provider || !shouldAttachToken(state, request)) {
    return base(request);
  }
  const retrySource = request.clone();
  let upgraded;
  try {
    upgraded = await provider.upgrade(request);
  } catch (e) {
    if (isSuperseded(e)) return base(retrySource);
    throw e;
  }
  const response = await base(upgraded);
  if (response.status !== 401) return response;
  const pureNonce = isUseDpopNonceChallenge(response);
  if (!state.provider || !shouldAttachToken(state, retrySource)) {
    return base(retrySource);
  }
  const retryFallback = retrySource.clone();
  let retried;
  try {
    retried = await state.provider.upgrade(retrySource);
  } catch (e) {
    if (isSuperseded(e)) return base(retryFallback);
    throw e;
  }
  void pureNonce;
  return base(retried);
}
var globalInstallSingleton = null;
function installProactiveAuthFetch(options = {}) {
  const patchGlobal = options.patchGlobal !== false;
  if (patchGlobal && globalInstallSingleton) return globalInstallSingleton;
  const rawGlobal = globalThis.fetch;
  const resolvedGlobal = resolvePristineFetch(rawGlobal);
  const pristineFetch = options.pristineFetch !== void 0 ? resolvePristineFetch(options.pristineFetch) : resolvedGlobal === rawGlobal ? rawGlobal.bind(globalThis) : resolvedGlobal;
  const config = options.isSuperseded ? { isSuperseded: options.isSuperseded } : {};
  const state = {
    provider: options.initial?.provider ?? null,
    allowedOrigins: options.initial?.allowedOrigins ?? /* @__PURE__ */ new Set(),
    ...options.initial?.issuerOrigins !== void 0 ? { issuerOrigins: options.initial.issuerOrigins } : {},
    ...options.initial?.canAttachNonInteractively !== void 0 ? { canAttachNonInteractively: options.initial.canAttachNonInteractively } : {}
  };
  const wrapper = brandFetchWrapper(
    ((input, init) => proactiveAuthenticatedFetch(state, pristineFetch, input, init, config)),
    pristineFetch
  );
  if (patchGlobal) globalThis.fetch = wrapper;
  const install = {
    setState(next) {
      state.provider = next.provider;
      state.allowedOrigins = next.allowedOrigins;
      if (next.issuerOrigins !== void 0) state.issuerOrigins = next.issuerOrigins;
      else delete state.issuerOrigins;
      if (next.canAttachNonInteractively !== void 0) {
        state.canAttachNonInteractively = next.canAttachNonInteractively;
      } else {
        delete state.canAttachNonInteractively;
      }
    },
    fetch: wrapper,
    pristineFetch,
    patchedGlobal: patchGlobal
  };
  if (patchGlobal) globalInstallSingleton = install;
  return install;
}
function __resetProactiveFetchForTests() {
  globalInstallSingleton = null;
}

// src/types.ts
function sameWebId(a, b) {
  if (!a || !b) return false;
  return a.trim() === b.trim();
}
export {
  AUTOLOGIN_FRAGMENT_PREFIX,
  AmbiguousIssuerError,
  ES256_JWK_IMPORT_ALG,
  InvalidWebIdError,
  MissingAuthFlowError,
  NoSolidIssuerError,
  PRISTINE_BASE,
  WebIdDPoPTokenProvider,
  __resetProactiveFetchForTests,
  authErrorFrom,
  brandFetchWrapper,
  cleanedUrl,
  clearPersistedRedirectFlow,
  computeAllowedOrigins,
  createSolidAuth,
  deriveProactiveAllowedOrigins,
  hasAuthCodeParams,
  hasAuthErrorParams,
  htuOf,
  installProactiveAuthFetch,
  isOriginAllowed,
  isProviderOAuthRequest,
  isReactiveAuthResetError,
  isUseDpopNonceChallenge,
  parseAutologinFragment,
  parseWwwAuthenticate,
  planRedirect,
  proactiveAuthenticatedFetch,
  readPersistedRedirectFlow,
  resolvePristineFetch,
  sameWebId,
  stripAuthCallbackParams,
  validateWebId,
  writePersistedRedirectFlow
};
//# sourceMappingURL=index.js.map
