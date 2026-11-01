// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import type { GoogleBirthday, GooglePerson } from "./fixtures.js";
import { birthday, fields, personDocument } from "./mapping.js";
import { Contact, text, VCARD, vocabMap } from "./vocab-map.js";

const resolve = (slug: string) => `https://pod.test/integrations/google-contacts/${slug}`;

describe("Google Contacts mapping", () => {
  it.each<[GoogleBirthday["date"], string | undefined]>([
    [undefined, undefined],
    [{}, undefined],
    [{ year: 1.5, month: 1, day: 1 }, undefined],
    [{ year: -1, month: 1, day: 1 }, undefined],
    [{ year: 10000, month: 1, day: 1 }, undefined],
    [{ year: 2026, month: 1.5, day: 1 }, undefined],
    [{ year: 2026, month: 1, day: 1.5 }, undefined],
    [{ month: 0, day: 1 }, undefined],
    [{ month: 13, day: 1 }, undefined],
    [{ month: 1, day: 0 }, undefined],
    [{ month: 1 }, undefined],
    [{ month: 4, day: 31 }, undefined],
    [{ year: 1900, month: 2, day: 29 }, undefined],
    [{ year: 2001, month: 2, day: 29 }, undefined],
    [{ year: 2004, month: 2, day: 29 }, "2004-02-29"],
    [{ year: 2000, month: 2, day: 29 }, "2000-02-29"],
    [{ year: 1, month: 1, day: 31 }, "0001-01-31"],
    [{ year: 2026, month: 4, day: 30 }, "2026-04-30"],
    [{ year: 0, month: 2, day: 29 }, "--02-29"],
    [{ month: 12, day: 31 }, "--12-31"],
  ])("validates birthday components %j", (value, expected) => {
    expect(birthday(value)).toBe(expected);
  });

  it("chooses the primary name and preserves multiple organizations as vCard literal values", () => {
    const { doc, fn } = personDocument(
      {
        names: [
          { metadata: { primary: false }, displayName: "Non-primary" },
          { metadata: { primary: true }, givenName: "Alex", familyName: "Example" },
        ],
        organizations: [
          { name: "Example One", title: "Engineer" },
          { name: "Example Two", jobDescription: "Volunteer" },
        ],
      },
      "c1",
      resolve,
    );
    expect(fn).toBe("Alex Example");
    const values = [...doc.dataset]
      .filter((q) => q.predicate.value === `${VCARD}organization-name`)
      .map((q) => q.object.value)
      .sort();
    expect(values).toEqual(["Example One", "Example Two"]);
    const mapped = vocabMap(doc);
    expect([...mapped.dataset]).toEqual([...doc.dataset]);
    expect(mapped.dataset).not.toBe(doc.dataset);
  });

  it.each([
    ["what?@example.test", "what%3F@example.test"],
    ["a&b@example.test", "a%26b@example.test"],
    ["a%b@example.test", "a%25b@example.test"],
    ["a%40b@example.test", "a%2540b@example.test"],
    ["a#b@example.test", "a%23b@example.test"],
    ["a/b@example.test", "a%2Fb@example.test"],
    ['"a b"@example.test', "%22a%20b%22@example.test"],
    ["a+b@example.test", "a%2Bb@example.test"],
    ['"a,b;=c"@example.test', "%22a%2Cb%3B%3Dc%22@example.test"],
    ['"a@b"@example.test', "%22a%40b%22@example.test"],
    ["a@[192.0.2.1]", "a@%5B192.0.2.1%5D"],
    ["a?subject=x&cc=other@example.test", "a%3Fsubject%3Dx%26cc%3Dother@example.test"],
  ])("encodes reserved email characters without adding mailto recipients or headers: %s", (value, encoded) => {
    const { doc } = personDocument({ emailAddresses: [{ value }] }, "c1", resolve);
    const values = [...doc.dataset.match(null, DataFactory.namedNode(`${VCARD}value`), null)];
    expect(values.map((quad) => [quad.object.termType, quad.object.value])).toEqual([
      ["NamedNode", `mailto:${encoded}`],
    ]);
    const iri = new URL(`mailto:${encoded}`);
    expect(iri.search).toBe("");
    expect(iri.hash).toBe("");
    expect(decodeURIComponent(iri.pathname)).toBe(value);
  });

  it("retains unnamed people and skips malformed optional fields without constructing unsafe IRIs", () => {
    const person: GooglePerson = JSON.parse(
      JSON.stringify({
        names: [null, 7, {}],
        emailAddresses: [
          null,
          {},
          { value: " " },
          { value: "bad> . <x> <y> <z>" },
          { value: "@example.test" },
          { value: "missing-domain@" },
          { value: "bad\ud800@example.test" },
          { value: "bad\r\n@example.test" },
          { value: "safe@example.test" },
        ],
        phoneNumbers: [
          null,
          {},
          { value: " " },
          { value: "+12025550101" },
          { value: "555-0101" },
          { value: "ask > reception", canonicalForm: "bad canonical" },
        ],
        addresses: [null, {}, { streetAddress: "One", type: "work" }],
        organizations: [null, {}, { name: " ", title: 7 }],
        birthdays: [null, {}, { date: { month: 2, day: 30 } }, { date: { month: 3, day: 2 } }],
      }),
    );
    const { doc, fn } = personDocument(person, "c2", resolve);
    expect(fn).toBe("(unnamed contact)");
    const contact = new Contact(`${resolve(doc.slug)}#this`, doc.dataset, DataFactory);
    expect([...contact.emails]).toHaveLength(1);
    expect([...contact.telephones]).toHaveLength(3);
    expect([...contact.addresses]).toHaveLength(2);
    const iriObjects = [...doc.dataset]
      .filter((q) => q.object.termType === "NamedNode")
      .map((q) => q.object.value);
    expect(iriObjects).toContain("mailto:safe@example.test");
    expect(iriObjects).toContain("tel:+12025550101");
    // A local number has no phone-context, so it stays a literal (RFC 3966 §5.1.5).
    expect(iriObjects).not.toContain("tel:555-0101");
    expect(iriObjects.some((iri) => iri.includes(">"))).toBe(false);
    expect(
      [...doc.dataset].some(
        (q) => q.object.value === "ask > reception" && q.object.termType === "Literal",
      ),
    ).toBe(true);
    expect([...doc.dataset].find((q) => q.predicate.value === `${VCARD}bday`)?.object.value).toBe(
      "--03-02",
    );
    expect(text(null)).toBeUndefined();
    expect(text(" ")).toBeUndefined();
    expect(fields(JSON.parse('[null, 3, {"name":"kept"}]'))).toEqual([{ name: "kept" }]);
    expect(fields(JSON.parse("{}"))).toEqual([]);
    expect(personDocument({}, "c3", resolve).fn).toBe("(unnamed contact)");
  });
});
