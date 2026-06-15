// AUTHORED-BY Claude Opus 4.8
import { describe, expect, it } from "vitest";
import { MailPrefixes, serialiseToTurtle } from "../src/model/serialise.js";
import { SCHEMA, SIOC } from "../src/model/vocab.js";
import { emptyMailbox } from "./helpers.js";

describe("serialise", () => {
  it("emits the declared prefixes", () => {
    expect(MailPrefixes.schema).toBe(SCHEMA);
    expect(MailPrefixes.sioc).toBe(SIOC);
  });

  it("serialises an empty dataset to an empty/prefix-only document", () => {
    const mb = emptyMailbox();
    const turtle = serialiseToTurtle(mb);
    expect(typeof turtle).toBe("string");
    // no message triples present
    expect(turtle).not.toContain("EmailMessage");
  });

  it("uses prefixed names rather than full IRIs for known vocab", () => {
    const mb = emptyMailbox();
    const m = mb.createMessage("https://pod.example/mail/messages/m1.ttl#it");
    m.subjectLine = "Subject";
    const turtle = serialiseToTurtle(mb);
    expect(turtle).toContain("schema:headline");
    expect(turtle).toContain("schema:EmailMessage");
    expect(turtle).not.toContain("<http://schema.org/headline>");
  });
});
