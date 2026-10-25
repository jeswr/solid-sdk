// AUTHORED-BY Codex GPT-6.1-Sol
import { NS, node, parse, Store, serialize } from "../../src/apps/tasks/lib/model/rdf";
export const storage = "https://pod.test/alice/";
export const webId = `${storage}profile/card#me`;
export const now = new Date("2026-10-25T12:00:00Z");
export interface RequestRecord {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}
/** Real parse/serialize over an injected transport that rejects unconditional mutations. */
export class Pod {
  readonly files = new Map<string, { body: string; version: number; etag?: string | null }>();
  readonly requests: RequestRecord[] = [];
  intercept?:
    | ((request: RequestRecord) => Response | undefined | Promise<Response | undefined>)
    | undefined;
  constructor() {
    this.seed(storage, `<${storage}> a <${NS.LDP}BasicContainer>.`);
    this.seed(`${storage}profile/`, `<${storage}profile/> a <${NS.LDP}BasicContainer>.`);
    this.seed(`${storage}profile/card`, `<${webId}> <${NS.DCT}title> "Alice".`);
  }
  seed(url: string, body: string) {
    this.files.set(url, { body, version: (this.files.get(url)?.version ?? 0) + 1 });
  }
  mutations() {
    return this.requests.filter((request) => request.method !== "GET");
  }
  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const request = {
      url,
      method,
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    };
    this.requests.push(request);
    const injected = await this.intercept?.(request);
    if (injected) return injected;
    const file = this.files.get(url);
    const etag = file?.etag === undefined ? (file ? `"${file.version}"` : null) : file.etag;
    if (method === "GET") {
      if (!file) return new Response(null, { status: 404 });
      let body = file.body;
      if (url.endsWith("/")) {
        const dataset = await parse(url, body);
        const container = node(url, dataset);
        for (const child of this.files.keys()) {
          if (
            child !== url &&
            child.startsWith(url) &&
            !child.slice(url.length).replace(/\/$/, "").includes("/")
          )
            container.iris(`${NS.LDP}contains`).add(child);
        }
        body = await serialize(dataset);
      }
      return new Response(body, {
        headers: { "Content-Type": "text/turtle", ...(etag ? { ETag: etag } : {}) },
      });
    }
    if (method !== "PUT" && method !== "DELETE") throw new Error(`Unexpected method ${method}`);
    if (!request.headers.has("If-Match") && request.headers.get("If-None-Match") !== "*")
      throw new Error("Unconditional mutation");
    if (
      (request.headers.get("If-None-Match") === "*" && file) ||
      (request.headers.has("If-Match") && request.headers.get("If-Match") !== etag)
    )
      return new Response(null, { status: 412, headers: etag ? { ETag: etag } : {} });
    if (method === "DELETE") {
      this.files.delete(url);
      return new Response(null, { status: 204 });
    }
    const parent = new URL("./", url.endsWith("/") ? url.slice(0, -1) : url).href;
    if (!this.files.has(parent)) return new Response(null, { status: 409 });
    await parse(url, request.body);
    this.seed(url, request.body);
    return new Response(null, {
      status: 201,
      headers: { ETag: `"${this.files.get(url)?.version}"` },
    });
  };
  async dataset(url: string) {
    return parse(url, this.files.get(url)?.body ?? "");
  }
  async emptyContainer(url: string) {
    const data = new Store();
    node(url, data).types.add(`${NS.LDP}BasicContainer`);
    this.seed(url, await serialize(data));
  }
}
