// AUTHORED-BY Claude Opus 5.5
// Indexed find* lookups must accept exactly the subjects the enumerations yield.
import { expect, it } from "vitest";
import { Classes } from "../src/index.js";
import { DataFactory, emptyMailbox } from "./helpers.js";

const { namedNode, quad, blankNode } = DataFactory;
const DOC = "https://pod.example/mail/all.ttl";
const TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");

it("finds explicitly typed subjects and agrees with enumeration", () => {
  const mailbox = emptyMailbox();
  mailbox.createMessage(`${DOC}#m`).subjectLine = "Hi";
  mailbox.createThread(`${DOC}#t`);
  mailbox.createFolder(`${DOC}#f`);
  expect(mailbox.findMessage(`${DOC}#m`)?.subjectLine).toBe("Hi");
  expect(mailbox.findThread(`${DOC}#t`)?.value).toBe(`${DOC}#t`);
  expect(mailbox.findFolder(`${DOC}#f`)?.value).toBe(`${DOC}#f`);
  for (const [find, all] of [
    [(iri: string) => mailbox.findMessage(iri), [...mailbox.messages]],
    [(iri: string) => mailbox.findThread(iri), [...mailbox.threads]],
    [(iri: string) => mailbox.findFolder(iri), [...mailbox.folders]],
  ] as const) {
    for (const iri of [`${DOC}#m`, `${DOC}#t`, `${DOC}#f`, `${DOC}#none`]) {
      expect(find(iri)?.value).toBe(all.find((w) => w.value === iri)?.value);
    }
  }
});

it("does not find untyped, wrongly typed or unwrappable subjects", () => {
  const mailbox = emptyMailbox();
  mailbox.message(`${DOC}#untyped`).subjectLine = "untyped";
  mailbox.add(quad(namedNode(`${DOC}#thread`), TYPE, namedNode(Classes.Conversation)));
  mailbox.add(quad(namedNode("not an iri"), TYPE, namedNode(Classes.EmailMessage)));
  mailbox.add(quad(blankNode("b"), TYPE, namedNode(Classes.EmailMessage)));
  expect(mailbox.findMessage(`${DOC}#untyped`)).toBeUndefined();
  expect(mailbox.findMessage(`${DOC}#thread`)).toBeUndefined();
  expect(mailbox.findFolder(`${DOC}#thread`)).toBeUndefined();
  expect(mailbox.findMessage("not an iri")).toBeUndefined();
  expect(mailbox.findMessage("b")).toBeUndefined();
  expect([...mailbox.messages]).toEqual([]);
});
