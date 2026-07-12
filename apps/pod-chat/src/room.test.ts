// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { serializeTurtle } from "./rdf-io.js";
import { buildRoom, type ChatRoom, parseRoom, RoomDoc, roomSubject } from "./room.js";
import { turtleToStore } from "./test-helpers.js";
import { AS_CLASS, CHAT_ROOM_CLASS, PREFIXES } from "./vocab.js";

const RES = "https://alice.pod/pod-chat/rooms/general.ttl";
const SUBJ = `${RES}#it`;
const ALICE = "https://alice.pod/profile/card#me";
const BOB = "https://bob.pod/profile/card#me";
const MSG_1 = "https://alice.pod/pod-chat/messages/m1.ttl";
const MSG_2 = "https://alice.pod/pod-chat/messages/m2.ttl";

describe("roomSubject", () => {
  it("appends #it to the resource URL", () => {
    expect(roomSubject(RES)).toBe(SUBJ);
  });
});

describe("buildRoom → parseRoom round-trip", () => {
  it("round-trips a room with participants and message refs", () => {
    const now = new Date("2026-06-15T09:00:00.000Z");
    const store = buildRoom(RES, {
      name: "General",
      creator: ALICE,
      created: now,
      participants: [
        { webId: ALICE, name: "Alice" },
        { webId: BOB, name: "Bob" },
      ],
      messages: [MSG_2, MSG_1],
    });
    const room = parseRoom(RES, store) as ChatRoom;
    expect(room.name).toBe("General");
    expect(room.creator).toBe(ALICE);
    expect(room.created).toBe("2026-06-15T09:00:00.000Z");
    expect(room.participants).toEqual([
      { webId: ALICE, name: "Alice" },
      { webId: BOB, name: "Bob" },
    ]);
    // messages come back sorted for a stable listing
    expect(room.messages).toEqual([MSG_1, MSG_2]);
  });

  it("round-trips an empty room (no participants, no messages)", () => {
    const store = buildRoom(RES, { name: "Empty", now: new Date("2026-06-15T09:00:00.000Z") });
    const room = parseRoom(RES, store) as ChatRoom;
    expect(room.name).toBe("Empty");
    expect(room.participants).toEqual([]);
    expect(room.messages).toEqual([]);
  });

  it("stamps now when neither created nor now is given", () => {
    const before = Date.now();
    const store = buildRoom(RES, { name: "R" });
    const after = Date.now();
    const ts = new Date((parseRoom(RES, store) as ChatRoom).created as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("handles a participant with no display name", () => {
    const store = buildRoom(RES, {
      name: "R",
      participants: [{ webId: BOB }],
    });
    const room = parseRoom(RES, store) as ChatRoom;
    expect(room.participants).toEqual([{ webId: BOB, name: undefined }]);
  });

  it("sorts participants by WebID regardless of input order", () => {
    const store = buildRoom(RES, {
      name: "R",
      participants: [{ webId: BOB }, { webId: ALICE }],
    });
    const webIds = (parseRoom(RES, store) as ChatRoom).participants.map((p) => p.webId);
    expect(webIds).toEqual([ALICE, BOB]);
  });

  it("types the subject both as:Collection AND pc:ChatRoom", () => {
    const store = buildRoom(RES, { name: "R" });
    const doc = new RoomDoc(SUBJ, store, DataFactory);
    expect(doc.types.has(AS_CLASS.Collection)).toBe(true);
    expect(doc.types.has(CHAT_ROOM_CLASS)).toBe(true);
  });

  it("serialises a room through n3.Writer with readable prefixes", async () => {
    const store = buildRoom(RES, {
      name: "General",
      participants: [{ webId: ALICE, name: "Alice" }],
      messages: [MSG_1],
    });
    const ttl = await serializeTurtle(store, PREFIXES);
    expect(ttl).toContain("pc:ChatRoom");
    expect(ttl).toContain("as:Collection");
    expect(ttl).toContain("as:Person");
    expect(ttl).toContain("pc:participant");
    expect(ttl).toContain("as:items");
  });

  it("drops a blank name (no as:name triple) but parses back to empty string", () => {
    const store = buildRoom(RES, { name: "" });
    const room = parseRoom(RES, store) as ChatRoom;
    expect(room.name).toBe("");
  });
});

describe("parseRoom edge cases", () => {
  it("returns undefined for a resource that is not a pc:ChatRoom", () => {
    const store = turtleToStore(
      `@prefix as: <https://www.w3.org/ns/activitystreams#> . <#it> a as:Collection .`,
      RES,
    );
    expect(parseRoom(RES, store)).toBeUndefined();
  });

  it("returns undefined for an empty dataset", () => {
    expect(parseRoom(RES, turtleToStore("", RES))).toBeUndefined();
  });

  it("reads a room parsed from raw Turtle, including participant labels", () => {
    const store = turtleToStore(
      `@prefix pc: <https://w3id.org/jeswr/pod-chat#> .
       @prefix as: <https://www.w3.org/ns/activitystreams#> .
       @prefix dct: <http://purl.org/dc/terms/> .
       <#it> a as:Collection, pc:ChatRoom ;
             as:name "Team" ;
             dct:creator <${ALICE}> ;
             pc:participant <${BOB}> ;
             as:items <${MSG_1}> .
       <${BOB}> a as:Person ; as:name "Bob" .`,
      RES,
    );
    const room = parseRoom(RES, store) as ChatRoom;
    expect(room.name).toBe("Team");
    expect(room.creator).toBe(ALICE);
    expect(room.participants).toEqual([{ webId: BOB, name: "Bob" }]);
    expect(room.messages).toEqual([MSG_1]);
  });
});
