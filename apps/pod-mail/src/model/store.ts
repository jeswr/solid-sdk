// AUTHORED-BY Claude Opus 4.8
/**
 * Pod-shaped read / write / list for the mail data layer.
 *
 * Reads go through `@jeswr/fetch-rdf` (one GET, content-type-dispatched parse).
 * Writes serialise the in-memory dataset with `n3.Writer` and conditional-PUT
 * with `If-Match: <etag>`. Auth is provided by the caller's `fetch` (the suite
 * default patches `globalThis.fetch` via `@solid/reactive-authentication`), so
 * this layer is auth-agnostic — it just carries the fetch through.
 *
 * WAC-aware: a 401/403 on read surfaces as `MailAccessError` so the caller can
 * tell "no access" apart from "not found" (`MailNotFoundError`). Discovery via
 * the type index is a hint, not a grant — you must still attempt the GET to
 * learn your actual access.
 */
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { MailboxDataset } from "./mailbox.js";
import { serialiseToTurtle } from "./serialise.js";

/** Raised when a mail resource exists but the agent lacks read/write access. */
export class MailAccessError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`No access (${status}) to mail resource ${url}`);
    this.name = "MailAccessError";
    this.url = url;
    this.status = status;
  }
}

/** Raised when a mail resource does not exist. */
export class MailNotFoundError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`Mail resource not found: ${url}`);
    this.name = "MailNotFoundError";
    this.url = url;
  }
}

/** Raised when a conditional write loses the optimistic-lock race (HTTP 412). */
export class MailConflictError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`Conditional write conflict (412) on ${url}; re-fetch and retry.`);
    this.name = "MailConflictError";
    this.url = url;
  }
}

/** A mail document loaded from the pod, with its strong validator. */
export interface LoadedMailbox {
  /** The typed wrapper over the document's dataset. */
  mailbox: MailboxDataset;
  /** ETag for the conditional write-back (`null` on servers that omit it). */
  etag: string | null;
  /** Final URL after redirects. */
  url: string;
}

/** Options for the store: the (authenticated) fetch to use. */
export interface MailStoreOptions {
  /** Fetch implementation; defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/**
 * Read / write / list a single mail document in a Solid pod.
 * One instance is cheap; construct per-pod or per-app as convenient.
 */
export class MailStore {
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: MailStoreOptions = {}) {
    this.fetchImpl = options.fetch;
  }

  /**
   * Load a mail document. Throws `MailNotFoundError` on 404 and
   * `MailAccessError` on 401/403; any other failure propagates.
   */
  async load(url: string): Promise<LoadedMailbox> {
    try {
      const { dataset, etag, url: finalUrl } = await fetchRdf(url, this.fetchOpt());
      // fetchRdf returns an n3.Store-backed DatasetCore; wrap it directly.
      const mailbox = new MailboxDataset(dataset, DataFactory);
      return { mailbox, etag, url: finalUrl };
    } catch (e) {
      throw mapFetchError(url, e);
    }
  }

  /**
   * Load a mail document, returning an empty mailbox (no ETag) when the
   * resource does not exist yet. Use this for the create-or-update flow.
   */
  async loadOrEmpty(url: string): Promise<LoadedMailbox> {
    try {
      return await this.load(url);
    } catch (e) {
      if (e instanceof MailNotFoundError) {
        return { mailbox: new MailboxDataset(new Store(), DataFactory), etag: null, url };
      }
      throw e;
    }
  }

  /**
   * Conditional-PUT a mail document back to the pod. Uses `If-Match: <etag>`
   * when an ETag is known, and `If-None-Match: *` (create-only) when it is not,
   * so a write never silently clobbers a concurrent change. Throws
   * `MailConflictError` on 412 (lost the race — re-fetch and retry) and
   * `MailAccessError` on 401/403.
   */
  async save(loaded: LoadedMailbox): Promise<void> {
    const body = serialiseToTurtle(loaded.mailbox);
    const headers: Record<string, string> = { "content-type": "text/turtle" };
    if (loaded.etag !== null) {
      headers["if-match"] = loaded.etag;
    } else {
      headers["if-none-match"] = "*";
    }
    const f = this.fetchImpl ?? globalThis.fetch;
    const res = await f(loaded.url, { method: "PUT", headers, body });
    if (res.ok) return;
    if (res.status === 412) throw new MailConflictError(loaded.url);
    if (res.status === 401 || res.status === 403) {
      throw new MailAccessError(loaded.url, res.status);
    }
    throw new Error(`Mail write to ${loaded.url} failed: HTTP ${res.status}`);
  }

  private fetchOpt(): { fetch?: typeof fetch } {
    return this.fetchImpl ? { fetch: this.fetchImpl } : {};
  }
}

/**
 * Map an `RdfFetchError` onto the mail-domain error taxonomy. Exported for
 * direct unit testing of the non-RdfFetchError pass-through (in practice
 * `@jeswr/fetch-rdf` always throws `RdfFetchError`, but the guard keeps this
 * robust if a raw error ever surfaces).
 */
export function mapFetchError(url: string, e: unknown): unknown {
  if (e instanceof RdfFetchError) {
    if (e.status === 404) return new MailNotFoundError(url);
    if (e.status === 401 || e.status === 403) return new MailAccessError(url, e.status);
  }
  return e;
}
