// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { assert, describe, expect, it } from "vitest";
import {
  clusterContacts,
  type DedupeContact,
  DedupeError,
  type DedupeErrorCode,
  type DedupeOptions,
  planMerges,
} from "../src/apps/contacts/lib/dedupe";

const webId = "https://example.org/people/mira#me";
const contacts: readonly DedupeContact[] = [
  {
    id: "a",
    fields: { name: "Mira Quill", organization: "Fictional Observatory" },
    emails: ["Mira+Club@EXAMPLE.ORG", "mira+club@example.org"],
    phones: ["+1 (202) 555-0101"],
    multiFields: { labels: ["Friends", "Astronomy", "Friends"], empty: [] },
  },
  {
    id: "b",
    fields: { name: "Mira Q.", note: "Fictional pen pal" },
    emails: ["mira+club@example.org", "mira.quill@example.org"],
    webIds: [webId],
    multiFields: { labels: ["Friends", "Books"] },
  },
  {
    id: "c",
    fields: {
      name: "Mira Quill",
      organization: "Fictional Library",
      note: "Another fictional note",
    },
    webIds: [webId, "https://example.org/mira#me"],
    phones: ["202-555-0102"],
    multiFields: { addresses: ["https://example.org/addresses/fictional-home#it"] },
  },
  { id: "d", fields: { name: "Mira Quill" }, phones: ["2025550102"] },
  { id: "e", fields: { name: "Mira Quill" }, emails: ["mira@example.org"] },
];

function rejects(input: unknown, code: DedupeErrorCode = "invalid-contact"): void {
  for (const operation of [clusterContacts, planMerges]) {
    expect(() => operation(input as readonly DedupeContact[])).toThrow(DedupeError);
    expect(() => operation(input as readonly DedupeContact[])).toThrow(
      expect.objectContaining({ code }),
    );
  }
}

describe("contact duplicate clusters", () => {
  it("joins transitive email, WebID and phone matches, with deterministic singletons", () => {
    expect(clusterContacts([...contacts].reverse(), { defaultCountryCallingCode: "1" })).toEqual([
      { id: "a", contactIds: ["a", "b", "c", "d"] },
      { id: "e", contactIds: ["e"] },
    ]);
    expect(clusterContacts([])).toEqual([]);
    expect(planMerges([])).toEqual([]);
    expect(clusterContacts([{ id: "z" }, { id: "a" }])).toEqual([
      { id: "a", contactIds: ["a"] },
      { id: "z", contactIds: ["z"] },
    ]);
  });

  it("keeps names, plus-tags, national/international numbers and WebID spellings distinct", () => {
    const input = [
      {
        id: "a",
        fields: { name: "Mira Quill" },
        emails: ["mira@example.org"],
        phones: ["2025550101"],
        webIds: [webId],
      },
      {
        id: "b",
        fields: { name: "ＭＩＲＡ QUILL" },
        emails: ["mira+club@example.org"],
        phones: ["+12025550101"],
        webIds: ["https://example.org/people/Mira#me"],
      },
      { id: "c", webIds: ["https://example.org/people/mira#other"] },
      { id: "d", webIds: ["https://EXAMPLE.ORG/people/mira#me"] },
    ];
    expect(clusterContacts(input).map((cluster) => cluster.contactIds)).toEqual([
      ["a"],
      ["b"],
      ["c"],
      ["d"],
    ]);
    expect(clusterContacts(input, { defaultCountryCallingCode: "1" })[0]?.contactIds).toEqual([
      "a",
      "b",
    ]);
  });

  it("handles cycles, repeated signals, disjoint groups and late bridges", () => {
    const input = [
      { id: "a", emails: ["a@example.org"], phones: ["123"] },
      { id: "b", emails: ["a@example.org"], phones: ["123"] },
      { id: "c", emails: ["c@example.org"], webIds: [webId] },
      { id: "d", emails: ["c@example.org"], webIds: [webId] },
      { id: "e", phones: ["123"], webIds: [webId] },
      { id: "f", emails: ["other@example.org"] },
    ];
    expect(clusterContacts(input)).toEqual([
      { id: "a", contactIds: ["a", "b", "c", "d", "e"] },
      { id: "f", contactIds: ["f"] },
    ]);
  });

  it("agrees with graph reachability for generated identity networks and input permutations", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            emails: fc.uniqueArray(fc.integer({ min: 0, max: 8 }), { maxLength: 4 }),
            phones: fc.uniqueArray(fc.integer({ min: 0, max: 8 }), { maxLength: 4 }),
            webIds: fc.uniqueArray(fc.integer({ min: 0, max: 8 }), { maxLength: 4 }),
          }),
          { maxLength: 20 },
        ),
        (rows) => {
          const input = rows.map((row, index) => ({
            id: `contact-${String(index).padStart(2, "0")}`,
            emails: row.emails.map((key) => `fiction-${key}@example.org`),
            phones: row.phones.map((key) => `+1202555010${key}`),
            webIds: row.webIds.map((key) => `https://example.org/fiction-${key}#me`),
          }));
          const remaining = new Set(input.map((row) => row.id));
          const expected = [];
          for (const start of input) {
            if (!remaining.delete(start.id)) continue;
            const reached = [start];
            for (const member of reached) {
              for (const other of input) {
                if (
                  remaining.has(other.id) &&
                  (["emails", "phones", "webIds"] as const).some((field) =>
                    member[field].some((value) => other[field].includes(value)),
                  )
                ) {
                  remaining.delete(other.id);
                  reached.push(other);
                }
              }
            }
            expected.push(reached.map((row) => row.id).sort());
          }
          expect(clusterContacts(input).map((cluster) => cluster.contactIds)).toEqual(expected);
          expect(planMerges([...input].reverse())).toEqual(planMerges(input));
        },
      ),
      { numRuns: 100, seed: 260026 },
    );
  });
});

