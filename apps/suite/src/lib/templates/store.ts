// AUTHORED-BY Codex GPT-6.1-Sol
import { ensurePrivateContainerAccess } from "@jeswr/pod-access/roles";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
import { createTemplateStore } from "@jeswr/suite-templates";
import type { PodSession } from "../session/pod-session";

const stores = new WeakMap<PodSession, Promise<ReturnType<typeof createTemplateStore>>>();
export function templatesForSession(session: PodSession) {
  let store = stores.get(session);
  if (!store) {
    store = createPodClient({
      fetch: session.fetch,
      storage: session.storageUrl,
      capabilities: createMemoryCache(),
    })
      .then(({ storage }) =>
        createTemplateStore({
          storage,
          profile: session.webId,
          fetch: session.fetch,
          ensurePrivateAccess: (url) => ensurePrivateContainerAccess(session, url),
        }),
      )
      .catch((error) => {
        stores.delete(session);
        throw error;
      });
    stores.set(session, store);
  }
  return store;
}
