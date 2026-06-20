// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * AS2.0 ↔ LongChat reconciliation round-trips + the parseRdf serialized entry
 * points (Turtle + JSON-LD). These exercise the canonical hub end to end.
 */

import { TASK_CLASS, WF_CLOSED, WF_OPEN } from "@jeswr/solid-task-model";
import { describe, expect, it } from "vitest";
import type { CanonicalMessage } from "./canonical.js";
import {
  canonicalToAs2,
  canonicalToLongChat,
  MAPPING_TABLE,
  parseAs2,
  parseLongChat,
  roundTripAs2ToLongChat,
  serializeAs2,
  serializeLongChat,
} from "./reconcile.js";

const SUBJECT = "https://alice.example/chat/room1/msg1.ttl#it";
const ROOM = "https://alice.example/chat/room1/index.ttl#this";
const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const REPLY = "https://alice.example/chat/room1/msg0.ttl#it";

function baseMessage(): CanonicalMessage {
  return {
    content: "Hello, world",
    mediaType: "text/plain",
    author: ALICE,
    published: "2026-06-20T10:00:00.000Z",
    room: ROOM,
    inReplyTo: REPLY,
  };
}

describe("AS2.0 ↔ LongChat round-trip", () => {
  it("preserves the shared fields AS2 → canonical → LongChat → canonical", async () => {
    const msg = baseMessage();
    const result = await roundTripAs2ToLongChat(msg, SUBJECT);

    // Shared fields LongChat carries directly:
    expect(result.content).toBe("Hello, world");
    expect(result.author).toBe(ALICE);
    expect(result.published).toBe("2026-06-20T10:00:00.000Z");
    expect(result.inReplyTo).toBe(REPLY);
    // room/mediaType are recovered (LongChat itself drops them — see MAPPING_TABLE):
    expect(result.room).toBe(ROOM);
    expect(result.mediaType).toBe("text/plain");
  });

  it("the LONGCHAT-lossy view drops room (no triple) but keeps content/author/published/inReplyTo", async () => {
    const result = await roundTripAs2ToLongChat(baseMessage(), SUBJECT, { lossy: true });
    expect(result.content).toBe("Hello, world");
    expect(result.author).toBe(ALICE);
    expect(result.published).toBe("2026-06-20T10:00:00.000Z");
    expect(result.inReplyTo).toBe(REPLY);
    // LongChat has no room triple: it is genuinely absent in the lossy view.
    expect(result.room).toBeUndefined();
  });

  it("carries the wf:Task overlay through the round-trip (state/title/assignee)", async () => {
    const msg: CanonicalMessage = {
      ...baseMessage(),
      task: { state: "open", title: "Follow up with Bob", assignee: BOB },
    };
    const result = await roundTripAs2ToLongChat(msg, SUBJECT);
    expect(result.task).toEqual({ state: "open", title: "Follow up with Bob", assignee: BOB });

    const closed: CanonicalMessage = {
      ...baseMessage(),
      task: { state: "closed", title: "Done" },
    };
    const closedResult = await roundTripAs2ToLongChat(closed, SUBJECT);
    expect(closedResult.task?.state).toBe("closed");
    expect(closedResult.task?.title).toBe("Done");
  });

  it("the written RDF carries rdf:type wf:Task + wf:Open/wf:Closed (the SHARED shape)", () => {
    const RdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const typesOf = (store: ReturnType<typeof canonicalToAs2>) =>
      [...store].filter((q) => q.predicate.value === RdfType).map((q) => q.object.value);

    // Assert against the BUILT dataset (expanded IRIs) using the task-model consts,
    // so it is verifiably the SAME wf:Task shape solid-issues / PM read. (The Turtle
    // serializer prefix-compresses wf:Task → `wf:Task`, so a string match on the
    // expanded IRI would spuriously fail — assert on the terms, not the text.)
    const openTypes = typesOf(
      canonicalToAs2({ ...baseMessage(), task: { state: "open", title: "T" } }, SUBJECT),
    );
    expect(openTypes).toContain(TASK_CLASS);
    expect(openTypes).toContain(WF_OPEN);
    expect(openTypes).not.toContain(WF_CLOSED);

    const closedTypes = typesOf(
      canonicalToLongChat({ ...baseMessage(), task: { state: "closed", title: "T" } }, SUBJECT),
    );
    expect(closedTypes).toContain(TASK_CLASS);
    expect(closedTypes).toContain(WF_CLOSED);
    expect(closedTypes).not.toContain(WF_OPEN);
  });

  it("carries PROV-O provenance through the round-trip", async () => {
    const agent = "https://agents.example/assistant#me";
    const model = "https://models.example/gpt#v1";
    const source = "https://import.example/conv/42";
    const msg: CanonicalMessage = {
      content: "Generated reply",
      mediaType: "text/plain",
      published: "2026-06-20T10:05:00.000Z",
      provenance: { attributedTo: agent, generatedBy: model, derivedFrom: source },
    };
    const result = await roundTripAs2ToLongChat(msg, SUBJECT);
    expect(result.provenance).toEqual({
      attributedTo: agent,
      generatedBy: model,
      derivedFrom: source,
    });
  });

  it("LongChat → canonical → AS2 also preserves content/author/published", async () => {
    const lcTurtle = await serializeLongChat(baseMessage(), SUBJECT);
    const fromLc = await parseLongChat(SUBJECT, lcTurtle, "text/turtle", SUBJECT);
    expect(fromLc).toBeDefined();
    const as2Turtle = await serializeAs2(fromLc as CanonicalMessage, SUBJECT);
    const fromAs2 = await parseAs2(SUBJECT, as2Turtle, "text/turtle", SUBJECT);
    expect(fromAs2?.content).toBe("Hello, world");
    expect(fromAs2?.author).toBe(ALICE);
    expect(fromAs2?.published).toBe("2026-06-20T10:00:00.000Z");
  });
});

