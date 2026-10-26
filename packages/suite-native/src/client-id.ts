// AUTHORED-BY Claude Opus 5.5

/** The suite apps' private-use redirect URI (RFC 8252 §7.1, reverse domain of jeswr.org). */
export const MOBILE_REDIRECT_URI = "org.jeswr.suite:/oauth/callback";

/** Where the suite origin serves the mobile Client Identifier Document (beside ADR-004 D7's web one). */
export const MOBILE_CLIENT_ID_PATH = "/.well-known/solid-client-id-mobile.jsonld";

export interface MobileClientIdOptions {
  /** The suite origin serving the document, e.g. `https://suite.example`. */
  origin: string;
  clientName?: string;
  redirectUri?: string;
  /** Path of the logo on the suite origin. */
  logoPath?: string;
}

export interface ClientIdDocument {
  "@context": string[];
  client_id: string;
  client_name: string;
  client_uri: string;
  logo_uri?: string;
  application_type: "native";
  redirect_uris: string[];
  scope: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The Solid-OIDC Client Identifier Document for the native apps: `application_type: native` so
 * identity providers accept the private-use scheme redirect. `client_id` equals the URL it is
 * served at, which is derived from the one trusted `origin` input.
 */
export function mobileClientIdDocument(options: MobileClientIdOptions): ClientIdDocument {
  const origin = new URL(options.origin);
  const local = origin.protocol === "http:" && LOOPBACK.has(origin.hostname);
  if (origin.protocol !== "https:" && !local) throw new TypeError("origin must be https");
  if (origin.href !== `${origin.origin}/`) throw new TypeError("origin must be a bare origin");
  const base = origin.origin;
  const document: ClientIdDocument = {
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: `${base}${MOBILE_CLIENT_ID_PATH}`,
    client_name: options.clientName ?? "Solid Suite",
    client_uri: `${base}/`,
    application_type: "native",
    redirect_uris: [options.redirectUri ?? MOBILE_REDIRECT_URI],
    scope: "openid webid offline_access",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  if (options.logoPath !== undefined) {
    if (!options.logoPath.startsWith("/")) throw new TypeError("logoPath must start with /");
    document.logo_uri = new URL(options.logoPath, base).href;
  }
  return document;
}
