// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS as SUITE_NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { buildMessage } from "./message.js";
import { serializeTurtle } from "./rdf-io.js";
import { buildRoom, parseRoom, RoomDoc } from "./room.js";
import { mockFetch, turtleToStore } from "./test-helpers.js";
import { ensureTypeRegistrations, TypeIndexDataset } from "./type-index.js";
import { CHAT_ROOM_CLASS, NS, PREFIXES } from "./vocab.js";

const URL = "https://alice.pod/pod-chat/rooms/general.ttl";
const ALICE = "https://alice.pod/profile/card#me";
const BOB = "https://bob.pod/profile/card#me";
const LEGACY = "https://w3id.org/jeswr/pod-chat#";

function fixture(base: string): string {
  return `@prefix pc: <${base}> .
    @prefix as: <${NS.AS}> .
    <#it> a pc:ChatRoom, as:Collection ; as:name "General" ; pc:participant <${BOB}> .
    <${BOB}> a as:Person ; as:name "Bob" .`;
}

describe("pc: read aliases", () => {
  it.each([SUITE_NS.POD_CHAT, LEGACY])("reads and reserializes a %s room", async (base) => {
    const dataset = turtleToStore(fixture(base), URL);
    expect(parseRoom(URL, dataset)).toMatchObject({
      name: "General",
      participants: [{ webId: BOB, name: "Bob" }],
    });
    new RoomDoc(`${URL}#it`, dataset, DataFactory).name = "Renamed";
    const output = await serializeTurtle(dataset, PREFIXES);
    expect(output).not.toContain("w3id.org/jeswr");
    expect(output).toContain(`${SUITE_NS.POD_CHAT}`);
    expect(output).toContain("pc:participant");
    expect(parseRoom(URL, turtleToStore(output, URL))?.name).toBe("Renamed");
  });

  it("combines mixed participant aliases, then deletes without resurrecting old values", async () => {
    const dataset = turtleToStore(
      `${fixture(LEGACY)}
      <#it> a <${CHAT_ROOM_CLASS}> ; <${NS.PC}participant> <${ALICE}> .`,
      URL,
    );
    const doc = new RoomDoc(`${URL}#it`, dataset, DataFactory);
    expect([...doc.participantRefs].sort()).toEqual([ALICE, BOB]);
    expect([...doc.types].filter((type) => type === CHAT_ROOM_CLASS)).toHaveLength(1);
    doc.participantRefs.delete(BOB);
    expect(parseRoom(URL, dataset)?.participants).toEqual([{ webId: ALICE, name: undefined }]);
    doc.participantRefs.clear();
    const output = await serializeTurtle(dataset, PREFIXES);
    expect(output).not.toContain("w3id.org/jeswr");
    expect(parseRoom(URL, turtleToStore(output, URL))?.participants).toEqual([]);
  });

  it("canonicalizes raw serializer input without first wrapping the room", async () => {
    const output = await serializeTurtle(turtleToStore(fixture(LEGACY), URL), {
      ...PREFIXES,
      pc: LEGACY,
    });
    expect(output).not.toContain("w3id.org/jeswr");
    expect(output).toContain("pc:ChatRoom");
    expect(parseRoom(URL, turtleToStore(output, URL))?.participants[0]?.webId).toBe(BOB);
  });

  it.each([SUITE_NS.POD_CHAT, LEGACY])("discovers Type Index classes from %s", (base) => {
    const dataset = turtleToStore(
      `@prefix solid: <${NS.SOLID}> .
      <#reg> a solid:TypeRegistration ; solid:forClass <${base}ChatRoom> ;
        solid:instanceContainer <https://alice.pod/pod-chat/rooms/> .`,
      URL,
    );
    const index = new TypeIndexDataset(dataset, DataFactory);
    expect(index.locate(CHAT_ROOM_CLASS)).toHaveLength(1);
    expect(index.locate(`${LEGACY}ChatRoom`)).toHaveLength(1);
  });

  it("reuses a legacy registration for discovery without an eager pod write", async () => {
    const indexUrl = "https://alice.pod/settings/privateTypeIndex.ttl";
    const container = "https://alice.pod/pod-chat/rooms/";
    const { fetch, calls } = mockFetch({
      [`GET ${ALICE}`]: { body: `<${ALICE}> <${NS.SOLID}privateTypeIndex> <${indexUrl}> .` },
      [`GET ${indexUrl}`]: {
        etag: '"old"',
        body: `@prefix solid: <${NS.SOLID}> .
        <#old> a solid:TypeRegistration ; solid:forClass <${LEGACY}ChatRoom> ;
          solid:instanceContainer <${container}> .`,
      },
    });
    const result = await ensureTypeRegistrations({
      webId: ALICE,
      podRoot: "https://alice.pod/",
      fetchImpl: fetch,
      registrations: [{ forClass: CHAT_ROOM_CLASS, container }],
    });
    // An equivalent read alias suffices for discovery; no eager pod migration.
    expect(result.added).toBe(0);
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("writes canonical rooms and actionable messages", async () => {
    for (const dataset of [
      buildRoom(URL, { name: "New", participants: [{ webId: BOB }] }),
      buildMessage(URL, {
        content: "Review",
        author: ALICE,
        room: `${URL}#it`,
        task: { state: "open", title: "Review", assignee: BOB },
      }),
    ]) {
      expect(await serializeTurtle(dataset, PREFIXES)).not.toContain("w3id.org/jeswr");
    }
  });
});

it("declares exactly the pc: terms used by the model in parseable Turtle", async () => {
  const ttl = readFileSync(new globalThis.URL("../vocab/pod-chat.ttl", import.meta.url), "utf8");
  const dataset = await parseRdf(ttl, "text/turtle");
  const subjects = new Set(
    [...dataset]
      .map((quad) => quad.subject.value)
      .filter((subject) => subject.startsWith(SUITE_NS.POD_CHAT)),
  );
  expect([...subjects].sort()).toEqual([CHAT_ROOM_CLASS, `${NS.PC}participant`].sort());
  expect(ttl).toContain('vann:preferredNamespacePrefix "pc"');
  expect(ttl).not.toContain("w3id.org/jeswr");
  expect(
    readFileSync(new globalThis.URL("../clientid.jsonld", import.meta.url), "utf8"),
  ).not.toContain("w3id.org/jeswr");
});
