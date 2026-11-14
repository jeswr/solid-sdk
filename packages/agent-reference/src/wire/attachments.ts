// AUTHORED-BY Codex GPT-6
/** Content-addressed, bounded carriage. Digest/length admission precedes all parsing. */
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory, type Store } from "n3";
import { digestBytes } from "../core/canonical.js";
import type { PilotLimits } from "../core/limits.js";
import {
  ATTACHMENT,
  type AttachmentValue,
  bindAttachments,
  materializeAttachments,
} from "../model/attachments.js";
import { IndexedStore } from "../model/indexed-store.js";
import { AWP } from "../profile/vocabulary.js";
import { DocumentError } from "./contexts.js";
import {
  type DocumentNode,
  type JsonLdDocument,
  type ReadResult,
  readDocument,
  refusal,
  validateRoot,
  writeDocument,
} from "./document.js";

export const ATTACHMENT_THRESHOLD = 8 * 1024;
export const ATTACHMENT_LIMITS = Object.freeze({
  perAttachment: 2 * 1024 * 1024,
  perPacket: 8 * 1024 * 1024,
  count: 32,
  quads: 32_768,
  valueDepth: 32,
});
export interface DocumentAttachment {
  readonly digest: string;
  readonly mediaType: string;
  readonly byteLength: number;
  /** Canonical base64 of the exact content bytes; JSON-safe for durable outboxes. */
  readonly bytes: string;
}
export interface AttachmentDocument {
  readonly document: JsonLdDocument;
  readonly attachments: readonly DocumentAttachment[];
  readonly dataset: Store;
}
const { namedNode: nn, literal, quad } = DataFactory;
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SCHEMA = "https://schema.org/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const DIGEST = AWP + "attachmentDigest",
  LENGTH = AWP + "byteLength",
  MEDIA = SCHEMA + "encodingFormat",
  DATATYPE = AWP + "attachmentDatatype";
const collections = new Set([AWP + "NamedValueCollection", SCHEMA + "ItemList"]);
const links = new Set([SCHEMA + "itemListElement", SCHEMA + "value"]);
const open = new Set(
  [
    "parameters",
    "description",
    "terms",
    "input",
    "output",
    "observed",
    "selection",
    "statementPayload",
    "bytes",
  ].map((x) => AWP + x),
);

