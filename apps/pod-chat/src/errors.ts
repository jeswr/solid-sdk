// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Typed errors for the Pod-Chat data layer. Each carries the offending `url`
 * and (where the pod answered) the HTTP `status`, so callers branch on the type
 * and `.status` rather than string-matching a message.
 */

/** Base class for every Pod-Chat error (one `instanceof` to catch them all). */
export class PodChatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PodChatError";
  }
}

/** A resource could not be written (non-2xx PUT). `status === 412` = precondition. */
export class ResourceWriteError extends PodChatError {
  constructor(
    readonly url: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(`Failed to write ${url} (HTTP ${status})`, options);
    this.name = "ResourceWriteError";
  }
}

/** A resource could not be deleted (non-2xx DELETE, other than an idempotent 404/410). */
export class ResourceDeleteError extends PodChatError {
  constructor(
    readonly url: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(`Failed to delete ${url} (HTTP ${status})`, options);
    this.name = "ResourceDeleteError";
  }
}

/**
 * A caller-supplied URL is not strictly inside this store's own container — a
 * confused-deputy guard so a crafted link can never redirect an authenticated
 * read/write/delete elsewhere. Fail closed before any I/O.
 */
export class OutOfScopeError extends PodChatError {
  constructor(
    readonly url: string,
    readonly container: string,
  ) {
    super(`Refusing to act on a resource outside this app's container: ${url}`);
    this.name = "OutOfScopeError";
  }
}
