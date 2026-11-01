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
  redirect: RequestRedirect;
}

export class MemoryPod implements SeedTarget {
  readonly resources = new Map<string, StoredResource>();
  /** Called after each GET is answered, to simulate a concurrent writer. */
  afterGet?: (url: string) => void;

  readonly requests: RequestRecord[] = [];
  readonly webid: string;
  readonly baseUrl: string;
  readonly authFetch: typeof fetch;
  /**
   * How the pod advertises a resource's ACL (`Link: rel="acl"`): the WAC `.acl`
   * suffix by default, `"none"` for a server without WAC, or a fixed suffix
   * (e.g. `.acr` for an ACP server).
   */
  aclLink: "suffix" | "none" | { suffix: string } = "suffix";
  /** Refuse HEAD with 405, as some servers do. */
  headUnsupported = false;
  /**
   * Refuse a PUT to an existing container with 409, as CSS does, before
   * evaluating If-None-Match (so a conditional PUT gets 409, not 412).
   */
  containerPutConflict = false;
  /** Delete a resource's `.acl` along with it, as CSS does. */
  deleteAclWithResource = false;
  /** Overwrite despite `If-None-Match: *`, answering 204, as a non-conforming server might. */
  ignoreIfNoneMatch = false;
  /** Paths whose DELETE is refused with the given status. */
  readonly deleteFailures = new Map<string, number>();
  #failure?: { path: string; remaining: number; status: number; skip: number; partial: boolean };

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
        redirect: request.redirect,
      });
      const path = new URL(request.url).pathname;
      if (
        request.method === "PUT" &&
        this.#failure !== undefined &&
        path === this.#failure.path &&
        this.#failure.remaining > 0 &&
        this.#failure.skip-- <= 0
      ) {
        this.#failure.remaining -= 1;
        if (this.#failure.partial) {
          this.resources.set(request.url, {
            body,
            contentType: request.headers.get("content-type") ?? "",
          });
        }
        return new Response("injected failure", { status: this.#failure.status });
      }
      if (request.method === "HEAD" && this.headUnsupported) {
        return new Response(null, { status: 405 });
      }
      if (request.method === "HEAD" || request.method === "GET") {
        const stored = this.resources.get(request.url);
        if (stored === undefined) return new Response(null, { status: 404 });
        const headers = new Headers({ "content-type": stored.contentType });
        const suffix =
          this.aclLink === "suffix"
            ? ".acl"
            : this.aclLink === "none"
              ? undefined
              : this.aclLink.suffix;
        if (suffix !== undefined && !request.url.endsWith(".acl")) {
          headers.set("link", `<${request.url}${suffix}>; rel="acl"`);
        }
        headers.set("etag", this.etag(request.url));
        this.afterGet?.(request.url);
        return new Response(request.method === "HEAD" ? null : stored.body, {
          status: 200,
          headers,
        });
      }
      if (request.method === "DELETE") {
        const refused = this.deleteFailures.get(path);
        if (refused !== undefined) return new Response("delete refused", { status: refused });
        const existed = this.resources.delete(request.url);
        if (existed && this.deleteAclWithResource) this.resources.delete(`${request.url}.acl`);
        return new Response(null, { status: existed ? 205 : 404 });
      }
      if (request.method === "PUT") {
        const existed = this.resources.has(request.url);
        if (this.containerPutConflict && request.url.endsWith("/") && existed) {
          return new Response("Existing containers cannot be updated via PUT.", { status: 409 });
        }
        if (request.headers.get("if-none-match") === "*" && existed && !this.ignoreIfNoneMatch) {
          return new Response("precondition failed", { status: 412 });
        }
        const ifMatch = request.headers.get("if-match");
        if (ifMatch !== null && (!existed || ifMatch !== this.etag(request.url))) {
          return new Response("precondition failed", { status: 412 });
        }
        this.resources.set(request.url, {
          body,
          contentType: request.headers.get("content-type") ?? "",
        });
        return new Response(null, { status: existed ? 204 : 201 });
      }
      return new Response("method not allowed", { status: 405 });
    };
  }

  /**
   * Fail one PUT to `path`, after letting `skip` earlier PUTs to it through. With
   * `partial`, the body is stored anyway, as a write that fails after landing.
   */
  failNextPut(path: string, status = 500, skip = 0, partial = false): void {
    this.#failure = { path, status, remaining: 1, skip, partial };
  }

  /** A strong ETag that changes whenever the stored resource does. */
  etag(url: string): string {
    const stored = this.resources.get(url);
    if (stored === undefined) return '"none"';
    let hash = 0;
    for (const char of stored.body) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
    return `"${stored.body.length}-${hash}"`;
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
