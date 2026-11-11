// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type EffectivePolicy, readWac } from "@jeswr/pod-access";
import { type RoleGrant, readGrants, setGrants } from "@jeswr/pod-access/roles";
import { type StorageClient, StorageError } from "@jeswr/storage-client";

export class JournalPrivacyError extends Error {
  constructor(
    message: string,
    options?: ErrorOptions,
    readonly canMakePrivate = false,
  ) {
    super(message, options);
  }
}

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
async function ownPolicy(storage: StorageClient, url: string) {
  const head = await storage.head(url);
  const endpoints = head.links.get("acl");
  if (endpoints?.length !== 1)
    throw new JournalPrivacyError("Couldn't verify private journal access");
  const endpoint = endpoints[0]?.target as string;
  if (!storage.isWithinStorage(endpoint))
    throw new JournalPrivacyError("Couldn't verify private journal access");
  try {
    const read = await storage.readRdf(endpoint);
    return readWac(read.dataset, url, endpoint, "css", true);
  } catch (error) {
    if (error instanceof StorageError && error.code === "not-found") return null;
    throw error;
  }
}

/** Nearest WAC defaults govern a missing own ACL; resource-only parent rules do not. */
async function inheritedPolicy(
  storage: StorageClient,
  container: string,
): Promise<EffectivePolicy> {
  let ancestor = container;
  for (let depth = 0; depth < 64 && ancestor !== storage.root; depth++) {
    ancestor = new URL("../", ancestor).href;
    if (!storage.isWithinStorage(ancestor)) break;
    const policy = await ownPolicy(storage, ancestor);
    if (policy)
      return {
        ...policy,
        grants: policy.grants.filter((grant) => grant.appliesTo !== "resource"),
      };
  }
  throw new JournalPrivacyError("Couldn't verify inherited journal access");
}

/** WAC only until the SDK exposes an equally complete effective ACP privacy proof. */
export async function protectJournal(
  storage: StorageClient,
  container: string,
  owner: string,
  fetch: typeof globalThis.fetch,
  seal = false,
): Promise<void> {
  const options = {
    fetch,
    root: storage.root,
    kind: "folder" as const,
    webId: owner,
    model: "wac" as const,
  };
  const snapshot = await readGrants(container, options);
  if (!seal) {
    const own = await ownPolicy(storage, container);
    const policy = own ?? (await inheritedPolicy(storage, container));
    if (!isOwnerOnly(snapshot.grants, owner) || !isOwnerOnlyPolicy(policy, owner))
      throw new JournalPrivacyError(
        "Journal storage is shared. Make your journal private before opening it.",
        undefined,
        true,
      );
    if (own) return;
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
  const policy = await ownPolicy(storage, container);
  if (!policy || !isOwnerOnlyPolicy(policy, owner))
    throw new JournalPrivacyError("Couldn't verify private journal access");
}

export async function verifyJournalResource(
  storage: StorageClient,
  url: string,
  owner: string,
  fetch: typeof globalThis.fetch,
): Promise<void> {
  // The caller has verified the container once. Only an own ACL can override its defaults.
  const policy = await ownPolicy(storage, url);
  if (policy && !isOwnerOnlyPolicy(policy, owner))
    throw new JournalPrivacyError(
      "This journal entry is shared. Make it private before opening it.",
    );
  // Existing overrides must also pass the SDK's model/placement checks. Missing ACLs
  // inherit the already verified folder and need no repeated ancestor discovery.
  if (policy) {
    const snapshot = await readGrants(url, { fetch, root: storage.root, model: "wac" });
    if (!isOwnerOnly(snapshot.grants, owner))
      throw new JournalPrivacyError("Couldn't verify private journal entry access");
  }
}
