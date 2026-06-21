// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// A Map-backed fake Solid pod implementing the node's SolidTransport contract,
// used to drive the operation tests WITHOUT a real server or n8n runtime. It
// models the LDP behaviours the operations rely on: GET/PUT/DELETE, ETags,
// If-None-Match / If-Match preconditions, 404s, and a synthesised Turtle
// container listing for any container path.

import type {
  SolidHttpRequest,
  SolidHttpResponse,
  SolidTransport,
} from "../nodes/Solid/operations.js";

interface StoredResource {
  body: string;
  contentType: string;
  etag: string;
}

export interface FakePodOptions {
  /** The pod base (used to synthesise container listings). */
  base: string;
  /** Record every request the node issues (for assertions). */
  log?: SolidHttpRequest[];
}

/**
 * Create a fake pod transport + its backing store. The store maps absolute
 * resource URLs to their bytes; containers are synthesised on GET from the set of
 * stored resources whose URL is a direct child of the requested container.
 */
export function createFakePod(opts: FakePodOptions): {
  transport: SolidTransport;
  store: Map<string, StoredResource>;
  log: SolidHttpRequest[];
} {
  const store = new Map<string, StoredResource>();
  const log = opts.log ?? [];
  let etagSeq = 0;

  const nextEtag = (): string => `"etag-${++etagSeq}"`;

  const isContainer = (url: string): boolean => new URL(url).pathname.endsWith("/");

  /** Build a Turtle container listing of the direct children of `containerUrl`. */
  const listingTurtle = (containerUrl: string): string => {
    const c = new URL(containerUrl);
    const directChildren = new Set<string>();
    for (const key of store.keys()) {
      const u = new URL(key);
      if (u.origin !== c.origin) {
        continue;
      }
      if (!u.pathname.startsWith(c.pathname) || u.pathname === c.pathname) {
        continue;
      }
      const rest = u.pathname.slice(c.pathname.length);
      const firstSeg = rest.split("/")[0];
      if (!firstSeg) {
        continue;
      }
      // A direct child resource has no further slash; otherwise it implies a
      // sub-container child (firstSeg + "/").
      const isDeeper = rest.indexOf("/") !== -1 && rest.indexOf("/") < rest.length - 1;
      directChildren.add(isDeeper ? `${firstSeg}/` : firstSeg);
    }
    const triples = [...directChildren]
      .map((child) => `<${containerUrl}> ldp:contains <${containerUrl}${child}> .`)
      .join("\n");
    return `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${containerUrl}> a ldp:Container .\n${triples}\n`;
  };

  const transport: SolidTransport = async (req: SolidHttpRequest): Promise<SolidHttpResponse> => {
    log.push(req);
    const url = req.url;

    if (req.method === "GET") {
      if (isContainer(url)) {
        // A container exists if it is the base, or any resource lives under it.
        const exists = url === opts.base || [...store.keys()].some((k) => k.startsWith(url));
        if (!exists && url !== opts.base) {
          return resp(404, {}, "Not Found");
        }
        return resp(200, { "content-type": "text/turtle" }, listingTurtle(url));
      }
      const stored = store.get(url);
      if (!stored) {
        return resp(404, {}, "Not Found");
      }
      return resp(200, { "content-type": stored.contentType, etag: stored.etag }, stored.body);
    }

    if (req.method === "PUT") {
      const exists = store.has(url);
      const ifNoneMatch = req.headers["if-none-match"];
      const ifMatch = req.headers["if-match"];
      if (ifNoneMatch === "*" && exists) {
        return resp(412, {}, "Precondition Failed");
      }
      if (ifMatch !== undefined) {
        const stored = store.get(url);
        if (!stored || stored.etag !== ifMatch) {
          return resp(412, {}, "Precondition Failed");
        }
      }
      const etag = nextEtag();
      store.set(url, {
        body: req.body ?? "",
        contentType: req.headers["content-type"] ?? "application/octet-stream",
        etag,
      });
      return resp(exists ? 205 : 201, { etag }, "");
    }

    if (req.method === "DELETE") {
      if (!store.has(url)) {
        return resp(404, {}, "Not Found");
      }
      store.delete(url);
      return resp(204, {}, "");
    }

    return resp(405, {}, "Method Not Allowed");
  };

  return { transport, store, log };
}

function resp(
  statusCode: number,
  headers: Record<string, string | undefined>,
  body: string,
): SolidHttpResponse {
  return { statusCode, headers, body };
}
