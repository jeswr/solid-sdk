// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { assertWithinBase } from "./keys.js";
import { isMissing, storageFromFetch, transportCause } from "./storage.js";

export interface ContainerMember {
  url: string;
  container: boolean;
}

/** List direct members; retain the legacy fetch signature as a factory adapter. */
export async function listContainer(
  containerUrl: string,
  base: string,
  client: StorageClient | typeof fetch,
): Promise<ContainerMember[] | null> {
  assertWithinBase(base, containerUrl);
  try {
    const storage = typeof client === "function" ? await storageFromFetch(base, client) : client;
    const members: ContainerMember[] = [];
    for await (const entry of storage.listAll(containerUrl)) {
      try {
        assertWithinBase(base, entry.url);
        const url = new URL(entry.url);
        const parent = new URL(containerUrl);
        if (
          url.search ||
          url.hash ||
          url.pathname.replace(/\/$/, "") === parent.pathname.replace(/\/$/, "")
        )
          continue;
        // Preserve the mount's direct-child layout and reject malformed entries individually.
        const relative = url.href.slice(containerUrl.length).replace(/\/$/, "");
        if (!url.href.startsWith(containerUrl) || !relative || relative.includes("/")) continue;
        members.push({ url: entry.url, container: entry.kind === "container" });
      } catch {
        /* A poisoned entry must not hide subsequent safe members. */
      }
    }
    return members;
  } catch (error) {
    if (isMissing(error)) return null;
    if (
      error instanceof StorageError &&
      error.code === "method-not-allowed" &&
      error.status === null
    )
      return [];
    if (error instanceof StorageError && error.status !== null) {
      throw new Error(`[unstorage-solid] list ${containerUrl} failed: ${error.status}`, {
        cause: error,
      });
    }
    throw transportCause(error);
  }
}