describe("deterministic contact merge plans", () => {
  it("selects winners per field, unions sets and retains all conflicts with provenance", () => {
    const result = planMerges(contacts, { defaultCountryCallingCode: "1" });
    expect(result[0]).toEqual({
      id: "a",
      targetId: "a",
      contactIds: ["a", "b", "c", "d"],
      fields: {
        name: { value: "Mira Quill", sourceIds: ["a", "c", "d"] },
        organization: { value: "Fictional Observatory", sourceIds: ["a"] },
        note: { value: "Fictional pen pal", sourceIds: ["b"] },
      },
      multiFields: {
        empty: [],
        addresses: [{ value: "https://example.org/addresses/fictional-home#it", sourceIds: ["c"] }],
        labels: [
          { value: "Astronomy", sourceIds: ["a"] },
          { value: "Books", sourceIds: ["b"] },
          { value: "Friends", sourceIds: ["a", "b"] },
        ],
      },
      emails: [
        { value: "mira+club@example.org", sourceIds: ["a", "b"] },
        { value: "mira.quill@example.org", sourceIds: ["b"] },
      ],
      phones: [
        { value: "+12025550101", sourceIds: ["a"] },
        { value: "+12025550102", sourceIds: ["c", "d"] },
      ],
      webIds: [
        { value: "https://example.org/mira#me", sourceIds: ["c"] },
        { value: webId, sourceIds: ["b", "c"] },
      ],
      conflicts: [
        {
          field: "name",
          winner: { value: "Mira Quill", sourceIds: ["a", "c", "d"] },
          alternatives: [{ value: "Mira Q.", sourceIds: ["b"] }],
        },
        {
          field: "note",
          winner: { value: "Fictional pen pal", sourceIds: ["b"] },
          alternatives: [{ value: "Another fictional note", sourceIds: ["c"] }],
        },
        {
          field: "organization",
          winner: { value: "Fictional Observatory", sourceIds: ["a"] },
          alternatives: [{ value: "Fictional Library", sourceIds: ["c"] }],
        },
      ],
    });
    expect(result[1]?.conflicts).toEqual([]);
    expect(planMerges([{ id: "a" }])).toEqual([
      {
        id: "a",
        targetId: "a",
        contactIds: ["a"],
        fields: {},
        multiFields: {},
        emails: [],
        phones: [],
        webIds: [],
        conflicts: [],
      },
    ]);
  });

  it("keeps every distinct scalar spelling, including multiple losing values and whitespace", () => {
    const result = planMerges([
      { id: "d", emails: ["mira@example.org"], fields: { name: "mira", note: "Note " } },
      { id: "c", emails: ["mira@example.org"], fields: { name: "ＭＩＲＡ" } },
      { id: "b", emails: ["mira@example.org"], fields: { name: "MIRA", note: "Note" } },
      { id: "a", emails: ["mira@example.org"], fields: { name: "Mira" } },
    ])[0];
    expect(result?.conflicts[0]?.alternatives).toEqual([
      { value: "MIRA", sourceIds: ["b"] },
      { value: "ＭＩＲＡ", sourceIds: ["c"] },
      { value: "mira", sourceIds: ["d"] },
    ]);
    expect(result?.conflicts[1]?.alternatives).toEqual([{ value: "Note ", sourceIds: ["d"] }]);
  });

  it("is invariant to record/array order and uses UTF-16 ordering rather than locale collation", () => {
    const shuffled = [...contacts].reverse().map((contact) => ({
      ...contact,
      fields: Object.fromEntries(Object.entries(contact.fields ?? {}).reverse()),
      multiFields: Object.fromEntries(
        Object.entries(contact.multiFields ?? {})
          .reverse()
          .map(([key, values]) => [key, [...values].reverse()]),
      ),
      emails: [...(contact.emails ?? [])].reverse(),
      phones: [...(contact.phones ?? [])].reverse(),
      webIds: [...(contact.webIds ?? [])].reverse(),
    }));
    expect(JSON.stringify(planMerges(shuffled))).toBe(JSON.stringify(planMerges(contacts)));
    expect(
      clusterContacts([{ id: "ä" }, { id: "z" }, { id: "Z" }]).map((cluster) => cluster.id),
    ).toEqual(["Z", "z", "ä"]);
  });

  it("supports prototype-like field names without prototype pollution", () => {
    const fields = JSON.parse(
      '{"__proto__":"Fictional value","constructor":"Fictional constructor"}',
    ) as Record<string, string>;
    const multiFields = JSON.parse('{"toString":["Fictional label"]}') as Record<string, string[]>;
    const result = planMerges([{ id: "__proto__", fields, multiFields }])[0];
    expect(Object.keys(result?.fields ?? {})).toEqual(["__proto__", "constructor"]);
    expect(Object.getOwnPropertyDescriptor(result?.fields, "__proto__")?.value).toEqual({
      value: "Fictional value",
      sourceIds: ["__proto__"],
    });
    expect(Object.getPrototypeOf(result?.fields)).toBe(Object.prototype);
    expect(result?.multiFields.toString).toEqual([
      { value: "Fictional label", sourceIds: ["__proto__"] },
    ]);
    expect(
      planMerges([
        { id: "a", emails: ["mira@example.org"], multiFields },
        { id: "b", emails: ["mira@example.org"] },
      ])[0]?.multiFields.toString,
    ).toEqual([{ value: "Fictional label", sourceIds: ["a"] }]);
    expect(
      planMerges([{ id: "a", fields: Object.create(null), multiFields: Object.create(null) }])[0]
        ?.fields,
    ).toEqual({});
  });

  it("does not mutate inputs or retain their mutable containers", () => {
    const input = structuredClone(contacts);
    const before = structuredClone(input);
    for (const contact of input) {
      Object.values(contact.multiFields ?? {}).forEach(Object.freeze);
      Object.freeze(contact.fields);
      Object.freeze(contact.multiFields);
      Object.freeze(contact.emails);
      Object.freeze(contact.phones);
      Object.freeze(contact.webIds);
      Object.freeze(contact);
    }
    Object.freeze(input);
    const plan = planMerges(input)[0];
    expect(input).toEqual(before);
    assert(plan);
    assert(plan.fields.name);
    (plan.fields.name.sourceIds as string[]).push("fictional");
    (plan.multiFields.labels as unknown[]).pop();
    expect(planMerges(input)).toEqual(planMerges(before));
  });
});

