// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 4.8 (original public API)
/** Canonical AS2 facade: generated scalar guards plus chat identity/task policy. */
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import type { CanonicalMessage } from "./canonical.js";
import { readMessageIris, writeMessageIris } from "./canonical-iris.js";
import { entities } from "./generated/model.js";
import { safeHttpIri, sanitizeText, tryRead } from "./iri.js";
import { As2MessageDoc } from "./message-view.js";
import {
  AS,
  DCT_IS_REPLACED_BY,
  DCT_TITLE,
  DEFAULT_MEDIA_TYPE,
  PROV,
  RDF_TYPE,
  SCHEMA_DATE_DELETED,
  TASK_CLASS,
  WF_ASSIGNEE,
  WF_CLOSED,
  WF_OPEN,
} from "./vocab.js";

const message = entities.Message;

export { As2MessageDoc } from "./message-view.js";

/** Conventional resource subject; the historic helper only appends #it. */
export function as2MessageSubject(resourceUrl: string): string {
  return `${resourceUrl}#it`;
}

export function parseAs2Message(
  subject: string,
  dataset: DatasetCore,
): CanonicalMessage | undefined {
  const doc = tryRead(() => new As2MessageDoc(subject, dataset, DataFactory));
  if (!doc?.isInstance) return undefined;
  // Foreign incomplete notes remain readable (the oracle includes bad/missing
  // timestamps). The generated wrapper still guards EACH field; this compatibility
  // projection is not SHACL conformance and never changes the input graph.
  const data = message.parse(subject, dataset) ?? {
    content: doc.content,
    mediaType: doc.mediaType,
    published: doc.published,
    deletedAt: doc.deletedAt,
    taskTitle: doc.taskTitle,
  };
  const iris = readMessageIris(doc);
  const msg: CanonicalMessage = {
    id: subject,
    content: data.content ?? "",
    mediaType: data.mediaType ?? DEFAULT_MEDIA_TYPE,
  };
  if (iris.author !== undefined) msg.author = iris.author;
  if (data.published !== undefined) msg.published = data.published.toISOString();
  for (const key of ["room", "inReplyTo", "replacedBy"] as const) {
    if (iris[key] !== undefined) msg[key] = iris[key];
  }
  if (data.deletedAt !== undefined) msg.deletedAt = data.deletedAt.toISOString();
  const provenance = {
    ...(iris.provAttributedTo === undefined ? {} : { attributedTo: iris.provAttributedTo }),
    ...(iris.provGeneratedBy === undefined ? {} : { generatedBy: iris.provGeneratedBy }),
    ...(iris.provDerivedFrom === undefined ? {} : { derivedFrom: iris.provDerivedFrom }),
  };
  if (Object.keys(provenance).length) msg.provenance = provenance;
  // Qualified rdf:type constraints and co-typed task overlays are not admitted.
  // Read type objects independently: a garbage literal cannot hide valid types.
  const types = new Set(
    [...dataset.match(DataFactory.namedNode(subject), DataFactory.namedNode(RDF_TYPE))]
      .filter((q) => q.object.termType === "NamedNode")
      .map((q) => q.object.value),
  );
  if (types.has(TASK_CLASS))
    msg.task = {
      state: types.has(WF_CLOSED) ? "closed" : "open",
      ...(data.taskTitle === undefined ? {} : { title: data.taskTitle }),
      ...(iris.assignee === undefined ? {} : { assignee: iris.assignee }),
    };
  return msg;
}

export function buildAs2Message(subject: string, msg: CanonicalMessage): Store {
  const safeSubject = safeHttpIri(subject);
  if (safeSubject === undefined)
    throw new TypeError("buildAs2Message: subject must be an absolute http(s) IRI");
  const iris = {
    author: msg.author,
    room: msg.room,
    inReplyTo: msg.inReplyTo,
    replacedBy: msg.replacedBy,
    provAttributedTo: msg.provenance?.attributedTo,
    provGeneratedBy: msg.provenance?.generatedBy,
    provDerivedFrom: msg.provenance?.derivedFrom,
    assignee: msg.task?.assignee,
  };
  const store = message.build(safeSubject, {
    content: msg.content,
    mediaType: sanitizeText(msg.mediaType)?.trim() || DEFAULT_MEDIA_TYPE,
    // Required fields cannot carry config defaults; compute the write-only now here.
    published: msg.published ? new Date(msg.published) : new Date(),
    deletedAt: msg.deletedAt ? new Date(msg.deletedAt) : undefined,
    taskTitle: msg.task?.title,
  });
  const doc = new As2MessageDoc(safeSubject, store, DataFactory);
  writeMessageIris(doc, iris);
  if (msg.task) {
    doc.types.add(TASK_CLASS);
    doc.types.add(msg.task.state === "closed" ? WF_CLOSED : WF_OPEN);
  }
  // Keep original Store/Turtle predicate ordering after guarded lexical restoration.
  const order = [
    RDF_TYPE,
    `${AS}content`,
    `${AS}mediaType`,
    `${AS}attributedTo`,
    `${AS}published`,
    `${AS}context`,
    `${AS}inReplyTo`,
    DCT_IS_REPLACED_BY,
    SCHEMA_DATE_DELETED,
    `${PROV}wasAttributedTo`,
    `${PROV}wasGeneratedBy`,
    `${PROV}wasDerivedFrom`,
    DCT_TITLE,
    WF_ASSIGNEE,
  ];
  const rank = new Map(order.map((predicate, index) => [predicate, index]));
  return new Store(
    [...store].sort(
      (a, b) =>
        (rank.get(a.predicate.value) ?? order.length) -
        (rank.get(b.predicate.value) ?? order.length),
    ),
  );
}

export { isHttpIri } from "./iri.js";
