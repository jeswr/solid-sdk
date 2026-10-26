// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { describe, expect, test } from "vitest";
import {
  Contact,
  ContactsModel,
  ContactsWriteError,
  PartialWriteError,
} from "../src/apps/contacts/lib/model";
import {
  ALICE,
  BOOK,
  FRIENDS,
  fixture,
  GROUPS,
  MemoryPod,
  PEOPLE,
  PM,
  ROOT,
  setup,
  VCARD_PREFIX,
} from "./contacts-support";

const newPerson = `${ROOT}contacts/people/new.ttl`;
const newGroup = `${ROOT}contacts/groups/new.ttl`;

describe("address book CRUD with protocol preconditions", () => {
  test("creates the canonical book and empty indexes without overwriting existing resources", async () => {
    const pod = new MemoryPod();
    const model = new ContactsModel(pod.fetch, ROOT);
    await model.createAddressBook({ title: "New book", owner: `${ROOT}profile/card#me` });
    const book = await model.loadAddressBook();
    expect(book.data.title).toBe("New book");
    expect((await model.loadPeople(book)).data).toEqual([]);
    expect((await model.loadGroups(book)).data).toEqual([]);
    expect(pod.writes).toHaveLength(3);
    expect(pod.writes.every((write) => write.headers.get("If-None-Match") === "*")).toBe(true);
    await expect(model.createAddressBook({ title: "Duplicate" })).rejects.toMatchObject({
      status: 412,
    });
    expect((await model.loadAddressBook()).data.title).toBe("New book");
  });

  test("rejects invalid books and aliases before any network writes", async () => {
    const pod = new MemoryPod();
    const model = new ContactsModel(pod.fetch, ROOT);
    await expect(model.createAddressBook({ title: " " })).rejects.toThrow(TypeError);
    await expect(
      model.createAddressBook({ title: "Invalid", nameEmailIndex: BOOK }),
    ).rejects.toThrow("distinct");
    await expect(
      model.createAddressBook({ title: "External", groupIndex: "https://evil.example/groups" }),
    ).rejects.toThrow();
    expect(pod.writes).toHaveLength(0);
  });

  test("loads fallback indexes and rejects documents of the wrong model type", async () => {
    const { model, pod, book } = await setup();
    const fallback = { ...book, data: { title: "No links" } };
    expect((await model.loadPeople(fallback)).data).toHaveLength(2);
    expect((await model.loadGroups(fallback)).data).toHaveLength(1);
    pod.seed(BOOK, "");
    pod.seed(newPerson, "");
    pod.seed(newGroup, "");
    await expect(model.loadAddressBook()).rejects.toThrow("expected contacts type");
    await expect(model.loadContact(newPerson)).rejects.toThrow("expected contacts type");
    await expect(model.loadGroup(newGroup)).rejects.toThrow("expected contacts type");
  });

  test("creates a contact and updates only its people-index entry", async () => {
    const { model, pod, book } = await setup();
    const id = await model.createContact(
      book,
      { name: "Cara", emails: ["cara@example.org"], phones: ["+44 (123) 45-6"] },
      newPerson,
    );
    expect(id).toBe(`${newPerson}#this`);
    expect((await model.loadContact(id)).data).toMatchObject({
      name: "Cara",
      inAddressBook: `${BOOK}#this`,
      emails: ["mailto:cara@example.org"],
      phones: ["tel:+44123456"],
    });
    expect((await model.loadPeople(book)).data.map((entry) => entry.name)).toEqual([
      "Alice",
      "Bob",
      "Cara",
    ]);
    expect(pod.writes.map((write) => write.url)).toEqual([newPerson, PEOPLE]);
    expect(pod.writes[1]?.headers.get("If-Match")).toBe('"1"');
    await expect(
      model.createContact(book, { name: "Collision" }, newPerson),
    ).rejects.toBeInstanceOf(ContactsWriteError);
    expect((await model.loadContact(id)).data.name).toBe("Cara");
    const minted = await model.createContact(book, { name: "Minted" });
    expect(minted).toMatch(/\/people\/[\da-f-]+\.ttl#this$/);
  });

  test("updates and clears fields while retaining UID, created, and unknown RDF", async () => {
    const { model, pod, book } = await setup();
    const person = await model.loadContact(ALICE);
    const before = new Contact(`${ALICE}#this`, person.dataset, DataFactory);
    await model.updateContact(book, person, {
      name: "Alicia",
      organization: "Updated",
      note: "New note",
      emails: ["new@example.org"],
      phones: ["123"],
      webId: "https://new.example/#me",
    });
    const updated = await model.loadContact(ALICE);
    expect(updated.data).toMatchObject({
      name: "Alicia",
      organization: "Updated",
      note: "New note",
    });
    expect(new Contact(`${ALICE}#this`, updated.dataset, DataFactory).uid).toBe(before.uid);
    expect(updated.data.created).toEqual(person.data.created);
    expect(pod.files.get(ALICE)?.body).toContain("Preserve me");
    expect((await model.loadPeople(book)).data[0]?.name).toBe("Alicia");
    await model.updateContact(book, updated, { name: "Only name" });
    expect((await model.loadContact(ALICE)).data).toEqual({
      name: "Only name",
      created: person.data.created,
      inAddressBook: `${BOOK}#this`,
    });
  });

  test("renames a loaded contact without deleting its additional URLs or structured metadata", async () => {
    const { model, pod, book } = await setup();
    pod.seed(
      ALICE,
      `${fixture("alice")}
      <#this> vcard:url <https://alice.example/direct>, _:homepage .
      _:homepage a vcard:Home; vcard:value <https://alice.example/home>; vcard:pref "2" .`,
    );
    const person = await model.loadContact(ALICE);
    expect(person.data.webId).toBe("https://alice.example/profile#me");
    await model.updateContact(book, person, { ...person.data, name: "Alicia" });
    const updated = await model.loadContact(ALICE);
    expect(updated.data).toEqual({ ...person.data, name: "Alicia" });
    const { namedNode } = DataFactory;
    const vcard = "http://www.w3.org/2006/vcard/ns#";
    const urls = [...updated.dataset.match(namedNode(`${ALICE}#this`), namedNode(`${vcard}url`))];
    expect(urls).toHaveLength(3);
    expect(urls.some((edge) => edge.object.value === "https://alice.example/direct")).toBe(true);
    const homepage = [...updated.dataset.match(null, namedNode(`${vcard}value`))].find(
      (quad) => quad.object.value === "https://alice.example/home",
    );
    expect(homepage).toBeDefined();
    expect(urls.some((edge) => edge.object.equals(homepage?.subject))).toBe(true);
    expect([...updated.dataset.match(homepage?.subject)].map((quad) => quad.object.value)).toEqual([
      `${vcard}Home`,
      "https://alice.example/home",
      "2",
    ]);
  });

  test("creates, renames and changes membership of groups without disturbing other index entries", async () => {
    const { model, book } = await setup();
    const id = await model.createGroup(
      book,
      { name: "Work", members: [`${ALICE}#this`, `${ALICE}#this`] },
      newGroup,
    );
    let group = await model.loadGroup(id);
    expect(group.data.members).toEqual([`${ALICE}#this`]);
    await model.updateGroup(book, group, { name: "Colleagues", members: [`${newPerson}#this`] });
    group = await model.loadGroup(id);
    expect(group.data).toMatchObject({ name: "Colleagues", members: [`${newPerson}#this`] });
    expect((await model.loadGroups(book)).data.map((entry) => entry.name)).toEqual([
      "Friends",
      "Colleagues",
    ]);
    await model.setGroupMembers(group, []);
    expect((await model.loadGroup(id)).data.members).toBeUndefined();
    const emptyId = await model.createGroup(book, { name: "Empty" });
    expect(emptyId).toMatch(/\/groups\/[\da-f-]+\.ttl#this$/);
    const empty = await model.loadGroup(emptyId);
    await model.updateGroup(book, empty, { name: "Still empty" });
    expect((await model.loadGroup(emptyId)).data.name).toBe("Still empty");
  });

  test("rejects invalid fields and membership without writes", async () => {
    const { model, pod, book } = await setup();
    const group = await model.loadGroup(FRIENDS);
    await expect(model.createContact(book, { name: "" })).rejects.toThrow();
    await expect(
      model.updateContact(book, await model.loadContact(ALICE), { name: "" }),
    ).rejects.toThrow();
    await expect(model.createGroup(book, { name: "" })).rejects.toThrow();
    await expect(
      model.createGroup(book, { name: "Invalid", members: ["javascript:evil"] }),
    ).rejects.toThrow();
    await expect(model.updateGroup(book, group, { name: "" })).rejects.toThrow();
    await expect(model.setGroupMembers(group, ["urn:evil"])).rejects.toThrow();
    expect(pod.writes).toHaveLength(0);
  });

  test("deletes a contact from groups and the index before deleting its resource", async () => {
    const { model, pod, book } = await setup();
    await model.createGroup(book, { name: "Empty" }, newGroup);
    pod.requests.length = 0;
    await model.deleteContact(book, await model.loadContact(ALICE));
    expect(pod.writes.map((write) => write.url)).toEqual([FRIENDS, PEOPLE, ALICE]);
    expect(pod.writes.at(-1)?.method).toBe("DELETE");
    expect((await model.loadGroup(FRIENDS)).data.members).toBeUndefined();
    expect((await model.loadPeople(book)).data.map((entry) => entry.name)).toEqual(["Bob"]);
    expect(pod.files.has(ALICE)).toBe(false);
  });

  test("deletes a group and its index entry, retaining contacts", async () => {
    const { model, pod, book } = await setup();
    await model.deleteGroup(book, await model.loadGroup(FRIENDS));
    expect((await model.loadGroups(book)).data).toEqual([]);
    expect(pod.files.has(FRIENDS)).toBe(false);
    expect(pod.files.has(ALICE)).toBe(true);
    expect(pod.writes.map((write) => write.url)).toEqual([GROUPS, FRIENDS]);
  });

  test("propagates stale ETags without blindly retrying or overwriting concurrent edits", async () => {
    const { model, pod, book } = await setup();
    const person = await model.loadContact(ALICE);
    pod.seed(ALICE, fixture("alice"), '"concurrent"');
    await expect(model.updateContact(book, person, { name: "Stale" })).rejects.toMatchObject({
      status: 412,
      etag: '"concurrent"',
    });
    expect(pod.writes).toHaveLength(1);
    expect((await model.loadPeople(book)).data[0]?.name).toBe("Alice");
  });

  test("reports partial index failures and never deletes a source after a failed copy/index step", async () => {
    const { model, pod, book } = await setup();
    pod.fail = (url, method) =>
      url === PEOPLE && method === "PUT" ? new Response(null, { status: 412 }) : undefined;
    await expect(model.migrateToBook(book, PM, newPerson)).rejects.toMatchObject({
      name: "PartialWriteError",
      completed: [newPerson],
      cause: { status: 412 },
    });
    expect(pod.files.has(PM)).toBe(true);
    expect(pod.files.has(newPerson)).toBe(true);
    expect(pod.writes.some((write) => write.method === "DELETE")).toBe(false);
  });

  test("explicitly migrates every PM field and removes the old document last", async () => {
    const { model, pod, book } = await setup();
    const original = (await model.loadFlatContacts(PM)).data[0]?.data;
    const id = await model.migrateToBook(book, PM);
    expect((await model.loadContact(id)).data).toMatchObject(original ?? {});
    expect(pod.files.has(PM)).toBe(false);
    expect((await model.loadPeople(book)).data.at(-1)).toEqual({ id, name: "Pat Morgan" });
    expect(pod.writes.at(-1)?.url).toBe(PM);
    expect(pod.writes.at(-1)?.headers.get("If-Match")).toBe('"1"');
  });

  test("refuses non-flat or ambiguous migration sources and in-place migration", async () => {
    const { model, pod, book } = await setup();
    await expect(model.migrateToBook(book, ALICE)).rejects.toThrow("one flat contact");
    pod.seed(
      PM,
      `${fixture("pm")}\n<other> a vcard:Individual; vcard:fn "Other"; vcard:inAddressBook <book.ttl#this> .`,
    );
    await expect(model.migrateToBook(book, PM)).rejects.toThrow("one flat contact");
    pod.seed(PM, fixture("pm"));
    await expect(model.migrateToBook(book, PM, `${PM}#it`)).rejects.toThrow("distinct destination");
    pod.seed(PM, fixture("pm"), null);
    await expect(model.migrateToBook(book, PM)).rejects.toThrow("strong ETag");
    expect(pod.writes).toHaveLength(0);
  });

  test("reports failure deleting a source after preserving its indexed replacement", async () => {
    const { model, pod, book } = await setup();
    pod.fail = (url, method) =>
      url === PM && method === "DELETE" ? new Response(null, { status: 403 }) : undefined;
    await expect(model.migrateToBook(book, PM, newPerson)).rejects.toBeInstanceOf(
      PartialWriteError,
    );
    expect(pod.files.has(PM)).toBe(true);
    expect((await model.loadContact(newPerson)).data.name).toBe("Pat Morgan");
    expect((await model.loadPeople(book)).data.at(-1)?.name).toBe("Pat Morgan");
  });

  test("never mutates when any ETag is absent, weak, or a wildcard", async () => {
    const { model, pod, book } = await setup();
    for (const etag of [null, 'W/"weak"', "*"]) {
      pod.seed(ALICE, fixture("alice"), etag);
      await expect(model.deleteContact(book, await model.loadContact(ALICE))).rejects.toThrow(
        "strong ETag",
      );
    }
    expect(pod.writes).toHaveLength(0);
    pod.seed(PEOPLE, fixture("people"), null);
    await expect(model.createContact(book, { name: "No index tag" })).rejects.toThrow(
      "strong ETag",
    );
    expect(pod.writes).toHaveLength(0);
  });

  test("removes contact index entries even when there are no groups", async () => {
    const { model, pod, book } = await setup();
    pod.seed(GROUPS, VCARD_PREFIX);
    await model.deleteContact(book, await model.loadContact(ALICE));
    expect(pod.files.has(ALICE)).toBe(false);
  });
});

test.each([
  '<#it> vcard:hasUID "urn:uuid:original" .',
  "<#it> vcard:hasPhoto <https://example.org/photo.jpg> .",
  '<#other> <https://example.org/note> "Unrelated RDF" .',
  '<#it> vcard:fn "Another name" .',
  '<#it> vcard:note "Original note"@en .',
  "<#it> vcard:hasEmail [ vcard:value <mailto:extra@example.org> ] .",
  "<#it> vcard:url <https://noncanonical.example> .",
])("refuses lossy migration before any writes: %s", async (extra) => {
  const { model, pod, book } = await setup();
  const body = `${fixture("pm")} ${extra}`;
  pod.seed(PM, body);
  await expect(model.migrateToBook(book, PM, newPerson)).rejects.toThrow("discard source RDF");
  expect(pod.writes).toHaveLength(0);
  expect(pod.files.get(PM)?.body).toBe(body);
  expect(pod.files.has(newPerson)).toBe(false);
});

test.each([
  "https://alice.example",
  "https://ALICE.example/#me",
  "https://alice.example:443/#me",
  "https://alice.example/a/../b#me",
])("rejects identifiers unsupported by the shared setters before writes: %s", async (identifier) => {
  const { model, pod, book } = await setup();
  await expect(model.createContact(book, { name: "Alice", webId: identifier })).rejects.toThrow(
    "canonical",
  );
  const person = await model.loadContact(ALICE);
  await expect(
    model.updateContact(book, person, { name: "Alice", webId: identifier }),
  ).rejects.toThrow("canonical");
  await expect(model.createGroup(book, { name: "Group", members: [identifier] })).rejects.toThrow(
    "canonical",
  );
  const group = await model.loadGroup(FRIENDS);
  await expect(
    model.updateGroup(book, group, { name: "Group", members: [identifier] }),
  ).rejects.toThrow("canonical");
  await expect(model.setGroupMembers(group, [identifier])).rejects.toThrow("canonical");
  expect(pod.writes).toHaveLength(0);
});

test("accepted canonical WebIDs and group identifiers survive create and update", async () => {
  const { model, book } = await setup();
  const webId = "https://alice.example/";
  const id = await model.createContact(book, { name: "Alice", webId }, newPerson);
  expect((await model.loadContact(id)).data.webId).toBe(webId);
  await model.updateContact(book, await model.loadContact(id), {
    name: "Alice",
    webId: `${webId}#me`,
  });
  expect((await model.loadContact(id)).data.webId).toBe(`${webId}#me`);
  const groupId = await model.createGroup(book, { name: "Group", members: [webId] }, newGroup);
  expect((await model.loadGroup(groupId)).data.members).toEqual([webId]);
  await model.updateGroup(book, await model.loadGroup(groupId), {
    name: "Group",
    members: [`${webId}#me`],
  });
  expect((await model.loadGroup(groupId)).data.members).toEqual([`${webId}#me`]);
  await model.setGroupMembers(await model.loadGroup(groupId), [webId]);
  expect((await model.loadGroup(groupId)).data.members).toEqual([webId]);
});

test("migrates a minimal flat contact and a canonical creation time without discarding fields", async () => {
  const { model, pod, book } = await setup();
  pod.seed(
    PM,
    `${VCARD_PREFIX} <#it> a vcard:Individual; vcard:fn "Minimal"; <http://purl.org/dc/terms/created> "2026-01-01T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
  );
  const id = await model.migrateToBook(book, PM, newPerson);
  expect((await model.loadContact(id)).data).toMatchObject({
    name: "Minimal",
    created: new Date("2026-01-01T00:00:00Z"),
  });
});
