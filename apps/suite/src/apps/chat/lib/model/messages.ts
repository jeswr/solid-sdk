// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Reuses pod-chat's AS2/wf:Task model through solid-chat-interop.
import {
  as2ToCanonical,
  buildAs2Message,
  type CanonicalMessage,
  LongChatMessageDoc,
  longChatToCanonical,
  type MessageTask,
  sanitizeText,
} from "@jeswr/solid-chat-interop";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { messageResource, messageSubject, roomIndex } from "./paths";
import { ChatNode, NS, RDF_TYPE, readDate, readRefs } from "./rdf";
import { ChatModelError, httpIri, isoDate, text } from "./validation";

export interface ChatMessage extends CanonicalMessage {
  id: string;
  updated: string | undefined;
  tombstone: boolean;
}
export interface SendInput {
  id: string;
  author: string;
  content: string;
  at: Date;
  inReplyTo?: string;
}

/** Multi-subject day resources and SolidOS LongChat are read through the interop hub. */
export function readMessages(dataset: DatasetCore): ChatMessage[] {
  const result: ChatMessage[] = [];
  const subjects = new Set<string>();
  for (const q of dataset.match(
    null,
    DataFactory.namedNode(RDF_TYPE),
    null,
    DataFactory.defaultGraph(),
  )) {
    if (q.subject.termType === "NamedNode") subjects.add(q.subject.value);
  }
  // Named graphs must not override a default-graph message's fields.
  const graph = new Store([...dataset.match(null, null, null, DataFactory.defaultGraph())]);
  for (const id of subjects) {
    const types = readRefs(graph, id, RDF_TYPE);
    const tombstone = types.includes(`${NS.AS}Tombstone`);
    let message: CanonicalMessage | undefined;
    if (tombstone) {
      message = { id, content: "", mediaType: "text/plain" };
      const author =
        readRefs(graph, id, `${NS.AS}attributedTo`)[0] ?? readRefs(graph, id, `${NS.FOAF}maker`)[0];
      const published =
        readDate(graph, id, `${NS.AS}published`) ?? readDate(graph, id, `${NS.DCT}created`);
      const deletedAt = readDate(graph, id, `${NS.AS}deleted`);
      if (author !== undefined) message.author = author;
      if (published !== undefined) message.published = published;
      if (deletedAt !== undefined) message.deletedAt = deletedAt;
    } else {
      // PM stamps as:Note as well as sioc:Note but stores the body in sioc:content.
      message = types.includes(`${NS.SIOC}Note`)
        ? longChatToCanonical(graph, id)
        : (as2ToCanonical(graph, id) ?? longChatToCanonical(graph, id));
    }
    if (!message) continue;
    const deletedAt = readDate(graph, id, `${NS.SCHEMA}dateDeleted`);
    if (deletedAt !== undefined) message.deletedAt = deletedAt;
    result.push({ ...message, id, tombstone, updated: readDate(graph, id, `${NS.AS}updated`) });
  }
  return result.sort(
    (a, b) => (a.published ?? "").localeCompare(b.published ?? "") || a.id.localeCompare(b.id),
  );
}

export function appendMessage(dataset: DatasetCore, room: string, input: SendInput): Store {
  const id = messageSubject(room, input.at, input.id);
  httpIri(input.author);
  text(input.content);
  isoDate(input.at);
  if (input.inReplyTo !== undefined) httpIri(input.inReplyTo);
  if (dataset.match(DataFactory.namedNode(id), null, null).size)
    throw new ChatModelError("duplicate");
  const message = buildAs2Message(id, {
    content: sanitizeText(input.content),
    author: input.author,
    published: isoDate(input.at),
    room: `${roomIndex(room)}#it`,
    mediaType: "text/plain",
    ...(input.inReplyTo !== undefined ? { inReplyTo: input.inReplyTo } : {}),
  });
  return new Store([...dataset, ...message]);
}
function ownMessage(dataset: DatasetCore, subject: string, actor: string, at: Date): Store {
  httpIri(subject);
  httpIri(actor);
  isoDate(at);
  const message = readMessages(dataset).find((message) => message.id === subject);
  if (!message) throw new ChatModelError("missing-message");
  if (message.author !== actor) throw new ChatModelError("not-author");
  if (message.tombstone || message.deletedAt !== undefined) throw new ChatModelError("deleted");
  return new Store([...dataset]);
}
export function editMessage(
  dataset: DatasetCore,
  subject: string,
  actor: string,
  content: string,
  at: Date,
): Store {
  const clean = sanitizeText(content);
  text(clean);
  const result = ownMessage(dataset, subject, actor, at);
  // Updating both aliases prevents a LongChat reader showing a stale body.
  new LongChatMessageDoc(subject, result, DataFactory).content = clean;
  new ChatNode(subject, result, DataFactory).setDate(`${NS.AS}updated`, at);
  return result;
}
export function tombstoneMessage(
  dataset: DatasetCore,
  subject: string,
  actor: string,
  at: Date,
): Store {
  const result = ownMessage(dataset, subject, actor, at);
  const doc = new ChatNode(subject, result, DataFactory);
  for (const type of [
    `${NS.AS}Note`,
    `${NS.SIOC}Note`,
    `${NS.SCHEMA}Message`,
    "http://schema.org/Message",
    `${NS.WF}Task`,
    `${NS.WF}Open`,
    `${NS.WF}Closed`,
  ])
    doc.types.delete(type);
  doc.types.add(`${NS.AS}Tombstone`);
  for (const predicate of [
    `${NS.AS}content`,
    `${NS.SIOC}content`,
    `${NS.DCT}title`,
    `${NS.WF}assignee`,
  ]) {
    result.deleteMatches(DataFactory.namedNode(subject), DataFactory.namedNode(predicate));
  }
  doc.setDate(`${NS.AS}updated`, at);
  doc.setDate(`${NS.AS}deleted`, at);
  // Preserve the canonical interop deletion stamp too.
  doc.setDate(`${NS.SCHEMA}dateDeleted`, at);
  return result;
}
export function turnIntoTask(
  dataset: DatasetCore,
  subject: string,
  actor: string,
  task: MessageTask,
  at: Date,
): Store {
  if (task.state !== "open" && task.state !== "closed") throw new ChatModelError("invalid-input");
  if (task.assignee !== undefined) httpIri(task.assignee);
  const result = ownMessage(dataset, subject, actor, at);
  const doc = new ChatNode(subject, result, DataFactory);
  doc.types.add(`${NS.WF}Task`);
  doc.types.delete(`${NS.WF}Open`);
  doc.types.delete(`${NS.WF}Closed`);
  doc.types.add(`${NS.WF}${task.state === "closed" ? "Closed" : "Open"}`);
  const overlay = new LongChatMessageDoc(subject, result, DataFactory);
  overlay.taskTitle = task.title === undefined ? undefined : text(task.title);
  overlay.assignee = task.assignee;
  doc.setDate(`${NS.AS}updated`, at);
  return result;
}
/** Ensure edit targets stay within a day file of the explicitly selected room. */
export { messageResource };
