/**
 * Typed error classes so the UI can branch on `instanceof` rather than
 * string-matching messages (AGENTS.md §TypeScript). `@jeswr/fetch-rdf` throws
 * its own `RdfFetchError`; these cover the write/discovery paths.
 */

/** A conditional PUT was rejected (HTTP 412) — the resource changed underneath us. */
export class ConflictError extends Error {
  constructor(
    public readonly url: string,
    message = "The issue list changed since you loaded it. Reload and try again.",
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

/** A write (PUT) failed for a non-conflict reason. */
export class WriteError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    message = `Writing to the pod failed (HTTP ${status}).`,
  ) {
    super(message);
    this.name = "WriteError";
  }
}

/** The user's WebID profile lacks a usable `pim:storage` (no write target). */
export class NoStorageError extends Error {
  constructor(
    public readonly webId: string,
    message = "This WebID profile does not advertise a storage (pim:storage), so the app cannot find a pod to write to.",
  ) {
    super(message);
    this.name = "NoStorageError";
  }
}