describe("LongChat write shape", () => {
  it("stamps sioc:Note + as:Note + schema:Message, and the as:inReplyTo reply edge", async () => {
    const ttl = await serializeLongChat(baseMessage(), SUBJECT);
    expect(ttl).toContain("sioc:Note");
    expect(ttl).toContain("as:Note");
    expect(ttl).toContain("schema:Message");
    // The reply edge is written ONLY as as:inReplyTo (reply→parent) — the direction
    // AS2.0 and SolidOS LongChat both use on the message itself. sioc:has_reply is the
    // INVERSE (parent→reply), so writing it here would reverse the thread (roborev
    // Medium #1) — see the "roborev-medium regressions" block below.
    expect(ttl).toContain("as:inReplyTo");
    expect(ttl).not.toMatch(/has_reply/i);
    expect(ttl).toContain("foaf:maker");
    expect(ttl).toContain("sioc:content");
  });

  it("does NOT write a room triple (LongChat models the room by container)", async () => {
    const store = canonicalToLongChat(baseMessage(), SUBJECT);
    const quads = [...store];
    expect(quads.some((q) => q.predicate.value.endsWith("activitystreams#context"))).toBe(false);
  });
});

describe("AS2.0 write shape", () => {
  it("writes as:context (room) and as:mediaType", async () => {
    const store = canonicalToAs2(baseMessage(), SUBJECT);
    const quads = [...store];
    expect(
      quads.some((q) => q.predicate.value === "https://www.w3.org/ns/activitystreams#context"),
    ).toBe(true);
    expect(
      quads.some((q) => q.predicate.value === "https://www.w3.org/ns/activitystreams#mediaType"),
    ).toBe(true);
  });
});

describe("parseRdf serialized entry points", () => {
  const Turtle = `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<https://alice.example/chat/room1/msg1.ttl#it> a as:Note ;
  as:content "From turtle" ;
  as:attributedTo <https://alice.example/profile/card#me> ;
  as:published "2026-06-20T11:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`;

  const Jsonld = JSON.stringify({
    "@context": "https://www.w3.org/ns/activitystreams",
    "@id": "https://alice.example/chat/room1/msg1.ttl#it",
    type: "Note",
    content: "From json-ld",
    attributedTo: "https://alice.example/profile/card#me",
    published: "2026-06-20T12:00:00.000Z",
  });

  it("reconciles a Turtle body", async () => {
    const msg = await parseAs2("https://alice.example/chat/room1/msg1.ttl", Turtle, "text/turtle");
    expect(msg?.content).toBe("From turtle");
    expect(msg?.author).toBe(ALICE);
    expect(msg?.published).toBe("2026-06-20T11:00:00.000Z");
  });

  it("reconciles a JSON-LD body", async () => {
    const msg = await parseAs2(
      "https://alice.example/chat/room1/msg1.ttl",
      Jsonld,
      "application/ld+json",
    );
    expect(msg?.content).toBe("From json-ld");
    expect(msg?.author).toBe(ALICE);
    expect(msg?.published).toBe("2026-06-20T12:00:00.000Z");
  });

  it("a null content-type defaults to text/turtle (the Solid §5.2 default)", async () => {
    const msg = await parseAs2("https://alice.example/chat/room1/msg1.ttl", Turtle, null);
    expect(msg?.content).toBe("From turtle");
  });

  it("returns undefined when the subject is not an as:Note", async () => {
    const notANote = `@prefix dct: <http://purl.org/dc/terms/> .
<https://alice.example/chat/room1/msg1.ttl#it> dct:title "not a note" .`;
    const msg = await parseAs2(
      "https://alice.example/chat/room1/msg1.ttl",
      notANote,
      "text/turtle",
    );
    expect(msg).toBeUndefined();
  });
});