/** Follow only owned named-value structure, never domain IRIs or back-references. */
function valueTree(dataset: Store, root: string): Store {
  const output = new IndexedStore(),
    pending = [root],
    seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const q of dataset.getQuads(nn(id), null, null, DataFactory.defaultGraph())) {
      output.addQuad(q);
      if (
        links.has(q.predicate.value) &&
        q.object.termType === "NamedNode" &&
        dataset.countQuads(q.object, nn(TYPE), null, DataFactory.defaultGraph())
      ) {
        const types = dataset
          .getObjects(q.object, nn(TYPE), DataFactory.defaultGraph())
          .map((t) => t.value);
        if (
          types.some(
            (t) => collections.has(t) || t === SCHEMA + "PropertyValue" || t === AWP + "NullValue",
          )
        )
          pending.push(q.object.value);
      }
    }
  }
  return output;
}
function reference(
  dataset: Store,
  id: string,
  bytes: Uint8Array,
  mediaType: string,
  datatype?: string,
): DocumentAttachment {
  if (bytes.byteLength > ATTACHMENT_LIMITS.perAttachment)
    throw new DocumentError("attachment-too-large", "bounds-exceeded");
  const digest = digestBytes(bytes);
  dataset.addQuad(nn(id), nn(TYPE), nn(ATTACHMENT));
  dataset.addQuad(nn(id), nn(DIGEST), literal(digest));
  dataset.addQuad(nn(id), nn(LENGTH), literal(String(bytes.byteLength), nn(XSD + "integer")));
  dataset.addQuad(nn(id), nn(MEDIA), literal(mediaType));
  if (datatype) dataset.addQuad(nn(id), nn(DATATYPE), nn(datatype));
  return {
    digest,
    mediaType,
    byteLength: bytes.byteLength,
    bytes: Buffer.from(bytes).toString("base64"),
  };
}
/** Prepare the graph the signature will cover. The caller's dataset is never mutated. */
export async function writeAttachmentDocument(
  node: DocumentNode,
  options: { limits?: PilotLimits } = {},
): Promise<AttachmentDocument> {
  const id = node.id ?? node.value;
  if (!id) throw new DocumentError("invalid-root-iri");
  const dataset = new IndexedStore([...materializeAttachments(node.dataset as Store)]),
    attachments = new Map<string, DocumentAttachment>(),
    values = new Map<string, AttachmentValue>();
  // Outer collections first. Removing an attached tree also removes nested candidates.
  const privateNames = new Set([
    "partial",
    "share",
    "shares",
    "packet",
    "audit_opening",
    "auditOpening",
    "localPartial",
    "signing_secret",
    "encryption_secret",
  ]);
  let privatePayload = false;
  const candidates = [...dataset]
    .filter((q) => open.has(q.predicate.value) && q.object.termType === "NamedNode")
    .map((q) => q.object.value);
  for (const root of candidates) {
    if (!dataset.getObjects(nn(root), nn(TYPE), null).some((t) => collections.has(t.value)))
      continue;
    const tree = valueTree(dataset, root);
    const bytes = Buffer.from(
      await serialize([...tree], { format: "application/n-quads" }),
      "utf8",
    );
    const sensitive = [...tree].some(
      (q) => q.predicate.value === SCHEMA + "name" && privateNames.has(q.object.value),
    );
    privatePayload ||= sensitive;
    if (bytes.byteLength <= ATTACHMENT_THRESHOLD && !sensitive) continue;
    // A shared child must stay visible to all its owners. Do not remove another field's data.
    const owned = new Set([...tree].map((q) => q.subject.value));
    if (
      [...dataset].some(
        (q) => owned.has(q.object.value) && q.object.value !== root && !owned.has(q.subject.value),
      )
    )
      continue;
    dataset.removeQuads([...tree]);
    for (const type of tree.getObjects(nn(root), nn(TYPE), null))
      dataset.addQuad(nn(root), nn(TYPE), type);
    const attachment = reference(dataset, root, bytes, "application/n-quads");
    attachments.set(attachment.digest, attachment);
    values.set(root, { graph: tree });
  }
  // Large original JWSs, envelope strings and content remain exact UTF-8, not JSON blobs.
  for (const q of [...dataset]) {
    if (
      q.object.termType !== "Literal" ||
      q.object.language ||
      (Buffer.byteLength(q.object.value) <= ATTACHMENT_THRESHOLD &&
        !(privatePayload && [AWP + "jws", AWP + "envelopeBytes"].includes(q.predicate.value)))
    )
      continue;
    const root =
      "urn:awp:attachment:" +
      digestBytes(
        q.subject.value + "\0" + q.predicate.value + "\0" + q.object.value + "\0" + q.graph.value,
      ).slice(8);
    dataset.removeQuad(q);
    const attachment = reference(
      dataset,
      root,
      Buffer.from(q.object.value, "utf8"),
      "text/plain;charset=utf-8",
      q.object.datatype.value,
    );
    dataset.addQuad(quad(q.subject, q.predicate, nn(root), q.graph));
    attachments.set(attachment.digest, attachment);
    values.set(root, { term: q.object });
  }
  bindAttachments(dataset, values);
  const document = await writeDocument({ id, dataset }, options);
  const list = [...attachments.values()];
  checkCarriageSize(JSON.stringify(document), list);
  return { document, attachments: list, dataset };
}
export function checkCarriageSize(
  document: string | Uint8Array,
  attachments: readonly DocumentAttachment[],
): void {
  if (attachments.length > ATTACHMENT_LIMITS.count)
    throw new DocumentError("too-many-attachments", "bounds-exceeded");
  let total = Buffer.byteLength(document);
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment))
      throw new DocumentError("attachment-malformed");
    if (!Number.isSafeInteger(attachment.byteLength) || attachment.byteLength < 0)
      throw new DocumentError("attachment-length-mismatch");
    // Check declared AND encoded lengths before decoding, hashing, or parsing anything.
    if (
      attachment.byteLength > ATTACHMENT_LIMITS.perAttachment ||
      typeof attachment.bytes !== "string" ||
      attachment.bytes.length > 4 * Math.ceil(ATTACHMENT_LIMITS.perAttachment / 3)
    )
      throw new DocumentError("attachment-too-large", "bounds-exceeded");
    if (
      Object.keys(attachment).some(
        (key) => !["digest", "mediaType", "byteLength", "bytes"].includes(key),
      ) ||
      typeof attachment.digest !== "string" ||
      !/^sha-256:[a-f0-9]{64}$/.test(attachment.digest) ||
      typeof attachment.mediaType !== "string" ||
      attachment.mediaType.length > 128
    )
      throw new DocumentError("attachment-malformed");
    total += Math.max(attachment.byteLength, Math.floor((attachment.bytes.length * 3) / 4) - 2);
    if (total > ATTACHMENT_LIMITS.perPacket)
      throw new DocumentError("attachment-packet-too-large", "bounds-exceeded");
  }
}

