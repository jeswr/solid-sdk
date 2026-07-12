// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Pod Drive read facade — the thin glue between @jeswr/fetch-rdf and the
// typed model. This is where a UI/page layer enters the data layer:
//
//   const { container, etag } = await listContainer(url);
//   for (const child of container.entries) { ... }
//
// WAC-aware: a fetch that the server rejects for authorization (401/403) is
// surfaced as a typed {@link DriveAccessError} so the UI can prompt for login /
// show "no access" rather than a raw RdfFetchError. Auth itself is injected:
// pass the patched `fetch` from @solid/reactive-authentication (or omit it to
// use the global fetch, which that package patches in a browser). The data
// layer never imports an auth library directly — it stays issuer-agnostic and
// trivially testable with a stub fetch.

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { type DriveContainer, readContainer } from "./model.js";

/** Options for {@link listContainer}. */
export interface ListOptions {
  /**
   * The authenticated fetch (e.g. the one @solid/reactive-authentication patches
   * onto globalThis.fetch). Omit to use the ambient global fetch.
   */
  fetch?: typeof fetch;
  /** Abort signal forwarded to the underlying GET. */
  signal?: AbortSignal;
}

/** A container listing plus the validators a conditional write needs. */
export interface ContainerListing {
  /** The typed, read-only view of the container and its children. */
  container: DriveContainer;
  /** Strong ETag for `If-Match` on a later write; `null` if the server omits it. */
  etag: string | null;
  /** Final URL after redirects — the canonical container IRI. */
  url: string;
}

/**
 * Raised when the pod refuses access (HTTP 401/403) to a resource. Distinct
 * from a 404 (which surfaces as the original {@link RdfFetchError}) so the UI
 * can branch: 401 → prompt login, 403 → "you don't have access".
 */
export class DriveAccessError extends Error {
  readonly status: 401 | 403;
  readonly url: string;
  constructor(status: 401 | 403, url: string, cause: unknown) {
    super(
      status === 401 ? `Authentication required to read ${url}` : `Forbidden: no access to ${url}`,
    );
    this.name = "DriveAccessError";
    this.status = status;
    this.url = url;
    this.cause = cause;
  }
}

/**
 * GET + parse an LDP container and return its typed view. The container URL is
 * normalised to a trailing slash (LDP containers are slash-terminated); reading
 * a slashless URL as a container would 404 on a strict server.
 *
 * @throws {DriveAccessError} on 401 / 403.
 * @throws {RdfFetchError} on any other non-2xx / network / parse failure
 *   (e.g. 404 for a missing container) — re-thrown unchanged.
 */
export async function listContainer(
  containerUrl: string,
  options: ListOptions = {},
): Promise<ContainerListing> {
  const url = containerUrl.endsWith("/") ? containerUrl : `${containerUrl}/`;
  try {
    const result = await fetchRdf(url, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return {
      container: readContainer(result.url, result.dataset),
      etag: result.etag,
      url: result.url,
    };
  } catch (error) {
    if (error instanceof RdfFetchError && (error.status === 401 || error.status === 403)) {
      throw new DriveAccessError(error.status, url, error);
    }
    throw error;
  }
}
