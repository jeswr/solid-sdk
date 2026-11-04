// AUTHORED-BY Claude Opus 5.5
import { accessRequestsEnabled } from "../permissions/view";

/** The capability flags the Requests surfaces depend on (03-home-permissions §6). */
export interface RequestCaps {
  accessRequests: boolean;
  /** WAC cannot enforce expiry, so expiring access is off unless the storage says otherwise. */
  grantExpiry: boolean;
}

/**
 * Server-provided overrides (`SUITE_TEST_CAPS`) win; the public build-time caps JSON the
 * Permissions page already honoured stays a fallback for the Requests flag.
 */
export function requestCaps(
  overrides: { accessRequests?: boolean | undefined; grantExpiry?: boolean | undefined },
  publicCaps?: string,
): RequestCaps {
  return {
    accessRequests: overrides.accessRequests ?? accessRequestsEnabled(publicCaps),
    grantExpiry: overrides.grantExpiry === true,
  };
}
