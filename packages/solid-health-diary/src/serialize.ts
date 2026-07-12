// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The ONE reviewed home for turning an n3 `Store` into Turtle and for parsing a
 * fetched body into a dataset — so every entity module serialises/parses the same
 * way and the house rules ("serialise via `n3.Writer`", "parse via
 * `@jeswr/fetch-rdf`, never a bespoke parser") have a single audit point.
 *
 * Browser-safe: imports only `n3` and (lazily) `@jeswr/fetch-rdf` — no `node:*`.
 */

import type { DatasetCore } from "@rdfjs/types";
import { type Store, Writer } from "n3";
import { PREFIXES } from "./vocab.js";

/** Serialise any n3 `Store` to Turtle with the model's prefixes (via `n3.Writer`). */
export function storeToTurtle(store: Store): Promise<string> {
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  writer.addQuads([...store]);
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/**
 * Parse a Turtle / JSON-LD body into a dataset, dispatching on `contentType` via
 * `@jeswr/fetch-rdf`'s `parseRdf` (the suite's vetted RDF parser — never a bespoke
 * one).
 *
 * @param body        - the raw response body.
 * @param url         - the resource URL (base IRI for relative refs).
 * @param contentType - the `Content-Type` header value (null ⇒ text/turtle, per
 *   the Solid Protocol §5.2 default).
 */
export async function parseBody(
  body: string,
  url: string,
  contentType: string | null = "text/turtle",
): Promise<DatasetCore> {
  // Coalesce BEFORE parsing: callers routinely pass `Response.headers.get(
  // "content-type")`, which is `null` for a header-less response, and the
  // default parameter only fires for `undefined` — so honour the documented
  // "⇒ text/turtle" default for an explicit null too.
  const resolvedContentType = contentType ?? "text/turtle";
  // Lazy import keeps the (Node-targeted) fetch-rdf dep off any pure-parse path a
  // consumer might tree-shake, and matches how the apps import it.
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  return parseRdf(body, resolvedContentType, { baseIRI: url });
}
