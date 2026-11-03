// AUTHORED-BY Codex GPT-6.1-Sol
import type { PodAuthOptions } from "./types.js";

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

export function validateOptions(options: PodAuthOptions): void {
  if (!options || typeof options !== "object") throw new TypeError("PodAuthOptions are required");
  if (typeof options.redirectUri !== "string") throw new TypeError("redirectUri is required");
  const insecure = options.allowInsecureLoopback === true;
  const redirect = secureUrl(options.redirectUri, insecure, "redirectUri");
  if (redirect.hash || redirect.search)
    throw new TypeError("redirectUri must not contain a query or fragment");
  const production =
    (globalThis as { process?: { env: { NODE_ENV?: string } } }).process?.env.NODE_ENV ===
    "production";
  if (insecure && (!isLoopback(redirect) || production))
    throw new TypeError("allowInsecureLoopback is for local development only");
  if (typeof globalThis.location !== "undefined" && globalThis.location.origin !== redirect.origin)
    throw new TypeError("redirectUri must use the application origin");
  if (typeof options.clientId === "string") {
    const client = secureUrl(options.clientId, false, "clientId");
    if (client.hash) throw new TypeError("clientId must not contain a fragment");
  } else if (
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
