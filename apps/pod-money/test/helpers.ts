// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Shared test helpers — parse Turtle into an n3.Store (mirroring what
// @jeswr/fetch-rdf returns at runtime) and a fake fetchRdf / fetch for the
// store tests, so the data layer is exercised end-to-end without a network.

import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { Parser, Store } from "n3";

/** Parse Turtle into an n3.Store (what fetchRdf yields at runtime). */
export function parseTurtle(
  turtle: string,
  baseIRI = "https://pod.example/finance/ledger.ttl",
): Store {
  const store = new Store();
  store.addQuads(new Parser({ baseIRI }).parse(turtle));
  return store;
}

/** A scripted response for the fake fetchRdf, keyed by URL. */
export interface RdfFixture {
  status?: number;
  turtle?: string;
  etag?: string | null;
}

/**
 * Build a fake `fetchRdf` resolving from a URL→fixture map. A missing URL (or a
 * fixture with status 404) rejects with a 404 RdfFetchError, mirroring the real
 * package; other non-2xx statuses reject too.
 */
export function fakeFetchRdf(fixtures: Record<string, RdfFixture>) {
  return async (url: string) => {
    const f = fixtures[url];
    if (!f || f.status === 404) {
      throw new RdfFetchError(`Not found: ${url}`, { url, status: 404 });
    }
    if (f.status && f.status >= 400) {
      throw new RdfFetchError(`Error ${f.status}: ${url}`, { url, status: f.status });
    }
    const dataset: DatasetCore = parseTurtle(f.turtle ?? "", url);
    return {
      dataset,
      etag: f.etag === undefined ? '"etag-1"' : f.etag,
      contentType: "text/turtle",
      response: new Response(f.turtle ?? "", { status: 200 }),
      url,
    };
  };
}

/** A recorded PUT. */
export interface RecordedPut {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Build a fake `fetch` recording every PUT and returning a scripted status
 * (default 205). Each call shifts the next status off `statuses`, defaulting to
 * 205 when exhausted.
 */
export function fakeFetch(record: RecordedPut[], statuses: number[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    const h = init?.headers as Record<string, string> | undefined;
    if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
    record.push({ url, headers, body: String(init?.body ?? "") });
    const status = statuses.shift() ?? 205;
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}
