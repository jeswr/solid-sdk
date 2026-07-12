/**
 * The ONE reviewed home for turning an n3 `Store` into Turtle and for parsing a
 * fetched body into a dataset — so every entity module serialises/parses the same
 * way and the house rules ("serialise via `n3.Writer`", "parse via
 * `@jeswr/fetch-rdf`, never a bespoke parser") have a single audit point.
 *
 * Browser-safe: imports only `n3` and (lazily) `@jeswr/fetch-rdf` — no `node:*`.
 */
import type { DatasetCore } from "@rdfjs/types";
import { type Store } from "n3";
/** Serialise any n3 `Store` to Turtle with the model's prefixes (via `n3.Writer`). */
export declare function storeToTurtle(store: Store): Promise<string>;
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
export declare function parseBody(body: string, url: string, contentType?: string | null): Promise<DatasetCore>;
//# sourceMappingURL=serialize.d.ts.map