// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Sonnet 5.5
import { checkOwnerOnly, type OwnerOnlyOptions, type OwnerOnlyResult } from "@jeswr/pod-access";
import { isRoleError, readGrants, setGrants } from "@jeswr/pod-access/roles";
import type { StorageClient } from "@jeswr/storage-client";

/** Trusted ACP dialect assertion, as for `checkOwnerOnly`; supply it only from deployment config. */
export type JournalAcpDialect = OwnerOnlyOptions["acpDialect"];

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

/**
 * The only privacy verdict: the shared, fail-closed `checkOwnerOnly` over the raw effective
 * WAC or ACP policy (own document, then every inherited ancestor). Journal has no verifier of
 * its own, so it cannot accept anything the shared one refuses (untyped WAC rules,
 * non-canonical targets, unrepresentable modes, ACP pods without a trusted dialect, a looser
 * parent ACL). Transport errors fail closed too.
 */
function verdict(
  storage: StorageClient,
  url: string,
  owner: string,
  acpDialect: JournalAcpDialect,
): Promise<OwnerOnlyResult> {
  return checkOwnerOnly({ storage, url, ownerWebId: owner, ...(acpDialect && { acpDialect }) });
}
/** Only an owner-versus-others finding can be repaired by sealing; anything else is unverifiable. */
function isShared(result: OwnerOnlyResult): boolean {
  return (
    !result.private &&
    result.reasons.length > 0 &&
    result.reasons.every((reason) => reason.reason === "non-owner")
  );
}

/**
 * Verify the journal folder is owner-only, or, with `seal`, first give it owner-only access.
 * Sealing is for a folder this caller just created and for the user's explicit "make private"
 * repair; every other call only verifies and never writes an access document.
 */
export async function protectJournal(
  storage: StorageClient,
  container: string,
  owner: string,
  fetch: typeof globalThis.fetch,
  seal = false,
  acpDialect?: JournalAcpDialect,
): Promise<void> {
  if (seal) {
    const options = {
      fetch,
      root: storage.root,
      kind: "folder" as const,
      webId: owner,
      ...(acpDialect && { implementation: acpDialect }),
    };
    const snapshot = await readGrants(container, options).catch(explainPartialScope);
    const result = await setGrants(
      [container],
      [{ agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" }],
      { ...options, expected: snapshot, ownOnly: true },
    );
    const failure = result.failed[0];
    if (failure) {
      if (isRoleError(failure.error) && failure.error.code === "partial-scope")
        explainPartialScope(failure.error);
      throw new JournalPrivacyError("Couldn't make your journal private", {
        cause: failure.error,
      });
    }
  }
  const result = await verdict(storage, container, owner, acpDialect);
  if (result.private) return;
  if (!seal && isShared(result))
    throw new JournalPrivacyError(
      "Journal storage is shared. Make your journal private before opening it.",
      undefined,
      true,
    );
  throw new JournalPrivacyError("Couldn't verify private journal access");
}

/** Verify one entry or photo (its own policy and every inherited one) before it is read or written. */
export async function verifyJournalResource(
  storage: StorageClient,
  url: string,
  owner: string,
  acpDialect?: JournalAcpDialect,
): Promise<void> {
  const result = await verdict(storage, url, owner, acpDialect);
  if (result.private) return;
  throw new JournalPrivacyError(
    isShared(result)
      ? "This journal entry is shared. Review its permissions in Drive and make it private."
      : "Couldn't verify private journal entry access",
  );
}
