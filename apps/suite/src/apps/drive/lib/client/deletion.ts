// AUTHORED-BY Codex
import { deletionLedger, protectionLedger } from "./protection-ledger";

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
  const forget = async (url: string, clearProtection = true) => {
    const record = await pending.get(url);
    // A failed provisioner's archive still governs recreation of a missing
    // ancestor. Only a confirmed DELETE caller retires that ACL requirement.
    if (clearProtection) await protection.clear(url);
    await pending.clear(url);
    if (record?.recovery) await pending.clear(record.recovery);
  };
  const reread = async (url: string): Promise<DeleteOutcome> => {
    const record = await pending.get(url);
    try {
      const response = await http(url, { method: "HEAD", cache: "no-store" });
      if (response.status === 404 || response.status === 410) return "done";
      const etag = response.headers.get("etag");
      if (response.ok && record?.etag && etag && !etag.startsWith("W/") && etag !== record.etag)
        return "not-performed";
    } catch {
      // A lost read cannot establish completion. Keep all durable requirements.
    }
    return "unknown";
  };
  const guard = async (url: string) => {
    const requirement = await pending.get(url);
    if (!requirement) return;
    for (const source of requirement.sources) {
      if ((await reread(source)) === "unknown") throw new DriveDeletePendingError(source);
      await forget(source, false);
    }
    await pending.clear(url);
  };
  const remove = async (url: string, etag: string, recovery?: string) => {
    await guard(url);
    // Persist both sides before the request: reload or response loss cannot turn
    // a retained copy into a disposable duplicate while its source is deleting.
    await pending.set(url, { sources: [url], etag, ...(recovery ? { recovery } : {}) });
    if (recovery) await pending.set(recovery, { sources: [url] });
    let response: Response;
    try {
      response = await http(url, { method: "DELETE", headers: { "if-match": etag } });
    } catch (cause) {
      // Response loss, aborts and timeouts do not establish whether DELETE ran.
      throw new DriveDeletePendingError(url, { cause });
    }
    let outcome = classifyDelete(response.status);
    if (outcome === "not-performed") {
      await forget(url, false);
      throw refusal(response.status, url);
    }
    if (outcome === "unknown") outcome = await reread(url);
    if (outcome === "done") {
      await forget(url);
      return;
    }
    if (outcome === "not-performed") {
      await forget(url, false);
      throw refusal(412, url);
    }
    throw new DriveDeletePendingError(url, { cause: error(response.status, url) });
  };
  const recheck = async (root: string): Promise<readonly string[]> => {
    const sources = new Set<string>();
    const guards = new Map<string, readonly string[]>();
    for (const url of await pending.keys()) {
      if (!url.startsWith(root)) continue;
      const record = await pending.get(url);
      if (!record) continue;
      guards.set(url, record.sources);
      for (const source of record.sources) if (source.startsWith(root)) sources.add(source);
    }
    const unresolved: string[] = [];
    for (const source of sources) {
      if ((await reread(source)) === "unknown") unresolved.push(source);
      else await forget(source, false);
    }
    // A reload may land between retiring the source and its recovery guard.
    for (const [url, linked] of guards)
      if (linked.every((source) => sources.has(source) && !unresolved.includes(source)))
        await pending.clear(url);
    return unresolved;
  };
  return { guard, remove, forget, recheck };
}
