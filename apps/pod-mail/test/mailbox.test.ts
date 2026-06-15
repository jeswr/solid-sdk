// AUTHORED-BY Claude Opus 4.8
import { describe, expect, it } from "vitest";
import { serialiseToTurtle } from "../src/model/serialise.js";
import { emptyMailbox, mailboxFromTurtle } from "./helpers.js";

const M1 = "https://pod.example/mail/messages/m1.ttl#it";
const M2 = "https://pod.example/mail/messages/m2.ttl#it";
const T1 = "https://pod.example/mail/threads/t1.ttl#it";
const F1 = "https://pod.example/mail/folders/inbox.ttl#it";

describe("MailboxDataset — enumeration", () => {
  it("enumerates messages, threads and folders as sibling subjects", () => {
    const mb = emptyMailbox();
    mb.createMessage(M1);
    mb.createMessage(M2);
    mb.createThread(T1);
    mb.createFolder(F1);

    expect([...mb.messages].map((m) => m.value).sort()).toEqual([M1, M2].sort());
    expect([...mb.threads].map((t) => t.value)).toEqual([T1]);
    expect([...mb.folders].map((f) => f.value)).toEqual([F1]);
  });

  it("wraps an existing subject without re-typing it", () => {
    const mb = emptyMailbox();
    mb.createMessage(M1);
    const again = mb.message(M1);
    expect(again.value).toBe(M1);
    // wrapping does not duplicate the type
    expect([...mb.messages]).toHaveLength(1);
  });

  it("find* returns undefined for an absent subject", () => {
    const mb = emptyMailbox();
    expect(mb.findMessage(M1)).toBeUndefined();
    expect(mb.findThread(T1)).toBeUndefined();
    expect(mb.findFolder(F1)).toBeUndefined();
  });

  it("find* skips non-matching subjects then returns undefined", () => {
    const mb = emptyMailbox();
    mb.createMessage(M1);
    mb.createThread(T1);
    mb.createFolder(F1);
    // a subject of each kind exists, but not the one we ask for
    expect(mb.findMessage(M2)).toBeUndefined();
    expect(mb.findThread("https://pod.example/mail/threads/other.ttl#it")).toBeUndefined();
    expect(mb.findFolder("https://pod.example/mail/folders/other.ttl#it")).toBeUndefined();
  });

  it("find* skips a non-matching subject then finds a later match", () => {
    const mb = emptyMailbox();
    mb.createMessage(M1);
    mb.createMessage(M2);
    // at least one of these requires skipping the first-iterated subject
    expect(mb.findMessage(M1)?.value).toBe(M1);
    expect(mb.findMessage(M2)?.value).toBe(M2);
  });

  it("find* locates a present subject", () => {
    const mb = emptyMailbox();
    mb.createMessage(M1);
    mb.createThread(T1);
    mb.createFolder(F1);
    expect(mb.findMessage(M1)?.value).toBe(M1);
    expect(mb.findThread(T1)?.value).toBe(T1);
    expect(mb.findFolder(F1)?.value).toBe(F1);
  });

  it("thread() and folder() mint wrappers over arbitrary IRIs", () => {
    const mb = emptyMailbox();
    expect(mb.thread(T1).value).toBe(T1);
    expect(mb.folder(F1).value).toBe(F1);
  });
});

describe("MailboxDataset — full document round-trip via n3.Writer", () => {
  it("serialises a populated mailbox and re-parses it losslessly", async () => {
    const mb = emptyMailbox();
    const m = mb.createMessage(M1);
    m.subjectLine = "Hi";
    m.sender = "https://alice.example/profile/card#me";
    m.dateSent = new Date("2026-06-15T09:00:00.000Z");
    const f = mb.createFolder(F1);
    f.title = "Inbox";
    f.addMessage(M1);

    const turtle = serialiseToTurtle(mb);
    expect(turtle).toContain("schema:");

    const reparsed = await mailboxFromTurtle(turtle, "https://pod.example/mail/inbox.ttl");
    const m2 = reparsed.findMessage(M1);
    expect(m2?.subjectLine).toBe("Hi");
    expect(m2?.sender).toBe("https://alice.example/profile/card#me");
    expect(m2?.dateSent?.toISOString()).toBe("2026-06-15T09:00:00.000Z");
    const f2 = reparsed.findFolder(F1);
    expect(f2?.title).toBe("Inbox");
    expect(f2?.has(M1)).toBe(true);
  });
});
