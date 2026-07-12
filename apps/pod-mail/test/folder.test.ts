// AUTHORED-BY Claude Opus 4.8
import { describe, expect, it } from "vitest";
import { Folder, WellKnownFolders } from "../src/model/folder.js";
import { Classes } from "../src/model/vocab.js";
import { emptyMailbox, mailboxFromTurtle } from "./helpers.js";

const F = "https://pod.example/mail/folders/inbox.ttl#it";
const M1 = "https://pod.example/mail/messages/m1.ttl#it";
const M2 = "https://pod.example/mail/messages/m2.ttl#it";

describe("Folder", () => {
  it("exposes the well-known folder slugs", () => {
    expect(WellKnownFolders.inbox).toBe("inbox");
    expect(WellKnownFolders.sent).toBe("sent");
    expect(WellKnownFolders.drafts).toBe("drafts");
    expect(WellKnownFolders.trash).toBe("trash");
    expect(WellKnownFolders.archive).toBe("archive");
  });

  it("mints a folder typed schema:Collection", () => {
    const mb = emptyMailbox();
    const f = mb.createFolder(F);
    expect([...f.types]).toContain(Classes.Folder);
    expect(f).toBeInstanceOf(Folder);
  });

  it("round-trips title and modified", () => {
    const mb = emptyMailbox();
    const f = mb.createFolder(F);
    const modified = new Date("2026-06-15T00:00:00.000Z");
    f.title = "Inbox";
    f.modified = modified;
    expect(f.title).toBe("Inbox");
    expect(f.modified?.toISOString()).toBe(modified.toISOString());
    f.title = undefined;
    f.modified = undefined;
    expect(f.title).toBeUndefined();
    expect(f.modified).toBeUndefined();
  });

  it("adds, queries, counts and removes messages", () => {
    const mb = emptyMailbox();
    const f = mb.createFolder(F);
    expect(f.size).toBe(0);
    expect(f.has(M1)).toBe(false);
    f.addMessage(M1);
    f.addMessage(M2);
    expect(f.size).toBe(2);
    expect(f.has(M1)).toBe(true);
    f.removeMessage(M1);
    expect(f.has(M1)).toBe(false);
    expect(f.size).toBe(1);
  });

  it("reads a folder from parsed Turtle", async () => {
    const turtle = `
      @prefix schema: <http://schema.org/> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a schema:Collection ;
        dct:title "Inbox" ;
        schema:hasPart <${M1}> .
    `;
    const mb = await mailboxFromTurtle(turtle, "https://pod.example/mail/folders/inbox.ttl");
    const f = mb.findFolder(F);
    expect(f?.title).toBe("Inbox");
    expect(f?.has(M1)).toBe(true);
  });
});
