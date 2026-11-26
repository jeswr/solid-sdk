// AUTHORED-BY Claude Sonnet 5.5
import { createOwnerOnlyDestinationChecks } from "@jeswr/pod-access";
import { createPodClient, type StorageClient } from "@jeswr/storage-client";

/**
 * A written resource could not be confirmed as owner-only afterwards. `removed` is true only
 * when the server confirmed the deletion of the file this run created. The message holds no
 * diary content, values or URLs, so it is safe to show and announce as it is.
 */
export class DiaryPrivacyError extends Error {
  constructor(readonly removed: boolean) {
    super(
      removed
        ? "Not saved: we removed it because we couldn't confirm it is private to you."
        : "Saved, but we couldn't confirm it is private to you. Check who can access your Health folder.",
    );
    this.name = "DiaryPrivacyError";
  }
}
function strongEtag(value: string | null): string | undefined {
  return value !== null && /^"[^"\r\n]*"$/.test(value) ? value : undefined;
}

/**
 * The after-write contract for private Health writes, shared by diary entries and settings:
 * the stored version keeps the strong ETag the write returned (or, when the server returned
 * none, the strong ETag a HEAD reports), and the file and its container are still owner-only.
 * On refusal it deletes ONLY a file this run created (201 to a create-only request) with
 * If-Match on the write's own strong ETag, so a replaced or concurrently changed file is never
 * removed, and reports removal only once the server confirms it. Never deletes without a
 * strong ETag from the write itself. Throws {@link DiaryPrivacyError} on refusal.
 */
export function createPrivateWriteConfirmer(
  fetch: typeof globalThis.fetch,
  storage: string,
  owner: string,
) {
  // Successful discovery is cached for the life of this account's store; a failure never is,
  // so a transient outage refuses one write and the next write retries.
  let opened: Promise<StorageClient> | undefined;
  const openStorage = () => {
    if (!opened) {
      const attempt = createPodClient({ fetch, storage }).then((client) => client.storage);
      opened = attempt;
      // Only this handler clears the cache, so it always clears this attempt.
      attempt.catch(() => {
        opened = undefined;
      });
    }
    return opened;
  };
  return async function confirm(url: string, written: Response | undefined): Promise<void> {
    const writeEtag = strongEtag(written?.headers.get("etag") ?? null);
    let confirmed = false;
    try {
      let bound = writeEtag;
      if (bound === undefined) {
        const head = await fetch(url, { method: "HEAD", redirect: "error" });
        bound = head.ok ? strongEtag(head.headers.get("etag")) : undefined;
      }
      // Without any strong ETag nothing can be bound: report it as unconfirmed.
      if (bound !== undefined)
        confirmed = await createOwnerOnlyDestinationChecks({
          podRoot: storage,
          ownerWebId: owner,
          openStorage,
        }).confirmPrivateWrite(url, { etag: bound });
    } catch {
      // An unreadable policy, failed discovery or unexpected metadata is a refusal as well.
    }
    if (confirmed) return;
    let removed = false;
    if (written?.status === 201 && writeEtag !== undefined) {
      try {
        const response = await fetch(url, {
          method: "DELETE",
          redirect: "error",
          headers: { "if-match": writeEtag },
        });
        removed = response.ok;
      } catch {
        // The resource may remain; the error says so.
      }
    }
    throw new DiaryPrivacyError(removed);
  };
}
