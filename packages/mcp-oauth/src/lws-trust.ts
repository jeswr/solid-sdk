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
 * itself) must be inside a stored root. Any other realm is a storage description: it must share
 * the resource's origin and advertise a container root that lies inside a stored root and
 * contains the resource. A description can only name an audience inside the existing grant.
 */
export async function trustsLwsBinding(
  trust: LwsTrust,
  binding: { authorizationServer: URL; realm: URL; resource: URL },
  describedRoots: (storage: string) => Promise<readonly string[]>,
): Promise<boolean> {
  const { authorizationServer, realm, resource } = binding;
  if (!inRoots(trust.roots, resource) || !trustsExchangeOrigin(trust, authorizationServer))
    return false;
  if (realm.href.endsWith("/") || realm.href === resource.href) return inRoots(trust.roots, realm);
  if (realm.origin !== resource.origin) return false;
  return (await describedRoots(realm.href)).some(
    (root) =>
      root.endsWith("/") &&
      URL.canParse(root) &&
      inRoots(trust.roots, new URL(root)) &&
      isWithinPodScope(root, resource.href),
  );
}
