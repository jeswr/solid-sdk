// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The SHACL-bodied Protocol Document (PD) — AGORA's hash-pinned protocol document
// made RDF/SHACL-native (roadmap M2, "the single clearest novel slice"). A PD's
// body is a SHACL shape (request + optional response); the document is
// CONTENT-ADDRESSED: its hash is a sha256 over a DETERMINISTIC canonical
// serialisation of its quads, so an upgrading peer can verify a fetched PD matches
// its pinned hash before trusting it. The PD's IRI/hash is what goes into an M1
// AgentDescriptor.protocolSources. RDF is built via the GraphBuilder (typed
// wrappers) + serialised via n3.Writer — never hand-built triples.

import { createHash } from "node:crypto";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { canonicalNQuads } from "./canonical.js";
import { serialize } from "./serialize.js";
import type { ProtocolDocument, ProtocolDocumentInput, ProtocolMeta } from "./types.js";
import {
  A2A,
  A2A_INLINE_CONTEXT,
  DCTERMS,
  PROTOCOL_HASH_ALGORITHM,
  PROTOCOL_HASH_PREFIX,
  RDF_TYPE,
  SH,
} from "./vocab.js";
import { GraphBuilder } from "./wrappers.js";

/** The minted PD class + the predicates linking a PD to its shapes. */
const A2A_PROTOCOL_DOCUMENT = `${A2A}ProtocolDocument` as const;
const A2A_REQUEST_SHAPE = `${A2A}requestShape` as const;
const A2A_RESPONSE_SHAPE = `${A2A}responseShape` as const;
const DCTERMS_TITLE = `${DCTERMS}title` as const;
const DCTERMS_DESCRIPTION = `${DCTERMS}description` as const;
const DCTERMS_HAS_VERSION = `${DCTERMS}hasVersion` as const;
const SH_NODE_SHAPE = `${SH}NodeShape` as const;

/**
 * Build a Protocol Document from a request shape (+ optional response shape) and
 * metadata. The PD graph is: the PD subject typed `a2a:ProtocolDocument`, linked
 * to its shape subject(s) via `a2a:requestShape` / `a2a:responseShape`, plus the
 * supplied shape quads and the dcterms metadata. The hash is computed over the
 * canonical serialisation of the FULL graph (so it pins the shapes too).
 */
export function buildProtocolDocument(input: ProtocolDocumentInput): ProtocolDocument {
  const { requestShape, responseShape, meta } = input;
  if (!meta?.id) {
    throw new TypeError("buildProtocolDocument: meta.id (the protocol IRI) is required.");
  }
  if (!requestShape || requestShape.length === 0) {
    throw new TypeError("buildProtocolDocument: a non-empty requestShape is required.");
  }

  const b = new GraphBuilder();
  b.addIri(meta.id, RDF_TYPE, A2A_PROTOCOL_DOCUMENT);
  if (meta.name !== undefined) {
    b.addLiteral(meta.id, DCTERMS_TITLE, meta.name);
  }
  if (meta.description !== undefined) {
    b.addLiteral(meta.id, DCTERMS_DESCRIPTION, meta.description);
  }
  if (meta.version !== undefined) {
    b.addLiteral(meta.id, DCTERMS_HAS_VERSION, meta.version);
  }

  // Link the PD to its request/response shape SUBJECTS (the sh:NodeShape ids).
  for (const shapeId of nodeShapeSubjects(requestShape)) {
    b.addIri(meta.id, A2A_REQUEST_SHAPE, shapeId);
  }
  if (responseShape && responseShape.length > 0) {
    for (const shapeId of nodeShapeSubjects(responseShape)) {
      b.addIri(meta.id, A2A_RESPONSE_SHAPE, shapeId);
    }
  }

  // The full document graph = metadata quads + the shape quads.
  const quads: Quad[] = [
    ...b.quads(),
    ...(requestShape as Quad[]),
    ...((responseShape ?? []) as Quad[]),
  ];

  const hash = hashQuads(quads);
  const frozenMeta: ProtocolMeta = { ...meta };
  const requestShapeQuads = [...(requestShape as Quad[])];

  return {
    meta: frozenMeta,
    quads,
    requestShapeQuads,
    hash,
    toTurtle: (format?: string) => serialize(quads, format),
    toJsonLd: () => Promise.resolve(buildPdJsonLd(quads, frozenMeta)),
  };
}

/**
 * The sha256 hash (`sha256:<hex>`) of a set of quads, over their DETERMINISTIC
 * canonical N-Quads serialisation (blank-node labels normalised so the hash is
 * stable across runs / builders). Exposed so a caller can hash a shape directly.
 */
