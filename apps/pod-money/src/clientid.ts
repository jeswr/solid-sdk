// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Client Identifier Document — the static clientid.jsonld an app serves at its
// client_id URL. Carries the Solid-OIDC client metadata AND the fedapp: block
// from https://w3id.org/jeswr/fed so the federation registry can read which
// sector Pod Money operates in and which classes it consumes / produces —
// WITHOUT trusting any self-asserted membership (membership is the registry's
// job after a signed challenge).
//
// The document is produced from the vocabulary constants (never hand-typed
// IRIs) and is round-trip-validated as RDF in the test suite.

import { FinClass } from "./vocab.js";

const ACL = "http://www.w3.org/ns/auth/acl#" as const;
const FEDAPP = "https://w3id.org/jeswr/fed#" as const;
const SECTOR_FINANCE = "https://w3id.org/jeswr/sectors/finance#sector" as const;

/** Inputs that vary per deployment (the served origin). */
export interface ClientIdOptions {
  /** The client_id IRI — the URL the document is served from. */
  clientId: string;
  /** Human-readable application name shown on the OIDC consent screen. */
  clientName?: string;
  /** OAuth redirect URIs. */
  redirectUris: string[];
  /** Public homepage / client URI. */
  clientUri?: string;
  /** Logo URI. */
  logoUri?: string;
}

/**
 * Build the Client Identifier Document as a JSON-LD object. The `@context`
 * mixes the Solid-OIDC client context with the fedapp / acl namespaces so the
 * federation block parses into the canonical fedapp: triples.
 */
export function buildClientIdDocument(options: ClientIdOptions): Record<string, unknown> {
  const { clientId, clientName = "Pod Money", redirectUris, clientUri, logoUri } = options;

  const doc: Record<string, unknown> = {
    "@context": [
      "https://www.w3.org/ns/solid/oidc-context.jsonld",
      {
        fedapp: FEDAPP,
        acl: ACL,
        sectors: "https://w3id.org/jeswr/sectors/",
        "fedapp:sector": { "@type": "@id" },
        "fedapp:access": { "@type": "@id" },
        "fedapp:consumes": { "@type": "@id" },
        "fedapp:produces": { "@type": "@id" },
      },
    ],
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid profile offline_access webid",
    token_endpoint_auth_method: "none",
    // --- the fedapp: federation-registration block ---
    "@type": ["fedapp:App"],
    "fedapp:sector": SECTOR_FINANCE,
    "fedapp:access": [`${ACL}Read`, `${ACL}Write`, `${ACL}Append`],
    "fedapp:consumes": [FinClass.Transaction, FinClass.FinancialAccount],
    "fedapp:produces": [FinClass.Transaction, FinClass.FinancialAccount, FinClass.Balance],
  };

  if (clientUri !== undefined) doc.client_uri = clientUri;
  if (logoUri !== undefined) doc.logo_uri = logoUri;

  return doc;
}

/** Serialise the Client Identifier Document to a pretty JSON string. */
export function clientIdJson(options: ClientIdOptions): string {
  return `${JSON.stringify(buildClientIdDocument(options), null, 2)}\n`;
}

/** The fedapp / sector / acl IRIs published, exposed for tests + tooling. */
export const Federation = {
  app: `${FEDAPP}App`,
  sectorFinance: SECTOR_FINANCE,
  aclRead: `${ACL}Read`,
  aclWrite: `${ACL}Write`,
  aclAppend: `${ACL}Append`,
  sectorProperty: `${FEDAPP}sector`,
  accessProperty: `${FEDAPP}access`,
  consumesProperty: `${FEDAPP}consumes`,
  producesProperty: `${FEDAPP}produces`,
} as const;
