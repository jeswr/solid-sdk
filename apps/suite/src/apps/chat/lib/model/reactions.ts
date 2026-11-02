// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { readMessages } from "./messages";
import { messageResource } from "./paths";
import { ChatNode, NS, RDF_TYPE, readDate, readRefs, readText } from "./rdf";
import { ChatModelError, httpIri, isoDate, segment, text } from "./validation";

export interface Reaction {
  readonly id: string;
  readonly actorId: string;
  readonly emoji: string;
}
export interface ReactionInput {
  id: string;
  message: string;
  actor: string;
  emoji: string;
  at: Date;
}
export interface UndoInput extends Omit<ReactionInput, "emoji"> {
  reaction: string;
}

/** Read only active, same-document Likes; only their author can undo them. */
export function readReactions(dataset: DatasetCore): Map<string, Reaction[]> {
  const messages = new Set(readMessages(dataset).map((message) => message.id));
  const likes = new Map<string, { message: string; reaction: Reaction }>();
  const undos: { object: string; actor: string }[] = [];
  const subjects = new Set<string>();
  for (const q of dataset.match(
    null,
    DataFactory.namedNode(RDF_TYPE),
    null,
    DataFactory.defaultGraph(),
  )) {
    if (q.subject.termType === "NamedNode") subjects.add(q.subject.value);
  }
  for (const id of subjects) {
    const types = readRefs(dataset, id, RDF_TYPE);
    const objects = readRefs(dataset, id, `${NS.AS}object`);
    const actors = readRefs(dataset, id, `${NS.AS}attributedTo`);
    if (objects.length !== 1 || actors.length !== 1 || !readDate(dataset, id, `${NS.AS}published`))
      continue;
    const object = objects[0] as string;
    const actor = actors[0] as string;
    const sameDocument = id.includes("#") && id.split("#")[0] === object.split("#")[0];
    if (!sameDocument) continue;
    if (types.includes(`${NS.AS}Like`) && !types.includes(`${NS.AS}Undo`)) {
      const emoji = readText(dataset, id, `${NS.AS}content`);
      if (!messages.has(object) || !emoji?.trim() || emoji.length > 32) continue;
      likes.set(id, { message: object, reaction: { id, actorId: actor, emoji } });
    } else if (types.includes(`${NS.AS}Undo`) && !types.includes(`${NS.AS}Like`)) {
      undos.push({ object, actor });
    }
  }
  for (const undo of undos) {
    if (likes.get(undo.object)?.reaction.actorId === undo.actor) likes.delete(undo.object);
  }
  const active = new Map<string, Reaction[]>();
  for (const { message, reaction } of likes.values()) {
    const reactions = active.get(message) ?? [];
    reactions.push(reaction);
    active.set(message, reactions);
  }
  return active;
}

function event(
  dataset: DatasetCore,
  room: string,
  input: Omit<ReactionInput, "emoji">,
  kind: "reaction" | "undo",
): Store {
  const resource = messageResource(room, input.message);
  const id = `${resource}#${kind}-${segment(input.id)}`;
  httpIri(input.actor);
  isoDate(input.at);
  const message = readMessages(dataset).find((message) => message.id === input.message);
  if (!message) throw new ChatModelError("missing-message");
  if (message.tombstone || message.deletedAt !== undefined) throw new ChatModelError("deleted");
  if (dataset.match(DataFactory.namedNode(id), null, null).size)
    throw new ChatModelError("duplicate");
  const delta = new Store();
  const node = new ChatNode(id, delta, DataFactory);
  node.types.add(`${NS.AS}${kind === "reaction" ? "Like" : "Undo"}`);
  node.setIri(`${NS.AS}attributedTo`, input.actor);
  node.setDate(`${NS.AS}published`, input.at);
  return delta;
}

/** Return only the new event, ready for an append-only INSERT DATA. */
export function appendReaction(dataset: DatasetCore, room: string, input: ReactionInput): Store {
  text(input.emoji);
  if (input.emoji.length > 32) throw new ChatModelError("invalid-input");
  const delta = event(dataset, room, input, "reaction");
  const node = new ChatNode(
    `${messageResource(room, input.message)}#reaction-${input.id}`,
    delta,
    DataFactory,
  );
  node.setIri(`${NS.AS}object`, input.message);
  node.setText(`${NS.AS}content`, input.emoji);
  return delta;
}

export function appendUndo(dataset: DatasetCore, room: string, input: UndoInput): Store {
  const delta = event(dataset, room, input, "undo");
  const reaction = readReactions(dataset)
    .get(input.message)
    ?.find((reaction) => reaction.id === input.reaction);
  if (!reaction) throw new ChatModelError("missing-message");
  if (reaction.actorId !== input.actor) throw new ChatModelError("not-author");
  new ChatNode(
    `${messageResource(room, input.message)}#undo-${input.id}`,
    delta,
    DataFactory,
  ).setIri(`${NS.AS}object`, input.reaction);
  return delta;
}
