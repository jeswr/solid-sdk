// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// session-derivation.ts — derive the values <ChatRooms> needs (the pod ROOT URL
// + the WebID) from the authenticated profile.
//
// WHY THE VIEW ONLY NEEDS A POD ROOT (not the chat containers):
// <ChatRooms podRoot webId /> hands those two to @jeswr/pod-chat's `useChat` →
// `ChatStore`, which OWNS container derivation/discovery: it derives the
// `pod-chat/rooms/` + `pod-chat/messages/` containers from the pod root and
// registers them via the user's Type Index (`ensureTypeRegistrations`) for
// cross-app discovery. So the host's job is ONLY to derive a correct pod root;
// the chat-container derivation lives in the data layer.
//
// POD-ROOT DERIVATION (first that yields a value):
//   1. the FIRST `pim:storage` advertised on the WebID profile (the canonical
//      Solid signal for "where this user's storage lives"). Most pods (CSS, PSS,
//      ESS) advertise exactly one; we take the first and note multi-storage as a
//      follow-up (a storage picker).
//   2. fallback: the WebID's ORIGIN + "/" — a reasonable guess when a profile
//      omits pim:storage (e.g. a bare CSS profile). The data layer's scope guard
//      still protects every write, so a wrong guess fails closed, not silently.
import type { Profile } from "./profile";

export interface DerivedSession {
  /** The pod root URL (always ends in "/"). Passed to <ChatRooms podRoot>. */
  podRoot: string;
  /** The authenticated user's WebID. Passed to <ChatRooms webId>. */
  webId: string;
  /** True when the pod root came from the WebID origin fallback, not pim:storage. */
  podRootIsFallback: boolean;
}

/** Ensure a container URL ends in a single trailing slash. */
function asContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** Derive the pod root + WebID the ChatRooms view needs from a read profile. */
export function deriveSession(profile: Profile): DerivedSession {
  const storage = profile.storages[0];
  if (storage) {
    return {
      podRoot: asContainer(storage),
      webId: profile.webId,
      podRootIsFallback: false,
    };
  }
  // Fallback: the WebID's origin. new URL("/", webId) gives `scheme://host/`.
  const fallback = new URL("/", profile.webId).toString();
  return {
    podRoot: asContainer(fallback),
    webId: profile.webId,
    podRootIsFallback: true,
  };
}
