// AUTHORED-BY Claude Fable 5
//
// The DEMO pod: a strictly READ-ONLY in-memory `fetch` over a fixed map of
// Turtle documents. It exists so the real views can render inert sample data
// with ZERO network and ZERO writes:
//   • GET/HEAD only — served from the in-memory map with an ETag and the
//     `Link: <...>; rel="acl"` header the ACL discovery path expects;
//   • container listings (trailing-"/" URLs) are synthesised from the map so
//     the ContainerDataset-based storage walk sees a real tree;
//   • EVERY other method (PUT/PATCH/POST/DELETE — i.e. every write the app
//     could ever attempt) THROWS DemoReadOnlyError before touching anything.
//     The map is never mutated; there is nothing to write to and no server to
//     reach. The thrown message surfaces in the app's SavingIndicator, so
//     Approve/Deny/Revoke stay visible but are provably inert no-ops.
//
// This module performs NO real fetch, imports NO auth code, and is only ever
// loaded behind the ?demo gate in main.tsx.

/** Thrown for any non-read request in demo mode (surfaces in the saving UI). */
export class DemoReadOnlyError extends Error {
  constructor() {
    super("Demo mode — sample data only; changes are disabled.");
    this.name = "DemoReadOnlyError";
  }
}

export interface DemoPod {
  /** The read-only fetch to inject as the demo session's `fetch`. */
  fetch: typeof fetch;
  /** Raw fixture body (test helper — proves nothing ever changed). */
  body(url: string): string | undefined;
  /** Every request served, for "no writes ever happened" assertions. */
  readonly log: { method: string; url: string }[];
}

/** Synthesise `<container> ldp:contains <child>.` for the fixture tree. */
function containerListing(url: string, resources: ReadonlyMap<string, string>): string {
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
  return `${lines.join("\n")}\n`;
}

/**
 * Build the read-only demo pod over a fixed URL → Turtle map. The map is
 * copied and never mutated: the returned fetch can only observe it.
 */
export function createDemoPod(fixtures: Record<string, string>): DemoPod {
  const resources = new Map(Object.entries(fixtures));
  const log: { method: string; url: string }[] = [];

  const demoFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // A real fetch never sends the fragment — strip it like the network would.
    const url = rawUrl.split("#")[0] ?? rawUrl;
    // Derive the method from EVERY form a caller can express it in: an
    // explicit `init.method` wins (fetch semantics), else a `Request`
    // object's own method, else GET. A Request-object PUT must hit the
    // write-refusal chokepoint exactly like `fetch(url, { method: "PUT" })`.
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    log.push({ method, url });

    if (method !== "GET" && method !== "HEAD") {
      // The single write chokepoint: refuse BEFORE anything else. No state
      // exists to mutate and no network is ever reached.
      throw new DemoReadOnlyError();
    }

    const headers = (present: boolean): HeadersInit => {
      const h: Record<string, string> = {};
      if (present) {
        h.etag = '"demo"';
        h["content-type"] = "text/turtle";
      }
      if (!url.endsWith(".acl")) h.link = `<${url}.acl>; rel="acl"`;
      return h;
    };

    const stored = resources.get(url);
    if (stored !== undefined) {
      return new Response(method === "HEAD" ? null : stored, {
        status: 200,
        headers: headers(true),
      });
    }
    if (url.endsWith("/")) {
      const listing = containerListing(url, resources);
      if (listing.includes("ldp#contains")) {
        return new Response(method === "HEAD" ? null : listing, {
          status: 200,
          headers: headers(true),
        });
      }
    }
    return new Response("not found", { status: 404, headers: headers(false) });
  }) as typeof fetch;

  return { fetch: demoFetch, body: (url) => resources.get(url), log };
}
