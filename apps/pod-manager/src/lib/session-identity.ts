// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import { resolveIssuers } from "./login-ux";
import { fetchProfile, readProfile, type PodProfile } from "./profile";
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

/** Load the committed profile and clear credentials if a newly claimed identity fails validation. */
export async function loginProfile(
  webId: string,
  issuer: string,
  profileWebId: string | undefined,
  provider: { forgetIssuer(issuer: URL): Promise<void> },
  fetchImpl?: typeof fetch,
): Promise<PodProfile> {
  if (webId === profileWebId) return fetchProfile(webId, fetchImpl);
  try {
    const { dataset, url } = await freshRdf(webId, fetchImpl);
    // A profile used to choose the issuer says nothing about a different claimed WebID.
    assertIssuerAuthority(webId, issuer, dataset);
    const document = new URL(url);
    document.hash = "";
    return { ...readProfile(webId, dataset), profileDocumentUrl: document.href };
  } catch {
    await provider.forgetIssuer(new URL(issuer));
    throw new WebIdIssuerAuthorityError(webId, issuer);
  }
}
