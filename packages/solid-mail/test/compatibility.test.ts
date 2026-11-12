// AUTHORED-BY Codex (GPT-6.1 Sol)
// Differences from both apps' permissive mappers. See README "Exact divergences".
import { NamedNodeAs, NamedNodeFrom, OptionalAs, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { expect, it } from "vitest";
import {
  Attachment,
  Classes,
  Folder,
  Message,
  Predicates,
  parseMailbox,
  serialiseToTurtle,
  Thread,
} from "../src/index.js";
import { DataFactory, emptyMailbox } from "./helpers.js";

const DOC = "https://pod.example/mail/all.ttl";
const M = `${DOC}#message`;
const A = `${DOC}#attachment`;
const prefixes = `@prefix schema: <http://schema.org/> .
  @prefix dct: <http://purl.org/dc/terms/> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;
const document = (body: string) => parseMailbox(`${prefixes}\n${body}`, DOC);

it("drops ambiguous scalar values instead of selecting the first", async () => {
  const mailbox = await document(`
    <#message> a schema:EmailMessage ; schema:headline "one", "two" ;
      schema:sender <mailto:one@example.org>, <mailto:two@example.org> ;
      schema:dateRead "2026-01-01T00:00:00Z"^^xsd:dateTime,
                      "2026-01-02T00:00:00Z"^^xsd:dateTime .
    <#thread> a schema:Conversation ; dct:title "one", "two" .
    <#folder> a schema:Collection ; dct:title "one", "two" .
    <#attachment> schema:contentSize 1, 2 .
  `);
  const message = mailbox.findMessage(M);
  if (!message) throw new Error("Expected the message fixture");
  expect(message.subjectLine).toBeUndefined();
  expect(message.sender).toBeUndefined();
  expect(message.dateRead).toBeUndefined();
  expect(message.isRead).toBe(false);
  expect(mailbox.findThread(`${DOC}#thread`)?.title).toBeUndefined();
  expect(mailbox.findFolder(`${DOC}#folder`)?.title).toBeUndefined();
  expect(new Attachment(A, mailbox, DataFactory).size).toBeUndefined();
});

it("requires xsd:string text and keeps unprofiled raw terms during unrelated edits", async () => {
  const mailbox = await document(`
    <#message> a schema:EmailMessage ; schema:headline "hola"@es ;
      schema:text 5 ; schema:articleBody "<p>hola</p>"@es ; schema:identifier "id"@en .
    <#thread> a schema:Conversation ; dct:title 5 .
    <#folder> a schema:Collection ; dct:title "Inbox"@en .
    <#attachment> schema:name "file"@en ; schema:encodingFormat 5 .
  `);
  const message = mailbox.findMessage(M);
  if (!message) throw new Error("Expected the message fixture");
  expect(message.subjectLine).toBeUndefined();
  expect(message.body).toBeUndefined();
  expect(message.bodyHtml).toBeUndefined();
  expect(message.identifier).toBeUndefined();
  expect(mailbox.findThread(`${DOC}#thread`)?.title).toBeUndefined();
  expect(mailbox.findFolder(`${DOC}#folder`)?.title).toBeUndefined();
  const attachment = new Attachment(A, mailbox, DataFactory);
  expect(attachment.name).toBeUndefined();
  expect(attachment.contentType).toBeUndefined();
  message.setRead(true, new Date("2026-01-01T00:00:00Z"));
  const reparsed = await parseMailbox(serialiseToTurtle(mailbox), DOC);
  expect(reparsed.size).toBe(mailbox.size);
  for (const quad of mailbox) expect(reparsed.has(quad)).toBe(true);
});

it("guards wrong term kinds and filters invalid set members", async () => {
  const mailbox = await document(`
    <#message> a schema:EmailMessage ; schema:headline <urn:wrong> ;
      schema:sender "not an IRI" ; schema:toRecipient <mailto:bob@example.org>, "bad" ;
      schema:dateSent <urn:wrong> .
  `);
  const message = mailbox.findMessage(M);
  if (!message) throw new Error("Expected the message fixture");
  expect(message.subjectLine).toBeUndefined();
  expect(message.sender).toBeUndefined();
  expect(message.dateSent).toBeUndefined();
  expect([...message.to]).toEqual(["mailto:bob@example.org"]);
});

