// AUTHORED-BY Claude Opus 5.5
import { isWithinPodScope } from "@jeswr/guarded-fetch";

/** What a pod session vouches for when answering an LWS token-exchange challenge. */
export interface LwsTrust {
  /** The session's verified OIDC issuer. */
  issuer: string;
  /** The session's storage roots, read from the verified WebID profile. */
  roots: readonly string[];
  /** Operator-configured LWS authorization servers on other origins. */
  authorizationServers: readonly string[];
}

const inRoots = (roots: readonly string[], url: URL) =>
  roots.some((root) => isWithinPodScope(root, url.href));

/** Origins that may receive the ID token: the issuer, a storage root, or a configured server. */
export function trustsExchangeOrigin(trust: LwsTrust, endpoint: URL): boolean {
  return [trust.issuer, ...trust.roots, ...trust.authorizationServers].some(
    (trusted) => new URL(trusted).origin === endpoint.origin,
  );
}

/**
 * The pod-auth exchange rule (#226) for a broker session. The resource must be inside a stored
 * root and the authorization server on a trusted origin. A container realm (or the resource
 * itself) must be inside a stored root; a storage-description realm must share the resource's
 * origin, where the engine then confirms the description lists a root containing the resource.
 */
export function trustsLwsBinding(
  trust: LwsTrust,
  binding: { authorizationServer: URL; realm: URL; resource: URL },
): boolean {
  const { authorizationServer, realm, resource } = binding;
  if (!inRoots(trust.roots, resource) || !trustsExchangeOrigin(trust, authorizationServer))
    return false;
  return realm.href.endsWith("/") || realm.href === resource.href
    ? inRoots(trust.roots, realm)
    : realm.origin === resource.origin;
}
