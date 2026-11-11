// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6.1-Sol
import type { Profile } from "./profile.js";

export interface DerivedSession {
  podRoot: string;
  webId: string;
  podRootIsFallback: boolean;
  displayName?: string;
  avatarUrl?: string;
}

/** Open the first advertised storage, retaining its existing origin fallback. */
export function deriveSession(profile: Profile): DerivedSession {
  const storage = profile.storages[0];
  const root = storage ?? new URL("/", profile.webId).href;
  return {
    podRoot: root.endsWith("/") ? root : `${root}/`,
    webId: profile.webId,
    podRootIsFallback: !storage,
    displayName: profile.name && profile.name !== profile.webId ? profile.name : undefined,
    avatarUrl: profile.avatarUrl,
  };
}
