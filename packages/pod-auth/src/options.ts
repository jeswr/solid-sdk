// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { FetchAccount, FetchForOptions, Identity, PodAuthOptions } from "./types.js";

/** Snapshot caller-selected origins before any asynchronous work. Exact origins exclude URL tricks. */
export function extraResourceOrigins(options?: FetchForOptions): readonly string[] {
  if (options === undefined) return [];
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== "extraResourceOrigins")
  )
    throw new TypeError("Invalid account fetch options");
  const origins = options.extraResourceOrigins;
  if (origins === undefined) return [];
  if (!Array.isArray(origins)) throw new TypeError("extraResourceOrigins must be an array");
  return origins.map((value: unknown) => {
    if (typeof value !== "string") throw new TypeError("Invalid resource origin");
    const url = secureUrl(value, false, "resource origin");
    // A DNS trailing dot names the same host under a different origin string, which would
    // let a credential-endpoint exclusion and the allowlist disagree about one server.
    if (value !== url.origin || url.hostname.includes("*") || url.hostname.endsWith("."))
      throw new TypeError("Resource origins must be canonical HTTPS origins");
    return value;
  });
}

/** Reject malformed selectors and stale handles without exposing either account. */
export function accountMatches(account: FetchAccount, identity: Identity | null): boolean {
  return (
    identity !== null &&
    account !== null &&
    typeof account === "object" &&
    account.webId === identity.webId &&
    account.issuer === identity.issuer
  );
}

export function isLoopback(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  );
}

export function secureUrl(value: string, insecure: boolean, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(insecure && url.protocol === "http:" && isLoopback(url)))
  )
    throw new TypeError(`${name} requires HTTPS (HTTP loopback requires allowInsecureLoopback)`);
  return url;
}

function nativeRedirectUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("redirectUri must be an absolute URI");
  }
  const scheme = value.slice(0, value.indexOf(":"));
  // Match suite-native's reverse-domain scheme grammar, using the raw spelling to require
  // lowercase. The required dot excludes reserved schemes (http, https, ws, file, data, etc.).
  if (!/^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]*[a-z0-9]$/.test(scheme))
    throw new TypeError("redirectUri must use a reverse-domain private-use scheme (RFC 8252 §7.1)");
  if (
    url.host !== "" ||
    value.startsWith(`${scheme}://`) ||
    !url.pathname.startsWith("/") ||
    value.includes("?") ||
    value.includes("#") ||
    url.href !== value
  )
    // No authority also excludes credentials. Check raw delimiters, including empty ? and #,
    // and reject normalization so the native driver's href and the registered URI stay exact.
    throw new TypeError(
      "redirectUri must be <scheme>:/<path> with no authority, credentials, query or fragment, and no URL normalization",
    );
  return url;
}

