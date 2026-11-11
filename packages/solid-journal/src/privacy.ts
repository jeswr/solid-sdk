// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type EffectivePolicy, readWac } from "@jeswr/pod-access";
import { type RoleGrant, readGrants, setGrants } from "@jeswr/pod-access/roles";
import { type StorageClient, StorageError } from "@jeswr/storage-client";

export class JournalPrivacyError extends Error {}

export function isOwnerOnly(grants: readonly RoleGrant[], owner: string): boolean {
  return (
    grants.length > 0 &&
    grants.every(
      (grant) =>
        grant.agent.type === "webid" && grant.agent.id === owner && grant.role === "manager",
    )
  );
}
/** Role projections omit partial grants. Inspect the complete SDK policy before claiming privacy. */
export function isOwnerOnlyPolicy(policy: EffectivePolicy, owner: string): boolean {
  return (
    policy.grants.length > 0 &&
    policy.denials.length === 0 &&
    policy.grants.every(
      (grant) =>
        grant.except.length === 0 &&
        grant.who.length > 0 &&
        grant.who.every(
          (clause) =>
            clause.length === 1 && clause[0]?.kind === "agent" && clause[0].webId === owner,
        ),
    )
  );
}
async function ownPolicy(storage: StorageClient, url: string, owner: string, required: boolean) {
  const head = await storage.head(url);
  const endpoints = head.links.get("acl");
  if (endpoints?.length !== 1)
    throw new JournalPrivacyError("Couldn't verify private journal access");
  const endpoint = endpoints[0]?.target as string;
  try {
    const read = await storage.readRdf(endpoint);
    if (!isOwnerOnlyPolicy(readWac(read.dataset, url, endpoint, "css", true), owner))
      throw new JournalPrivacyError("Journal access includes another person or public access");
  } catch (error) {
    if (!required && error instanceof StorageError && error.code === "not-found") return;
    throw error;
  }
}

/** WAC only until the SDK exposes an equally complete effective ACP privacy proof. */
export async function protectJournal(
  storage: StorageClient,
  container: string,
  owner: string,
  fetch: typeof globalThis.fetch,
  newlyCreated = false,
): Promise<void> {
  const options = {
    fetch,
    root: storage.root,
    kind: "folder" as const,
    webId: owner,
    model: "wac" as const,
  };
  const snapshot = await readGrants(container, options);
  if (!newlyCreated) {
    if (!isOwnerOnly(snapshot.grants, owner))
      throw new JournalPrivacyError(
        "Journal storage is shared. Make it private in Permissions before opening it.",
      );
    await ownPolicy(storage, container, owner, true);
    return;
  }
  const result = await setGrants(
    [container],
    [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
    { ...options, expected: snapshot, ownOnly: true },
  );
  if (result.failed.length)
    throw new JournalPrivacyError("Couldn't make your journal private", {
      cause: result.failed[0]?.error,
    });
  const verified = await readGrants(container, options);
  if (!isOwnerOnly(verified.grants, owner))
    throw new JournalPrivacyError("Couldn't verify private journal access");
  await ownPolicy(storage, container, owner, true);
}

export async function verifyJournalResource(
  storage: StorageClient,
  url: string,
  owner: string,
  fetch: typeof globalThis.fetch,
): Promise<void> {
  const snapshot = await readGrants(url, {
    fetch,
    root: storage.root,
    kind: "resource",
    model: "wac",
  });
  if (!isOwnerOnly(snapshot.grants, owner))
    throw new JournalPrivacyError(
      "This journal entry is shared. Make it private before opening it.",
    );
  await ownPolicy(storage, url, owner, false);
}
