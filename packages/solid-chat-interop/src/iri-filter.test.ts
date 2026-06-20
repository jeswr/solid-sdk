// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Untrusted-IRI / scope filtering — the security surface. A non-http(s) IRI-valued
 * object (javascript:/mailto:/urn:/bare string) must be DROPPED (not coerced into a
 * NamedNode, not surfaced) on BOTH read and write, in BOTH formats and in the
 * LibreChat adapter. Exhaustive + adversarial.
 */

import type { Store } from "n3";
import { describe, expect, it } from "vitest";
import { buildAs2Message, parseAs2Message } from "./as2.js";
import { isHttpIri, safeIri } from "./iri.js";
import { LibreChatAdapter } from "./librechat.js";
import { buildLongChatMessage, parseLongChatMessage } from "./longchat.js";

const SUBJECT = "https://alice.example/chat/room1/msg1.ttl#it";
const NON_HTTP = [
  "javascript:alert(1)",
  "mailto:bob@x.example",
  "urn:uuid:1234",
  "not-a-url",
  "ftp://x/y",
  "data:text/html,x",
  "",
];

describe("isHttpIri / safeIri", () => {
  it("accepts only absolute http(s) IRIs", () => {
    expect(isHttpIri("https://x.example/a")).toBe(true);
    expect(isHttpIri("http://x.example/a")).toBe(true);
    for (const v of NON_HTTP) expect(isHttpIri(v)).toBe(false);
    expect(isHttpIri(undefined)).toBe(false);
  });
  it("safeIri returns the value or undefined", () => {
    expect(safeIri("https://x.example/a")).toBe("https://x.example/a");
    expect(safeIri("javascript:x")).toBeUndefined();
    expect(safeIri(undefined)).toBeUndefined();
  });
});

describe("AS2.0 write — drops non-http(s) IRI-valued objects (never coerces)", () => {
  for (const bad of NON_HTTP) {
    it(`drops author/room/inReplyTo/replacedBy/assignee = ${JSON.stringify(bad)}`, () => {
      const store = buildAs2Message(SUBJECT, {
        content: "x",
        mediaType: "text/plain",
        author: bad,
        room: bad,
        inReplyTo: bad,
        replacedBy: bad,
        provenance: { attributedTo: bad, generatedBy: bad, derivedFrom: bad },
        task: { state: "open", assignee: bad },
      });
      const objects = [...store].map((q) => q.object.value);
      // None of the bad values should appear as ANY object in the graph.
      for (const o of objects) expect(o).not.toBe(bad);
      // And specifically no NamedNode coercion of the bad value.
      const named = [...store]
        .filter((q) => q.object.termType === "NamedNode")
        .map((q) => q.object.value);
      expect(named).not.toContain(bad);
    });
  }
});

describe("LongChat write — drops non-http(s) IRI-valued objects", () => {
  for (const bad of NON_HTTP) {
    it(`drops author/inReplyTo/replacedBy/assignee = ${JSON.stringify(bad)}`, () => {
      const store = buildLongChatMessage(SUBJECT, {
        content: "x",
        mediaType: "text/plain",
        author: bad,
        inReplyTo: bad,
        replacedBy: bad,
        provenance: { attributedTo: bad },
        task: { state: "open", assignee: bad },
      });
      const named = [...store]
        .filter((q) => q.object.termType === "NamedNode")
        .map((q) => q.object.value);
      expect(named).not.toContain(bad);
    });
  }
});

describe("AS2.0 read — drops a non-http(s) object even if present in the graph", () => {
  it("a maliciously-authored note with a javascript: author yields undefined author", async () => {
    // Hand-construct a parsed graph (simulating a foreign/hostile document) by
    // building a clean note then INJECTING a bad-but-NamedNode-shaped object is
    // impossible via n3 NamedNode (n3 would throw on a malformed IRI); instead we
    // parse a Turtle body where a relative ref resolves to a non-http scheme is not
    // expressible, so we test the read guard via the parse path using a urn: IRI,
    // which IS a valid absolute IRI but not http(s).
    const turtle = `@prefix as: <https://www.w3.org/ns/activitystreams#> .
<https://alice.example/chat/room1/msg1.ttl#it> a as:Note ;
  as:content "x" ;
  as:attributedTo <urn:uuid:bob> ;
  as:context <urn:uuid:room> ;
  as:inReplyTo <urn:uuid:prev> .`;
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const ds = await parseRdf(turtle, "text/turtle", {
      baseIRI: "https://alice.example/chat/room1/msg1.ttl",
    });
    const msg = parseAs2Message(SUBJECT, ds);
    expect(msg?.content).toBe("x");
    expect(msg?.author).toBeUndefined();
    expect(msg?.room).toBeUndefined();
    expect(msg?.inReplyTo).toBeUndefined();
  });
});

describe("LongChat read — drops a non-http(s) object", () => {
  it("a urn: foaf:maker yields undefined author", async () => {
    const turtle = `@prefix sioc: <http://rdfs.org/sioc/ns#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<https://alice.example/chat/room1/msg1.ttl#it> a sioc:Note ;
  sioc:content "x" ;
  foaf:maker <urn:uuid:bob> .`;
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const ds = await parseRdf(turtle, "text/turtle", {
      baseIRI: "https://alice.example/chat/room1/msg1.ttl",
    });
    const msg = parseLongChatMessage(SUBJECT, ds);
    expect(msg?.content).toBe("x");
    expect(msg?.author).toBeUndefined();
  });
});

describe("LibreChat adapter — applies the IRI guard to everything that becomes an IRI", () => {
  it("a non-http(s) humanWebId / agentWebId / conversationId is dropped", () => {
    const adapter = new LibreChatAdapter({
      humanWebId: "mailto:alice@x.example",
      agentWebId: "urn:agent:1",
    });
    const human = adapter.toCanonical({
      text: "x",
      isCreatedByUser: true,
      conversationId: "javascript:x",
    });
    expect(human.author).toBeUndefined();
    expect(human.room).toBeUndefined();

    const ai = adapter.toCanonical({ text: "x", isCreatedByUser: false, model: "m" });
    // urn: agentWebId dropped, urn: default model dropped → no provenance at all.
    expect(ai.provenance).toBeUndefined();
  });

  it("a resolver that returns a non-http(s) IRI for the model is dropped", () => {
    const adapter = new LibreChatAdapter({
      agentWebId: "https://agents.example/a#me",
      resolveModelIri: () => "urn:bad",
    });
    const ai = adapter.toCanonical({ text: "x", isCreatedByUser: false, model: "m" });
    expect(ai.provenance?.attributedTo).toBe("https://agents.example/a#me");
    expect(ai.provenance?.generatedBy).toBeUndefined();
  });
});

describe("sanity: a valid graph is unaffected", () => {
  it("an http(s) author round-trips and is a NamedNode", () => {
    const store: Store = buildAs2Message(SUBJECT, {
      content: "x",
      mediaType: "text/plain",
      author: "https://alice.example/profile/card#me",
    });
    const named = [...store]
      .filter((q) => q.object.termType === "NamedNode")
      .map((q) => q.object.value);
    expect(named).toContain("https://alice.example/profile/card#me");
  });
});