export function validateOptions(options: PodAuthOptions): void {
  if (!options || typeof options !== "object") throw new TypeError("PodAuthOptions are required");
  if (typeof options.redirectUri !== "string") throw new TypeError("redirectUri is required");
  if (options.nativeRedirect !== undefined && options.nativeRedirect !== true)
    throw new TypeError("nativeRedirect must be true when supplied");
  const native = options.nativeRedirect === true;
  const insecure = options.allowInsecureLoopback === true;
  const redirect = native
    ? nativeRedirectUrl(options.redirectUri)
    : secureUrl(options.redirectUri, insecure, "redirectUri");
  if (redirect.hash || redirect.search)
    throw new TypeError("redirectUri must not contain a query or fragment");
  const production =
    (globalThis as { process?: { env: { NODE_ENV?: string } } }).process?.env.NODE_ENV ===
    "production";
  if (insecure && (native || !isLoopback(redirect) || production))
    throw new TypeError("allowInsecureLoopback is for local development only");
  if (
    !native &&
    typeof globalThis.location !== "undefined" &&
    globalThis.location.origin !== redirect.origin
  )
    throw new TypeError("redirectUri must use the application origin");
  if (typeof options.clientId === "string") {
    const client = secureUrl(options.clientId, false, "clientId");
    if (client.hash) throw new TypeError("clientId must not contain a fragment");
  } else if (
    native ||
    !options.clientId ||
    options.clientId.dynamicRegistration !== true ||
    Object.keys(options.clientId).length !== 1 ||
    !isLoopback(redirect) ||
    production
  ) {
    throw new TypeError("dynamicRegistration is allowed only for loopback development");
  }
  if (
    typeof options.ui?.getWebId !== "function" ||
    typeof options.ui?.getCode !== "function" ||
    (options.ui.chooseIssuer !== undefined && typeof options.ui.chooseIssuer !== "function")
  )
    throw new TypeError("ui requires getWebId, getCode and an optional chooseIssuer function");
  if (options.clock !== undefined && typeof options.clock !== "function")
    throw new TypeError("clock must be a function");
  if (
    options.maxReplayBodyBytes !== undefined &&
    (!Number.isSafeInteger(options.maxReplayBodyBytes) || options.maxReplayBodyBytes < 0)
  )
    throw new TypeError("maxReplayBodyBytes must be a non-negative safe integer");
  if (options.boundary?.automatic !== undefined && typeof options.boundary.automatic !== "boolean")
    throw new TypeError("boundary.automatic must be boolean");
  if (options.boundary?.eligible !== undefined && typeof options.boundary.eligible !== "function")
    throw new TypeError("boundary.eligible must be a function");
  if (
    options.boundary?.roots !== undefined &&
    (!Array.isArray(options.boundary.roots) ||
      options.boundary.roots.some((r) => typeof r !== "string"))
  )
    throw new TypeError("boundary.roots must be an array of URLs");
  for (const root of options.boundary?.roots ?? []) secureUrl(root, insecure, "boundary root");
  storageEndpointPaths(options.boundary?.storageEndpoints);
  if (options.lws !== undefined && options.lws.subject !== "oidc-id-token")
    validateCid(options.lws.subject?.cid);
  if (options.storage !== undefined) {
    for (const store of [options.storage.sessions, options.storage.caches]) {
      if (
        !store ||
        typeof store.getItem !== "function" ||
        typeof store.setItem !== "function" ||
        typeof store.removeItem !== "function"
      )
        throw new TypeError("storage requires sessions and caches key-value stores");
    }
  }
}

export function validateCid(cid: import("./types.js").CidSubject): void {
  if (!cid) throw new TypeError("CID subject is required");
  const document = secureUrl(cid.documentUrl, false, "CID document");
  const keyId = secureUrl(cid.keyId, false, "CID keyId");
  const keyDocument = new URL(keyId);
  keyDocument.hash = "";
  if (document.hash || !keyId.hash || keyDocument.href !== document.href)
    throw new TypeError("CID keyId must name a verification method in the CID document");
  const key = cid.privateKey;
  if (
    !(key instanceof CryptoKey) ||
    key.type !== "private" ||
    key.extractable ||
    key.algorithm.name !== "ECDSA" ||
    (key.algorithm as EcKeyAlgorithm).namedCurve !== "P-256" ||
    !key.usages.includes("sign")
  )
    throw new TypeError("CID requires a non-extractable ES256 private signing key");
}

/** Validate and copy storage endpoint paths; read once so a getter cannot swap them later. */
export function storageEndpointPaths(value: unknown): readonly string[] {
  if (value === undefined) return [];
  const paths = Array.isArray(value) ? [...value] : undefined;
  if (
    paths === undefined ||
    paths.some(
      (path) =>
        typeof path !== "string" ||
        !path.startsWith("/") ||
        path.startsWith("//") ||
        /[?#\\@]|(?:^|\/)\.\.?(?:\/|$)/u.test(path) ||
        new URL(path, "https://origin.invalid").pathname !== path,
    )
  )
    throw new TypeError("boundary.storageEndpoints must be absolute, normalised paths");
  return Object.freeze(paths as string[]);
}
