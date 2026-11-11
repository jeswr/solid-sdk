// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { readMessages } from "./messages";
import { roomContainer, roomIndex } from "./paths";
import { ChatNode, NS, RDF_TYPE, readRefs } from "./rdf";
import { buildRoom, type ChatRoom, type MemberContainer, type RoomInput, readRoom } from "./rooms";
import { ChatModelError, httpIri } from "./validation";

const memberKeys = new Map<string, string>();
export async function memberContainer(room: string, webId: string): Promise<string> {
  httpIri(webId);
  let key = memberKeys.get(webId);
  if (key === undefined) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(webId));
    key = [...new Uint8Array(digest)]
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    memberKeys.set(webId, key);
  }
  return `${roomContainer(room)}members/${key}/`;
}
export async function buildRoomV2(room: string, input: RoomInput): Promise<Store> {
  const dataset = buildRoom(room, input);
  const space = `${roomIndex(room)}#it`;
  for (const owner of new Set([input.creator, ...input.members])) {
    const url = await memberContainer(room, owner);
    const node = new ChatNode(url, dataset, DataFactory);
    node.types.add(`${NS.SIOC}Container`);
    node.setIri(`${NS.SIOC}has_owner`, owner);
    node.setIri(`${NS.SIOC}has_space`, space);
    new ChatNode(space, dataset, DataFactory).refs(`${NS.SIOC}space_of`).add(url);
  }
  return dataset;
}
/** Hash validation is asynchronous; the legacy synchronous readRoom remains available. */
export async function readRoomLayout(
  room: string,
  dataset: DatasetCore,
): Promise<ChatRoom | undefined> {
  const result = readRoom(room, dataset);
  if (!result) {
    if (
      dataset.match(
        DataFactory.namedNode(`${roomIndex(room)}#it`),
        DataFactory.namedNode(`${NS.SIOC}space_of`),
      ).size
    )
      throw new ChatModelError("invalid-input");
    return undefined;
  }
  const listed = readRefs(dataset, result.id, `${NS.SIOC}space_of`);
  // Detect even malformed listings, never downgrade a v2 descriptor to shared v1 writes.
  if (
    !dataset.match(DataFactory.namedNode(result.id), DataFactory.namedNode(`${NS.SIOC}space_of`))
      .size
  )
    return result;
  result.memberContainers = [];
  const members = new Set(readRefs(dataset, result.id, `${NS.VCARD}hasMember`));
  if (result.creator) members.add(result.creator);
  for (const url of listed) {
    const owners = readRefs(dataset, url, `${NS.SIOC}has_owner`);
    if (
      owners.length !== 1 ||
      dataset.match(DataFactory.namedNode(url), DataFactory.namedNode(`${NS.SIOC}has_owner`))
        .size !== 1
    )
      continue;
    const owner = owners[0] as string;
    if (
      !members.has(owner) ||
      url !== (await memberContainer(room, owner)) ||
      !readRefs(dataset, url, RDF_TYPE).includes(`${NS.SIOC}Container`) ||
      !readRefs(dataset, url, `${NS.SIOC}has_space`).includes(result.id)
    )
      continue;
    result.memberContainers.push({ url, owner });
  }
  return result;
}
export function ownContainer(room: string, layout: ChatRoom | undefined, actor: string): string {
  if (layout?.memberContainers === undefined) return roomContainer(room);
  const own = layout.memberContainers.find((member) => member.owner === actor);
  if (!own) throw new ChatModelError("not-author");
  return own.url;
}
export function documentMember(
  containers: readonly MemberContainer[],
  document: string,
): MemberContainer | undefined {
  return containers.find(
    ({ url }) =>
      document.startsWith(url) && /^\d{4}\/\d{2}\/\d{2}\.ttl$/.test(document.slice(url.length)),
  );
}
/** Bind subjects and every claimed author to the document's WAC boundary before interop reads. */
export function memberDocument(
  dataset: DatasetCore,
  document: string,
  owner: string,
): { dataset: Store; dropped: number } {
  const graph = new Store([...dataset.match(null, null, null, DataFactory.defaultGraph())]);
  const messages = new Set(readMessages(graph).map((message) => message.id));
  const subjects = new Set(messages);
  for (const q of graph.match(null, DataFactory.namedNode(RDF_TYPE)))
    if (
      q.subject.termType === "NamedNode" &&
      (q.object.value === `${NS.AS}Like` || q.object.value === `${NS.AS}Undo`)
    )
      subjects.add(q.subject.value);
  let dropped = 0;
  for (const id of subjects) {
    const claims = [`${NS.AS}attributedTo`, `${NS.FOAF}maker`].flatMap((predicate) => [
      ...graph.match(DataFactory.namedNode(id), DataFactory.namedNode(predicate)),
    ]);
    if (
      id.split("#")[0] !== document ||
      claims.some((q) => q.object.termType !== "NamedNode" || q.object.value !== owner) ||
      (!claims.length && !messages.has(id))
    ) {
      graph.deleteMatches(DataFactory.namedNode(id));
      dropped++;
    } else if (!claims.length)
      new ChatNode(id, graph, DataFactory).setIri(`${NS.AS}attributedTo`, owner);
  }
  return { dataset: graph, dropped };
}
