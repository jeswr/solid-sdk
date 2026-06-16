import type { DatasetCore, Quad } from "@rdfjs/types";
import type { ProtocolDocument, ProtocolDocumentInput } from "./types.js";
/**
 * Build a Protocol Document from a request shape (+ optional response shape) and
 * metadata. The PD graph is: the PD subject typed `a2a:ProtocolDocument`, linked
 * to its shape subject(s) via `a2a:requestShape` / `a2a:responseShape`, plus the
 * supplied shape quads and the dcterms metadata. The hash is computed over the
 * canonical serialisation of the FULL graph (so it pins the shapes too).
 */
export declare function buildProtocolDocument(input: ProtocolDocumentInput): ProtocolDocument;
/**
 * The sha256 hash (`sha256:<hex>`) of a set of quads, over their DETERMINISTIC
 * canonical N-Quads serialisation (blank-node labels normalised so the hash is
 * stable across runs / builders). Exposed so a caller can hash a shape directly.
 */
export declare function hashQuads(quads: readonly Quad[]): string;
/**
 * Verify that a Protocol Document body matches its pinned hash. The body may be
 * the parsed quads/dataset OR a Turtle/JSON-LD string (parsed via the sanctioned
 * `@jeswr/fetch-rdf` parser). Returns `true` iff the body's canonical hash equals
 * `expectedHash`. NEVER throws on a mismatch / parse failure — returns `false`.
 *
 * This is the on-the-wire trust check: an upgrading peer fetches a PD from a
 * `protocolSource`, then calls this with the offer's `protocolHash` before
 * speaking the protocol (so a tampered PD is rejected).
 *
 * @param body - the PD body (quads, a dataset, or Turtle/JSON-LD text).
 * @param expectedHash - the pinned `sha256:<hex>` to check against.
 * @param contentType - media type when `body` is text (default `text/turtle`).
 */
export declare function verifyProtocolDocument(body: readonly Quad[] | DatasetCore | string, expectedHash: string, contentType?: string): Promise<boolean>;
//# sourceMappingURL=protocol.d.ts.map