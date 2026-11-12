// AUTHORED-BY Codex GPT-6.1-Sol

import { createPodClient } from "@jeswr/storage-client";
import { GroupDirectory } from "@jeswr/suite-groups";

export interface GroupsSession {
  fetch: typeof globalThis.fetch;
  webId: string;
  storageUrl: string;
}
const clients = new WeakMap<typeof fetch, Map<string, Promise<GroupDirectory>>>();
/** Account-owned transports fence retained clients when the shell switches account. */
export function groupDirectory(session: GroupsSession): Promise<GroupDirectory> {
  let cache = clients.get(session.fetch);
  if (!cache) {
    cache = new Map();
    clients.set(session.fetch, cache);
  }
  const key = JSON.stringify([session.webId, session.storageUrl]);
  let pending = cache.get(key);
  if (!pending) {
    pending = createPodClient({ fetch: session.fetch, storage: session.storageUrl }).then(
      ({ storage }) => new GroupDirectory({ ...session, storage }),
    );
    cache.set(key, pending);
    void pending.catch(() => cache?.delete(key));
  }
  return pending;
}
