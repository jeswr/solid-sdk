// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import { resolveIssuers } from "./login-ux";
import { readProfile, type PodProfile } from "./profile";
import { freshRdf } from "./rdf-read";

/** Reconcile a remembered pointer with the identity actually authenticated on reload. */
export function restoredIdentity(
  remembered: string,
  restored: { webId: string } | undefined,
): string {
  return restored?.webId ?? remembered;
}

/** An issuer claimed an identity whose own profile does not authorize that issuer. */
export class WebIdIssuerAuthorityError extends Error {
  constructor(webId: string, issuer: string) {
    super(`Cannot sign in as ${webId}: its profile must authorize the Solid OIDC issuer ${issuer}.`);
    this.name = "WebIdIssuerAuthorityError";
  }
}

/** Require the claimed WebID's own issuer relationship, tolerating a trailing slash. */
export function assertIssuerAuthority(webId: string, issuer: string, dataset: DatasetCore): void {
  const normalized = (value: string) => {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.href;
  };
  try {
    if (resolveIssuers(webId, dataset).some((value) => normalized(value) === normalized(issuer))) return;
  } catch {
    // Missing or malformed issuer statements cannot establish authority.
  }
  throw new WebIdIssuerAuthorityError(webId, issuer);
}

/** Validate the published identity and clear only credentials owned by this operation. */
export async function loginProfile(
  webId: string,
  issuer: string,
  ownership: number | undefined,
  provider: { forgetIssuerIfOwned(issuer: URL, ownership: number): Promise<void> },
  fetchImpl?: typeof fetch,
  isCurrent: () => boolean = () => true,
): Promise<PodProfile> {
  try {
    const { dataset, url } = await freshRdf(webId, fetchImpl);
    if (!isCurrent()) throw new Error("Superseded profile validation");
    assertIssuerAuthority(webId, issuer, dataset);
    const document = new URL(url);
    document.hash = "";
    return { ...readProfile(webId, dataset), profileDocumentUrl: document.href };
  } catch {
    if (isCurrent() && ownership !== undefined) {
      await provider.forgetIssuerIfOwned(new URL(issuer), ownership);
    }
    throw new WebIdIssuerAuthorityError(webId, issuer);
  }
}