it("requires valid xsd:dateTime reads and drops invalid Date writes", async () => {
  for (const term of [
    '"2026-01-01"^^xsd:date',
    '"2026-01-01T00:00:00Z"',
    '"not-a-date"^^xsd:dateTime',
    '"2026-02-30T00:00:00Z"^^xsd:dateTime',
  ]) {
    const mailbox = await document(`
      <#message> a schema:EmailMessage ; schema:dateSent ${term} ;
        schema:dateReceived ${term} ; schema:dateRead ${term} .
      <#thread> a schema:Conversation ; dct:created ${term} ; dct:modified ${term} .
      <#folder> a schema:Collection ; dct:modified ${term} .
    `);
    const message = mailbox.findMessage(M);
    if (!message) throw new Error("Expected the message fixture");
    expect(message.dateSent).toBeUndefined();
    expect(message.dateReceived).toBeUndefined();
    expect(message.isRead).toBe(false);
    expect(mailbox.findThread(`${DOC}#thread`)?.created).toBeUndefined();
    expect(mailbox.findThread(`${DOC}#thread`)?.modified).toBeUndefined();
    expect(mailbox.findFolder(`${DOC}#folder`)?.modified).toBeUndefined();
  }
  const message = emptyMailbox().createMessage(M);
  message.dateRead = new Date("2026-01-01");
  expect(() => {
    message.dateRead = new Date(Number.NaN);
  }).not.toThrow();
  expect(message.dateRead).toBeUndefined();
});

it("requires attachment sizes to be safe xsd:integer values", async () => {
  for (const term of [
    '"12"^^xsd:decimal',
    '"12"^^xsd:double',
    '"12"^^xsd:nonNegativeInteger',
    '"12"',
    '"1.5"^^xsd:integer',
    '"9007199254740992"^^xsd:integer',
  ]) {
    const mailbox = await document(`<#attachment> schema:contentSize ${term} .`);
    expect(new Attachment(A, mailbox, DataFactory).size).toBeUndefined();
  }
  const attachment = new Attachment(A, emptyMailbox(), DataFactory);
  for (const size of [0, -1, Number.MAX_SAFE_INTEGER]) {
    attachment.size = size;
    expect(attachment.size).toBe(size);
  }
  for (const size of [1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    attachment.size = size;
    expect(attachment.size).toBeUndefined();
  }
});

it("rejects unsafe subjects and types and drops invalid IRI field writes", () => {
  const mailbox = emptyMailbox();
  for (const Wrapper of [Message, Thread, Folder, Attachment]) {
    for (const subject of [
      "relative",
      "https://pod.example/a b",
      "https://pod.example/a>",
      DataFactory.blankNode("b"),
      DataFactory.literal("text"),
    ]) {
      expect(() => new Wrapper(subject, mailbox, DataFactory)).toThrow(TypeError);
    }
  }
  const message = mailbox.createMessage(M);
  message.sender = "mailto:alice@example.org";
  message.sender = "relative";
  expect(message.sender).toBeUndefined();
  message.to.add("https://pod.example/a b");
  expect(message.to.size).toBe(0);
  expect(() => message.types.add("relative")).toThrow(TypeError);
  expect([...message.types]).toEqual([Classes.EmailMessage]);
});

it("skips a typed blank-node subject during mailbox enumeration and keeps the valid ones", async () => {
  const mailbox = await document(`
    [] a schema:EmailMessage ; schema:headline "Blank" .
    <#message> a schema:EmailMessage ; schema:headline "Hi" .
  `);
  expect([...mailbox.messages].map((m) => m.value)).toEqual([M]);
  expect(mailbox.findMessage(M)?.subjectLine).toBe("Hi");
});

it("filters unsafe raw IRI values on read without mutating the original dataset", () => {
  const mailbox = emptyMailbox();
  const message = mailbox.createMessage(M);
  // Use the original sanctioned mappers to model a dataset supplied by another caller.
  OptionalAs.object(message, Predicates.sender, "urn:unsafe address", NamedNodeFrom.string);
  const rawRecipients = SetFrom.subjectPredicate(
    message,
    Predicates.toRecipient,
    NamedNodeAs.string,
    NamedNodeFrom.string,
  );
  rawRecipients.add("relative");
  rawRecipients.add("mailto:bob@example.org");
  const before = [...mailbox];
  expect(message.sender).toBeUndefined();
  expect([...message.to]).toEqual(["mailto:bob@example.org"]);
  expect([...rawRecipients]).toEqual(["relative", "mailto:bob@example.org"]);
  expect([...mailbox]).toEqual(before);
});

it("exposes generated subtype recognition without broadening exact mailbox enumeration", async () => {
  const mailbox = await document(`
    <urn:custom:Message> rdfs:subClassOf schema:EmailMessage .
    <#message> a <urn:custom:Message> ; schema:headline "Hi" .
    <#thread> a <http://rdfs.org/sioc/ns#Thread> .
  `);
  const message = new Message(M, mailbox, DataFactory);
  expect(message).toBeInstanceOf(TermWrapper);
  expect(message.id).toBe(M);
  expect(message.isInstance).toBe(true);
  expect(message.subjectLine).toBe("Hi");
  expect([...mailbox.messages]).toEqual([]);
  expect([...mailbox.threads]).toEqual([]);
  message.markMessage();
  expect(mailbox.findMessage(M)).toBeDefined();
});
