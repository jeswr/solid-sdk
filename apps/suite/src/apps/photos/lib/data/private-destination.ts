// AUTHORED-BY Claude Sonnet 5.5

import { ensurePrivateContainerAccess, verifyPrivateDemoAccess } from "@jeswr/pod-access/roles";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient, type StorageClient } from "@jeswr/storage-client";
import type { PodSession } from "@/lib/session/pod-session";

/**
 * The shared owner-only check, bound to one session. It verifies and never rewrites a
 * container (`created: false`), so a folder the owner shared on purpose keeps its collaborators.
 * Any uncertainty (discovery, transport, an unreadable policy) is a refusal.
 */
export function destinationGuard(session: PodSession): (container: string) => Promise<boolean> {
  let client: Promise<StorageClient> | undefined;
  return async (container) => {
    try {
      if (session.mode === "demo")
        return await verifyPrivateDemoAccess(session, container, session.webId);
      client ??= createPodClient({
        fetch: session.fetch,
        storage: session.storageUrl,
        capabilities: createMemoryCache(),
      }).then((opened) => opened.storage);
      const storage = await client.catch((error: unknown) => {
        client = undefined;
        throw error;
      });
      return (await ensurePrivateContainerAccess(session, container, { created: false, storage }))
        .private;
    } catch {
      return false;
    }
  };
}
