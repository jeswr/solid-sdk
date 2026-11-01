// AUTHORED-BY Codex GPT-6.1-Sol
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { contactAvatar, searchContacts, sectionContacts } from "../src/apps/contacts/lib/list";
import type { ContactData, Snapshot } from "../src/apps/contacts/lib/model";
import {
  applyContactPatch,
  contactLabels,
  decodeContactRef,
  displayPhone,
  encodeContactRef,
  filterContacts,
  projectContact,
  readStars,
  starsKey,
  toggleStar,
} from "../src/apps/contacts/state/data";
import { ALICE, BOOK } from "./contacts-support";

const snap = (data: ContactData): Snapshot<ContactData> => ({
  url: ALICE,
  etag: '"1"',
  dataset: new Store(),
  data,
});
describe("Contacts route references", () => {
  it("round trips book-relative documents and discards subject fragments", () => {
    for (const path of ["people/a.ttl", "people/%C3%A9.ttl", "people/a%20b.ttl"]) {
      const url = new URL(path, BOOK).href;
      const ref = encodeContactRef(BOOK, `${url}#this`);
      expect(ref).toBe(btoa(path).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
      expect(decodeContactRef(BOOK, ref)).toBe(url);
      expect(encodeContactRef(BOOK, path)).toBe(ref);
    }
  });
  it("rejects traversal, off-book origins, query strings, aliases and malformed encodings", () => {
    for (const url of [
      "https://evil.example/people/a",
      "../outside.ttl",
      "people/../../outside.ttl",
      "https://pod.example/alice/contacts-other/a",
      "./",
      "people/a?x=1",
      "https://user:pass@pod.example/alice/contacts/a",
      "people/%2Fetc.ttl",
      "people/%5cetc.ttl",
      "people/%2e%2e/a",
    ])
      expect(() => encodeContactRef(BOOK, url)).toThrow();
    expect(() => encodeContactRef("file:///contacts/book.ttl", "people/a")).toThrow();
    for (const ref of [
      "",
      "a=",
      "!",
      "a",
      btoa("../outside.ttl"),
      btoa("https://evil.example/a"),
      btoa("people/a#this"),
      btoa("people/./a"),
      btoa("people/a?"),
    ])
      expect(() => decodeContactRef(BOOK, ref)).toThrow();
    // Noncanonical trailing base64 bits and embedded controls cannot alias a valid reference.
    expect(() => decodeContactRef(BOOK, "Yh")).toThrow();
  });
});
describe("Contacts presentation and filters", () => {
  it("distinguishes omitted fields from explicit clears for the next lane's editor", () => {
    const original = {
      name: "Mira",
      note: "Keep",
      organization: "Observatory",
      webId: "https://mira.example/#me",
    };
    expect(
      applyContactPatch(original, { name: "Mira Quill", note: undefined, webId: undefined }),
    ).toEqual({ name: "Mira Quill", organization: "Observatory" });
    expect(applyContactPatch(original, {})).toEqual(original);
    expect(original.note).toBe("Keep");
  });
  it("projects bare points and omits absent or blank optional fields", () => {
    expect(
      projectContact(
        snap({
          name: "Mira",
          emails: ["mailto:mira@example.org", ""],
          phones: ["tel:+12025550101", ""],
          organization: "Observatory",
        }),
      ),
    ).toEqual({
      id: `${ALICE}#this`,
      displayName: "Mira",
      emails: ["mira@example.org"],
      phones: ["+1 202 555 0101"],
      organization: "Observatory",
    });
    expect(projectContact(snap({ name: " " }))).toEqual({ id: `${ALICE}#this` });
    expect(
      projectContact(snap({ name: "Mira", emails: [], phones: [], organization: " " })),
    ).toEqual({ id: `${ALICE}#this`, displayName: "Mira" });
    expect(
      projectContact(snap({ name: "Mira", emails: ["bare@example.org"], phones: ["123"] })).emails,
    ).toEqual(["bare@example.org"]);
  });
  it("adapts model-supported values to the strict list subset without changing detail data", () => {
    const unusual = snap({
      name: "Mira\nQuill\u200e",
      organization: "Observatory\r\nSecond floor\tOffice",
      emails: ["mailto:mira@localhost", "mailto:mira@example.org", "mailto:é@example.org"],
      phones: ["tel:+12025550101;ext=42", "tel:123", "tel:unknown", "tel:"],
    });
    const original = structuredClone(unusual.data);
    const projected = projectContact(unusual);
    expect(projected).toMatchObject({
      displayName: "Mira Quill",
      organization: "Observatory Second floor Office",
      emails: ["mira@example.org"],
      phones: ["+1 202 555 0101", "123"],
    });
    const contacts = [projected, { id: "ordinary", displayName: "Ada" }];
    expect(sectionContacts(contacts)).toHaveLength(2);
    expect(searchContacts(contacts, "2025550101")[0]?.contact.id).toBe(projected.id);
    expect(contactAvatar(projected).initials).toBe("MQ");
    expect(unusual.data).toEqual(original);
    expect(displayPhone("tel:+12025550101;ext=42")).toBe("+1 202 555 0101 ext. 42");
    expect(displayPhone("tel:123")).toBe("123");
    expect(projectContact(snap({ name: "\u200e\n", organization: "\t" }))).toEqual({
      id: `${ALICE}#this`,
    });
  });
  it("resolves label memberships and intersects label and starred filters", () => {
    const contacts = [{ id: "a" }, { id: "b" }];
    const group = {
      url: "group",
      etag: null,
      dataset: new Store(),
      data: { name: "Family", members: ["a"] },
    };
    const empty = { ...group, data: { name: "Empty" } };
    expect(contactLabels("a", [group, empty])).toEqual([group]);
    expect(filterContacts(contacts, new Set())).toEqual(contacts);
    expect(filterContacts(contacts, new Set(["b"]), undefined, true)).toEqual([{ id: "b" }]);
    expect(filterContacts(contacts, new Set(["b"]), group, true)).toEqual([]);
    expect(filterContacts(contacts, new Set(), group)).toEqual([{ id: "a" }]);
    expect(filterContacts(contacts, new Set(), empty)).toEqual([]);
  });
});
describe("WebID-scoped starred store", () => {
  it("persists toggles, isolates accounts and tolerates unavailable/malformed storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    expect(readStars(storage, "alice").size).toBe(0);
    const first = toggleStar(storage, "alice", new Set(), "a");
    expect(first.has("a")).toBe(true);
    expect(readStars(storage, "alice")).toEqual(first);
    expect(readStars(storage, "bob").size).toBe(0);
    expect(toggleStar(storage, "alice", first, "a").size).toBe(0);
    expect(first.has("a")).toBe(true);
    values.set(starsKey("alice"), '["a",4,null,"a"]');
    expect(readStars(storage, "alice")).toEqual(new Set(["a"]));
    values.set(starsKey("alice"), "{}");
    expect(readStars(storage, "alice").size).toBe(0);
    values.set(starsKey("alice"), "broken");
    expect(readStars(storage, "alice").size).toBe(0);
    expect(
      readStars(
        {
          getItem: () => {
            throw new Error("denied");
          },
          setItem: () => {},
        },
        "alice",
      ).size,
    ).toBe(0);
  });
});
