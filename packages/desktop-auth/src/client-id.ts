// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Claude Sonnet 5.5
import { type ClientIdDocument, nativeClientIdDocument, parseRedirect } from "@jeswr/suite-native";

export interface DesktopClientIdOptions {
  /**
   * The HTTPS URL the document will be served at. It is the OAuth `client_id`, so it must match
   * the served URL byte for byte, for example
   * `https://example.github.io/app/solid-client-id.jsonld`.
   */
  clientId: string;
  /** The app's name, shown by identity providers on the consent screen. */
  clientName: string;
  /** The app's home page (HTTPS). */
  clientUri: string;
  /** The private-use scheme redirect, for example `ai.artcraft.app:/oauth/callback`. */
  redirectUri: string;
  /** An HTTPS logo URL on the same origin as `clientId`. */
  logoUri?: string;
}

function https(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "https:") throw new TypeError(`${name} must use https`);
  if (url.username !== "" || url.password !== "") {
    throw new TypeError(`${name} must not carry credentials`);
  }
  // An empty fragment (`#`) leaves `hash` empty but stays in `href`.
  if (url.hash !== "" || value.includes("#")) {
    throw new TypeError(`${name} must not carry a fragment`);
  }
  // Exact string equality with what is published: refuse anything URL parsing would rewrite.
  if (url.href !== value) throw new TypeError(`${name} must be in normal form`);
  return url;
}

/** C0 and C1 controls and the Unicode bidi controls, none of which belong in a consent screen. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x61c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

/** No identity provider can fetch a document from the local machine or a bare IP address. */
function isUnfetchableHost(hostname: string): boolean {
  const host = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.startsWith("[") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * The Solid-OIDC Client Identifier Document for a desktop app that signs in through the system
 * browser and a private-use scheme. `application_type: native` lets identity providers accept the
 * scheme redirect; pod-auth refuses dynamic registration and insecure loopback in this mode.
 * Serve the result at `clientId` as `application/ld+json`. Inputs are refused, not normalised:
 * what is published must be exactly what was written.
 */
export function desktopClientIdDocument(options: DesktopClientIdOptions): ClientIdDocument {
  const clientId = https(options.clientId, "clientId");
  if (clientId.search !== "") throw new TypeError("clientId must not carry a query");
  if (isUnfetchableHost(clientId.hostname)) {
    throw new TypeError("clientId must be a public host name, not localhost or an IP address");
  }
  const clientUri = https(options.clientUri, "clientUri");
  if (typeof options.clientName !== "string" || hasControlCharacter(options.clientName)) {
    throw new TypeError("clientName must not contain control characters");
  }
  const name = options.clientName.trim();
  if (name === "" || name.length > 100) {
    throw new TypeError("clientName must be 1 to 100 characters");
  }
  const redirect = parseRedirect(options.redirectUri);
  if (
    redirect.href !== options.redirectUri ||
    options.redirectUri.includes("#") ||
    options.redirectUri.slice(redirect.protocol.length).includes("//")
  ) {
    throw new TypeError("redirectUri must be in normal form, as <scheme>:/<path>");
  }
  let logoUri: string | undefined;
  if (options.logoUri !== undefined) {
    const logo = https(options.logoUri, "logoUri");
    if (logo.origin !== clientId.origin) {
      throw new TypeError("logoUri must be on the clientId origin");
    }
    logoUri = logo.href;
  }
  return nativeClientIdDocument({
    clientId: clientId.href,
    clientName: name,
    clientUri: clientUri.href,
    redirectUri: redirect.href,
    logoUri,
  });
}
