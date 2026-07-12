// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Typed errors for the pod I/O layer. Callers branch on the class + `.status`
 * (never string-matching) so behaviour (404 → create, 412 → re-read & retry)
 * is explicit and testable.
 */

/** A write (`PUT`) to the pod returned a non-2xx status. */
export class ResourceWriteError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`Failed to write ${url} (status ${status})`);
    this.name = 'ResourceWriteError';
  }
}

/** A delete (`DELETE`) to the pod returned a non-2xx (non-idempotent) status. */
export class ResourceDeleteError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`Failed to delete ${url} (status ${status})`);
    this.name = 'ResourceDeleteError';
  }
}

/**
 * A caller-supplied resource URL is not inside the store's own container — a
 * confused-deputy guard. A crafted `?id=` link must never make the app
 * fetch/PUT/DELETE an arbitrary URL with the user's credentials. Fail closed
 * before any I/O.
 */
export class OutOfScopeError extends Error {
  constructor(
    readonly url: string,
    readonly container: string,
  ) {
    super(`Refusing to act on a resource outside this app's container: ${url}`);
    this.name = 'OutOfScopeError';
  }
}