/** An attachment owns a tree of value nodes, never another signed node or a cycle.
 * A shared subtree can expand exponentially in object-shaped policy traversals.
 */
function checkValueTree(
  graph: Store,
  dataset: Store,
  root: string,
  attachmentNodes: Set<string>,
): void {
  const seen = new Set<string>();
  const pending = [{ id: root, depth: 0 }];
  while (pending.length) {
    const { id, depth } = pending.pop()!;
    if (depth > ATTACHMENT_LIMITS.valueDepth)
      throw new DocumentError("attachment-too-deep", "bounds-exceeded");
    if (seen.has(id)) throw new DocumentError("attachment-invalid-graph");
    seen.add(id);
    if (attachmentNodes.has(id)) throw new DocumentError("attachment-node-collision");
    attachmentNodes.add(id);
    const term = nn(id);
    if (
      id !== root &&
      (dataset.countQuads(term, null, null, null) ||
        dataset.countQuads(null, null, term, null) ||
        dataset.countQuads(null, null, null, term))
    )
      throw new DocumentError("attachment-node-collision");
    for (const q of graph.getQuads(term, null, null, null))
      if (
        links.has(q.predicate.value) &&
        q.object.termType === "NamedNode" &&
        graph.countQuads(q.object, null, null, null)
      )
        pending.push({ id: q.object.value, depth: depth + 1 });
  }
}
export async function admitAttachments(
  dataset: Store,
  document: string | Uint8Array,
  attachments: readonly DocumentAttachment[],
  root: string,
): Promise<void> {
  checkCarriageSize(document, attachments);
  const refs = dataset.getSubjects(nn(TYPE), nn(ATTACHMENT), DataFactory.defaultGraph());
  const reachable = new Set<string>(),
    pending = [root];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const q of dataset.getQuads(nn(id), null, null, null)) {
      if (q.object.termType === "NamedNode") pending.push(q.object.value);
      if (q.predicate.value === "https://w3id.org/security#proof")
        for (const proof of dataset.getQuads(null, null, null, q.object as never))
          pending.push(proof.subject.value);
    }
  }
  for (const subject of dataset.getSubjects(nn(DIGEST), null, null))
    if (!refs.some((ref) => ref.equals(subject)))
      throw new DocumentError("attachment-reference-malformed");
  if (refs.some((ref) => !reachable.has(ref.value)))
    throw new DocumentError("attachment-unreferenced");
  const expected = new Map<
    string,
    { id: string; mediaType: string; byteLength: number; datatype?: string }[]
  >();
  const one = (id: string, predicate: string) => {
    const terms = dataset.getObjects(nn(id), nn(predicate), DataFactory.defaultGraph());
    if (terms.length !== 1) throw new DocumentError("attachment-reference-malformed");
    return terms[0]!;
  };
  for (const ref of refs) {
    const digest = one(ref.value, DIGEST),
      mediaType = one(ref.value, MEDIA),
      length = one(ref.value, LENGTH);
    if (
      digest.termType !== "Literal" ||
      !/^sha-256:[a-f0-9]{64}$/.test(digest.value) ||
      mediaType.termType !== "Literal" ||
      length.termType !== "Literal" ||
      length.datatype.value !== XSD + "integer"
    )
      throw new DocumentError("attachment-reference-malformed");
    if (!Number.isSafeInteger(Number(length.value)) || Number(length.value) < 0)
      throw new DocumentError("attachment-reference-malformed");
    if (Number(length.value) > ATTACHMENT_LIMITS.perAttachment)
      throw new DocumentError("attachment-too-large", "bounds-exceeded");
    const allowed = new Set([TYPE, DIGEST, LENGTH, MEDIA, DATATYPE]);
    if (dataset.getQuads(ref, null, null, null).some((q) => !allowed.has(q.predicate.value)))
      throw new DocumentError("attachment-reference-malformed");
    const datatype = dataset.getObjects(ref, nn(DATATYPE), DataFactory.defaultGraph());
    if (datatype.length > 1 || datatype.some((t) => t.termType !== "NamedNode"))
      throw new DocumentError("attachment-reference-malformed");
    const entries = expected.get(digest.value) ?? [];
    entries.push({
      id: ref.value,
      mediaType: mediaType.value,
      byteLength: Number(length.value),
      ...(datatype[0] ? { datatype: datatype[0].value } : {}),
    });
    expected.set(digest.value, entries);
  }
  const seen = new Set<string>(),
    verified: { attachment: DocumentAttachment; bytes: Uint8Array }[] = [];
  for (const attachment of attachments) {
    if (seen.has(attachment.digest)) throw new DocumentError("attachment-duplicate");
    seen.add(attachment.digest);
    const entries = expected.get(attachment.digest);
    if (!entries) throw new DocumentError("attachment-unreferenced");
    const bytes = Buffer.from(attachment.bytes, "base64");
    if (
      bytes.toString("base64") !== attachment.bytes ||
      bytes.byteLength !== attachment.byteLength ||
      entries.some((e) => e.byteLength !== bytes.byteLength)
    )
      throw new DocumentError("attachment-length-mismatch");
    if (entries.some((e) => e.mediaType !== attachment.mediaType))
      throw new DocumentError("attachment-media-type-mismatch");
    if (digestBytes(bytes) !== attachment.digest)
      throw new DocumentError("attachment-digest-mismatch");
    verified.push({ attachment, bytes });
  }
  if ([...expected.keys()].some((digest) => !seen.has(digest)))
    throw new DocumentError("attachment-missing");
  // All packet attachments have passed integrity checks before the first payload is parsed.
  const values = new Map<string, AttachmentValue>();
  const attachmentNodes = new Set<string>();
  for (const { attachment, bytes } of verified)
    for (const entry of expected.get(attachment.digest)!) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (entry.mediaType === "application/n-quads" && !entry.datatype) {
        const parsed = await parseRdf(text, "application/n-quads", {
          maxBytes: ATTACHMENT_LIMITS.perAttachment,
          maxQuads: ATTACHMENT_LIMITS.quads,
        });
        const graph = new IndexedStore([...parsed]);
        if (
          graph.getGraphs(null, null, null).some((g) => g.termType !== "DefaultGraph") ||
          valueTree(graph, entry.id).size !== graph.size ||
          graph.countQuads(null, nn(TYPE), nn(ATTACHMENT), null) ||
          !graph.getObjects(nn(entry.id), nn(TYPE), null).some((t) => collections.has(t.value)) ||
          [...collections].some(
            (type) =>
              Boolean(graph.countQuads(nn(entry.id), nn(TYPE), nn(type), null)) !==
              Boolean(dataset.countQuads(nn(entry.id), nn(TYPE), nn(type), null)),
          )
        )
          throw new DocumentError("attachment-invalid-graph");
        checkValueTree(graph, dataset, entry.id, attachmentNodes);
        values.set(entry.id, { graph });
      } else if (entry.mediaType === "text/plain;charset=utf-8" && entry.datatype)
        values.set(entry.id, { term: literal(text, nn(entry.datatype)) });
      else throw new DocumentError("attachment-media-type-mismatch");
    }
  bindAttachments(dataset, values);
}
export async function readAttachmentDocument(
  bytes: string | Uint8Array,
  attachments: readonly DocumentAttachment[],
  options: { limits?: PilotLimits; suite?: "jws" | "data-integrity" } = {},
): Promise<ReadResult> {
  try {
    checkCarriageSize(bytes, attachments);
    const admitted = await readDocument(bytes, "application/ld+json", options);
    if (!admitted.ok) return admitted;
    await admitAttachments(admitted.dataset, bytes, attachments, admitted.root);
    await validateRoot(materializeAttachments(admitted.dataset), admitted.root);
    return admitted;
  } catch (error) {
    return refusal(error);
  }
}
