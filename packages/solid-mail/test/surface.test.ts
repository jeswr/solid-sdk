// AUTHORED-BY Codex (GPT-6.1 Sol)
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseRdf } from "@jeswr/fetch-rdf";
import { TermWrapper } from "@rdfjs/wrapper";
import { expect, it } from "vitest";
import { entities } from "../src/generated/model.js";
import { Attachment, MailboxDataset, parseMailbox, serialiseToTurtle } from "../src/index.js";
import { DataFactory, emptyMailbox } from "./helpers.js";

const M = "https://pod.example/mail/messages/1.ttl#it";
const A = "https://pod.example/mail/attachments/1/file.pdf";

it("round-trips every newer suite message field and attachment metadata", async () => {
  const mailbox = emptyMailbox();
  const message = mailbox.createMessage(M);
  message.bodyHtml = '<p title="inert">Hello &amp; bye</p>';
  message.encoding = "https://pod.example/mail/messages/1.eml";
  message.identifier = "<original@example.org>";
  message.folderIris.add("https://pod.example/mail/folders/inbox.ttl#it");
  message.attachments.add(A);
  const attachment = new Attachment(A, mailbox, DataFactory);
  expect(attachment).toBeInstanceOf(TermWrapper);
  expect([...attachment.types]).toEqual([]);
  attachment.types.add("http://schema.org/MediaObject");
  attachment.name = "résumé.pdf";
  attachment.contentType = "application/pdf";
  attachment.size = 123;

  const parsed = await parseMailbox(serialiseToTurtle(mailbox), M);
  const back = parsed.findMessage(M);
  if (!back) throw new Error("Expected the parsed message");
  expect(back?.bodyHtml).toBe(message.bodyHtml);
  expect(back?.encoding).toBe(message.encoding);
  expect(back?.identifier).toBe(message.identifier);
  expect([...(back?.folderIris ?? [])]).toEqual([...message.folderIris]);
  expect([...(back?.attachments ?? [])]).toEqual([A]);
  const metadata = new Attachment(A, parsed, DataFactory);
  expect(metadata.name).toBe("résumé.pdf");
  expect(metadata.contentType).toBe("application/pdf");
  expect(metadata.size).toBe(123);
  expect([...metadata.types]).toEqual(["http://schema.org/MediaObject"]);

  back.bodyHtml = undefined;
  back.encoding = undefined;
  back.identifier = undefined;
  back.folderIris.clear();
  back.attachments.delete(A);
  metadata.name = undefined;
  metadata.contentType = undefined;
  metadata.size = undefined;
  expect(back?.bodyHtml).toBeUndefined();
  expect(back?.encoding).toBeUndefined();
  expect(back?.identifier).toBeUndefined();
  expect(back?.folderIris.size).toBe(0);
  expect(back?.attachments.size).toBe(0);
  expect(metadata.name).toBeUndefined();
  expect(metadata.contentType).toBeUndefined();
  expect(metadata.size).toBeUndefined();
});

it("keeps mailto addresses, lexical IRI identity and live recipient sets", () => {
  const mailbox = emptyMailbox();
  const message = mailbox.createMessage(M);
  message.sender = "mailto:Alice%20Example%20%3Calice%40example.org%3E";
  const recipients = message.to;
  message.to.add("mailto:bob@example.org");
  recipients.add("HTTPS://BOB.example:443/profile#me");
  message.cc.add("urn:contact:carol");
  message.bcc.add("mailto:private@example.org");
  expect(message.sender).toBe("mailto:Alice%20Example%20%3Calice%40example.org%3E");
  expect([...recipients]).toEqual(["mailto:bob@example.org", "HTTPS://BOB.example:443/profile#me"]);
  expect([...message.cc]).toEqual(["urn:contact:carol"]);
  expect([...message.bcc]).toEqual(["mailto:private@example.org"]);
  message.to.delete("mailto:bob@example.org");
  expect(recipients.has("mailto:bob@example.org")).toBe(false);
  recipients.clear();
  expect(message.to.size).toBe(0);
});

it("preserves decoded mail text including controls, whitespace and empty strings", async () => {
  const mailbox = emptyMailbox();
  const message = mailbox.createMessage(M);
  const text = " \tfirst\u0000\u0001\u007f\u009f\r\n second ";
  message.subjectLine = "";
  message.body = text;
  message.bodyHtml = text;
  message.identifier = text;
  const parsed = await parseMailbox(serialiseToTurtle(mailbox), M);
  expect(parsed.findMessage(M)?.subjectLine).toBe("");
  expect(parsed.findMessage(M)?.body).toBe(text);
  expect(parsed.findMessage(M)?.bodyHtml).toBe(text);
  expect(parsed.findMessage(M)?.identifier).toBe(text);
});

it("parses document-relative siblings and preserves unrelated triples on edit", async () => {
  const doc = "https://pod.example/mail/all.ttl";
  const mailbox = await parseMailbox(
    `
    @prefix schema: <http://schema.org/> .
    <#one> a schema:EmailMessage ; schema:headline "One" .
    <#two> a schema:EmailMessage ; schema:headline "Two" .
    <#unrelated> <urn:external:property> "preserved"@en .
  `,
    doc,
  );
  const one = mailbox.findMessage(`${doc}#one`);
  if (!one) throw new Error("Expected the first message");
  one.setRead(true);
  const turtle = serialiseToTurtle(mailbox);
  const dataset = await parseRdf(turtle, "text/turtle", { baseIRI: doc });
  expect([...mailbox.messages].map((m) => m.value)).toEqual([`${doc}#one`, `${doc}#two`]);
  expect([...dataset].some((q) => q.predicate.value === "urn:external:property")).toBe(true);
  expect((await parseMailbox(turtle, doc)).findMessage(`${doc}#two`)?.subjectLine).toBe("Two");
  await expect(parseMailbox("malformed Turtle", doc)).rejects.toThrow();
});

it("retains the suite serializer's named-graph rejection", async () => {
  const dataset = await parseRdf(
    '<urn:mail:one> <urn:mail:property> "value" <urn:mail:graph> .',
    "application/n-quads",
    {},
  );
  expect(() => serialiseToTurtle(new MailboxDataset(dataset, DataFactory))).toThrow(
    "Named graphs cannot be serialised as Turtle",
  );
});

it("exercises generated build, parse and serialization for all four entities", async () => {
  const cases = [
    { entity: entities.Message, data: { subjectLine: "Hi", to: ["mailto:bob@example.org"] } },
    { entity: entities.Thread, data: { title: "Thread", messageIris: [M] } },
    { entity: entities.Folder, data: { title: "Inbox", messageIris: [M] } },
    { entity: entities.Attachment, data: { name: "File", contentType: "text/plain", size: 0 } },
  ];
  for (const { entity, data } of cases) {
    expect(entity.subject(M)).toBe(M);
    // Each handle has a different data type; the supplied record uses only its own fields.
    expect(entity.parse(M, entity.build(M, data))).toEqual(data);
    expect(await entity.parseDocument(M, await entity.serialize(M, data))).toEqual(data);
  }
});

it("compiles strict consumers against the published declarations", async () => {
  await promisify(execFile)(process.execPath, [
    fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
    "--noEmit",
    "--skipLibCheck",
    "--strict",
    "--exactOptionalPropertyTypes",
    "--module",
    "NodeNext",
    "--target",
    "ES2022",
    fileURLToPath(new URL("./consumer.ts", import.meta.url)),
  ]);
}, 15_000);
