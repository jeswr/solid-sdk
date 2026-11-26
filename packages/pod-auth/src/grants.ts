// AUTHORED-BY Claude Opus 5.5
import { CredentialBoundary } from "@jeswr/reactive-authentication";

/**
 * A resource on someone else's storage that the signed-in user explicitly chose to open with
 * their account. `root` is a container (trailing `/`, covering its descendants) or one exact
 * resource. Grants live in memory, per signed-in account, and end at logout or session change.
 */
export interface ResourceGrant {
  readonly root: string;
  readonly origin: string;
  /** Milliseconds since the epoch, from the core's clock. */
  readonly created: number;
}

/** Why {@link PodAuth.grantResource} refused a grant. */
export type ResourceGrantRefusal =
  /** No signed-in account, or the session ended or changed while the grant was checked. */
  | "signed-out"
  /** The browser reports no transient user activation: grants need a user gesture. */
  | "no-user-activation"
  /** Not a canonical HTTPS URL (loopback HTTP only in development), or the app's eligibility filter refused it. */
  | "invalid-url"
  /** The whole origin (path `/`); grant the shared container or resource instead. */
  | "origin-wide"
  /** It contains the user's issuer or an identity-provider endpoint. */
  | "protocol-endpoint"
  /** It lies inside, or contains, the user's own storage, which needs no grant. */
  | "own-storage";

export class ResourceGrantError extends Error {
  constructor(readonly reason: ResourceGrantRefusal) {
    super(`Resource grant refused: ${reason}`);
    this.name = "ResourceGrantError";
  }
}

/**
 * Whether `url` falls inside one of `grants`, using the credential boundary's own matching:
 * same origin, a container prefix on whole path segments or the exact resource (ignoring its
 * query and fragment), and no encoded separators or dot segments. Pure and synchronous, so
 * queued work (an offline outbox, for example) can drop entries whose grant has gone.
 */
export function withinResourceGrants(
  grants: readonly Pick<ResourceGrant, "root">[],
  url: string | URL,
): boolean {
  try {
    return new CredentialBoundary(
      grants.map((grant) => grant.root),
      // A loopback HTTP grant only exists in development; HTTPS grants never match HTTP URLs.
      { allowInsecureHttp: true },
    ).allows(url);
  } catch {
    return false;
  }
}
