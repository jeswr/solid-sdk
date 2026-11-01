// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Ported from apps/pod-chat/src/room.ts; suite layout and membership follow 07 §Chat.
import type { DatasetCore } from "@rdfjs/types";
import { Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { roomContainer, roomIndex } from "./paths";
import { ChatNode, NS, RDF_TYPE, readDate, readRefs, readText } from "./rdf";
import { ChatModelError, httpIri, isoDate, text } from "./validation";

export interface RoomInput {
  name: string;
  creator: string;
  created: Date;
  members: readonly string[];
}
export interface ChatRoom {
  id: string;
  name: string;
  creator: string | undefined;
  created: string | undefined;
  members: string[];
}
export function buildRoom(room: string, input: RoomInput): Store {
  const subject = `${roomIndex(room)}#it`;
  const name = text(input.name);
  httpIri(input.creator);
  isoDate(input.created);
  const members = new Set([input.creator, ...input.members.map(httpIri)]);
  const dataset = new Store();
  const doc = new ChatNode(subject, dataset, DataFactory);
  doc.types.add(`${NS.POD_CHAT}ChatRoom`);
  doc.types.add(`${NS.AS}Collection`);
  doc.setText(`${NS.AS}name`, name);
  doc.setIri(`${NS.DCT}creator`, input.creator);
  doc.setDate(`${NS.DCT}created`, input.created);
  for (const member of members) doc.refs(`${NS.VCARD}hasMember`).add(member);
  return dataset;
}
export function readRoom(room: string, dataset: DatasetCore): ChatRoom | undefined {
  const id = `${roomIndex(room)}#it`;
  const types = readRefs(dataset, id, RDF_TYPE);
  if (!types.includes(`${NS.POD_CHAT}ChatRoom`) && !types.includes(`${NS.MEETING}LongChat`))
    return undefined;
  return {
    id,
    name: readText(dataset, id, `${NS.AS}name`) ?? "",
    creator: readRefs(dataset, id, `${NS.DCT}creator`)[0],
    created: readDate(dataset, id, `${NS.DCT}created`),
    members: [
      ...new Set(
        [`${NS.VCARD}hasMember`, `${NS.AS}attributedTo`, `${NS.POD_CHAT}participant`].flatMap((p) =>
          readRefs(dataset, id, p),
        ),
      ),
    ].sort(),
  };
}
export function readJoinedRooms(url: string, dataset: DatasetCore): string[] {
  return readRefs(dataset, `${httpIri(url)}#it`, `${NS.AS}items`).map(roomContainer);
}
/** Copy-on-write; joining changes only the account's list, never remote membership or grants. */
export function joinRoom(url: string, dataset: DatasetCore, room: string): Store {
  const result = new Store([...dataset]);
  const doc = new ChatNode(`${httpIri(url)}#it`, result, DataFactory);
  doc.types.add(`${NS.AS}Collection`);
  doc.refs(`${NS.AS}items`).add(roomContainer(room));
  return result;
}
/** The advertised ACL URL is supplied by I/O; owner control is always retained. */
export function buildRoomAcl(
  room: string,
  aclUrl: string,
  owner: string,
  members: readonly string[],
): Store {
  const container = roomContainer(room);
  httpIri(aclUrl);
  httpIri(owner);
  if (new URL(aclUrl).hash) throw new ChatModelError("invalid-input");
  const people = [...new Set(members.map(httpIri))].filter((member) => member !== owner);
  const dataset = new Store();
  const rule = new Authorization(`${aclUrl}#owner`, dataset, DataFactory);
  rule.type.add(`${NS.ACL}Authorization`);
  rule.agent.add(owner);
  rule.accessTo = container;
  rule.default = container;
  rule.canRead = true;
  rule.canWrite = true;
  rule.canReadWriteAcl = true;
  if (people.length) {
    const memberRule = new Authorization(`${aclUrl}#members`, dataset, DataFactory);
    memberRule.type.add(`${NS.ACL}Authorization`);
    for (const person of people) memberRule.agent.add(person);
    memberRule.accessTo = container;
    memberRule.default = container;
    memberRule.canRead = true;
    memberRule.canAppend = true;
  }
  return dataset;
}
