// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, test } from "vitest";
import {
  BOOK_CLASS,
  CONTACT_CLASS,
  discoverContacts,
  GROUP_CLASS,
  importVcards,
  parseVcards,
  registerAddressBook,
  TypeIndexDataset,
  TypeRegistration,
} from "../src/apps/contacts/lib/model";
import { ALICE, BOOK, fixture, INDEX, PM, ROOT, setup } from "./contacts-support";

const prefixes =
  "@prefix solid: <http://www.w3.org/ns/solid/terms#> . @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .";
const vcf = `BEGIN:VCARD\nVERSION:3.0\nFN:Vera Card\nEMAIL:vera@example.org\nTEL:+44123\nORG:Example;Team\nNOTE:Note\nEND:VCARD`;

describe("Type Index and vCard model adapters", () => {
  test("registers books, people and groups while preserving unrelated registrations and metadata", async () => {
    const { model, pod } = await setup();
    pod.seed(
      INDEX,
      `${prefixes} <#other> a solid:TypeRegistration; solid:forClass <https://schema.org/Event>; solid:instance <../calendar/event.ttl> . <> a solid:TypeIndex, solid:UnlistedDocument .`,
    );
    await registerAddressBook(model, INDEX);
    const result = await model.transport.read(
      INDEX,
      (dataset) => new TypeIndexDataset(dataset, DataFactory),
    );
    const registrations = [...result.data.registrations];
    expect(registrations).toHaveLength(4);
    expect(
      registrations.find((registration) => registration.classes.has(BOOK_CLASS))?.instance,
    ).toBe(`${BOOK}#this`);
    expect(
      registrations.find((registration) => registration.classes.has(CONTACT_CLASS))?.container,
    ).toBe(`${ROOT}contacts/people/`);
    expect(
      registrations.find((registration) => registration.classes.has(GROUP_CLASS))?.container,
    ).toBe(`${ROOT}contacts/groups/`);
    const entry = new TypeRegistration(`${INDEX}#other`, result.dataset, DataFactory);
    expect(entry.instance).toBe(`${ROOT}calendar/event.ttl`);
    expect(pod.files.get(INDEX)?.body).toContain("UnlistedDocument");
    expect(pod.writes[0]?.headers.get("If-Match")).toBe('"1"');
    await registerAddressBook(model, INDEX);
    expect(pod.writes).toHaveLength(1);
  });

  test("does not bootstrap or overwrite an absent or unreadable caller-selected index", async () => {
    const { model, pod } = await setup();
    await expect(registerAddressBook(model, INDEX)).rejects.toBeInstanceOf(RdfFetchError);
    pod.fail = () => new Response(null, { status: 403 });
    await expect(registerAddressBook(model, INDEX)).rejects.toMatchObject({ status: 403 });
    expect(pod.writes).toHaveLength(0);
  });

  test("discovers books and flat PM contacts from instances and containers, deduplicating requests", async () => {
    const { model, pod } = await setup();
    const container = `${ROOT}contacts/`;
    pod.seed(
      INDEX,
      `${prefixes}
      <#book> a solid:TypeRegistration; solid:forClass vcard:AddressBook; solid:instance <${BOOK}#this> .
      <#pm> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instance <${PM}#it> .
      <#container> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instanceContainer <${container}> .
      <#duplicate> a solid:TypeRegistration; solid:forClass vcard:AddressBook; solid:instance <${BOOK}> .
      <#other> a solid:TypeRegistration; solid:forClass <https://schema.org/Event>; solid:instance <https://evil.example/no> .
      <#empty> a solid:TypeRegistration; solid:forClass vcard:Individual .`,
    );
    pod.seed(
      container,
      `@prefix ldp: <http://www.w3.org/ns/ldp#> . <> a ldp:BasicContainer; ldp:contains <${PM}>, <${ALICE}>, <${ROOT}contacts/sub/>, <${ROOT}contacts/missing.ttl> .`,
    );
    const result = await discoverContacts(model, INDEX);
    expect(result.books).toEqual([`${BOOK}#this`]);
    expect(result.flat).toHaveLength(1);
    expect(result.flat[0]?.data.name).toBe("Pat Morgan");
    expect(result.incomplete).toBe(false);
    expect(pod.requests.filter((request) => request.url === PM)).toHaveLength(1);
    expect(pod.requests.some((request) => request.url.includes("/sub/"))).toBe(false);
  });

  test("caps discovery reads and reports incomplete results", async () => {
    const { model, pod } = await setup();
    pod.seed(
      INDEX,
      `${prefixes} <#a> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instance <${PM}> . <#b> a solid:TypeRegistration; solid:forClass vcard:AddressBook; solid:instance <${BOOK}> .`,
    );
    const result = await discoverContacts(model, INDEX, 1);
    expect(result.incomplete).toBe(true);
    expect(result.flat).toHaveLength(1);
    expect(result.books).toEqual([]);
    for (const limit of [0, -1, 1.5, Number.NaN])
      await expect(discoverContacts(model, INDEX, limit)).rejects.toThrow(TypeError);
  });

  test("tolerates missing container registrations but propagates forbidden or network reads", async () => {
    const { model, pod } = await setup();
    pod.seed(
      INDEX,
      `${prefixes} <#a> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instanceContainer <${ROOT}missing/> .`,
    );
    expect((await discoverContacts(model, INDEX)).flat).toEqual([]);
    pod.fail = (url) =>
      url === `${ROOT}missing/` ? new Response(null, { status: 403 }) : undefined;
    await expect(discoverContacts(model, INDEX)).rejects.toMatchObject({ status: 403 });
    pod.fail = (url) => {
      if (url === `${ROOT}missing/`) throw new Error("offline");
      return undefined;
    };
    await expect(discoverContacts(model, INDEX)).rejects.toThrow();
  });

  test("rejects foreign registrations, container children and index links before credentialed requests", async () => {
    const { model, pod, book } = await setup();
    const foreign = "https://evil.example/steal";
    pod.seed(
      INDEX,
      `${prefixes} <#a> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instance <${foreign}> .`,
    );
    await expect(discoverContacts(model, INDEX)).rejects.toThrow("escapes pod origin");
    await expect(
      model.loadPeople({ ...book, data: { title: "Poisoned", nameEmailIndex: foreign } }),
    ).rejects.toThrow();
    pod.seed(
      INDEX,
      `${prefixes} <#a> a solid:TypeRegistration; solid:forClass vcard:Individual; solid:instanceContainer <${ROOT}contacts/> .`,
    );
    pod.seed(
      `${ROOT}contacts/`,
      `@prefix ldp: <http://www.w3.org/ns/ldp#> . <> a ldp:BasicContainer; ldp:contains <${foreign}> .`,
    );
    await expect(discoverContacts(model, INDEX)).rejects.toThrow();
    expect(pod.requests.every((request) => request.url.startsWith(ROOT))).toBe(true);
  });

  test("previews and imports vCard through the existing bridge mapping, including multiple cards", async () => {
    const { model, book } = await setup();
    const parsed = parseVcards(vcf);
    expect(parsed).toEqual([
      {
        name: "Vera Card",
        emails: ["mailto:vera@example.org"],
        phones: ["tel:+44123"],
        note: "Note\nOrganization: Example — Team",
      },
    ]);
    const ids = await importVcards(
      model,
      book,
      `${vcf}\n${vcf.replaceAll("Vera Card", "Second Card")}`,
    );
    expect(ids).toHaveLength(2);
    expect((await model.loadContact(ids[0] ?? "")).data).toMatchObject(parsed[0] ?? {});
    expect((await model.loadPeople(book)).data.slice(-2).map((entry) => entry.name)).toEqual([
      "Vera Card",
      "Second Card",
    ]);
    expect(await importVcards(model, book, "")).toEqual([]);
    await expect(
      importVcards(model, book, `${vcf}\nBEGIN:VCARD\nVERSION:3.0\nEND:VCARD`),
    ).rejects.toThrow("name");
  });

  test("a failed vCard import does not replace existing resources", async () => {
    const { model, pod, book } = await setup();
    pod.fail = (_url, method) =>
      method === "PUT" ? new Response(null, { status: 403 }) : undefined;
    await expect(importVcards(model, book, vcf)).rejects.toMatchObject({ status: 403 });
    expect(pod.files.get(ALICE)?.body).toBe(fixture("alice"));
  });
});
