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
