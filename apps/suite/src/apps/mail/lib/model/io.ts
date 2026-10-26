// AUTHORED-BY Codex GPT-6.1-Sol
import { extractMediaType, fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch } from "@jeswr/guarded-fetch";
import type { DatasetCore } from "@rdfjs/types";
import { ContainerDataset } from "@solid/object";
import { DataFactory, Store } from "n3";
import { MailboxDataset } from "./mailbox.js";
import { serialiseToTurtle } from "./serialise.js";
import { TypeIndexDataset } from "./typeIndex.js";

export class MailError extends Error {
  constructor(
    public readonly code: "not-found" | "forbidden" | "conflict" | "no-validator" | "http",
    public readonly status: number,
  ) {
    super(`Mail operation failed: ${code} (${status})`);
    this.name = "MailError";
  }
}
export interface LoadedMail {
  mailbox: MailboxDataset;
  url: string;
  etag: string | null;
  exists: boolean;
}
export async function parseMailbox(text: string, url: string): Promise<MailboxDataset> {
  return new MailboxDataset(await parseRdf(text, "text/turtle", { baseIRI: url }), DataFactory);
}
function failure(status: number): MailError {
  return new MailError(
    status === 404
      ? "not-found"
      : status === 401 || status === 403
        ? "forbidden"
        : status === 412
          ? "conflict"
          : "http",
    status,
  );
}
/** fetch-rdf cannot inject its transport into JSON-LD's context loader. */
function assertLocalContexts(value: unknown, context = false): void {
  if (context && typeof value === "string")
    throw new TypeError("Remote JSON-LD contexts are not allowed");
  if (Array.isArray(value)) {
    for (const item of value) assertLocalContexts(item, context);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      assertLocalContexts(item, key === "@context" || key === "@import");
  }
}
/** Every credentialed request, including redirects and RDF-derived URLs, stays in the selected pod. */
export class MailStore {
  readonly fetch: typeof globalThis.fetch;
  private readonly writeFetch: typeof globalThis.fetch;
  constructor(
    fetch: typeof globalThis.fetch,
    private readonly storage: string,
  ) {
    const scopedFetch = createPodScopedFetch(storage, { fetch });
    this.fetch = async (input, init) => {
      const response = await scopedFetch(input, init);
      if (
        response.ok &&
        extractMediaType(response.headers.get("content-type")) === "application/ld+json"
      )
        assertLocalContexts(JSON.parse(await response.clone().text()));
      return response;
    };
    this.writeFetch = createPodScopedFetch(storage, { fetch, maxRedirects: 0 });
  }
  async load(url: string, create = false): Promise<LoadedMail> {
    try {
      const result = await fetchRdf(url, { fetch: this.fetch });
      return {
        mailbox: new MailboxDataset(result.dataset, DataFactory),
        url: result.url,
        etag: result.etag,
        exists: true,
      };
    } catch (e) {
      if (!(e instanceof RdfFetchError) || e.status === undefined) throw e;
      if (e.status === 404 && create)
        return {
          mailbox: new MailboxDataset(new Store(), DataFactory),
          url,
          etag: null,
          exists: false,
        };
      throw failure(e.status);
    }
  }
  async write(
    url: string,
    body: BodyInit,
    contentType: string,
    etag: string | null,
    exists: boolean,
  ): Promise<string | null> {
    if (exists && (!etag || etag.startsWith("W/") || etag === "*"))
      throw new MailError("no-validator", 0);
    const headers = new Headers({ "content-type": contentType });
    headers.set(exists ? "if-match" : "if-none-match", exists ? String(etag) : "*");
    const response = await this.writeFetch(url, { method: "PUT", headers, body });
    if (!response.ok) throw failure(response.status);
    return response.headers.get("etag");
  }
  async save(loaded: LoadedMail, dataset: DatasetCore = loaded.mailbox): Promise<void> {
    loaded.etag = await this.write(
      loaded.url,
      serialiseToTurtle(dataset),
      "text/turtle",
      loaded.etag,
      loaded.exists,
    );
    loaded.exists = true;
  }
  async list(url: string): Promise<string[]> {
    const { dataset } = await fetchRdf(url, { fetch: this.fetch });
    const container = new ContainerDataset(dataset, DataFactory).container;
    return [...(container?.contains ?? [])].map((resource) => resource.value);
  }
  /** Load explicit document URLs into one read snapshot. Writes retain each document's validator. */
  async snapshot(urls: string[]): Promise<MailboxDataset> {
    const dataset = new Store();
    for (const url of new Set(urls)) dataset.addQuads([...(await this.load(url)).mailbox]);
    return new MailboxDataset(dataset, DataFactory);
  }
  async mutate(url: string, change: (mailbox: MailboxDataset) => void): Promise<void> {
    const loaded = await this.load(url);
    change(loaded.mailbox);
    await this.save(loaded);
  }
  /** Caller supplies an existing private index; SDK-APP-10 owns discovery/bootstrap. */
  async register(indexUrl: string, container: string): Promise<void> {
    // Validate even when registration itself does not fetch the target.
    assertWithinPodScope(this.storage, container);
    const loaded = await this.load(indexUrl);
    const index = new TypeIndexDataset(loaded.mailbox, DataFactory);
    index.registerMail(loaded.url, container);
    await this.save(loaded, index);
  }
}