export function hashQuads(quads: readonly Quad[]): string {
  const canonical = canonicalNQuads(quads);
  const digest = createHash(PROTOCOL_HASH_ALGORITHM).update(canonical, "utf8").digest("hex");
  return `${PROTOCOL_HASH_PREFIX}${digest}`;
}

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
export async function verifyProtocolDocument(
  body: readonly Quad[] | DatasetCore | string,
  expectedHash: string,
  contentType = "text/turtle",
): Promise<boolean> {
  let quads: readonly Quad[];
  try {
    if (typeof body === "string") {
      const dataset = await parseRdf(body, contentType, {});
      quads = [...dataset] as Quad[];
    } else if (Array.isArray(body)) {
      quads = body;
    } else {
      quads = [...(body as DatasetCore)] as Quad[];
    }
  } catch {
    // A body that does not parse cannot match a hash — fail closed.
    return false;
  }
  return constantTimeEquals(hashQuads(quads), expectedHash);
}

/**
 * Every `sh:NodeShape` subject in a shape's quads (the shape ids the PD links to).
 * If the shape declares no NodeShape subject (a malformed shape), returns an empty
 * list — the PD still carries the shape quads, just no `a2a:requestShape` link.
 */
function nodeShapeSubjects(shape: readonly Quad[]): string[] {
  const out = new Set<string>();
  for (const q of shape) {
    if (
      q.predicate.value === RDF_TYPE &&
      q.object.termType === "NamedNode" &&
      q.object.value === SH_NODE_SHAPE &&
      q.subject.termType === "NamedNode"
    ) {
      out.add(q.subject.value);
    }
  }
  return [...out];
}

/**
 * The JSON-LD projection of a PD: the PD metadata + a reference to its shape
 * subject(s), with the pinned inline `@context`. The SHACL shape bodies are RDF
 * (Turtle is the natural serialisation); the JSON-LD form carries the metadata +
 * links so a JSON-LD consumer can discover the shapes, then fetch the Turtle for
 * the full SHACL. (We do not re-serialise arbitrary SHACL through a JSON-LD
 * library — Turtle is the canonical SHACL body; this is the discovery view.)
 */
function buildPdJsonLd(quads: readonly Quad[], meta: ProtocolMeta): Record<string, unknown> {
  const requestShapes = linkedShapeIds(quads, meta.id, A2A_REQUEST_SHAPE);
  const responseShapes = linkedShapeIds(quads, meta.id, A2A_RESPONSE_SHAPE);
  const doc: Record<string, unknown> = {
    "@context": {
      ...A2A_INLINE_CONTEXT,
      dcterms: DCTERMS,
      sh: SH,
      ProtocolDocument: A2A_PROTOCOL_DOCUMENT,
      requestShape: { "@id": A2A_REQUEST_SHAPE, "@type": "@id" },
      responseShape: { "@id": A2A_RESPONSE_SHAPE, "@type": "@id" },
      title: DCTERMS_TITLE,
      // Map `description` to dcterms:description so the emitted metadata parses
      // back to the same predicate the Turtle body uses (no silent loss).
      description: DCTERMS_DESCRIPTION,
      version: DCTERMS_HAS_VERSION,
    },
    "@id": meta.id,
    "@type": "ProtocolDocument",
  };
  if (meta.name !== undefined) {
    doc.title = meta.name;
  }
  if (meta.description !== undefined) {
    doc.description = meta.description;
  }
  if (meta.version !== undefined) {
    doc.version = meta.version;
  }
  if (requestShapes.length > 0) {
    doc.requestShape = requestShapes.map((id) => ({ "@id": id }));
  }
  if (responseShapes.length > 0) {
    doc.responseShape = responseShapes.map((id) => ({ "@id": id }));
  }
  return doc;
}

/** The IRI objects of `(subject, predicate, ?)` in the quads. */
function linkedShapeIds(quads: readonly Quad[], subject: string, predicate: string): string[] {
  const out = new Set<string>();
  for (const q of quads) {
    if (
      q.subject.value === subject &&
      q.predicate.value === predicate &&
      q.object.termType === "NamedNode"
    ) {
      out.add(q.object.value);
    }
  }
  return [...out];
}

/**
 * Length-aware constant-time-ish string compare for the hash check. The hashes
 * are public content addresses (not secrets), so timing is not a real concern;
 * still, a constant-time compare avoids any short-circuit surprise and documents
 * intent. Returns `false` on any length mismatch.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
