// AUTHORED-BY Claude Opus 4.8
import { describe, expect, it } from "vitest";
import { Classes } from "../src/model/vocab.js";
import { emptyMailbox, mailboxFromTurtle } from "./helpers.js";

const T = "https://pod.example/mail/threads/t1.ttl#it";
const M1 = "https://pod.example/mail/messages/m1.ttl#it";
const M2 = "https://pod.example/mail/messages/m2.ttl#it";

describe("Thread", () => {
  it("mints a thread with both alignment types", () => {
    const mb = emptyMailbox();
    const t = mb.createThread(T);
    const types = [...t.types];
    expect(types).toContain(Classes.Conversation);
    expect(types).toContain(Classes.SiocThread);
  });

  it("round-trips title and timestamps", () => {
    const mb = emptyMailbox();
    const t = mb.createThread(T);
    const created = new Date("2026-06-01T00:00:00.000Z");
    const modified = new Date("2026-06-15T00:00:00.000Z");
    t.title = "Lunch plans";
    t.created = created;
    t.modified = modified;
    expect(t.title).toBe("Lunch plans");
    expect(t.created?.toISOString()).toBe(created.toISOString());
    expect(t.modified?.toISOString()).toBe(modified.toISOString());
  });

  it("adds, counts and removes member messages", () => {
    const mb = emptyMailbox();
    const t = mb.createThread(T);
    expect(t.size).toBe(0);
    t.addMessage(M1);
    t.addMessage(M2);
    expect(t.size).toBe(2);
    expect([...t.messageIris].sort()).toEqual([M1, M2].sort());
    t.removeMessage(M1);
    expect(t.size).toBe(1);
    expect([...t.messageIris]).toEqual([M2]);
  });

  it("clears title and timestamps via undefined", () => {
    const mb = emptyMailbox();
    const t = mb.createThread(T);
    t.title = "x";
    t.created = new Date();
    t.modified = new Date();
    t.title = undefined;
    t.created = undefined;
    t.modified = undefined;
    expect(t.title).toBeUndefined();
    expect(t.created).toBeUndefined();
    expect(t.modified).toBeUndefined();
  });

  it("reads a thread from parsed Turtle", async () => {
    const turtle = `
      @prefix schema: <http://schema.org/> .
      @prefix sioc: <http://rdfs.org/sioc/ns#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a schema:Conversation, sioc:Thread ;
        dct:title "Project" ;
        schema:hasPart <${M1}>, <${M2}> .
    `;
    const mb = await mailboxFromTurtle(turtle, "https://pod.example/mail/threads/t1.ttl");
    const t = mb.findThread(T);
    expect(t?.title).toBe("Project");
    expect(t?.size).toBe(2);
  });
});
