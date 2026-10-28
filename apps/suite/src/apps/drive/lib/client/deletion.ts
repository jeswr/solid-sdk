// AUTHORED-BY Codex
import { deletionLedger, protectionLedger } from "./protection-ledger";

export class DriveDeletePendingError extends Error {
  readonly kind = "delete-pending";
  constructor(
    readonly url: string,
    options?: ErrorOptions,
  ) {
    super("Still deleting on the server", options);
    this.name = "DriveDeletePendingError";
  }
}

/** Housekeeping must expose any DELETE whose completion is still unknown. */
export function rethrowPendingDeletion(error: unknown): void {
  if (error instanceof DriveDeletePendingError) throw error;
}

/** Accepted/ambiguous deletes must settle before either endpoint can be reused. */
export function deletionControl(http: typeof fetch, error: (status: number, url: string) => Error) {
  const pending = deletionLedger(http);
  const protection = protectionLedger(http);
  const forget = async (url: string, clearProtection = true) => {
    const record = await pending.get(url);
    // A failed provisioner's archive still governs recreation of a missing
    // ancestor. Only a confirmed DELETE caller retires that ACL requirement.
    if (clearProtection) await protection.clear(url);
    await pending.clear(url);
    if (record?.recovery) await pending.clear(record.recovery);
  };
  const absent = async (url: string) => {
    for (const delay of [0, 25, 75]) {
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      try {
        const response = await http(url, { method: "HEAD", cache: "no-store" });
        if (response.status === 404 || response.status === 410) return true;
      } catch {
        // A lost read cannot establish completion. Keep all durable requirements.
      }
    }
    return false;
  };
  const guard = async (url: string) => {
    const requirement = await pending.get(url);
    if (!requirement) return;
    for (const source of requirement.sources) {
      if (!(await absent(source))) throw new DriveDeletePendingError(source);
      await forget(source, false);
    }
    await pending.clear(url);
  };
  const remove = async (url: string, etag: string, recovery?: string) => {
    await guard(url);
    // Persist both sides before the request: reload or response loss cannot turn
    // a retained copy into a disposable duplicate while its source is deleting.
    await pending.set(url, { sources: [url], ...(recovery ? { recovery } : {}) });
    if (recovery) await pending.set(recovery, { sources: [url] });
    let response: Response;
    try {
      response = await http(url, { method: "DELETE", headers: { "if-match": etag } });
    } catch (cause) {
      // Response loss, aborts and timeouts do not establish whether DELETE ran.
      throw new DriveDeletePendingError(url, { cause });
    }
    if (
      response.status === 200 ||
      response.status === 204 ||
      response.status === 404 ||
      response.status === 410 ||
      (await absent(url))
    ) {
      await forget(url);
      return;
    }
    // Only a terminal receipt or an absent re-read retires either guard. Even
    // an error response can follow an upstream request that is still running.
    throw new DriveDeletePendingError(url, { cause: error(response.status, url) });
  };
  return { guard, remove, forget };
}
