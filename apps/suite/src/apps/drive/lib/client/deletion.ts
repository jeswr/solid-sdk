// AUTHORED-BY Codex
import { type DeletionRequest, deletionLedger, protectionLedger } from "./protection-ledger";

export type DeleteOutcome = "done" | "not-performed" | "unknown";
const refusedRequests = new WeakSet<Error>();

/** A refusal of a precondition is definitive; acceptance is not completion. */
export function classifyDelete(status: number | undefined): DeleteOutcome {
  if (status === undefined) return "unknown";
  if ((status >= 200 && status < 300 && status !== 202) || status === 404 || status === 410)
    return "done";
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return "not-performed";
  return "unknown";
}

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

/** Housekeeping must surface DELETE refusals as well as unresolved requests. */
export function isDeletionFailure(error: unknown): error is Error {
  return (
    error instanceof DriveDeletePendingError ||
    (error instanceof Error && refusedRequests.has(error))
  );
}

export function rethrowPendingDeletion(error: unknown): void {
  if (isDeletionFailure(error)) throw error;
}

/** Accepted/ambiguous deletes must settle before either endpoint can be reused. */
export function deletionControl(http: typeof fetch, error: (status: number, url: string) => Error) {
  const pending = deletionLedger(http);
  const protection = protectionLedger(http);
  const refusal = (status: number, url: string) => {
    const rejected = error(status, url);
    refusedRequests.add(rejected);
    return rejected;
  };
  const retire = async (record: DeletionRequest, clearProtection = false) => {
    if (clearProtection) await protection.clear(record.source);
    await pending.retire(record);
  };
  const forget = async (url: string) => {
    await guard(url);
    await protection.clear(url);
  };
  const reread = async (record: DeletionRequest): Promise<DeleteOutcome> => {
    try {
      const response = await http(record.source, { method: "HEAD", cache: "no-store" });
      if (response.status === 404 || response.status === 410) return "done";
      const etag = response.headers.get("etag");
      if (response.ok && record.etag && etag && !etag.startsWith("W/") && etag !== record.etag)
        return "not-performed";
    } catch {
      // A lost read cannot establish completion. Keep the independent record.
    }
    return "unknown";
  };
  const guard = async (url: string) => {
    let unresolved: string | undefined;
    for (const record of await pending.records()) {
      if (record.source !== url && record.recovery !== url) continue;
      if ((await reread(record)) === "unknown") unresolved = record.source;
      else await retire(record);
    }
    if (unresolved) throw new DriveDeletePendingError(unresolved);
  };
  const remove = async (
    url: string,
    etag: string,
    recovery?: string,
    verifyAccess?: () => Promise<void>,
  ) => {
    await guard(url);
    // Persist both sides before the request: reload or response loss cannot turn
    // a retained copy into a disposable duplicate while its source is deleting.
    const record: DeletionRequest = {
      id: crypto.randomUUID(),
      source: url,
      etag,
      ...(recovery ? { recovery } : {}),
    };
    await pending.add(record);
    try {
      await verifyAccess?.();
    } catch (error) {
      await retire(record);
      throw error;
    }
    let response: Response;
    try {
      response = await http(url, { method: "DELETE", headers: { "if-match": etag } });
    } catch (cause) {
      // Response loss, aborts and timeouts do not establish whether DELETE ran.
      throw new DriveDeletePendingError(url, { cause });
    }
    let outcome = classifyDelete(response.status);
    if (outcome === "not-performed") {
      await retire(record);
      throw refusal(response.status, url);
    }
    if (outcome === "unknown") outcome = await reread(record);
    if (outcome === "done") {
      await retire(record, true);
      return;
    }
    if (outcome === "not-performed") {
      await retire(record);
      throw refusal(412, url);
    }
    throw new DriveDeletePendingError(url, { cause: error(response.status, url) });
  };
  const recheck = async (root: string): Promise<readonly string[]> => {
    const unresolved = new Set<string>();
    for (const record of await pending.records()) {
      if (!record.source.startsWith(root)) continue;
      if ((await reread(record)) === "unknown") unresolved.add(record.source);
      else await retire(record);
    }
    return [...unresolved];
  };
  return { guard, remove, forget, recheck };
}
