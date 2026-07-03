// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Tests for the AS2.0 activity model — typed build + Turtle round-trip, IRI
 * coercion safety, and the read-side accessors.
 */
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Parser } from "n3";
import { describe, expect, it } from "vitest";
import {
  ActivityDoc,
  buildActivity,
  isHttpIri,
  safeHttpIri,
  serializeTurtle,
} from "./activity.js";

const AS = "https://www.w3.org/ns/activitystreams#";

describe("isHttpIri", () => {
  it("accepts http(s) absolute URLs", () => {
    expect(isHttpIri("https://alice.example/card#me")).toBe(true);
    expect(isHttpIri("http://bob.example/profile")).toBe(true);
  });
  it("rejects undefined, non-http schemes, and non-URLs", () => {
    expect(isHttpIri(undefined)).toBe(false);
    expect(isHttpIri("")).toBe(false);
    expect(isHttpIri("mailto:a@b.com")).toBe(false);
    expect(isHttpIri("ftp://x/")).toBe(false);
    expect(isHttpIri("just text")).toBe(false);
    expect(isHttpIri("urn:uuid:1234")).toBe(false);
  });
});

describe("buildActivity + serializeTurtle", () => {
  it("builds a complete AS2.0 notification and serialises with the as: prefix", async () => {
    const published = new Date("2026-01-02T03:04:05.000Z");
    const store = buildActivity({
      type: "Invite",
      actor: "https://alice.example/card#me",
      object: "https://bob.example/chat/",
      target: "https://bob.example/inbox/",
      summary: "Join the chat",
      content: "Alice invited you to a chat.",
      published,
    });
    const ttl = await serializeTurtle(store);
    expect(ttl).toContain("@prefix as:");
    expect(ttl).toContain("as:Invite");
    expect(ttl).toContain("as:actor");

    // Round-trip: parse it back and read via the typed accessors.
    const ds = await parseRdf(ttl, "text/turtle", {
      baseIRI: "https://x.example/n",
    });
    // The subject was the relative #it, resolved against the base.
    const doc = new ActivityDoc("https://x.example/n#it", ds, DataFactory);
    expect([...doc.types]).toContain(`${AS}Invite`);
    expect(doc.actor).toBe("https://alice.example/card#me");
    expect(doc.activityObject).toBe("https://bob.example/chat/");
    expect(doc.target).toBe("https://bob.example/inbox/");
    expect(doc.summary).toBe("Join the chat");
    expect(doc.content).toBe("Alice invited you to a chat.");
    expect(doc.published?.toISOString()).toBe(published.toISOString());
  });

  it("defaults published to now when omitted", () => {
    const before = Date.now();
    const store = buildActivity({
      type: "Announce",
      actor: "https://alice.example/card#me",
    });
    const doc = new ActivityDoc("#it", store, DataFactory);
    const ts = doc.published?.getTime() ?? 0;
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("NEVER coerces a non-http object/target/actor into a NamedNode", () => {
    const store = buildActivity({
      type: "Announce",
      actor: "not a url",
      object: "mailto:x@y.com",
      target: "javascript:alert(1)",
    });
    const doc = new ActivityDoc("#it", store, DataFactory);
    expect(doc.actor).toBeUndefined();
    expect(doc.activityObject).toBeUndefined();
    expect(doc.target).toBeUndefined();
  });

  it("drops empty/whitespace summary + content", () => {
    const store = buildActivity({
      type: "Announce",
      actor: "https://alice.example/card#me",
      summary: "   ",
      content: "",
    });
    const doc = new ActivityDoc("#it", store, DataFactory);
    expect(doc.summary).toBeUndefined();
    expect(doc.content).toBeUndefined();
  });

  it("can root the activity at an explicit subject", async () => {
    const store = buildActivity(
      { type: "Create", actor: "https://alice.example/card#me" },
      "https://alice.example/n1#it"
    );
    const ttl = await serializeTurtle(store);
    expect(ttl).toContain("alice.example/n1");
  });
});

describe("safeHttpIri", () => {
  it("canonicalises safe http(s) IRIs", () => {
    expect(safeHttpIri("https://alice.example/card#me")).toBe(
      "https://alice.example/card#me"
    );
    // The URL parser percent-encodes Turtle-terminating characters.
    expect(safeHttpIri("https://evil/x> y")).not.toContain(">");
    expect(safeHttpIri("https://evil/x> y")).not.toContain(" ");
  });
  it("percent-encodes the URL-parser-tolerated Turtle-forbidden chars |, ^, `", () => {
    const out = safeHttpIri("https://evil/a|b^c`d");
    expect(out).toBeDefined();
    expect(out).not.toContain("|");
    expect(out).not.toContain("^");
    expect(out).not.toContain("`");
  });
  it("rejects non-http(s) / non-URL / non-string values", () => {
    expect(safeHttpIri(undefined)).toBeUndefined();
    // biome-ignore lint/suspicious/noExplicitAny: exercising a non-string arg at runtime.
    expect(safeHttpIri(123 as any)).toBeUndefined();
    expect(safeHttpIri("mailto:a@b.com")).toBeUndefined();
    expect(safeHttpIri("just text")).toBeUndefined();
  });
});

describe("Turtle IRI-injection guard (n3.Writer does NOT escape IRIs)", () => {
  // Payload that, written RAW between <…>, would break out of the actor IRI and
  // inject a second, attacker-chosen triple into the serialised (then POSTed) doc.
  const INJECTION =
    "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";

  it("does not let a hostile actor inject a second triple", async () => {
    const store = buildActivity({
      type: "Announce",
      actor: INJECTION,
      object: "https://bob.example/chat/",
    });
    const ttl = await serializeTurtle(store);
    const quads = new Parser().parse(ttl);
    // The smuggled subject/predicate/object must NOT appear as its own triple.
    for (const q of quads) {
      expect(q.subject.value).not.toBe("https://evil/s2");
      expect(q.predicate.value).not.toBe("https://evil/p2");
      expect(q.object.value).not.toBe("https://evil/o2");
    }
    // And the raw breakout sequence never reaches the wire.
    expect(ttl).not.toContain("> . <https://evil/s2>");
  });
});
