// AUTHORED-BY Claude Fable 5
//
// The in-memory pod stub behind the injectable-fetch seam. It implements the
// exact HTTP semantics the data layer depends on, so every conditional-write /
// CAS / 412 path is exercised REALISTICALLY with no live server:
//   • GET/HEAD with ETag; 404 for missing resources
//   • PUT with `If-Match` (mismatch → 412) and `If-None-Match: *`
//     (already-exists → 412); every successful PUT bumps the ETag
//   • DELETE
//   • `Link: <...>; rel="acl"` advertised on every non-.acl resource
//   • auto-generated ldp:contains listings for container URLs (trailing "/")
//     so ContainerDataset-based walks see a real tree

interface StoredResource {
  body: string;
  contentType: string;
  version: number;
}

export interface PodStub {
  fetch: typeof fetch;
  /** Seed/overwrite a resource directly (no HTTP semantics). */
  seed(url: string, turtle: string, contentType?: string): void;
  /** Raw read of the stored body (assertion helper). */
  body(url: string): string | undefined;
  etag(url: string): string | undefined;
  has(url: string): boolean;
  delete(url: string): void;
  /** Every request the stub served, for interaction assertions. */
  readonly log: { method: string; url: string }[];
  /** Optional per-request interceptor (fault injection); return a Response to short-circuit. */
  intercept?:
    | ((method: string, url: string, init?: RequestInit) => Response | undefined)
    | undefined;
}

function makeEtag(r: StoredResource): string {
  return `"v${r.version}"`;
}

/** Container listing: synthesise `<> ldp:contains <child>.` for direct children. */
function containerListing(url: string, resources: Map<string, StoredResource>): string {
  const children = new Set<string>();
  for (const key of resources.keys()) {
    if (!key.startsWith(url) || key === url) continue;
    const rest = key.slice(url.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      children.add(key);
    } else {
      children.add(url + rest.slice(0, slash + 1));
    }
  }
  const lines = [...children].map((c) => `<${url}> <http://www.w3.org/ns/ldp#contains> <${c}> .`);
  lines.push(
    `<${url}> a <http://www.w3.org/ns/ldp#BasicContainer>, <http://www.w3.org/ns/ldp#Container> .`,
  );
  return `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n${lines.join("\n")}\n`;
}

export function createPodStub(initial: Record<string, string> = {}): PodStub {
  const resources = new Map<string, StoredResource>();
  const log: { method: string; url: string }[] = [];

  const stub: PodStub = {
    log,
    seed(url, turtle, contentType = "text/turtle") {
      const existing = resources.get(url);
      resources.set(url, {
        body: turtle,
        contentType,
        version: (existing?.version ?? 0) + 1,
      });
    },
    body: (url) => resources.get(url)?.body,
    etag: (url) => {
      const r = resources.get(url);
      return r ? makeEtag(r) : undefined;
    },
    has: (url) => resources.has(url),
    delete: (url) => {
      resources.delete(url);
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // Real fetch never sends the fragment — strip it like the network would.
      const url = rawUrl.split("#")[0] ?? rawUrl;
      const method = (init?.method ?? "GET").toUpperCase();
      log.push({ method, url });

      const intercepted = stub.intercept?.(method, url, init);
      if (intercepted) return intercepted;

      const headers = new Headers(init?.headers);
      const isContainer = url.endsWith("/");
      const existing = resources.get(url);

      const baseHeaders = (r?: StoredResource): HeadersInit => {
        const h: Record<string, string> = {};
        if (r) {
          h.etag = makeEtag(r);
          h["content-type"] = r.contentType;
        }
        if (!url.endsWith(".acl")) h.link = `<${url}.acl>; rel="acl"`;
        return h;
      };

      if (method === "GET" || method === "HEAD") {
        if (existing) {
          return new Response(method === "HEAD" ? null : existing.body, {
            status: 200,
            headers: baseHeaders(existing),
          });
        }
        if (isContainer) {
          // A container "exists" when anything lives under it.
          const listing = containerListing(url, resources);
          const hasChildren = listing.includes("ldp#contains");
          if (hasChildren) {
            const synthetic: StoredResource = {
              body: listing,
              contentType: "text/turtle",
              version: 1,
            };
            return new Response(method === "HEAD" ? null : listing, {
              status: 200,
              headers: baseHeaders(synthetic),
            });
          }
        }
        return new Response("not found", { status: 404, headers: baseHeaders() });
      }

      if (method === "PUT") {
        const ifMatch = headers.get("if-match");
        const ifNoneMatch = headers.get("if-none-match");
        if (ifNoneMatch === "*" && existing) {
          return new Response("already exists", { status: 412, headers: baseHeaders(existing) });
        }
        if (ifMatch !== null) {
          if (!existing || makeEtag(existing) !== ifMatch) {
            return new Response("precondition failed", {
              status: 412,
              headers: baseHeaders(existing),
            });
          }
        }
        const body = typeof init?.body === "string" ? init.body : "";
        const next: StoredResource = {
          body,
          contentType: headers.get("content-type") ?? "text/turtle",
          version: (existing?.version ?? 0) + 1,
        };
        resources.set(url, next);
        return new Response(null, { status: existing ? 204 : 201, headers: baseHeaders(next) });
      }

      if (method === "DELETE") {
        if (!existing) return new Response(null, { status: 404 });
        resources.delete(url);
        return new Response(null, { status: 204 });
      }

      return new Response("method not allowed", { status: 405 });
    }) as typeof fetch,
  };

  for (const [url, turtle] of Object.entries(initial)) stub.seed(url, turtle);
  return stub;
}
