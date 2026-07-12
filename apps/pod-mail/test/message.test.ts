// AUTHORED-BY Claude Opus 4.8
import { describe, expect, it } from "vitest";
import { Classes } from "../src/model/vocab.js";
import { emptyMailbox, mailboxFromTurtle } from "./helpers.js";

const M = "https://pod.example/mail/messages/m1.ttl#it";
const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const CAROL = "https://carol.example/profile/card#me";

describe("Message — write then read round-trip", () => {
  it("mints a message and reads back every scalar field", () => {
    const mb = emptyMailbox();
    const m = mb.createMessage(M);
    const sent = new Date("2026-06-15T09:00:00.000Z");
    const received = new Date("2026-06-15T09:00:05.000Z");

    m.subjectLine = "Hello";
    m.body = "First line\nSecond line";
    m.sender = ALICE;
    m.dateSent = sent;
    m.dateReceived = received;
    m.partOfThread = "https://pod.example/mail/threads/t1.ttl#it";
    m.inReplyTo = "https://pod.example/mail/messages/m0.ttl#it";

    expect([...m.types]).toContain(Classes.EmailMessage);
    expect(m.subjectLine).toBe("Hello");
    expect(m.body).toBe("First line\nSecond line");
    expect(m.sender).toBe(ALICE);
    expect(m.dateSent?.toISOString()).toBe(sent.toISOString());
    expect(m.dateReceived?.toISOString()).toBe(received.toISOString());
    expect(m.partOfThread).toBe("https://pod.example/mail/threads/t1.ttl#it");
    expect(m.inReplyTo).toBe("https://pod.example/mail/messages/m0.ttl#it");
  });

  it("manages To/Cc/Bcc recipient sets", () => {
    const mb = emptyMailbox();
    const m = mb.createMessage(M);
    m.to.add(BOB);
    m.to.add(CAROL);
    m.cc.add(ALICE);
    m.bcc.add(BOB);

    expect([...m.to].sort()).toEqual([BOB, CAROL].sort());
    expect([...m.cc]).toEqual([ALICE]);
    expect([...m.bcc]).toEqual([BOB]);

    m.to.delete(CAROL);
    expect([...m.to]).toEqual([BOB]);
  });

  it("treats dateRead as the read flag and toggles it", () => {
    const mb = emptyMailbox();
    const m = mb.createMessage(M);
    expect(m.isRead).toBe(false);
    expect(m.dateRead).toBeUndefined();

    const readAt = new Date("2026-06-15T10:00:00.000Z");
    m.setRead(true, readAt);
    expect(m.isRead).toBe(true);
    expect(m.dateRead?.toISOString()).toBe(readAt.toISOString());

    m.setRead(false);
    expect(m.isRead).toBe(false);
    expect(m.dateRead).toBeUndefined();
  });

  it("defaults setRead(true) timestamp to now", () => {
    const mb = emptyMailbox();
    const m = mb.createMessage(M);
    const before = Date.now();
    m.setRead(true);
    const after = Date.now();
    const t = m.dateRead?.getTime();
    expect(t).toBeDefined();
    expect(t as number).toBeGreaterThanOrEqual(before - 1000);
    expect(t as number).toBeLessThanOrEqual(after + 1000);
  });

  it("clears a scalar field by assigning undefined", () => {
    const mb = emptyMailbox();
    const m = mb.createMessage(M);
    m.subjectLine = "x";
    expect(m.subjectLine).toBe("x");
    m.subjectLine = undefined;
    expect(m.subjectLine).toBeUndefined();
  });

  it("clears sender and other IRI fields by assigning undefined", () => {
    const mb = emptyMailbox();
    const m = mb.createMessage(M);
    m.sender = ALICE;
    m.partOfThread = "https://pod.example/mail/threads/t1.ttl#it";
    m.inReplyTo = "https://pod.example/mail/messages/m0.ttl#it";
    m.sender = undefined;
    m.partOfThread = undefined;
    m.inReplyTo = undefined;
    expect(m.sender).toBeUndefined();
    expect(m.partOfThread).toBeUndefined();
    expect(m.inReplyTo).toBeUndefined();
  });
});

describe("Message — read from parsed Turtle", () => {
  it("reads a message authored elsewhere", async () => {
    const turtle = `
      @prefix schema: <http://schema.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a schema:EmailMessage ;
        schema:headline "Re: lunch" ;
        schema:text "Sounds good" ;
        schema:sender <${ALICE}> ;
        schema:toRecipient <${BOB}> ;
        schema:dateSent "2026-06-15T09:00:00.000Z"^^xsd:dateTime ;
        schema:dateRead "2026-06-15T11:00:00.000Z"^^xsd:dateTime .
    `;
    const mb = await mailboxFromTurtle(turtle, "https://pod.example/mail/messages/m1.ttl");
    const m = mb.findMessage("https://pod.example/mail/messages/m1.ttl#it");
    expect(m).toBeDefined();
    expect(m?.subjectLine).toBe("Re: lunch");
    expect(m?.body).toBe("Sounds good");
    expect(m?.sender).toBe(ALICE);
    expect([...(m?.to ?? [])]).toEqual([BOB]);
    expect(m?.isRead).toBe(true);
  });
});