describe("MAPPING_TABLE", () => {
  it("documents every canonical field as data", () => {
    const fields = MAPPING_TABLE.map((r) => r.canonical);
    expect(fields).toContain("content");
    expect(fields).toContain("author");
    expect(fields).toContain("published");
    expect(fields).toContain("inReplyTo");
    expect(fields).toContain("provenance.attributedTo");
    expect(fields).toContain("task");
    // room is AS2-only (LongChat = null), per the report.
    const room = MAPPING_TABLE.find((r) => r.canonical === "room");
    expect(room?.longChat).toBeNull();
    expect(room?.as2).not.toBeNull();
  });
});

describe("roborev-medium regressions", () => {
  it("reply edge uses as:inReplyTo and NEVER the backwards sioc:has_reply (Medium #1)", async () => {
    // sioc:has_reply is the INVERSE (parent → reply); writing it on the reply pointing
    // at its parent reverses the thread for sioc readers. We emit only as:inReplyTo
    // (reply → parent), which AS2.0 and SolidOS LongChat both use on the message itself.
    const ttl = await serializeLongChat(baseMessage(), SUBJECT);
    expect(ttl).toContain("inReplyTo");
    expect(ttl).not.toMatch(/has_reply/i);
    const parsed = await parseLongChat(SUBJECT, ttl, "text/turtle", SUBJECT);
    expect(parsed?.inReplyTo).toBe(REPLY);
  });

  it("drops a MALFORMED date literal instead of throwing on parse (Medium #2, untrusted input)", async () => {
    // An Invalid Date from a garbage RDF literal must be FILTERED (like a non-http IRI),
    // not abort the whole parse via Invalid-Date.toISOString() throwing.
    const ttl = `@prefix as: <https://www.w3.org/ns/activitystreams#> .\n<${SUBJECT}> a as:Note ; as:content "hi" ; as:published "not-a-date" .`;
    const parsed = await parseAs2(SUBJECT, ttl, "text/turtle", SUBJECT);
    expect(parsed).toBeDefined();
    expect(parsed?.content).toBe("hi");
    expect(parsed?.published).toBeUndefined();
  });

  it("recovers as:published when the preferred dct:created is malformed (date fallback not masked, Medium follow-up)", async () => {
    // The LongChat `created` getter prefers dct:created, falling back to as:published.
    // A naive `dct:created ?? as:published` THROWS on the malformed dct:created and
    // never reaches the valid fallback, wrongly dropping the date. Per-predicate
    // guarding must let the valid as:published through.
    const ttl = `@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix sioc: <http://rdfs.org/sioc/ns#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${SUBJECT}> a sioc:Note ; sioc:content "hi" ;
  dct:created "not-a-date" ;
  as:published "2026-06-20T10:00:00.000Z"^^xsd:dateTime .`;
    const parsed = await parseLongChat(SUBJECT, ttl, "text/turtle", SUBJECT);
    expect(parsed).toBeDefined();
    expect(parsed?.published).toBe("2026-06-20T10:00:00.000Z");
  });

  it("a malformed foaf:maker literal falls back to as:attributedTo, never aborts the parse (untrusted-input class)", async () => {
    // foaf:maker pointing at a LITERAL (not an IRI) where the preferred read expects a
    // NamedNode must NOT abort the parse: the guarded read drops it and the valid
    // as:attributedTo fallback is used, and the rest of the message still parses.
    // (LiteralAs.string is lenient — it coerces a non-string literal to its lexical
    // form rather than throwing — so the malformed-literal THROW the tryRead guard
    // catches is the date case, covered by the two tests above.)
    const ttl = `@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix sioc: <http://rdfs.org/sioc/ns#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<${SUBJECT}> a sioc:Note ;
  sioc:content "real body" ;
  foaf:maker "not-an-iri" ;
  as:attributedTo <${ALICE}> .`;
    const parsed = await parseLongChat(SUBJECT, ttl, "text/turtle", SUBJECT);
    expect(parsed).toBeDefined();
    expect(parsed?.content).toBe("real body");
    expect(parsed?.author).toBe(ALICE);
  });

  it("a valid note with an extra MALFORMED rdf:type still parses (per-object type filter, Medium follow-up)", async () => {
    // A literal-valued rdf:type alongside the valid type must NOT drop the WHOLE
    // type set (an all-or-nothing SetFrom read would, leaving the message
    // unrecognized). Per-object filtering keeps the valid type IRI and ignores the
    // garbage term — for BOTH the LongChat (sioc:Note) and AS2.0 (as:Note) readers.
    const lc = `@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix sioc: <http://rdfs.org/sioc/ns#> .
<${SUBJECT}> a sioc:Note, "garbage-type-literal" ; sioc:content "still here" .`;
    const fromLc = await parseLongChat(SUBJECT, lc, "text/turtle", SUBJECT);
    expect(fromLc).toBeDefined();
    expect(fromLc?.content).toBe("still here");

    const as2 = `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<${SUBJECT}> a as:Note, "garbage-type-literal" ; as:content "still here" .`;
    const fromAs2 = await parseAs2(SUBJECT, as2, "text/turtle", SUBJECT);
    expect(fromAs2).toBeDefined();
    expect(fromAs2?.content).toBe("still here");
  });
});
