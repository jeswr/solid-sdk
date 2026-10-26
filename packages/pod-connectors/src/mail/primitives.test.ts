// AUTHORED-BY Codex GPT-6.1-Sol
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  accountRoot,
  attachmentPath,
  attachmentSlug,
  Classes,
  DCT,
  documentSlug,
  emlSlug,
  Flags,
  FOAF,
  folderSlug,
  LDP,
  MAIL_CLASSES,
  MAIL_PREDICATES,
  MAIL_SCHEMA,
  mailtos,
  messageSlug,
  PIM,
  Predicates,
  pathId,
  RDF,
  RDFS,
  SCHEMA,
  SIOC,
  SOLID,
  SYSTEM_FOLDERS,
  systemFolderSlug,
  threadSlug,
  XSD,
} from "./index.js";

describe("shared mail primitives", () => {
  it("keeps the account, message, source, thread, folder and attachment layout", () => {
    expect(accountRoot("me@example.org")).toBe("mail/me~40example.org/");
    expect(messageSlug("a", "<id@host>")).toBe("mail/a/messages/~3Cid~40host~3E.ttl");
    expect(emlSlug("a", "id.ttl")).toBe("mail/a/messages/id.ttl.eml");
    expect(threadSlug("a", "thread/1")).toBe("mail/a/threads/thread~2F1.ttl");
    expect(attachmentSlug("a", "<id>", 2)).toBe("mail/attachments/a/~3Cid~3E-2");
    expect(SYSTEM_FOLDERS).toEqual(["Inbox", "Sent", "Drafts", "Trash", "Archive", "Starred"]);
    for (const [title, key] of [
      ["Inbox", "inbox"],
      ["Sent", "sent"],
      ["Drafts", "drafts"],
      ["Trash", "trash"],
      ["Archive", "archive"],
      ["Starred", "starred"],
    ] as const) {
      expect(folderSlug("a", title)).toBe(`mail/a/folders/system:${key}.ttl`);
    }
    expect(folderSlug("a", "inbox")).toBe("mail/a/folders/inbox.ttl");
    expect(folderSlug("a", "system:inbox")).toBe("mail/a/folders/system~3Ainbox.ttl");
    expect(folderSlug("a", "Work/Team")).toBe("mail/a/folders/Work~2FTeam.ttl");
  });

  it("escapes reversibly and keeps delimiters inside their path segments", () => {
    const ids = ["a/b", "a~2Fb", "a%2Fb", "../#?", "é😀", "a:b", "a\\b", "a b"];
    expect(pathId("a~b%c/d:e")).toBe("a~7Eb~25c~2Fd~3Ae");
    expect(new Set(ids.map(pathId)).size).toBe(ids.length);
    for (const id of ids) {
      const escaped = pathId(id);
      expect(escaped).not.toMatch(/[%/\\#?:\s]/);
      expect(decodeURIComponent(escaped.replace(/~/g, "%"))).toBe(id);
      const url = new URL(messageSlug(id, id), "https://pod.example/root/");
      expect(url.pathname.split("/")).toHaveLength(6);
      expect(url.search + url.hash).toBe("");
    }
    expect(() => pathId("\ud800")).toThrow(URIError);
  });

  it("keeps connector validation separate from the app's relative layout helpers", () => {
    for (const invalid of ["", " ", ".", ".."]) {
      expect(() => accountRoot(invalid)).toThrow(TypeError);
      expect(() => messageSlug("a", invalid)).toThrow(TypeError);
      expect(() => emlSlug("a", invalid)).toThrow(TypeError);
      expect(() => threadSlug("a", invalid)).toThrow(TypeError);
      expect(() => folderSlug("a", invalid)).toThrow(TypeError);
      expect(() => attachmentSlug(invalid, "id", 0)).toThrow(TypeError);
    }
    // The suite validates these at its existing public boundary, with looser legacy rules.
    expect(documentSlug("messages", ".")).toBe("messages/..ttl");
    expect(documentSlug("threads", "..")).toBe("threads/...ttl");
    expect(documentSlug("folders", "Inbox")).toBe("folders/Inbox.ttl");
    expect(systemFolderSlug("")).toBe("folders/system:.ttl");
    expect(systemFolderSlug("Inbox")).toBe("folders/system:Inbox.ttl");
    expect(attachmentPath("", "", -1)).toBe("mail/attachments//--1");
    expect(attachmentSlug("a", "", 0)).toBe("mail/attachments/a/-0");
  });

  it("keeps the exact standard namespaces, classes and predicate IRIs", () => {
    expect({ RDF, RDFS, XSD, SCHEMA, SIOC, DCT, FOAF, SOLID, LDP, PIM }).toEqual({
      RDF: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      RDFS: "http://www.w3.org/2000/01/rdf-schema#",
      XSD: "http://www.w3.org/2001/XMLSchema#",
      SCHEMA: "http://schema.org/",
      SIOC: "http://rdfs.org/sioc/ns#",
      DCT: "http://purl.org/dc/terms/",
      FOAF: "http://xmlns.com/foaf/0.1/",
      SOLID: "http://www.w3.org/ns/solid/terms#",
      LDP: "http://www.w3.org/ns/ldp#",
      PIM: "http://www.w3.org/ns/pim/space#",
    });
    expect(Classes).toEqual({
      EmailMessage: "http://schema.org/EmailMessage",
      Conversation: "http://schema.org/Conversation",
      SiocThread: "http://rdfs.org/sioc/ns#Thread",
      Folder: "http://schema.org/Collection",
      ContactPoint: "http://schema.org/ContactPoint",
      LdpContainer: "http://www.w3.org/ns/ldp#Container",
    });
    expect(MAIL_SCHEMA).toBe("http://schema.org/");
    expect(MAIL_CLASSES.MediaObject).toBe("http://schema.org/MediaObject");
    expect(Predicates).toEqual({
      type: `${RDF}type`,
      subject: `${SCHEMA}about`,
      headline: `${SCHEMA}headline`,
      text: `${SCHEMA}text`,
      articleBody: `${SCHEMA}articleBody`,
      dateSent: `${SCHEMA}dateSent`,
      dateReceived: `${SCHEMA}dateReceived`,
      dateRead: `${SCHEMA}dateRead`,
      sender: `${SCHEMA}sender`,
      toRecipient: `${SCHEMA}toRecipient`,
      ccRecipient: `${SCHEMA}ccRecipient`,
      bccRecipient: `${SCHEMA}bccRecipient`,
      messageAttachment: `${SCHEMA}messageAttachment`,
      container: `${SIOC}has_container`,
      encoding: `${SCHEMA}encoding`,
      identifier: `${SCHEMA}identifier`,
      partOf: `${SCHEMA}isPartOf`,
      hasPart: `${SCHEMA}hasPart`,
      replyTo: `${SIOC}reply_of`,
      inReplyTo: `${SCHEMA}replyToUrl`,
      collectionItem: `${SCHEMA}hasPart`,
      email: `${SCHEMA}email`,
      name: `${SCHEMA}name`,
      created: `${DCT}created`,
      modified: `${DCT}modified`,
      title: `${DCT}title`,
    });
    expect(MAIL_PREDICATES.encodingFormat).toBe("http://schema.org/encodingFormat");
    expect(Flags).toEqual({ isRead: "http://schema.org/dateRead" });
  });

  it("flattens MIME address groups and preserves the existing full-address encoding", () => {
    expect(mailtos(undefined)).toEqual([]);
    expect(
      mailtos([
        {
          name: "Group",
          group: [
            { name: "A", address: "a+b@example.org" },
            { name: "Nested", group: [{ name: "B", address: "b/é@example.org" }] },
          ],
        },
        { name: "Missing", address: "" },
      ]),
    ).toEqual(["mailto:a%2Bb%40example.org", "mailto:b%2F%C3%A9%40example.org"]);
  });

  it("imports the public mail entry without loading the connector framework or Node-only ports", () => {
    // A fresh Node module graph checks the published export rather than Vitest's transform cache.
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import assert from "node:assert/strict";
      import { registerHooks } from "node:module";
      const forbidden = /^(?:node:)?(?:fs|net|http|https|tls|dns|child_process|worker_threads)(?:\\/|$)/;
      registerHooks({
        resolve(specifier, context, nextResolve) {
          assert(!forbidden.test(specifier), "Node-only import: " + specifier);
          const result = nextResolve(specifier, context);
          assert(!/\\/dist\\/(?:core|node)\\//.test(result.url), "Framework import: " + result.url);
          return result;
        },
      });
      const mail = await import("@jeswr/pod-connectors/mail");
      assert.equal(mail.messageSlug("a", "id"), "mail/a/messages/id.ttl");
      assert.equal(mail.MAIL_SCHEMA, "http://schema.org/");
      assert.equal(mail.htmlToText("<p>Hello</p>"), "Hello");
      assert.equal(typeof mail.createMailWriter, "function");
    `,
      ],
      { cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 10_000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
  });
});
