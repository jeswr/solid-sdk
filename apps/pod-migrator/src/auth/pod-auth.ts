// AUTHORED-BY GPT-6.1 Sol
import { appUrl, createAppPodAuth, type LegacyKeys } from "@jeswr/app-session";
import type { PodAuth } from "@jeswr/pod-auth";
import type { ConnectionId } from "./connections.js";

// The former connections.ts passed these exact keys to solid-auth-core/controller.ts.
// Keep literals so the shared-origin storage-isolation audit can inspect them.
export const legacyCredentials: Record<ConnectionId, LegacyKeys> = {
  source: {
    indexedDb: ["pod-migrator:source:sessions"],
    localStorage: ["pod-migrator:source:remembered-account", "pod-migrator:source:recent-accounts"],
    sessionStorage: ["pod-migrator:source:redirect-flow", "pod-migrator:source:redirect-sentinel"],
  },
  target: {
    indexedDb: ["pod-migrator:target:sessions"],
    localStorage: ["pod-migrator:target:remembered-account", "pod-migrator:target:recent-accounts"],
    sessionStorage: ["pod-migrator:target:redirect-flow", "pod-migrator:target:redirect-sentinel"],
  },
};

// Both providers use app-session's shared popup holder. Claim it synchronously, before login
// awaits anything; UI disabling alone cannot prevent two clicks in the same React update.
let loginActive = false;
export function serializeLogins(getAuth: () => Promise<PodAuth>): () => Promise<PodAuth> {
  let singleton: Promise<PodAuth> | undefined;
  return () => {
    singleton ??= getAuth()
      .then((auth) => ({
        ...auth,
        async login(...args: Parameters<PodAuth["login"]>) {
          if (loginActive) throw new Error("Finish the other pod's sign-in first");
          loginActive = true;
          try {
            return await auth.login(...args);
          } finally {
            loginActive = false;
          }
        },
      }))
      .catch((error: unknown) => {
        singleton = undefined;
        throw error;
      });
    return singleton;
  };
}

export function connectionAuth(id: ConnectionId, origin: string, base: string) {
  return serializeLogins(
    createAppPodAuth({
      clientId: appUrl("clientid.jsonld", base, origin),
      redirectUri: appUrl(`callback/${id}/`, base, origin),
      dev: import.meta.env.DEV,
    }),
  );
}
