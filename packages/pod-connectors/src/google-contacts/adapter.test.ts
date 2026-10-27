// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it } from "vitest";
import { demoImport, fixtureFetch, TEST_POD_ROOT } from "../core/testing.js";
import type { NormalisedDoc } from "../core/types.js";
import { googleContactsAdapter } from "./adapter.js";
import { AddressBook, Contact, VCARD } from "./vocab-map.js";

const ROOT = `${TEST_POD_ROOT}integrations/google-contacts/`;

describe("Google Contacts adapter contract", () => {
  it("writes the SolidOS address book and registers only its contacts container", async () => {
    const { pod, report } = await demoImport(googleContactsAdapter);
    expect(report.categories).toEqual(["contacts"]);
    expect(report.cursor).toBe("synthetic-sync-1");
    expect(report.written.map((doc) => doc.url).sort()).toEqual([
      `${ROOT}contacts/Person/c101/index.ttl`,
      `${ROOT}contacts/Person/c102/index.ttl`,
      `${ROOT}contacts/index.ttl`,
      `${ROOT}contacts/people.ttl`,
    ]);
    const book = new AddressBook(
      `${ROOT}contacts/index.ttl#this`,
      pod.dataset(`${ROOT}contacts/index.ttl`),
      DataFactory,
    );
    expect(book.types.has(`${VCARD}AddressBook`)).toBe(true);
    const person = new Contact(
      `${ROOT}contacts/Person/c101/index.ttl#this`,
      pod.dataset(`${ROOT}contacts/people.ttl`),
      DataFactory,
    );
    expect(person.fn).toBe("Dr Alex Morgan Example Jr");
    expect(person.inAddressBook).toBe(`${ROOT}contacts/index.ttl#this`);
    const index = pod.get(report.indexUrl) ?? "";
    expect(index).toContain(`${VCARD}AddressBook`);
    expect(index).toContain(`${ROOT}contacts/`);
    expect(index).not.toContain(`${VCARD}Individual`);
    expect(index).not.toContain("/Person/");
    const personDoc = pod.get(`${ROOT}contacts/Person/c101/index.ttl`) ?? "";
    expect(personDoc).toContain("https://contacts.google.com/person/c101");
    expect(personDoc).toContain("http://www.w3.org/ns/prov#wasDerivedFrom");
  });

  it("uses only the sensitive Contacts read scope and stays approval-gated", () => {
    expect(googleContactsAdapter.metadata.tier).toBe("B");
    expect(googleContactsAdapter.oauth?.tokenExchange).toBe("proxy");
    expect(googleContactsAdapter.oauth?.scopes).toEqual([
      "https://www.googleapis.com/auth/contacts.readonly",
    ]);
  });

  it("re-imports without duplicating documents or contacts", async () => {
    const { pod } = await demoImport(googleContactsAdapter);
    const before = pod.urls();
    const sizes = before
      .filter((url) => url.includes("/contacts/"))
      .map((url) => pod.dataset(url).size);
    await demoImport(googleContactsAdapter, { pod });
    expect(pod.urls()).toEqual(before);
    expect(
      before.filter((url) => url.includes("/contacts/")).map((url) => pod.dataset(url).size),
    ).toEqual(sizes);
  });

  it("matches the sorted Turtle mapping snapshot for every mapped vCard field", async () => {
    const docs: NormalisedDoc[] = [];
    await googleContactsAdapter.import({
      api: fixtureFetch("google-contacts", googleContactsAdapter.fixtures()),
      resolve: (slug) => `${ROOT}${slug}`,
      read: async () => undefined,
      write: async (doc) => {
        docs.push(doc);
        return { url: `${ROOT}${doc.slug}`, category: doc.category, forClass: doc.forClass };
      },
      remove: async () => {},
      writeBinary: async () => {
        throw new Error("Contacts has no binary resources");
      },
      progress: () => {},
    });
    const quads = [...new Store(docs.flatMap((doc) => [...doc.dataset]))].sort((a, b) =>
      [a.subject.value, a.predicate.value, a.object.value]
        .join("\n")
        .localeCompare([b.subject.value, b.predicate.value, b.object.value].join("\n")),
    );
    expect(quads.every((q) => q.subject.termType === "NamedNode")).toBe(true);
    const turtle = await new Promise<string>((resolve, reject) => {
      const writer = new Writer({ format: "text/turtle" });
      writer.addQuads(quads);
      writer.end((error, value) => (error ? reject(error) : resolve(value)));
    });
    await expect(`# AUTHORED-BY Codex GPT-6.1-Sol\n${turtle}`).toMatchFileSnapshot(
      "__snapshots__/mapping.ttl",
    );
  });
});
