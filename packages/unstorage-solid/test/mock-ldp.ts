// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// An in-memory mock LDP server modelled as a `fetch` stub (`typeof fetch`).
// It stores resource bytes + content-type + a generated ETag + last-modified, and
// for a container GET returns a REAL `ldp:contains` Turtle listing built with
// `n3.Writer` (house rule: no hand-concatenated triples even in fixtures).
//
// Supports GET / PUT / DELETE / HEAD on resources and containers, optional
// auto-creation of parent containers, optimistic concurrency via If-Match, and a
// HEAD-405 mode to exercise the GET fallback.

import { DataFactory, Writer } from "n3";

const { namedNode, quad } = DataFactory;

const LDP = "http://www.w3.org/ns/ldp#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

interface StoredResource {
  bytes: Uint8Array;
  contentType: string;
  etag: string;
  lastModified: string;
  isContainer: boolean;
}

export interface MockLdpOptions {
  /** Base origin+path for the pod, e.g. "https://pod.example/kv/". */
  base: string;
  /** When true, a deep PUT auto-creates intermediate containers (CSS-like). */
  autoCreateParents?: boolean;
  /** When true, HEAD returns 405 (forces the driver's GET fallback). */
  headReturns405?: boolean;
}

/** A mock LDP pod plus its `fetch` and helpers to inspect/seed state. */
export class MockLdp {
  readonly base: string;
  readonly resources = new Map<string, StoredResource>();
  private etagSeq = 0;
  private readonly autoCreateParents: boolean;
  private readonly headReturns405: boolean;
  /** Records of every request, for assertions. */
  readonly requests: { method: string; url: string; headers: Record<string, string> }[] = [];

  constructor(opts: MockLdpOptions) {
    this.base = new URL(opts.base).toString();
    this.autoCreateParents = opts.autoCreateParents ?? false;
    this.headReturns405 = opts.headReturns405 ?? false;
    // The base container always exists.
    this.ensureContainer(this.base);
  }

  /** The `fetch` to hand to the driver. */
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = normalizeHeaders(init?.headers);
    this.requests.push({ method, url, headers });

