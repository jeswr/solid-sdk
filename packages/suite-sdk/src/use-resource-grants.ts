// AUTHORED-BY Claude Opus 5.5
"use client";

import type { GrantResourceOptions, PodAuth, ResourceGrant } from "@jeswr/pod-auth";
import { ResourceGrantError } from "@jeswr/pod-auth";
import { usePodAuth } from "@jeswr/pod-auth/react";
import { useMemo, useSyncExternalStore } from "react";

const NONE: readonly ResourceGrant[] = Object.freeze([]);

/** The active account's grants for resources on other people's storages, and its actions. */
export interface ResourceGrants {
  /** False for a core without grant support (agents, the signed-out adapter, test doubles). */
  supported: boolean;
  grants: readonly ResourceGrant[];
  /**
   * Open a resource or container on someone else's storage with the active account. Call only
   * from the click on a consent screen that names its origin. Rejects with `ResourceGrantError`.
   */
  grant(url: string, options?: GrantResourceOptions): Promise<ResourceGrant>;
  revoke(grant: ResourceGrant | string): boolean;
  /** Synchronous scope check, for queued work that must stop when a grant ends. */
  isWithinGrantedScope(url: string | URL): boolean;
}

function store(auth: PodAuth) {
  return {
    snapshot: () => auth.grants?.() ?? NONE,
    subscribe: (notify: () => void) => auth.on("grants", notify),
  };
}

/**
 * Read and manage the active account's resource grants through the nearest PodAuthProvider
 * (or AccountsProvider), so apps never touch the core directly. Grants follow the active
 * account: switching shows that account's grants, and logout ends them.
 */
export function useResourceGrants(): ResourceGrants {
  const { auth } = usePodAuth();
  const { snapshot, subscribe } = useMemo(() => store(auth), [auth]);
  const grants = useSyncExternalStore(subscribe, snapshot, snapshot);
  const actions = useMemo(
    () => ({
      supported: auth.grantResource !== undefined,
      grant: async (url: string, options?: GrantResourceOptions) => {
        if (auth.grantResource === undefined) throw new ResourceGrantError("signed-out");
        return await auth.grantResource(url, options);
      },
      revoke: (grant: ResourceGrant | string) => auth.revokeResource?.(grant) ?? false,
      isWithinGrantedScope: (url: string | URL) => auth.isWithinGrantedScope?.(url) ?? false,
    }),
    [auth],
  );
  return useMemo(() => ({ ...actions, grants }), [actions, grants]);
}
