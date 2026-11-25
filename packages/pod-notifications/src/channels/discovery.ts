// AUTHORED-BY Codex GPT-6
import type { PodClientOptions } from "@jeswr/storage-client";

// Each discovery gets a fresh cache, shared only between createPodClient's resolve/probe
// calls. Reconnect must not reuse a still-fresh description from a previous channel.
export function discoveryCache(): NonNullable<PodClientOptions["capabilities"]> {
  type Cache = NonNullable<PodClientOptions["capabilities"]>;
  const records = new Map<string, Awaited<ReturnType<Cache["get"]>>>();
  let prefix: { root: string; id: string } | undefined;
  return {
    get: async (id) => records.get(id),
    set: async (id, value) => {
      records.set(id, value);
    },
    delete: async (id) => {
      records.delete(id);
    },
    rememberPrefix: async (root, id) => {
      prefix = { root, id };
    },
    lookupPrefix: async (url) => (url.startsWith(prefix?.root ?? "\0") ? prefix?.id : undefined),
  };
}
