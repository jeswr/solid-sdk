// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// session-derivation.ts — derive the values the host needs (the pod ROOT URL +
// the WebID + the profile display name/avatar) from the authenticated profile.
//
// POD-ROOT DERIVATION (first that yields a value):
//   1. the FIRST `pim:storage` advertised on the WebID profile (the canonical
//      Solid signal for "where this user's storage lives"). Most pods (CSS, PSS,
//      ESS) advertise exactly one; we take the first and note multi-storage as a
//      follow-up (a storage picker).
//   2. fallback: the WebID's ORIGIN + "/" — a reasonable guess when a profile
//      omits pim:storage (e.g. a bare CSS profile). The data layer's scope guard
//      still protects every read, so a wrong guess fails closed, not silently.
import type { Profile } from "./profile";

export interface DerivedSession {
  /** The pod root URL (always ends in "/"). The health resource is resolved under it. */
  podRoot: string;
  /** The authenticated user's WebID. Passed to discovery + shown in the header. */
  webId: string;
  /** True when the pod root came from the WebID origin fallback, not pim:storage. */
  podRootIsFallback: boolean;
  /**
   * The profile's human display name (foaf:name), for the header AccountMenu.
   * `undefined` when the profile advertises none (the menu then falls back to the
   * WebID). NOT the WebID-as-name fallback `readProfile` applies — we keep the
   * "real name only" signal here so the menu can decide its own fallback chain.
   */
  displayName?: string;
  /** The profile avatar URL (foaf:img / vcard:hasPhoto), for the AccountMenu avatar. */
  avatarUrl?: string;
}

/** Ensure a container URL ends in a single trailing slash. */
function asContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * The profile's REAL display name, or undefined. `readProfile` sets `name` to the
 * WebID when the profile advertises no foaf:name; here we strip that fallback so
 * the AccountMenu sees only a genuine name (and applies its own WebID fallback).
 */
function realDisplayName(profile: Profile): string | undefined {
  return profile.name && profile.name !== profile.webId ? profile.name : undefined;
}

/** Derive the pod root + WebID + profile display fields from a read profile. */
export function deriveSession(profile: Profile): DerivedSession {
  const displayName = realDisplayName(profile);
  const { avatarUrl } = profile;
  const storage = profile.storages[0];
  if (storage) {
    return {
      podRoot: asContainer(storage),
      webId: profile.webId,
      podRootIsFallback: false,
      displayName,
      avatarUrl,
    };
  }
  // Fallback: the WebID's origin. new URL("/", webId) gives `scheme://host/`.
  const fallback = new URL("/", profile.webId).toString();
  return {
    podRoot: asContainer(fallback),
    webId: profile.webId,
    podRootIsFallback: true,
    displayName,
    avatarUrl,
  };
}
