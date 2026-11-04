// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import type { ContactAddress } from "../src/apps/contacts/lib/model";
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
import { applyContact, VCARD } from "../src/apps/contacts/lib/model/data";
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
  expect(web?.termType).toBe("BlankNode");
  if (web?.termType !== "BlankNode") throw new Error("Missing structured WebID node");
  const retained = [...dataset].filter(
    (quad) => !quad.subject.equals(web) && !edges[0]?.equals(quad),
  );
  applyContact(contact, webId === undefined ? { name: "Alice" } : { name: "Alice", webId });
  for (const quad of retained) expect(dataset.has(quad)).toBe(true);
  expect(dataset.match(DataFactory.blankNode(web.value)).size).toBe(0);
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
  const removed = [...dataset.match(subject, email)].find(
    (edge) =>
      edge.object.termType === "BlankNode" &&
      [...dataset.match(DataFactory.blankNode(edge.object.value))].some(
        (quad) => quad.object.value === "mailto:old@example.org",
      ),
  )?.object;
  expect(removed?.termType).toBe("BlankNode");
  if (removed?.termType !== "BlankNode") throw new Error("Missing removed email node");
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
  expect(dataset.match(DataFactory.blankNode(removed.value)).size).toBe(0);
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

// Independent N3 instances may mint the same automatic blank-node label.
test("keeps newly minted contact nodes separate from parsed blank nodes", async () => {
  const dataset = await parse(
    `${VCARD_PREFIX}
    <#this> a vcard:Individual; vcard:fn "Alice";
      vcard:hasTelephone [ a vcard:Work; vcard:value <tel:+44123>; vcard:pref "1" ] .`,
    ALICE,
  );
  const contact = new Contact(`${ALICE}#this`, dataset, DataFactory);
  const original = [...dataset];
  const retained = [
    ...dataset.match(
      DataFactory.namedNode(contact.id),
      DataFactory.namedNode("http://www.w3.org/2006/vcard/ns#hasTelephone"),
    ),
  ][0]?.object;
  expect(retained?.termType).toBe("BlankNode");
  if (retained?.termType !== "BlankNode") throw new Error("Missing retained phone node");
  const blankNode = DataFactory.blankNode;
  const mint = vi
    .spyOn(DataFactory, "blankNode")
    .mockImplementation((label) => blankNode(label ?? retained.value));
  try {
    const data = {
      name: "Alice",
      emails: ["mailto:alice@example.org"],
      phones: ["tel:+44123", "tel:+44567"],
      webId: "https://alice.example/#me",
    };
    applyContact(contact, data);
    expect(contactData(contact)).toEqual(data);
    for (const quad of original) expect(dataset.has(quad)).toBe(true);
    applyContact(contact, { name: "Alice" });
    expect(contactData(contact)).toEqual({ name: "Alice" });
  } finally {
    mint.mockRestore();
  }
});

