// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import env from "@zazuko/env-node";
import { DataFactory, Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import {
  addressBookSubject,
  buildAddressBook,
  buildGroup,
  buildGroupsIndex,
  buildPeopleIndex,
  buildPerson,
  Contact,
  type ContactData,
  groupSubject,
  parseAddressBook,
  parseAddressBookTtl,
  parseGroup,
  parseGroupTtl,
  parsePerson,
  parsePersonTtl,
  personSubject,
  serializeAddressBook,
  serializeGroup,
  serializePerson,
} from "./contacts.js";
import { addressBookShapeTtl } from "./shape.js";
import { dc, dct, vcard } from "./vocab.js";

const BOOK = "http://localhost:3000/alice/contacts/index.ttl";
const BOOK_SUBJECT = `${BOOK}#this`;
const PEOPLE = "http://localhost:3000/alice/contacts/people.ttl";
const GROUPS = "http://localhost:3000/alice/contacts/groups.ttl";
const PERSON = "http://localhost:3000/alice/contacts/Person/abc/index.ttl";
const PERSON2 = "http://localhost:3000/alice/contacts/Person/def/index.ttl";
const GROUP = "http://localhost:3000/alice/contacts/Group/friends.ttl";
const ME = "http://localhost:3000/alice/profile/card#me";
const BOB = "http://localhost:3000/bob/profile/card#me";

function parseStore(ttl: string, base: string): Store {
  const store = new Store();
  store.addQuads(new Parser({ baseIRI: base }).parse(ttl));
  return store;
}

function has(store: Store, s: string, p: string, o: string): boolean {
  return (
    store.getQuads(
      DataFactory.namedNode(s),
      DataFactory.namedNode(p),
      DataFactory.namedNode(o),
      null,
    ).length > 0
  );
}

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

describe("buildAddressBook / parseAddressBook round-trip", () => {
  it("round-trips a fully-populated address book", () => {
    const store = buildAddressBook(BOOK, {
      title: "Alice's Contacts",
      nameEmailIndex: PEOPLE,
      groupIndex: GROUPS,
      owner: ME,
    });
    const parsed = parseAddressBook(BOOK, store);
    expect(parsed).toBeDefined();
    expect(parsed?.title).toBe("Alice's Contacts");
    expect(parsed?.nameEmailIndex).toBe(PEOPLE);
    expect(parsed?.groupIndex).toBe(GROUPS);
    expect(parsed?.owner).toBe(ME);
  });

  it("defaults the indexes to people.ttl / groups.ttl resolved against the book doc", () => {
    const store = buildAddressBook(BOOK, { title: "Defaults" });
    const parsed = parseAddressBook(BOOK, store);
    expect(parsed?.nameEmailIndex).toBe(PEOPLE);
    expect(parsed?.groupIndex).toBe(GROUPS);
  });

  it("writes BOTH dc:title (DC Elements) and vcard:fn for the title", () => {
    const store = buildAddressBook(BOOK, { title: "Both titles" });
    const sub = BOOK_SUBJECT;
    expect(
      store.getQuads(DataFactory.namedNode(sub), DataFactory.namedNode(dc("title")), null, null),
    ).toHaveLength(1);
    expect(
      store.getQuads(DataFactory.namedNode(sub), DataFactory.namedNode(vcard("fn")), null, null),
    ).toHaveLength(1);
  });

  it("parseAddressBook returns undefined when the subject is not a vcard:AddressBook", () => {
    const store = parseStore(
      `@prefix dc: <http://purl.org/dc/elements/1.1/> . <#this> dc:title "Not a book" .`,
      BOOK,
    );
    expect(parseAddressBook(BOOK, store)).toBeUndefined();
  });

  it("drops a non-http(s) owner / index IRI (untrusted input)", () => {
    const store = buildAddressBook(BOOK, {
      title: "Untrusted",
      owner: "urn:bad",
      nameEmailIndex: "urn:also-bad",
    });
    const parsed = parseAddressBook(BOOK, store);
    expect(parsed?.owner).toBeUndefined();
    // A non-http(s) index falls back to the default people.ttl.
    expect(parsed?.nameEmailIndex).toBe(PEOPLE);
  });
});

describe("buildPerson / parsePerson round-trip", () => {
  it("round-trips a person with multiple emails + phones + webId + note", () => {
    const data: ContactData = {
      name: "Bob Smith",
      inAddressBook: BOOK_SUBJECT,
      emails: ["bob@example.com", "mailto:bob2@example.org"],
      phones: ["+15551234", "tel:+15555678"],
      webId: BOB,
      note: "Met at the conference.",
    };
    const store = buildPerson(PERSON, data);
    const parsed = parsePerson(PERSON, store);
    expect(parsed).toBeDefined();
    expect(parsed?.name).toBe("Bob Smith");
    expect(parsed?.inAddressBook).toBe(BOOK_SUBJECT);
    expect(new Set(parsed?.emails)).toEqual(
      new Set(["mailto:bob@example.com", "mailto:bob2@example.org"]),
    );
    expect(new Set(parsed?.phones)).toEqual(new Set(["tel:+15551234", "tel:+15555678"]));
    expect(parsed?.webId).toBe(BOB);
    expect(parsed?.note).toBe("Met at the conference.");
    expect(parsed?.created).toBeInstanceOf(Date);
  });

  it("round-trips a minimal person (name only)", () => {
    const store = buildPerson(PERSON, { name: "Just A Name" });
    const parsed = parsePerson(PERSON, store);
    expect(parsed?.name).toBe("Just A Name");
    expect(parsed?.created).toBeInstanceOf(Date);
  });

  it("writes a vcard:hasUID urn:uuid: literal", () => {
    const store = buildPerson(PERSON, { name: "UID" });
    const person = new Contact(personSubject(PERSON), store, DataFactory);
    expect(person.uid?.startsWith("urn:uuid:")).toBe(true);
  });

  it("drops a malformed email / phone on build (untrusted input)", () => {
    const store = buildPerson(PERSON, {
      name: "Bad addresses",
      // A direct mailto: passes through; the bare "not-an-email" and "weird://x"
      // become mailto:not-an-email (well-formed) but "javascript:" / empty are dropped.
      emails: ["good@example.com", ""],
      phones: ["", "+1555"],
    });
    const parsed = parsePerson(PERSON, store);
    expect(parsed?.emails).toEqual(["mailto:good@example.com"]);
    expect(parsed?.phones).toEqual(["tel:+1555"]);
  });

  it("drops a non-http(s) webId / inAddressBook (untrusted input)", () => {
    const store = buildPerson(PERSON, {
      name: "Untrusted refs",
      webId: "urn:agent:bob",
      inAddressBook: "not a url",
    });
    const parsed = parsePerson(PERSON, store);
    expect(parsed?.webId).toBeUndefined();
    expect(parsed?.inAddressBook).toBeUndefined();
  });
});

describe("THE CRUX — parse accepts BOTH email/phone forms → same Contact", () => {
  it("parses a direct vcard:hasEmail <mailto:..> (legacy form)", () => {
    const ttl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ;
        vcard:fn "Direct Email" ;
        vcard:hasEmail <mailto:direct@example.com> ;
        vcard:hasTelephone <tel:+15550000> .
    `;
    const parsed = parsePerson(PERSON, parseStore(ttl, PERSON));
    expect(parsed?.emails).toEqual(["mailto:direct@example.com"]);
    expect(parsed?.phones).toEqual(["tel:+15550000"]);
  });

  it("parses a structured vcard:hasEmail [ vcard:value <mailto:..> ] (SolidOS form)", () => {
    const ttl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ;
        vcard:fn "Structured Email" ;
        vcard:hasEmail [ a vcard:Home ; vcard:value <mailto:struct@example.com> ] ;
        vcard:hasTelephone [ a vcard:Cell ; vcard:value <tel:+15551111> ] .
    `;
    const parsed = parsePerson(PERSON, parseStore(ttl, PERSON));
    expect(parsed?.emails).toEqual(["mailto:struct@example.com"]);
    expect(parsed?.phones).toEqual(["tel:+15551111"]);
  });

  it("the two forms yield the SAME Contact value (the crux)", () => {
    const directTtl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ; vcard:fn "Same" ;
        vcard:hasEmail <mailto:same@example.com> ;
        vcard:hasTelephone <tel:+15552222> .
    `;
    const structTtl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ; vcard:fn "Same" ;
        vcard:hasEmail [ a vcard:Home ; vcard:value <mailto:same@example.com> ] ;
        vcard:hasTelephone [ a vcard:Cell ; vcard:value <tel:+15552222> ] .
    `;
    const direct = parsePerson(PERSON, parseStore(directTtl, PERSON));
    const struct = parsePerson(PERSON, parseStore(structTtl, PERSON));
    expect(direct?.emails).toEqual(struct?.emails);
    expect(direct?.phones).toEqual(struct?.phones);
    expect(direct?.emails).toEqual(["mailto:same@example.com"]);
    expect(direct?.phones).toEqual(["tel:+15552222"]);
  });

  it("the BUILDER always writes the STRUCTURED form (SolidOS reads vcard:value)", () => {
    const store = buildPerson(PERSON, {
      name: "Builder writes structured",
      emails: ["x@example.com"],
      phones: ["+15553333"],
    });
    const sub = personSubject(PERSON);
    // The hasEmail object is a blank node, not a direct IRI.
    const emailEdges = store.getQuads(
      DataFactory.namedNode(sub),
      DataFactory.namedNode(vcard("hasEmail")),
      null,
      null,
    );
    expect(emailEdges).toHaveLength(1);
    expect(emailEdges[0]?.object.termType).toBe("BlankNode");
    // The blank node carries a vcard:value <mailto:..> and a vcard:Home type.
    // NOTE: the subject is a BLANK node, so match on the term itself, not a
    // DataFactory.namedNode(label) (a blank-node label is not a NamedNode IRI).
    const bnode = emailEdges[0]?.object;
    if (bnode) {
      const value = store.getQuads(bnode, DataFactory.namedNode(vcard("value")), null, null);
      expect(value[0]?.object.value).toBe("mailto:x@example.com");
      const type = store.getQuads(bnode, DataFactory.namedNode(RDF_TYPE), null, null);
      expect(type.map((q) => q.object.value)).toContain(vcard("Home"));
    }
  });

  it("the PARSER drops a non-mailto:/non-tel: value from untrusted RDF (direct + structured)", () => {
    // A malicious/malformed contact: a javascript: / http: / literal value must NOT
    // be surfaced as an email/phone to UI. Both the direct-IRI and structured forms
    // are guarded; only well-formed mailto:/tel: values survive.
    const ttl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ; vcard:fn "Untrusted" ;
        vcard:hasEmail <javascript:alert(1)> ;
        vcard:hasEmail <https://evil.example/phish> ;
        vcard:hasEmail [ a vcard:Home ; vcard:value <javascript:alert(2)> ] ;
        vcard:hasEmail [ a vcard:Home ; vcard:value <mailto:ok@example.com> ] ;
        vcard:hasTelephone <javascript:alert(3)> ;
        vcard:hasTelephone [ a vcard:Cell ; vcard:value <sip:evil@x> ] ;
        vcard:hasTelephone [ a vcard:Cell ; vcard:value <tel:+15559999> ] .
    `;
    const parsed = parsePerson(PERSON, parseStore(ttl, PERSON));
    expect(parsed?.emails).toEqual(["mailto:ok@example.com"]);
    expect(parsed?.phones).toEqual(["tel:+15559999"]);
  });
});

describe("SolidOS-readable triples (the pane reads these)", () => {
  it("a built person carries the exact triples SolidOS reads", () => {
    const store = buildPerson(PERSON, {
      name: "Readable",
      inAddressBook: BOOK_SUBJECT,
      emails: ["r@example.com"],
    });
    const sub = personSubject(PERSON);
    // ?p a vcard:Individual
    expect(has(store, sub, RDF_TYPE, vcard("Individual"))).toBe(true);
    // ?p vcard:inAddressBook ?book
    expect(has(store, sub, vcard("inAddressBook"), BOOK_SUBJECT)).toBe(true);
    // ?p vcard:fn
    expect(
      store.getQuads(DataFactory.namedNode(sub), DataFactory.namedNode(vcard("fn")), null, null),
    ).not.toHaveLength(0);
    // structured ?p vcard:hasEmail ?e . ?e vcard:value <mailto:..>
    const e = store.getQuads(
      DataFactory.namedNode(sub),
      DataFactory.namedNode(vcard("hasEmail")),
      null,
      null,
    )[0]?.object;
    expect(e?.termType).toBe("BlankNode");
    if (e) {
      expect(
        store.getQuads(e, DataFactory.namedNode(vcard("value")), null, null)[0]?.object.value,
      ).toBe("mailto:r@example.com");
    }
  });

  it("the address book + index docs carry the exact triples SolidOS reads", async () => {
    const bookStore = buildAddressBook(BOOK, { title: "Indexed", owner: ME });
    // book vcard:nameEmailIndex <people.ttl> ; vcard:groupIndex <groups.ttl>
    expect(has(bookStore, BOOK_SUBJECT, vcard("nameEmailIndex"), PEOPLE)).toBe(true);
    expect(has(bookStore, BOOK_SUBJECT, vcard("groupIndex"), GROUPS)).toBe(true);

    // people.ttl: person vcard:inAddressBook book ; person vcard:fn name
    const peopleStore = buildPeopleIndex(BOOK_SUBJECT, [{ person: `${PERSON}#this`, name: "Bob" }]);
    expect(has(peopleStore, `${PERSON}#this`, vcard("inAddressBook"), BOOK_SUBJECT)).toBe(true);
    expect(
      peopleStore.getQuads(
        DataFactory.namedNode(`${PERSON}#this`),
        DataFactory.namedNode(vcard("fn")),
        null,
        null,
      ),
    ).not.toHaveLength(0);

    // groups.ttl: book vcard:includesGroup group ; group a vcard:Group ; group vcard:fn
    const groupsStore = buildGroupsIndex(BOOK_SUBJECT, [
      { group: `${GROUP}#this`, name: "Friends" },
    ]);
    expect(has(groupsStore, BOOK_SUBJECT, vcard("includesGroup"), `${GROUP}#this`)).toBe(true);
    expect(has(groupsStore, `${GROUP}#this`, RDF_TYPE, vcard("Group"))).toBe(true);

    // group doc: group vcard:hasMember person
    const groupStore = buildGroup(GROUP, {
      name: "Friends",
      inAddressBook: BOOK_SUBJECT,
      members: [`${PERSON}#this`],
    });
    expect(has(groupStore, groupSubject(GROUP), vcard("hasMember"), `${PERSON}#this`)).toBe(true);
  });
});

describe("buildGroup / parseGroup round-trip", () => {
  it("round-trips a group with members", () => {
    const store = buildGroup(GROUP, {
      name: "Friends",
      inAddressBook: BOOK_SUBJECT,
      members: [`${PERSON}#this`, `${PERSON2}#this`],
    });
    const parsed = parseGroup(GROUP, store);
    expect(parsed?.name).toBe("Friends");
    expect(parsed?.inAddressBook).toBe(BOOK_SUBJECT);
    expect(new Set(parsed?.members)).toEqual(new Set([`${PERSON}#this`, `${PERSON2}#this`]));
  });

  it("drops a non-http(s) member (untrusted input)", () => {
    const store = buildGroup(GROUP, {
      name: "Mixed",
      members: [`${PERSON}#this`, "urn:agent:x", "mailto:y@z.com"],
    });
    const parsed = parseGroup(GROUP, store);
    expect(parsed?.members).toEqual([`${PERSON}#this`]);
  });

  it("parseGroup returns undefined when the subject is not a vcard:Group", () => {
    const store = parseStore(
      `@prefix vcard: <http://www.w3.org/2006/vcard/ns#> . <#this> vcard:fn "Not a group" .`,
      GROUP,
    );
    expect(parseGroup(GROUP, store)).toBeUndefined();
  });
});

describe("namespace-spelling lock (a refactor must not silently break the contract)", () => {
  it("the SolidOS vcard extension term IRIs are spelled exactly", () => {
    expect(vcard("AddressBook")).toBe("http://www.w3.org/2006/vcard/ns#AddressBook");
    expect(vcard("nameEmailIndex")).toBe("http://www.w3.org/2006/vcard/ns#nameEmailIndex");
    expect(vcard("groupIndex")).toBe("http://www.w3.org/2006/vcard/ns#groupIndex");
    expect(vcard("inAddressBook")).toBe("http://www.w3.org/2006/vcard/ns#inAddressBook");
    expect(vcard("includesGroup")).toBe("http://www.w3.org/2006/vcard/ns#includesGroup");
  });

  it("dc:title (DC Elements) and dct:created (DC Terms) are DISTINCT namespaces", () => {
    expect(dc("title")).toBe("http://purl.org/dc/elements/1.1/title");
    expect(dct("created")).toBe("http://purl.org/dc/terms/created");
    // They must not be the same namespace.
    expect(dc("title")).not.toBe("http://purl.org/dc/terms/title");
  });

  it("a built book uses dc:title (Elements) and a built person uses dct:created (Terms)", () => {
    const bookStore = buildAddressBook(BOOK, { title: "DC test" });
    expect(
      bookStore.getQuads(
        DataFactory.namedNode(BOOK_SUBJECT),
        DataFactory.namedNode("http://purl.org/dc/elements/1.1/title"),
        null,
        null,
      ),
    ).toHaveLength(1);
    const personStore = buildPerson(PERSON, { name: "DC test" });
    expect(
      personStore.getQuads(
        DataFactory.namedNode(personSubject(PERSON)),
        DataFactory.namedNode("http://purl.org/dc/terms/created"),
        null,
        null,
      ),
    ).toHaveLength(1);
  });
});

describe("parse*Ttl (content-type dispatch via @jeswr/fetch-rdf)", () => {
  it("parses a serialised book from Turtle", async () => {
    const ttl = await serializeAddressBook(BOOK, { title: "Serialised", owner: ME });
    const parsed = await parseAddressBookTtl(BOOK, ttl, "text/turtle");
    expect(parsed?.title).toBe("Serialised");
    expect(parsed?.owner).toBe(ME);
  });

  it("treats a null content-type as text/turtle (book)", async () => {
    const ttl = await serializeAddressBook(BOOK, { title: "Null CT" });
    const parsed = await parseAddressBookTtl(BOOK, ttl, null);
    expect(parsed?.title).toBe("Null CT");
  });

  it("parses a serialised person from Turtle (structured email round-trips)", async () => {
    const ttl = await serializePerson(PERSON, {
      name: "Serialised Person",
      emails: ["sp@example.com"],
    });
    const parsed = await parsePersonTtl(PERSON, ttl, "text/turtle");
    expect(parsed?.name).toBe("Serialised Person");
    expect(parsed?.emails).toEqual(["mailto:sp@example.com"]);
  });

  it("treats a null content-type as text/turtle (person)", async () => {
    const ttl = await serializePerson(PERSON, { name: "Null CT Person" });
    const parsed = await parsePersonTtl(PERSON, ttl, null);
    expect(parsed?.name).toBe("Null CT Person");
  });

  it("parses a serialised group from Turtle", async () => {
    const ttl = await serializeGroup(GROUP, {
      name: "Serialised Group",
      members: [`${PERSON}#this`],
    });
    const parsed = await parseGroupTtl(GROUP, ttl, null);
    expect(parsed?.name).toBe("Serialised Group");
    expect(parsed?.members).toEqual([`${PERSON}#this`]);
  });
});

// rdf-validate-shacl needs a clownface-capable factory (@zazuko/env). Quads are
// fed straight from an n3 Parser/Store into an env dataset — the exact pattern the
// task + tracker shape tests use, so verdicts match across the suite.
function toDataset(quads: Iterable<Parameters<ReturnType<typeof env.dataset>["add"]>[0]>) {
  const ds = env.dataset();
  for (const q of quads) ds.add(q);
  return ds;
}

const contactsShapes = toDataset(new Parser().parse(addressBookShapeTtl()));

function validate(store: Store) {
  return new SHACLValidator(contactsShapes, { factory: env }).validate(toDataset(store));
}

function validateTtl(ttl: string, base: string) {
  return new SHACLValidator(contactsShapes, { factory: env }).validate(
    toDataset(new Parser({ baseIRI: base }).parse(ttl)),
  );
}

describe("SHACL shape (shapes/contacts.ttl)", () => {
  it("a canonical book + person + group yields ZERO violations", async () => {
    const combined = new Store();
    combined.addQuads([...buildAddressBook(BOOK, { title: "All", owner: ME })]);
    combined.addQuads([
      ...buildPerson(PERSON, {
        name: "Bob",
        inAddressBook: BOOK_SUBJECT,
        emails: ["bob@example.com"],
        phones: ["+15551234"],
        webId: BOB,
      }),
    ]);
    combined.addQuads([
      ...buildGroup(GROUP, {
        name: "Friends",
        inAddressBook: BOOK_SUBJECT,
        members: [`${PERSON}#this`],
      }),
    ]);
    const report = await validate(combined);
    // No violations (Warnings are advisory).
    const violations = report.results.filter((r) =>
      String(r.severity?.value).endsWith("Violation"),
    );
    expect(violations).toHaveLength(0);
    expect(report.conforms).toBe(true);
  });

  it("a contact with NO group / NO inAddressBook is NOT a Violation (conforms stays true)", async () => {
    // A canonical person with a name + email but no inAddressBook and in no group:
    // inAddressBook is maxCount-only (its absence is fine) and group membership is
    // not required of an individual, so this yields ZERO results → conforms true.
    const store = buildPerson(PERSON, { name: "Loner", emails: ["loner@example.com"] });
    const report = await validate(store);
    expect(report.conforms).toBe(true);
    const violations = report.results.filter((r) =>
      String(r.severity?.value).endsWith("Violation"),
    );
    expect(violations).toHaveLength(0);
  });

  it("a person with NO vcard:fn yields a Warning, NOT a Violation (advisory, not fatal)", async () => {
    const ttl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ;
        vcard:hasEmail [ vcard:value <mailto:noname@example.com> ] .
    `;
    const report = await validateTtl(ttl, PERSON);
    // The missing-fn rule is sh:Warning → a result exists, but at Warning severity.
    // (rdf-validate-shacl sets `conforms = false` on ANY result, even a Warning —
    // so the meaningful federation property is "no VIOLATION", which we assert
    // directly rather than leaning on `conforms`; mirrors the tracker shape test.)
    expect(
      report.results.some(
        (r) =>
          String(r.path?.value).endsWith("fn") && String(r.severity?.value).endsWith("Warning"),
      ),
    ).toBe(true);
    const violations = report.results.filter((r) =>
      String(r.severity?.value).endsWith("Violation"),
    );
    expect(violations).toHaveLength(0);
  });

  it("a book with NO nameEmailIndex is non-conforming (required)", async () => {
    const ttl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      @prefix dc:    <http://purl.org/dc/elements/1.1/> .
      <#this> a vcard:AddressBook ;
        dc:title "No people index" ;
        vcard:fn "No people index" ;
        vcard:groupIndex <groups.ttl> .
    `;
    const report = await validateTtl(ttl, BOOK);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("nameEmailIndex"))).toBe(true);
  });

  it("a bare literal email (not mailto: IRI, not structured) is non-conforming", async () => {
    const ttl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ;
        vcard:fn "Bad email" ;
        vcard:hasEmail "plain-string@example.com" .
    `;
    const report = await validateTtl(ttl, PERSON);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("hasEmail"))).toBe(true);
  });

  it("BOTH email forms conform against the shape (direct IRI and structured node)", async () => {
    const directTtl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ; vcard:fn "Direct" ;
        vcard:hasEmail <mailto:d@example.com> .
    `;
    const structTtl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ; vcard:fn "Struct" ;
        vcard:hasEmail [ a vcard:Home ; vcard:value <mailto:s@example.com> ] .
    `;
    expect((await validateTtl(directTtl, PERSON)).conforms).toBe(true);
    expect((await validateTtl(structTtl, PERSON)).conforms).toBe(true);
  });

  it("a structured node with a LITERAL vcard:value is non-conforming (parser ignores literals)", async () => {
    // parsePerson reads vcard:value via NamedNodeAs.string and IGNORES a literal, so
    // the shape must reject a structured node whose vcard:value is a literal — the
    // sh:nodeKind sh:IRI guard on the nested vcard:value shape (email + phone).
    const emailLiteral = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ; vcard:fn "Literal value" ;
        vcard:hasEmail [ a vcard:Home ; vcard:value "mailto:x@example.com" ] .
    `;
    const phoneLiteral = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Individual ; vcard:fn "Literal value" ;
        vcard:hasTelephone [ a vcard:Cell ; vcard:value "tel:+15550000" ] .
    `;
    const emailReport = await validateTtl(emailLiteral, PERSON);
    expect(emailReport.conforms).toBe(false);
    expect(emailReport.results.some((r) => String(r.path?.value).endsWith("hasEmail"))).toBe(true);
    const phoneReport = await validateTtl(phoneLiteral, PERSON);
    expect(phoneReport.conforms).toBe(false);
    expect(phoneReport.results.some((r) => String(r.path?.value).endsWith("hasTelephone"))).toBe(
      true,
    );
  });

  it("a group with NO vcard:fn is non-conforming (required)", async () => {
    const ttl = `
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <#this> a vcard:Group ;
        vcard:hasMember <http://localhost:3000/alice/contacts/Person/abc/index.ttl#this> .
    `;
    const report = await validateTtl(ttl, GROUP);
    expect(report.conforms).toBe(false);
    expect(report.results.some((r) => String(r.path?.value).endsWith("fn"))).toBe(true);
  });
});

describe("subject conventions", () => {
  it("address book / person / group all root at #this", () => {
    expect(addressBookSubject(BOOK)).toBe(`${BOOK}#this`);
    expect(personSubject(PERSON)).toBe(`${PERSON}#this`);
    expect(groupSubject(GROUP)).toBe(`${GROUP}#this`);
  });
});
