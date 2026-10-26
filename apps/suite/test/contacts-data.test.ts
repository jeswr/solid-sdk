// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { describe, expect, test } from "vitest";
import {
  buildAddressBook,
  buildGroup,
  buildPerson,
  Contact,
  ContactsDataset,
  contactData,
  flatContacts,
  parseAddressBookTtl,
  parseGroupTtl,
  parsePersonTtl,
  readGroupsIndex,
  readPeopleIndex,
  serializeAddressBook,
  serializeGroup,
  serializePerson,
  sortedSections,
  validateContact,
} from "../src/apps/contacts/lib/model";
import { applyContact } from "../src/apps/contacts/lib/model/data";
import { ALICE, BOOK, FRIENDS, fixture, parse, ROOT, VCARD_PREFIX } from "./contacts-support";

describe("contacts pure data", () => {
  test("reads a SolidOS-shaped fixture with relative index links and DC Elements title", async () => {
    const book = await parseAddressBookTtl(BOOK, fixture("book"));
    expect(book).toEqual({
      title: "Personal contacts",
      nameEmailIndex: `${ROOT}contacts/people.ttl`,
      groupIndex: `${ROOT}contacts/groups.ttl`,
      owner: `${ROOT}profile/card#me`,
    });
    expect(
      await parseAddressBookTtl(BOOK, await serializeAddressBook(BOOK, { title: "New" })),
    ).toMatchObject({ title: "New" });
    expect(buildAddressBook(BOOK, { title: "New" }).size).toBeGreaterThan(0);
  });

  test("reads SolidOS people/groups indexes, including unnamed and untyped entries", async () => {
    const people = await parse(
      `${fixture("people")}\n_:b vcard:inAddressBook <book.ttl#this> . <people/unknown.ttl#this> vcard:inAddressBook <book.ttl#this> . <other> vcard:inAddressBook <other-book> .`,
      `${ROOT}contacts/people.ttl`,
    );
    expect(readPeopleIndex(`${BOOK}#this`, people)).toEqual([
      { id: `${ALICE}#this`, name: "Alice" },
      { id: `${ROOT}contacts/people/bob.ttl#this`, name: "Bob" },
      { id: `${ROOT}contacts/people/unknown.ttl#this`, name: "" },
    ]);
    const groups = await parse(
      `${fixture("groups")}\n<book.ttl#this> vcard:includesGroup <groups/unnamed.ttl#this> .`,
      `${ROOT}contacts/groups.ttl`,
    );
    expect(readGroupsIndex(`${BOOK}#this`, groups).map((entry) => entry.name)).toEqual([
      "Friends",
      "",
    ]);
    expect(readPeopleIndex(`${BOOK}#this`, new Store())).toEqual([]);
    expect(readGroupsIndex(`${BOOK}#this`, new Store())).toEqual([]);
  });

  test("round-trips names, emails, phones, organization, note, WebID and creation time", async () => {
    const data = {
      name: 'Alice "A"\nΩ',
      emails: ["mailto:a@example.org"],
      phones: ["tel:+44123"],
      organization: "Org",
      note: "Note",
      webId: "https://alice.example/#me",
      created: new Date("2026-01-01T00:00:00Z"),
      inAddressBook: `${BOOK}#this`,
    };
    expect(await parsePersonTtl(ALICE, await serializePerson(ALICE, data))).toEqual(data);
    expect(
      contactData(new Contact(`${ALICE}#this`, buildPerson(ALICE, data), DataFactory)),
    ).toEqual(data);
    const group = { name: "Friends", members: [`${ALICE}#this`], inAddressBook: `${BOOK}#this` };
    expect(await parseGroupTtl(FRIENDS, await serializeGroup(FRIENDS, group))).toEqual(group);
    expect(buildGroup(FRIENDS, group).size).toBeGreaterThan(0);
  });

  test("maps PM flat #it contact fields without losing multiple values or ORG", async () => {
    const [candidate] = flatContacts(await parse(fixture("pm"), `${ROOT}contacts/old.ttl`));
    expect(candidate?.data).toEqual({
      name: "Pat Morgan",
      emails: ["mailto:pat@example.org", "mailto:work@example.org"],
      phones: ["tel:+44123", "tel:+44567"],
      note: "Original note",
      organization: "PM Inc",
      webId: "https://pat.example/profile#me",
    });
    expect(flatContacts(await parse(fixture("alice"), ALICE))).toEqual([]);
    const unnamed = await parse(`${VCARD_PREFIX} <#it> a vcard:Individual .`);
    expect(flatContacts(unnamed)[0]?.data).toEqual({ name: "" });
    expect([...new ContactsDataset(unnamed, DataFactory).contacts]).toHaveLength(1);
  });

  test("sorts immutable indexes into alphabetical sections with stable ties and a fallback", () => {
    const entries = [
      { id: "z", name: " Bob" },
      { id: "b", name: "alice" },
      { id: "a", name: "Alice" },
      { id: "x", name: "9 Lives" },
      { id: "u", name: "" },
      { id: "e", name: "Élodie" },
    ];
    const original = structuredClone(entries);
    const sections = sortedSections(entries);
    expect(sections.map((section) => section.letter)).toEqual(["#", "A", "B", "É"]);
    expect(sections[1]?.contacts.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(entries).toEqual(original);
    expect(sortedSections([], "en")).toEqual([]);
  });

  test("validates required names, contact points, WebIDs and creation dates", () => {
    expect(() => validateContact({ name: "Alice" })).not.toThrow();
    expect(() =>
      validateContact({
        name: "Alice",
        emails: ["a@example.org", "mailto:b@example.org"],
        phones: ["+44 (123) 4-5", "tel:123"],
        webId: "https://a.example/#me",
        created: new Date(),
      }),
    ).not.toThrow();
    for (const data of [
      { name: " " },
      { name: "A", emails: ["bad"] },
      { name: "A", phones: ["javascript:1"] },
      { name: "A", webId: "javascript:bad" },
      { name: "A", created: new Date("bad") },
    ]) {
      expect(() => validateContact(data)).toThrow(TypeError);
    }
  });
});

// AUTHORED-BY Codex GPT-6
test("renaming parsed contacts preserves every structured value node and its metadata", async () => {
  const dataset = await parse(
    `${fixture("alice")}
    <#this> vcard:hasEmail _:work2 .
    _:work2 a vcard:Work; vcard:value <mailto:alice@example.org>; vcard:pref "2" .
    <#this> vcard:hasTelephone _:phone .
    _:phone a vcard:Work; vcard:value <tel:+441234567>; vcard:pref "1" .
    <#this> vcard:url _:web, _:homepage .
    _:homepage a vcard:Home; vcard:value <https://alice.example/home>; vcard:pref "2" .
    _:web a vcard:WebId; vcard:value <https://alice.example/profile#me>;
      <https://example.org/verified> true .`,
    ALICE,
  );
  const contact = new Contact(`${ALICE}#this`, dataset, DataFactory);
  const original = [...dataset];
  applyContact(contact, { ...contactData(contact), name: "Alicia" });
  expect(contact.name).toBe("Alicia");
  expect(dataset.size).toBe(original.length);
  for (const quad of original) {
    if (quad.predicate.value !== "http://www.w3.org/2006/vcard/ns#fn") {
      expect(dataset.has(quad)).toBe(true);
    }
  }
});

test.each([
  "https://alice.example/#me",
  undefined,
])("preserves unrelated URL RDF when the selected WebID is unchanged (%s)", async (webId) => {
  const dataset = await parse(
    `${VCARD_PREFIX}
      <#this> a vcard:Individual; vcard:fn "Alice";
        ${webId ? `vcard:url <${webId}>;` : ""}
        vcard:url _:home, <ftp://example.org/>, "legacy", _:empty .
      _:home a vcard:Home; vcard:value <${webId ? "https://alice.example/home" : "ftp://example.org/home"}>;
        vcard:pref "2" .
      _:empty vcard:note "Keep this URL metadata" .`,
    ALICE,
  );
  const contact = new Contact(`${ALICE}#this`, dataset, DataFactory);
  expect(contact.webId).toBe(webId);
  const original = [...dataset];
  applyContact(contact, { ...contactData(contact), name: "Alicia" });
  expect(dataset.size).toBe(original.length);
  for (const quad of original) {
    if (quad.predicate.value !== "http://www.w3.org/2006/vcard/ns#fn") {
      expect(dataset.has(quad)).toBe(true);
    }
  }
});

test.each([
  "https://new.example/#me",
  undefined,
  "https://alice.example/home",
])("edits only the selected WebID value while retaining other URLs (%s)", async (webId) => {
  const dataset = await parse(
    `${VCARD_PREFIX}
      <#this> a vcard:Individual; vcard:fn "Alice";
        vcard:url _:web, <https://alice.example/#me>, _:home, <https://alice.example/direct>, "legacy" .
      _:web a vcard:WebId; vcard:value <https://alice.example/#me>; vcard:pref "1" .
      _:home a vcard:Home; vcard:value <https://alice.example/home>; vcard:pref "2" .`,
    ALICE,
  );
  const contact = new Contact(`${ALICE}#this`, dataset, DataFactory);
  expect(contact.webId).toBe("https://alice.example/#me");
  const { namedNode } = DataFactory;
  const url = namedNode("http://www.w3.org/2006/vcard/ns#url");
  const edges = [...dataset.match(namedNode(contact.id), url)];
  const web = edges[0]?.object;
  expect(web).toBeDefined();
  const retained = [...dataset].filter(
    (quad) => !quad.subject.equals(web) && !edges[0]?.equals(quad),
  );
  applyContact(contact, webId === undefined ? { name: "Alice" } : { name: "Alice", webId });
  for (const quad of retained) expect(dataset.has(quad)).toBe(true);
  expect(dataset.match(web).size).toBe(0);
  expect(contactData(contact).webId).toBe(webId);
  if (webId) {
    expect([...dataset].some((quad) => quad.object.value === webId)).toBe(true);
  }
});

test.each([
  ["<https://alice.example/#me>", "https://alice.example/#me"],
  ["<ftp://example.org/>", undefined],
  ["<https://alice.example>", undefined],
  [undefined, undefined],
])("reads explicit WebID nodes independently of URL ordering (%s)", async (value, expected) => {
  const dataset = await parse(
    `${VCARD_PREFIX}
    <#this> a vcard:Individual; vcard:fn "Alice";
      vcard:url _:home, <https://alice.example/direct>, _:web .
    _:home a vcard:Home; vcard:value <https://alice.example/home> .
    _:web a vcard:WebId ${value ? `; vcard:value ${value}` : ""} .`,
    ALICE,
  );
  expect(contactData(new Contact(`${ALICE}#this`, dataset, DataFactory))).toEqual({
    name: "Alice",
    ...(expected === undefined ? {} : { webId: expected }),
  });
});

test("adding a first WebID preserves URL nodes outside the readable scalar field", async () => {
  const dataset = await parse(
    `${VCARD_PREFIX}
    <#this> a vcard:Individual; vcard:fn "Alice"; vcard:url _:empty, <ftp://example.org/> .
    _:empty vcard:note "Keep this URL metadata" .`,
    ALICE,
  );
  const contact = new Contact(`${ALICE}#this`, dataset, DataFactory);
  expect(contact.webId).toBeUndefined();
  const original = [...dataset];
  applyContact(contact, { name: "Alice", webId: "https://alice.example/#me" });
  expect(contact.webId).toBe("https://alice.example/#me");
  for (const quad of original) expect(dataset.has(quad)).toBe(true);
});

test("reconciles added and removed values without rebuilding retained or shared nodes", async () => {
  const dataset = await parse(
    `${VCARD_PREFIX}
    <#this> a vcard:Individual; vcard:fn "Alice";
      vcard:hasEmail <mailto:direct@example.org>, _:work, _:old, _:shared, "invalid", _:empty;
      vcard:hasTelephone [ a vcard:Work; vcard:value <tel:+44-123> ];
      vcard:url [ a vcard:WebId; vcard:value <https://alice.example/#me> ] .
    _:work a vcard:Work; vcard:value <mailto:work@example.org>; vcard:pref "1" .
    _:old a vcard:Home; vcard:value <mailto:old@example.org> .
    _:shared a vcard:Work; vcard:value <mailto:shared@example.org> .
    _:empty a vcard:Home .
    <#other> vcard:hasEmail _:shared .`,
    ALICE,
  );
  const contact = new Contact(`${ALICE}#this`, dataset, DataFactory);
  const original = [...dataset];
  const { namedNode } = DataFactory;
  const email = namedNode("http://www.w3.org/2006/vcard/ns#hasEmail");
  const subject = namedNode(contact.id);
  const removed = [...dataset.match(subject, email)].find((edge) =>
    [...dataset.match(edge.object)].some((quad) => quad.object.value === "mailto:old@example.org"),
  )?.object;
  expect(removed).toBeDefined();
  applyContact(contact, {
    name: "Alicia",
    emails: ["direct@example.org", "work@example.org", "new@example.org"],
    phones: ["+44 (123)", "+44567"],
    webId: "https://new.example/#me",
  });
  expect(contact.emails).toEqual([
    "mailto:direct@example.org",
    "mailto:work@example.org",
    "mailto:new@example.org",
  ]);
  expect(contact.phones).toEqual(["tel:+44-123", "tel:+44567"]);
  expect(contact.webId).toBe("https://new.example/#me");
  expect(dataset.match(removed).size).toBe(0);
  // All surviving old nodes, including the other contact's shared node, keep their RDF.
  for (const quad of original) {
    if (
      quad.object.value === "mailto:direct@example.org" ||
      quad.object.value === "mailto:work@example.org" ||
      quad.object.value === "mailto:shared@example.org" ||
      quad.object.value === "tel:+44-123" ||
      quad.predicate.value === "http://www.w3.org/2006/vcard/ns#pref"
    ) {
      expect(dataset.has(quad)).toBe(true);
    }
  }
  applyContact(contact, { name: "Cleared" });
  expect(contactData(contact)).toEqual({ name: "Cleared" });
  expect(dataset.match(subject, email).size).toBe(0);
  expect(dataset.match(null, email).size).toBe(1);
});