// AUTHORED-BY Claude Opus 5.5
describe("postal addresses through the app mapping", () => {
  const Shape = `${VCARD_PREFIX}
      <#this> a vcard:Individual; vcard:fn "Alice"; vcard:hasAddress _:home .
      _:home a vcard:Home; vcard:street-address "1 Way"; vcard:locality "Paris";
        <https://example.org/geo> "48.8,2.3" .`;

  test("contactData reads addresses and an unchanged save keeps the original node", async () => {
    const dataset = await parse(Shape, ALICE);
    const contact = new Contact(`${ALICE}#this`, dataset, DataFactory);
    const data = contactData(contact);
    expect(data.addresses).toEqual([{ kind: "home", street: "1 Way", locality: "Paris" }]);
    const original = [...dataset];
    // Padding that the shared reader would trim away is not a change either.
    applyContact(contact, {
      ...data,
      name: "Alicia",
      addresses: [{ kind: "home", street: " 1 Way ", locality: "Paris" }],
    });
    for (const quad of original)
      if (quad.predicate.value !== `${VCARD}fn`) expect(dataset.has(quad)).toBe(true);
  });

  test("an edited address replaces the node; clearing removes it", async () => {
    const dataset = await parse(Shape, ALICE);
    const contact = new Contact(`${ALICE}#this`, dataset, DataFactory);
    applyContact(contact, {
      name: "Alice",
      addresses: [{ kind: "work", locality: "Lyon" }, { postalCode: "12345" }],
    });
    expect(contact.addresses).toEqual(
      expect.arrayContaining([{ kind: "work", locality: "Lyon" }, { postalCode: "12345" }]),
    );
    expect(dataset.match(null, DataFactory.namedNode("https://example.org/geo")).size).toBe(0);
    applyContact(contact, { name: "Alice" });
    expect(contact.addresses).toEqual([]);
    expect(contactData(contact).addresses).toBeUndefined();
    expect(dataset.match(null, DataFactory.namedNode(`${VCARD}locality`)).size).toBe(0);
  });

  test("changing one address keeps the other's node; limits apply only to a changed list", async () => {
    const dataset = await parse(
      `${Shape}
      <#this> vcard:hasAddress [ a vcard:Work; vcard:locality "Lyon" ], _:hidden .
      _:hidden <https://example.org/note> "unreadable" .`,
      ALICE,
    );
    const contact = new Contact(`${ALICE}#this`, dataset, DataFactory);
    const data = contactData(contact);
    applyContact(contact, {
      ...data,
      addresses: [
        { kind: "home", street: "1 Way", locality: "Paris" },
        { kind: "work", locality: "Lille" },
      ],
    });
    expect(contact.addresses).toEqual([
      { kind: "home", street: "1 Way", locality: "Paris" },
      { kind: "work", locality: "Lille" },
    ]);
    expect(dataset.match(null, DataFactory.namedNode("https://example.org/geo")).size).toBe(1);
    expect(dataset.match(null, DataFactory.namedNode("https://example.org/note")).size).toBe(1);
    expect(dataset.match(null, null, DataFactory.literal("Lyon")).size).toBe(0);

    // Seventeen addresses written elsewhere stay editable while the list is unchanged.
    const many = Array.from({ length: 17 }, (_, i) => ({ postalCode: String(i) }));
    const crowded = new Contact(
      `${ALICE}#this`,
      buildPerson(ALICE, { name: "A", addresses: many }),
      DataFactory,
    );
    expect(() => applyContact(crowded, { ...contactData(crowded), note: "ok" })).not.toThrow();
    expect(() =>
      applyContact(crowded, { ...contactData(crowded), addresses: [...many, { locality: "x" }] }),
    ).toThrow("Too many addresses.");
    // Removing one of seventeen adds nothing, so it is allowed.
    applyContact(crowded, { ...contactData(crowded), addresses: many.slice(1) });
    expect(crowded.addresses).toHaveLength(16);
    // An over-long address already stored does not block adding a valid one beside it.
    const long = new Contact(
      `${ALICE}#this`,
      buildPerson(ALICE, { name: "A", addresses: [{ locality: "x".repeat(300) }] }),
      DataFactory,
    );
    applyContact(long, {
      ...contactData(long),
      addresses: [...(contactData(long).addresses ?? []), { locality: "Lyon" }],
    });
    expect(long.addresses).toHaveLength(2);
    const write = (addresses: ContactAddress[]) => () =>
      applyContact(new Contact(`${ALICE}#this`, new Store(), DataFactory), {
        name: "A",
        addresses,
      });
    expect(write([{ kind: "other" as "home", locality: "x" }])).toThrow("Invalid address type.");
    expect(write([{ locality: "x".repeat(257) }])).toThrow("Invalid address.");
    expect(write([{ locality: 1 as unknown as string }])).toThrow("Invalid address.");
    expect(write([{ kind: "work", street: "y".repeat(2048) }])).not.toThrow();
  });
});
