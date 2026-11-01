// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { parseAs2, serializeAs2, serializeLongChat, storeToTurtle } from "./reconcile.js";
import { PC, PC_CHAT_ROOM } from "./vocab.js";

const URL = "https://alice.example/chat/message.ttl";
const ROOM = "https://alice.example/chat/room.ttl#it";
const ALICE = "https://alice.example/profile#me";
const LEGACY = "https://w3id.org/jeswr/pod-chat#";

describe("pc: namespace compatibility", () => {
  it.each([NS.POD_CHAT, LEGACY])("accepts message datasets with %s room terms", async (base) => {
    const fixture = `@prefix as: <${NS.AS}> . @prefix pc: <${base}> .
      <#it> a as:Note ; as:content "Hello" ; as:context <${ROOM}> .
      <${ROOM}> a pc:ChatRoom ; pc:participant <${ALICE}> .`;
    const message = await parseAs2(URL, fixture);
    expect(message).toMatchObject({ content: "Hello", room: ROOM });
    if (!message) throw new Error("Missing message");
    const dataset = new Store([...(await parseRdf(fixture, "text/turtle", { baseIRI: URL }))]);
    const output = await storeToTurtle(dataset);
    expect(output).not.toContain("w3id.org/jeswr");
    expect(output).toContain("pc:ChatRoom");
    expect(output).toContain("pc:participant");
    expect(PC).toBe(NS.POD_CHAT);
    expect(PC_CHAT_ROOM).toBe(`${NS.POD_CHAT}ChatRoom`);
    for (const serialized of [
      await serializeAs2(message, `${URL}#it`),
      await serializeLongChat(message, `${URL}#it`),
    ]) {
      expect(serialized).not.toContain("w3id.org/jeswr");
    }
  });

  it("preserves resource identifiers, literal text and named graphs", async () => {
    const fixture = `<https://example.org/graph> {
      <${LEGACY}resource> a <${LEGACY}ChatRoom> ;
        <${NS.AS}name> "${LEGACY}text" ; <${LEGACY}participant> <${ALICE}> .
    }`;
    const dataset = new Store([...(await parseRdf(fixture, "application/trig"))]);
    await storeToTurtle(dataset);
    const quads = [...dataset];
    expect(quads.every((quad) => quad.graph.value === "https://example.org/graph")).toBe(true);
    expect(quads.every((quad) => quad.subject.value === `${LEGACY}resource`)).toBe(true);
    expect(quads.some((quad) => quad.object.value === `${LEGACY}text`)).toBe(true);
    expect(quads.some((quad) => quad.object.value === PC_CHAT_ROOM)).toBe(true);
    expect(quads.some((quad) => quad.predicate.value === `${PC}participant`)).toBe(true);
  });
});
