// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Tests for the AS2.0 activity model — typed build + Turtle round-trip, IRI
 * coercion safety, and the read-side accessors.
 */
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  ActivityDoc,
  buildActivity,
  isHttpIri,
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
