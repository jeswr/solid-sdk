// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Test-only helpers. Parses Turtle to an `n3.Store` (the read side feeds parse
 * functions a real dataset), and a tiny scripted-fetch mock so I/O paths are
 * unit-testable without a pod. NOT part of the public surface — excluded from
 * the build entry; lives in `src/` only so the gate typechecks it.
 */
import { Parser, Store } from "n3";

/** Parse Turtle into an `n3.Store` rooted at `baseIRI` (relative IRIs resolve). */
export function turtleToStore(turtle: string, baseIRI: string): Store {
  const store = new Store();
  const parser = new Parser({ baseIRI });
  store.addQuads(parser.parse(turtle));
  return store;
}

/**
 * Normalise RequestInit headers to a lower-cased plain object, whether passed as
 * a `Headers` instance, a `[k, v][]` array, or a plain object (`@jeswr/fetch-rdf`
 * builds a `Headers` instance internally).
 */
export function normaliseHeaders(raw: RequestInit["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw instanceof Headers) {
    raw.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
  } else if (Array.isArray(raw)) {
    for (const pair of raw) {
      const k = pair[0];
      const v = pair[1];
      if (k !== undefined && v !== undefined) out[k.toLowerCase()] = v;
    }
  } else if (raw) {
    for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = v as string;
  }
  return out;
}

/** One scripted response in a {@link mockFetch} script. */
export interface MockResponse {
  /** HTTP status (defaults to 200 for GET, 201 for PUT, 205 for DELETE). */
  status?: number | undefined;
  /** Body for a GET (Turtle); ignored for PUT/DELETE. */
  body?: string | undefined;
  /** `content-type` header for a GET (defaults to `text/turtle`). */
  contentType?: string | undefined;
  /** `etag` header to return. */
  etag?: string | undefined;
  headers?: Record<string, string> | undefined;
}

/** A recorded call made against a {@link mockFetch}. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

/**
 * Build a `fetch`-shaped mock from a `url+method → response` script. Unknown
 * routes resolve to 404. Records every call on `.calls` for assertions.
 */
export function mockFetch(script: Record<string, MockResponse>): {
  fetch: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = normaliseHeaders(init?.headers);
    calls.push({ url, method, headers, body: init?.body as string | undefined });

    const planned = script[`${method} ${url}`];
    if (!planned) {
      return new Response("not found", { status: 404 });
    }
    const status = planned.status ?? (method === "PUT" ? 201 : method === "DELETE" ? 205 : 200);
    const responseHeaders: Record<string, string> = {
      "content-type": planned.contentType ?? "text/turtle",
      ...planned.headers,
    };
    if (planned.etag) responseHeaders.etag = planned.etag;
    return new Response(method === "GET" ? (planned.body ?? "") : null, {
      status,
      headers: responseHeaders,
    });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

/** Explicit owner-only WAC fixture for tests that write a private Type Index. */
export function privateIndexPolicy(resource: string, owner: string): Record<string, MockResponse> {
  return {
    [`HEAD ${resource}`]: { headers: { link: `<${resource}.acl>; rel="acl"` } },
    [`GET ${resource}.acl`]: {
      body: `
      @prefix acl: <http://www.w3.org/ns/auth/acl#>.
      <#owner> a acl:Authorization; acl:accessTo <${resource}>;
        acl:agent <${owner}>; acl:mode acl:Read, acl:Write, acl:Control.
    `,
    },
  };
}
