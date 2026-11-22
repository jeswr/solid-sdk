// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type EffectivePolicy, readWac } from "@jeswr/pod-access";
import { isRoleError, type RoleGrant, readGrants, setGrants } from "@jeswr/pod-access/roles";
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
function explainPartialScope(error: unknown): never {
  if (isRoleError(error) && error.code === "partial-scope")
    throw new JournalPrivacyError(
      "The journal folder and its entries have different permissions. Review both in Drive before making your journal private.",
      { cause: error },
    );
  throw error;
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
  // WAC replacement can retain targeted authorisations with no principals. Their
  // empty disjunction grants nobody access; require a nonempty owner grant as well.
  const active = policy.grants.filter((grant) => grant.who.length > 0);
  return (
    active.length > 0 &&
    policy.denials.length === 0 &&
    active.every(
      (grant) =>
        grant.except.length === 0 &&
        grant.who.every(
          (clause) =>
            clause.length === 1 && clause[0]?.kind === "agent" && clause[0].webId === owner,
        ),
    )
  );
}
async function ownPolicy(storage: StorageClient, url: string) {
  const head = await storage.head(url, { revalidate: true });
  const endpoints = head.links.get("acl");
  if (endpoints?.length !== 1)
    throw new JournalPrivacyError("Couldn't verify private journal access");
  const endpoint = endpoints[0]?.target as string;
  if (!storage.isWithinStorage(endpoint))
    throw new JournalPrivacyError("Couldn't verify private journal access");
  let validator: string | null;
  try {
    validator = (await storage.head(endpoint, { revalidate: true })).etag;
  } catch (error) {
    if (error instanceof StorageError && error.status === 404) return null;
    throw error;
  }
  const read = await storage.readRdf(endpoint, { maxBytes: 1024 * 1024 });
  if (!validator || read.etag !== validator)
    throw new JournalPrivacyError("Couldn't verify private journal access");
  return readWac(read.dataset, url, endpoint, "css", true);
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
  const snapshot = await readGrants(container, options).catch(explainPartialScope);
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
  if (result.failed.length) {
    if (isRoleError(result.failed[0]?.error) && result.failed[0].error.code === "partial-scope")
      explainPartialScope(result.failed[0].error);
    throw new JournalPrivacyError("Couldn't make your journal private", {
      cause: result.failed[0]?.error,
    });
  }
  const verified = await readGrants(container, options).catch(explainPartialScope);
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
      "This journal entry is shared. Review its permissions in Drive and make it private.",
    );
  // Existing overrides must also pass the SDK's model/placement checks. Missing ACLs
  // inherit the already verified folder and need no repeated ancestor discovery.
  if (policy) {
    const snapshot = await readGrants(url, { fetch, root: storage.root, model: "wac" });
    if (!isOwnerOnly(snapshot.grants, owner))
      throw new JournalPrivacyError("Couldn't verify private journal entry access");
  }
}
