// AUTHORED-BY Codex GPT-6.1-Sol
import { capabilities, resolveStorageDescription } from "@jeswr/storage-capabilities";
import { createLwsBackend } from "./lws.js";
import { createSolidBackend } from "./solid.js";
import type { PodClient, PodClientOptions } from "./types.js";

/**
 * Discover a storage, derive its capabilities (including cached Solid probes), and create
 * its scoped client. The injected fetch is used for discovery and all storage operations.
 * An explicit backend selects the implementation; description and features retain the
 * server's advertised protocol. Discovery failures propagate without a fallback backend.
 */
export async function createPodClient(options: PodClientOptions): Promise<PodClient> {
  if (options.backend !== undefined && !["solid", "lws"].includes(options.backend)) {
    throw new TypeError("backend must be 'solid' or 'lws'");
  }
  options.signal?.throwIfAborted();
  const resolveOptions = {
    fetch: options.fetch,
    cache: options.capabilities,
    now: options.clock,
    signal: options.signal,
  };
  const description = await resolveStorageDescription(options.storage, resolveOptions);
  const features = await capabilities(options.storage, resolveOptions);
  options.signal?.throwIfAborted();
  const backend = options.backend ?? description.protocol;
  const common = { fetch: options.fetch, root: description.root, features };
  const storage =
    backend === "lws"
      ? createLwsBackend({ ...common, storage: description.id })
      : createSolidBackend(common);
  return { storage, description, features };
}
