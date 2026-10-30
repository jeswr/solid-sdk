// AUTHORED-BY Codex GPT-6
import { TermTypeError } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { buildPerson, Contact, parsePerson, personSubject } from "./contacts.js";

const PERSON = "https://pod.example/contacts/alice.ttl";
const HOMEPAGE = "https://alice.example/home";
const WEB_ID = "https://alice.example/profile#me";

function dataset(urls: string, nodes = ""): Store {
  return new Store(
    new Parser({ baseIRI: PERSON }).parse(`
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual; vcard:fn "Alice"; vcard:url ${urls} .
      ${nodes}
    `),
  );
}

describe.each([
  {
    api: "Contact.webId",
    read: (store: Store) => new Contact(personSubject(PERSON), store, DataFactory).webId,
  },
  {
    api: "parsePerson",
    read: (store: Store) => {
      const person = parsePerson(PERSON, store);
      expect(person).toBeDefined();
      return person?.webId;
    },
  },
])("$api WebID selection", ({ read }) => {
  it.each([
    { edit: "replacement", value: `<${WEB_ID}>`, expected: WEB_ID },
    { edit: "clearing", value: undefined, expected: undefined },
    { edit: "selecting an existing homepage", value: `<${HOMEPAGE}>`, expected: HOMEPAGE },
  ])("reads $edit with other URLs retained before the explicit selection", ({
    value,
    expected,
  }) => {
    // These are the RDF shapes the contacts editor persists after a WebID edit.
    // It retains generic URLs and appends the selected (or cleared) WebId node.
    const store = dataset(
      `_:home, <https://alice.example/direct>, _:web`,
      `_:home a vcard:Home; vcard:value <${HOMEPAGE}> .
       _:web a vcard:WebId ${value ? `; vcard:value ${value}` : ""} .`,
    );
    const original = [...store];
    expect(read(store)).toBe(expected);
    expect([...store]).toEqual(original);
  });

  it.each([
    "<ftp://alice.example/profile#me>",
    "<https://alice.example>",
  ])("does not fall back to a homepage for an invalid explicit WebID (%s)", (value) => {
    const store = dataset(`<${HOMEPAGE}>, _:web`, `_:web a vcard:WebId; vcard:value ${value} .`);
    expect(read(store)).toBeUndefined();
  });

  it("fails with a typed error for a literal explicit WebID instead of reading the homepage", () => {
    const store = dataset(`<${HOMEPAGE}>, _:web`, `_:web a vcard:WebId; vcard:value "${WEB_ID}" .`);
    expect(() => read(store)).toThrow(TermTypeError);
  });

  it("rejects RDF-forbidden characters in an explicit WebID from an in-memory dataset", () => {
    const store = buildPerson(PERSON, { name: "Alice", webId: "https://alice.example/a|b" });
    expect(read(store)).toBeUndefined();
  });

  it("uses the first valid explicit WebID when an earlier explicit node is empty", () => {
    const store = dataset(
      `<${HOMEPAGE}>, _:cleared, _:web`,
      `_:cleared a vcard:WebId .
       _:web a vcard:WebId; vcard:value <${WEB_ID}> .`,
    );
    expect(read(store)).toBe(WEB_ID);
  });

  it("recognizes an explicit WebID type in a named graph", () => {
    const store = new Store(
      new Parser({ baseIRI: PERSON, format: "TriG" }).parse(`
        @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
        <#this> a vcard:Individual; vcard:url <${HOMEPAGE}>, _:web .
        _:web vcard:value <${WEB_ID}> .
        <#graph> { _:web a vcard:WebId . }
      `),
    );
    expect(read(store)).toBe(WEB_ID);
  });

  it.each([
    { urls: `<ftp://alice.example/>, <${WEB_ID}>`, nodes: "" },
    { urls: "_:legacy", nodes: `_:legacy vcard:value <${WEB_ID}> .` },
    { urls: "_:home", nodes: `_:home a vcard:Home; vcard:value <${HOMEPAGE}> .` },
  ])("retains legacy URL fallback without an explicit WebID ($urls)", ({ urls, nodes }) => {
    const store = dataset(urls, nodes);
    expect(read(store)).toBe(urls === "_:home" ? HOMEPAGE : WEB_ID);
  });

  it("ignores an unlinked WebID node belonging to a different contact", () => {
    const store = dataset(`<${WEB_ID}>`, `<#other> vcard:url [ a vcard:WebId ] .`);
    expect(read(store)).toBe(WEB_ID);
  });
});
