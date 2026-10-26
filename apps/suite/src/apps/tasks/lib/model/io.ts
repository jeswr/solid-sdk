// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { ModelError } from "./errors";
import { NS, node, requireHttp, Store, serialize } from "./rdf";
export interface Resource {
  url: string;
  dataset: Store;
  etag: string | null;
}
/** The caller injects a scope-guarded authenticated fetch, including redirect policy. */
export class RdfIO {
  constructor(private readonly fetch: typeof globalThis.fetch) {}
  async read(url: string): Promise<Resource> {
    requireHttp(url);
    try {
      const result = await fetchRdf(url, {
        fetch: this.fetch,
        headers: { "Cache-Control": "no-cache" },
      });
      return { url: result.url, dataset: new Store([...result.dataset]), etag: result.etag };
    } catch (error) {
      if (error instanceof RdfFetchError)
        throw new ModelError(error.status ?? 0, url, null, { cause: error });
      throw error;
    }
  }
  async optional(url: string): Promise<Resource | undefined> {
    try {
      return await this.read(url);
    } catch (error) {
      if (error instanceof ModelError && error.status === 404) return undefined;
      throw error;
    }
  }
  async write(
    url: string,
    dataset: DatasetCore,
    precondition: { create: true } | { etag: string | null },
  ): Promise<Resource> {
    const headers: Record<string, string> = { "Content-Type": "text/turtle" };
    if ("create" in precondition) headers["If-None-Match"] = "*";
    else headers["If-Match"] = requireEtag(precondition.etag);
    const response = await this.request(url, {
      method: "PUT",
      headers,
      body: await serialize(dataset),
    });
    const resource = { url, dataset: new Store([...dataset]), etag: response.headers.get("ETag") };
    if (resource.etag) return resource;
    // A transformed PUT may omit validators. Never attach a read validator to
    // different data: that could authorize overwriting or deleting another writer.
    const current = await this.read(url);
    const isContainer = node(url, resource.dataset).types.has(`${NS.LDP}BasicContainer`);
    if (
      isContainer
        ? !current.dataset.contains(resource.dataset) ||
          node(current.url, current.dataset).iris(`${NS.LDP}contains`).size > 0
        : !current.dataset.equals(resource.dataset)
    )
      throw new ModelError(412, url, current.etag);
    return current;
  }
  async remove(url: string, etag: string | null): Promise<void> {
    await this.request(url, { method: "DELETE", headers: { "If-Match": requireEtag(etag) } });
  }
  private async request(url: string, init: RequestInit): Promise<Response> {
    requireHttp(url);
    let response: Response;
    try {
      response = await this.fetch(url, init);
    } catch (error) {
      throw new ModelError(0, url, null, { cause: error });
    }
    if (!response.ok) throw new ModelError(response.status, url, response.headers.get("ETag"));
    return response;
  }
  async container(url: string): Promise<Resource | undefined> {
    // CSS can reject PUT to an existing container before checking If-None-Match.
    const existing = await this.optional(url);
    if (existing) {
      this.requireContainer(existing);
      return;
    }
    const dataset = new Store();
    node(url, dataset).types.add(`${NS.LDP}BasicContainer`);
    try {
      return await this.write(url, dataset, { create: true });
    } catch (error) {
      if (!(error instanceof ModelError && [409, 412].includes(error.status))) throw error;
      const raced = await this.optional(url);
      if (!raced) throw error;
      this.requireContainer(raced);
    }
  }
  private requireContainer(resource: Resource): void {
    const types = node(resource.url, resource.dataset).types;
    if (!types.has(`${NS.LDP}BasicContainer`) && !types.has(`${NS.LDP}Container`))
      throw new TypeError("Expected an LDP container.");
  }
  async list(url: string): Promise<string[]> {
    const resource = await this.optional(url);
    if (!resource) return [];
    return [...node(resource.url, resource.dataset).iris(`${NS.LDP}contains`)];
  }
}
export function requireEtag(value: string | null): string {
  if (!value || value === "*" || value.startsWith("W/") || !/^"[^"\r\n]*"$/.test(value))
    throw new TypeError("A strong ETag from the last read is required.");
  return value;
}