    switch (method) {
      case "HEAD":
        return this.handleHead(url, headers);
      case "GET":
        return this.handleGet(url, headers);
      case "PUT":
        return this.handlePut(url, headers, init?.body);
      case "DELETE":
        return this.handleDelete(url, headers);
      default:
        return new Response(null, { status: 405, statusText: "Method Not Allowed" });
    }
  };

  private newEtag(): string {
    this.etagSeq += 1;
    return `"etag-${this.etagSeq}"`;
  }

  private ensureContainer(url: string): void {
    const norm = url.endsWith("/") ? url : `${url}/`;
    if (!this.resources.has(norm)) {
      this.resources.set(norm, {
        bytes: new Uint8Array(),
        contentType: "text/turtle",
        etag: this.newEtag(),
        lastModified: new Date().toUTCString(),
        isContainer: true,
      });
    }
  }

  /** Seed a resource directly (bypassing the driver). */
  seed(url: string, body: string, contentType = "text/plain"): void {
    this.resources.set(url, {
      bytes: new TextEncoder().encode(body),
      contentType,
      etag: this.newEtag(),
      lastModified: new Date().toUTCString(),
      isContainer: false,
    });
  }

  private parentContainerOf(url: string): string {
    const u = new URL(url);
    // Strip the last path segment.
    const path = u.pathname.replace(/\/$/, "");
    const idx = path.lastIndexOf("/");
    u.pathname = path.slice(0, idx + 1);
    return u.toString();
  }

  private directMembers(containerUrl: string): string[] {
    const norm = containerUrl.endsWith("/") ? containerUrl : `${containerUrl}/`;
    const out: string[] = [];
    for (const key of this.resources.keys()) {
      if (key === norm) {
        continue;
      }
      if (!key.startsWith(norm)) {
        continue;
      }
      const rest = key.slice(norm.length).replace(/\/$/, "");
      // direct child = no further slash
      if (rest.length > 0 && !rest.includes("/")) {
        out.push(key);
      }
    }
    return out;
  }

  private async containerTurtle(containerUrl: string): Promise<string> {
    const norm = containerUrl.endsWith("/") ? containerUrl : `${containerUrl}/`;
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuad(quad(namedNode(norm), namedNode(RDF_TYPE), namedNode(`${LDP}BasicContainer`)));
    writer.addQuad(quad(namedNode(norm), namedNode(RDF_TYPE), namedNode(`${LDP}Container`)));
    for (const member of this.directMembers(norm)) {
      writer.addQuad(quad(namedNode(norm), namedNode(`${LDP}contains`), namedNode(member)));
      const m = this.resources.get(member);
      if (m?.isContainer) {
        writer.addQuad(quad(namedNode(member), namedNode(RDF_TYPE), namedNode(`${LDP}Container`)));
      }
    }
    return new Promise<string>((resolve, reject) => {
      writer.end((err, result) => (err ? reject(err) : resolve(result)));
    });
  }

  private headersFor(r: StoredResource): Headers {
    return new Headers({
      "content-type": r.contentType,
      etag: r.etag,
      "last-modified": r.lastModified,
      "content-length": String(r.bytes.byteLength),
    });
  }

  private handleHead(url: string, _headers: Record<string, string>): Response {
    if (this.headReturns405) {
      return new Response(null, { status: 405, statusText: "Method Not Allowed" });
    }
    const r = this.resources.get(url);
    if (!r) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    return new Response(null, { status: 200, headers: this.headersFor(r) });
  }

  private async handleGet(url: string, _headers: Record<string, string>): Promise<Response> {
    const r = this.resources.get(url);
    if (!r) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    if (r.isContainer) {
      const turtle = await this.containerTurtle(url);
      return new Response(turtle, {
        status: 200,
        headers: new Headers({
          "content-type": "text/turtle",
          etag: r.etag,
          "last-modified": r.lastModified,
        }),
      });
    }
    return new Response(r.bytes, { status: 200, headers: this.headersFor(r) });
  }

  private async bodyToBytes(body: BodyInit | null | undefined): Promise<Uint8Array> {
    if (body == null) {
      return new Uint8Array();
    }
    if (typeof body === "string") {
      return new TextEncoder().encode(body);
    }
    if (body instanceof Uint8Array) {
      return body;
    }
    if (body instanceof ArrayBuffer) {
      return new Uint8Array(body);
    }
    // Response can read most BodyInit forms.
    const buf = await new Response(body).arrayBuffer();
    return new Uint8Array(buf);
  }

  private async handlePut(
    url: string,
    headers: Record<string, string>,
    body: BodyInit | null | undefined,
  ): Promise<Response> {
    const isContainer = url.endsWith("/");
    // Optimistic concurrency.
    const ifMatch = headers["if-match"];
    if (ifMatch) {
      const existing = this.resources.get(url);
      if (!existing || existing.etag !== ifMatch) {
        return new Response(null, { status: 412, statusText: "Precondition Failed" });
      }
    }
    // Parent must exist unless we auto-create.
    const parent = this.parentContainerOf(url);
    if (parent !== url && !this.resources.has(parent)) {
      if (this.autoCreateParents) {
        // Walk up creating ancestors down to base.
        this.createAncestors(url);
      } else if (!isContainer) {
        // Resource PUT with a missing parent — reject so the driver creates it.
        return new Response(null, { status: 409, statusText: "Conflict (missing parent)" });
      }
    }
    if (isContainer) {
      this.ensureContainer(url);
      return new Response(null, { status: 201, statusText: "Created" });
    }
    const bytes = await this.bodyToBytes(body);
    const existed = this.resources.has(url);
    this.resources.set(url, {
      bytes,
      contentType: headers["content-type"] ?? "application/octet-stream",
      etag: this.newEtag(),
      lastModified: new Date().toUTCString(),
      isContainer: false,
    });
    return new Response(null, {
      status: existed ? 205 : 201,
      statusText: existed ? "Reset Content" : "Created",
    });
  }

  private createAncestors(url: string): void {
    const baseUrl = new URL(this.base);
    const u = new URL(url);
    const rel = u.pathname.slice(baseUrl.pathname.length);
    const parts = rel.split("/").filter((s) => s.length > 0);
    parts.pop(); // drop resource name
    let current = this.base;
    for (const part of parts) {
      current = `${current}${part}/`;
      this.ensureContainer(current);
    }
  }

  private handleDelete(url: string, _headers: Record<string, string>): Response {
    if (!this.resources.has(url)) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    // Refuse to delete a non-empty container (LDP semantics).
    if (url.endsWith("/") && this.directMembers(url).length > 0) {
      return new Response(null, { status: 409, statusText: "Conflict (non-empty container)" });
    }
    this.resources.delete(url);
    return new Response(null, { status: 204, statusText: "No Content" });
  }
}

function normalizeHeaders(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) {
    return out;
  }
  const h = new Headers(init);
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}
