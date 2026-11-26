// AUTHORED-BY Claude Opus 5.5
/**
 * An in-memory Solid pod for access-control tests: resources advertise their
 * own `.acl` through `Link: rel="acl"`, ACL documents carry ETags that change on
 * every write, and `PUT` honours `If-Match` / `If-None-Match: *` (412 on a
 * mismatch). Every request is recorded so tests can assert the exact writes.
 */

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface AclPod {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  /** ACL documents by URL (Turtle). */
  docs: Map<string, { body: string; etag: string }>;
  /** The PUTs sent so far. */
  puts(): RecordedRequest[];
  /** Replace an ACL document out of band (a concurrent writer). */
  setAcl(aclUrl: string, body: string): void;
  /** Force the next PUT responses to these statuses (e.g. 403), in order. */
  failNextPuts(...statuses: number[]): void;
}

/**
 * @param resources - URLs that exist (containers end in `/`).
 * @param acls - initial ACL documents keyed by ACL URL (`<resource>.acl`).
 */
export function aclPod(resources: string[], acls: Record<string, string>): AclPod {
  const known = new Set(resources);
  const docs = new Map<string, { body: string; etag: string }>();
  let version = 0;
  const nextEtag = () => `"v${++version}"`;
  for (const [url, body] of Object.entries(acls)) docs.set(url, { body, etag: nextEtag() });
  const requests: RecordedRequest[] = [];
  const forced: number[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({
      method,
      url,
      headers,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    if (url.endsWith(".acl")) {
      const doc = docs.get(url);
      if (method === "GET" || method === "HEAD") {
        if (!doc) return new Response(null, { status: 404 });
        return new Response(method === "HEAD" ? null : doc.body, {
          status: 200,
          headers: { "content-type": "text/turtle", etag: doc.etag },
        });
      }
      if (method === "PUT") {
        const status = forced.shift();
        if (status !== undefined) return new Response(null, { status });
        const ifMatch = headers["if-match"];
        const ifNoneMatch = headers["if-none-match"];
        if (ifNoneMatch === "*" && doc) return new Response(null, { status: 412 });
        if (ifMatch !== undefined && ifMatch !== doc?.etag) {
          return new Response(null, { status: 412 });
        }
        docs.set(url, { body: String(init?.body ?? ""), etag: nextEtag() });
        return new Response(null, { status: doc ? 205 : 201 });
      }
      return new Response(null, { status: 405 });
    }
    if (!known.has(url)) return new Response(null, { status: 404 });
    if (method === "GET" || method === "HEAD") {
      return new Response(method === "HEAD" ? null : "", {
        status: 200,
        headers: {
          link: `<${url}.acl>; rel="acl"`,
          etag: '"resource"',
          "content-type": "text/turtle",
        },
      });
    }
    return new Response(null, { status: 405 });
  };

  return {
    fetch: fetchImpl,
    requests,
    docs,
    puts: () => requests.filter((r) => r.method === "PUT"),
    setAcl(aclUrl, body) {
      docs.set(aclUrl, { body, etag: nextEtag() });
    },
    failNextPuts(...statuses) {
      forced.push(...statuses);
    },
  };
}
