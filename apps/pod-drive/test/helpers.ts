// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Test helpers: parse Turtle into an n3.Store (the dataset shape @jeswr/fetch-rdf
// returns) and a minimal fake fetch for the WAC/read-path tests.

import { Parser, Store } from "n3";

/** Parse a Turtle string into an n3.Store, resolving relative IRIs against base. */
export function turtle(text: string, baseIRI = "https://pod.example/"): Store {
  const store = new Store();
  const parser = new Parser({ baseIRI });
  store.addQuads(parser.parse(text));
  return store;
}

/**
 * A fake `fetch` that returns a canned Turtle body (or a status) for any URL.
 * Used to drive the read facade without a live pod.
 */
export function fakeFetch(opts: {
  status?: number;
  body?: string;
  contentType?: string;
  etag?: string | null;
}): typeof globalThis.fetch {
  const { status = 200, body = "", contentType = "text/turtle", etag = '"abc"' } = opts;
  const ok = status >= 200 && status < 300;
  return (async () => {
    const headers = new Headers();
    if (ok) {
      headers.set("content-type", contentType);
      if (etag !== null) {
        headers.set("etag", etag);
      }
    }
    return new Response(ok ? body : null, { status, headers });
  }) as unknown as typeof globalThis.fetch;
}

/** Apply a final URL to a Response (fetch sets `.url`, which the Response ctor does not). */
export function withUrl(
  fetchFn: typeof globalThis.fetch,
  finalUrl: string,
): typeof globalThis.fetch {
  return (async (...args: Parameters<typeof globalThis.fetch>) => {
    const res = await fetchFn(...args);
    Object.defineProperty(res, "url", { value: finalUrl, configurable: true });
    return res;
  }) as typeof globalThis.fetch;
}
