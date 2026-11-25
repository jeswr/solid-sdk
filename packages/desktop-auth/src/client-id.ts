// AUTHORED-BY Claude Opus 5.5
import { type ClientIdDocument, parseRedirect } from "@jeswr/suite-native";

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
  if (url.hash !== "") throw new TypeError(`${name} must not carry a fragment`);
  return url;
}

/**
 * The Solid-OIDC Client Identifier Document for a desktop app that signs in through the system
 * browser and a private-use scheme. `application_type: native` lets identity providers accept the
 * scheme redirect; pod-auth refuses dynamic registration and insecure loopback in this mode.
 * Serve the result at `clientId` as `application/ld+json`.
 */
export function desktopClientIdDocument(options: DesktopClientIdOptions): ClientIdDocument {
  const clientId = https(options.clientId, "clientId");
  // Exact string equality with the served URL: refuse anything URL parsing would rewrite.
  if (clientId.href !== options.clientId) throw new TypeError("clientId must be in normal form");
  if (clientId.search !== "") throw new TypeError("clientId must not carry a query");
  const clientUri = https(options.clientUri, "clientUri");
  const name = typeof options.clientName === "string" ? options.clientName.trim() : "";
  if (name === "" || name.length > 100) {
    throw new TypeError("clientName must be 1 to 100 characters");
  }
  const document: ClientIdDocument = {
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: clientId.href,
    client_name: name,
    client_uri: clientUri.href,
    application_type: "native",
    redirect_uris: [parseRedirect(options.redirectUri).href],
    scope: "openid webid offline_access",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    dpop_bound_access_tokens: true,
  };
  if (options.logoUri !== undefined) {
    const logo = https(options.logoUri, "logoUri");
    if (logo.origin !== clientId.origin) {
      throw new TypeError("logoUri must be on the clientId origin");
    }
    document.logo_uri = logo.href;
  }
  return document;
}
