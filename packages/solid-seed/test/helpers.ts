// AUTHORED-BY GPT-5.6 Sol via codex

import type { AccountProvisioner, SeedTarget } from "../src/index.js";

export interface StoredResource {
  body: string;
  contentType: string;
}

export interface RequestRecord {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

export class MemoryPod implements SeedTarget {
  readonly resources = new Map<string, StoredResource>();
  readonly requests: RequestRecord[] = [];
  readonly webid: string;
  readonly baseUrl: string;
  readonly authFetch: typeof fetch;
  #failure?: { path: string; remaining: number; status: number };

  constructor(origin: string, webid = `${origin}/profile/card#me`) {
    this.baseUrl = origin;
    this.webid = webid;
    this.authFetch = async (input, init) => {
      const request = new Request(input, init);
      const body = request.method === "PUT" ? await request.text() : "";
      this.requests.push({
        method: request.method,
        url: request.url,
        headers: new Headers(request.headers),
        body,
      });
      const path = new URL(request.url).pathname;
      if (
        request.method === "PUT" &&
        this.#failure !== undefined &&
        path === this.#failure.path &&
        this.#failure.remaining > 0
      ) {
        this.#failure.remaining -= 1;
        return new Response("injected failure", { status: this.#failure.status });
      }
      if (request.method === "HEAD" || request.method === "GET") {
        const stored = this.resources.get(request.url);
        if (stored === undefined) return new Response(null, { status: 404 });
        if (request.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "content-type": stored.contentType },
          });
        }
        return new Response(stored.body, {
          status: 200,
          headers: { "content-type": stored.contentType },
        });
      }
      if (request.method === "PUT") {
        if (request.headers.get("if-none-match") === "*" && this.resources.has(request.url)) {
          return new Response("precondition failed", { status: 412 });
        }
        this.resources.set(request.url, {
          body,
          contentType: request.headers.get("content-type") ?? "",
        });
        return new Response(null, { status: 201 });
      }
      return new Response("method not allowed", { status: 405 });
    };
  }

  failNextPut(path: string, status = 500): void {
    this.#failure = { path, status, remaining: 1 };
  }

  putRecords(path?: string): RequestRecord[] {
    return this.requests.filter(
      (value) =>
        value.method === "PUT" && (path === undefined || new URL(value.url).pathname === path),
    );
  }
}

export class MemoryProvisioner implements AccountProvisioner {
  readonly targets: MemoryPod[] = [];
  #next = 0;

  async provisionAccount(webid?: string): Promise<MemoryPod> {
    this.#next += 1;
    const origin = `https://pod-${this.#next}.example`;
    const pod = new MemoryPod(origin, webid ?? `${origin}/profile/card#me`);
    this.targets.push(pod);
    return pod;
  }
}
