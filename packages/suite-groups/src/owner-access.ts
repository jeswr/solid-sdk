// AUTHORED-BY Codex GPT-6.1-Sol
import { readGrants } from "@jeswr/pod-access/roles";
import { StorageError } from "@jeswr/storage-client";
import type { GroupSession } from "./index.js";

/** Verify private inheritance before an application creates a new Family space or index. */
export async function ownerOnlyAccess(session: GroupSession, target: string): Promise<boolean> {
  let url = target;
  for (;;) {
    try {
      await session.storage.head(url);
      break;
    } catch (error) {
      if (
        !(error instanceof StorageError && error.code === "not-found") ||
        url === session.storage.root
      )
        throw error;
      url = new URL(url.endsWith("/") ? ".." : ".", url).href;
    }
  }
  const snapshot = await readGrants(url, {
    fetch: session.fetch,
    root: session.storage.root,
    model: "wac",
    kind: url.endsWith("/") ? "folder" : "resource",
  });
  return (
    snapshot.grants.length > 0 &&
    snapshot.grants.every(
      (grant) => grant.agent.type === "webid" && grant.agent.id === session.webId,
    ) &&
    snapshot.grants.some((grant) => grant.role === "manager")
  );
}
