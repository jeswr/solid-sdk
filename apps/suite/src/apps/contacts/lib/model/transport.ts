// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch } from "@jeswr/guarded-fetch";
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { documentUrl } from "./data";

export interface Snapshot<T> {
  url: string;
  etag: string | null;
  dataset: DatasetCore;
  data: T;
}

export interface Change {
  url: string;
  /** undefined means DELETE; an empty dataset means an empty RDF document. */
  dataset?: DatasetCore;
  /** null means create; every replacement/deletion requires a strong ETag. */
  etag: string | null;
}

export class ContactsWriteError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly etag: string | null,
  ) {
    super(`Contacts write failed (${status}).`);
    this.name = "ContactsWriteError";
  }
}

/** HTTP has no multi-document transaction: report exactly what persisted before failure. */
export class PartialWriteError extends Error {
  constructor(
    readonly completed: readonly string[],
    cause: unknown,
  ) {
    super("Some contacts documents were saved; reload before retrying.", { cause });
    this.name = "PartialWriteError";
  }
}

export class ContactsTransport {
  readonly fetch: typeof fetch;
  constructor(
    readonly podRoot: string,
    fetchImpl: typeof fetch,
  ) {
    // No redirects: a 303 must not turn a conditional mutation into a successful GET.
    this.fetch = createPodScopedFetch(podRoot, { fetch: fetchImpl, maxRedirects: 0 });
  }

  url(value: string): string {
    return documentUrl(assertWithinPodScope(this.podRoot, value, { allowRoot: false }));
  }

  async read<T>(url: string, parse: (dataset: DatasetCore) => T): Promise<Snapshot<T>> {
    const target = this.url(url);
    const result = await fetchRdf(target, { fetch: this.fetch });
    return { url: target, etag: result.etag, dataset: result.dataset, data: parse(result.dataset) };
  }

  async commit(changes: readonly Change[]): Promise<(string | null)[]> {
    // Preflight ALL scope and concurrency guards before the first request.
    const prepared = await Promise.all(
      changes.map(async (change) => {
        const url = this.url(change.url);
        const headers = new Headers();
        if (change.etag === null) {
          if (change.dataset === undefined) throw new TypeError("Deletion requires an ETag.");
          headers.set("If-None-Match", "*");
        } else {
          if (!/^"[^"\r\n]*"$/.test(change.etag)) {
            throw new TypeError("A strong ETag is required; reload before writing.");
          }
          headers.set("If-Match", change.etag);
        }
        let body: string | undefined;
        if (change.dataset !== undefined) {
          headers.set("Content-Type", "text/turtle");
          body = await serialize([...change.dataset]);
        }
        return { url, headers, body };
      }),
    );
    const completed: string[] = [];
    const etags: (string | null)[] = [];
    try {
      for (const { url, headers, body } of prepared) {
        const response = await this.fetch(url, {
          method: body === undefined ? "DELETE" : "PUT",
          headers,
          ...(body === undefined ? {} : { body }),
        });
        if (!response.ok) {
          throw new ContactsWriteError(response.status, url, response.headers.get("etag"));
        }
        completed.push(url);
        etags.push(response.headers.get("etag"));
      }
    } catch (error) {
      if (completed.length) throw new PartialWriteError(completed, error);
      throw error;
    }
    return etags;
  }
}

export function replacement<T>(snapshot: Snapshot<T>, dataset?: DatasetCore): Change {
  if (snapshot.etag === null)
    throw new TypeError("A strong ETag is required; reload before writing.");
  return { url: snapshot.url, etag: snapshot.etag, ...(dataset === undefined ? {} : { dataset }) };
}
