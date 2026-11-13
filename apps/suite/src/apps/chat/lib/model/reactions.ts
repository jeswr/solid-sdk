// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { documentMember } from "./layout";
import { type ChatMessage, readMessages } from "./messages";
import { messageResource } from "./paths";
import { ChatNode, NS, RDF_TYPE, readDate, readRefs, readText } from "./rdf";
import type { MemberContainer } from "./rooms";
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

export interface ReactionContext {
  document: string;
  messages: readonly ChatMessage[];
  containers: readonly MemberContainer[];
}
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Presentation})+$/u;
// Digits, # and * are Emoji_Component but only form an emoji inside a keycap sequence.
const KEYCAP = /[0-9#*]\ufe0f?\u20e3/gu;
const BARE_KEYCAP_BASE = /[0-9#*]/u;
/**
 * A reaction is a short run of emoji, never arbitrary text (at most 32 UTF-16 units). Bare
 * digits, # and * are refused, so "👍999" cannot pass itself off as a reaction count.
 */
export function isReactionEmoji(value: string): boolean {
  return (
    value.length <= 32 &&
    EMOJI_ONLY.test(value) &&
    PICTOGRAPH.test(value) &&
    !BARE_KEYCAP_BASE.test(value.replace(KEYCAP, ""))
  );
}

/**
 * Read only active, same-document Likes from the default graph. When `document` is given, the
 * Like must live in that document, so one day can never stand in for another day's reactions.
 * `as:attributedTo` is what the writer claims: the author check on Undo holds between honest
 * clients only, exactly like message authorship today.
 */
export function readReactions(
  dataset: DatasetCore,
  document?: string,
  known: ReadonlySet<string> = new Set(readMessages(dataset).map((message) => message.id)),
  containers?: readonly MemberContainer[],
): Map<string, Reaction[]> {
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
    if (document !== undefined && id.split("#")[0] !== document) continue;
    const types = readRefs(dataset, id, RDF_TYPE);
    const objects = readRefs(dataset, id, `${NS.AS}object`);
    const actors = readRefs(dataset, id, `${NS.AS}attributedTo`);
    if (objects.length !== 1 || actors.length !== 1 || !readDate(dataset, id, `${NS.AS}published`))
      continue;
    const object = objects[0] as string;
    const actor = actors[0] as string;
    const sameDocument = id.includes("#") && id.split("#")[0] === object.split("#")[0];
    if (containers !== undefined) {
      const source = documentMember(containers, id.split("#")[0] as string);
      if (!source || source.owner !== actor) continue;
      if (types.includes(`${NS.AS}Like`)) {
        const target = documentMember(containers, object.split("#")[0] as string);
        if (!target || id.split("#")[0]?.slice(-14) !== object.split("#")[0]?.slice(-14)) continue;
      } else if (!sameDocument) continue;
    } else if (!sameDocument) continue;
    if (types.includes(`${NS.AS}Like`) && !types.includes(`${NS.AS}Undo`)) {
      const emoji = readText(dataset, id, `${NS.AS}content`);
      if (!known.has(object) || !emoji || !isReactionEmoji(emoji)) continue;
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
  messages: readonly ChatMessage[],
  context?: ReactionContext,
): Store {
  const target = messageResource(room, input.message);
  const resource = context?.document ?? target;
  const id = `${resource}#${kind}-${segment(input.id)}`;
  httpIri(input.actor);
  isoDate(input.at);
  const message = messages.find((message) => message.id === input.message);
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
export function appendReaction(
  dataset: DatasetCore,
  room: string,
  input: ReactionInput,
  context?: ReactionContext,
): Store {
  const emoji = text(input.emoji);
  if (!isReactionEmoji(emoji)) throw new ChatModelError("invalid-input");
  const delta = event(
    dataset,
    room,
    input,
    "reaction",
    context?.messages ?? readMessages(dataset),
    context,
  );
  const node = new ChatNode(
    `${context?.document ?? messageResource(room, input.message)}#reaction-${input.id}`,
    delta,
    DataFactory,
  );
  node.setIri(`${NS.AS}object`, input.message);
  node.setText(`${NS.AS}content`, emoji);
  return delta;
}

/**
 * Return the Undo event, or `null` when this author already undid the reaction (another tab
 * won the race), so there is nothing left to write.
 */
export function appendUndo(
  dataset: DatasetCore,
  room: string,
  input: UndoInput,
  context?: ReactionContext,
): Store | null {
  const messages = context?.messages ?? readMessages(dataset);
  const delta = event(dataset, room, input, "undo", messages, context);
  const known = new Set(messages.map((message) => message.id));
  const reaction = readReactions(dataset, context?.document, known, context?.containers)
    .get(input.message)
    ?.find((reaction) => reaction.id === input.reaction);
  if (!reaction) {
    if (undoneBy(dataset, input.reaction, input.actor)) return null;
    throw new ChatModelError("missing-message");
  }
  if (reaction.actorId !== input.actor) throw new ChatModelError("not-author");
  new ChatNode(
    `${context?.document ?? messageResource(room, input.message)}#undo-${input.id}`,
    delta,
    DataFactory,
  ).setIri(`${NS.AS}object`, input.reaction);
  return delta;
}

function undoneBy(dataset: DatasetCore, reaction: string, actor: string): boolean {
  const liked = readRefs(dataset, reaction, RDF_TYPE).includes(`${NS.AS}Like`);
  if (!liked || !readRefs(dataset, reaction, `${NS.AS}attributedTo`).includes(actor)) return false;
  for (const q of dataset.match(
    null,
    DataFactory.namedNode(`${NS.AS}object`),
    DataFactory.namedNode(reaction),
    DataFactory.defaultGraph(),
  )) {
    const id = q.subject.value;
    if (
      readRefs(dataset, id, RDF_TYPE).includes(`${NS.AS}Undo`) &&
      readRefs(dataset, id, `${NS.AS}attributedTo`).includes(actor)
    )
      return true;
  }
  return false;
}