describe("fail-closed contact inputs", () => {
  it.each([
    null,
    {},
    "contacts",
    [null],
    [[]],
    [new Date()],
    [{ id: "" }],
    [{ id: " " }],
    [{ id: 1 }],
    [{}],
    [{ id: "a", extra: "unsupported" }],
    [{ id: "a", fields: null }],
    [{ id: "a", multiFields: null }],
    [{ id: "a", fields: [] }],
    [{ id: "a", fields: { name: 1 } }],
    [{ id: "a", fields: { name: " " } }],
    [{ id: "a", fields: { "": "Fictional" } }],
    [{ id: "a", multiFields: { " ": [] } }],
    [{ id: "a", multiFields: { labels: "Fictional" } }],
    [{ id: "a", multiFields: { labels: [1] } }],
    [{ id: "a", emails: null }],
    [{ id: "a", phones: "123" }],
    [{ id: "a", webIds: {} }],
    [{ id: "a", fields: { name: "Mira" }, multiFields: { name: ["Quill"] } }],
    [
      { id: "a", fields: { labels: "Friends" } },
      { id: "b", multiFields: { labels: ["Books"] } },
    ],
    [{ id: "a", [Symbol("hidden")]: "unsupported" }],
    [Object.create({ id: "a" })],
    [Object.defineProperty({ id: "a" }, "hidden", { value: "unsupported", enumerable: false })],
    [
      Object.defineProperty({ id: "a" }, "fields", {
        get: () => {
          throw new Error("must not run");
        },
        enumerable: true,
      }),
    ],
    [{ id: "a", fields: { name: undefined } }],
    Array(1),
  ])("rejects unsupported shape %#", (value) => rejects(value));

  it("rejects duplicate IDs and invalid identities even in otherwise unrelated contacts", () => {
    rejects([{ id: "a" }, { id: "a" }], "duplicate-id");
    rejects([{ id: "a", emails: ["Mira <mira@example.org>"] }], "invalid-email");
    rejects([{ id: "a", phones: ["123 x1"] }], "invalid-phone");
    rejects([{ id: "a", webIds: ["not a WebID"] }], "invalid-webid");
  });

  it.each([
    null,
    [],
    "options",
    { country: "US" },
    { [Symbol("hidden")]: 1 },
  ])("rejects unsupported options %# before producing even an empty plan", (options) => {
    for (const operation of [clusterContacts, planMerges]) {
      expect(() => operation([], options as DedupeOptions)).toThrow(
        expect.objectContaining({ code: "invalid-options" }),
      );
    }
  });

  it("validates the country option even without phone fields", () => {
    expect(() => planMerges([], { defaultCountryCallingCode: "+44" })).toThrow(
      expect.objectContaining({ code: "invalid-country-code" }),
    );
  });
});
