// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  CONTACT_HUES,
  ContactListError,
  type ContactListErrorCode,
  contactAvatar,
  type ListContact,
  type ListOptions,
  searchContacts,
  sectionContacts,
} from "../src/apps/contacts/lib/list";

const person: ListContact = Object.freeze({
  id: "https://example.org/people/mira#me",
  displayName: "Mira Quill",
  givenName: "Mira",
  familyName: "Quill",
  emails: Object.freeze(["mira.quill@example.org"]),
  phones: Object.freeze(["+1 (202) 555-0101"]),
  organization: "Fictional Observatory",
});
const ids = (values: readonly { contact: ListContact }[]) =>
  values.map(({ contact }) => contact.id);
const grouped = (values: readonly ListContact[], options?: ListOptions) =>
  sectionContacts(values, options).map(({ label, contacts }) => [
    label,
    contacts.map(({ id }) => id),
  ]);

function fails(run: () => unknown, code: ContactListErrorCode): void {
  expect(run).toThrow(ContactListError);
  expect(run).toThrow(expect.objectContaining({ code, message: `Contact list: ${code}` }));
}

function invalidContacts(value: unknown, code: ContactListErrorCode = "invalid-contact"): void {
  fails(() => sectionContacts(value as ListContact[]), code);
  fails(() => searchContacts(value as ListContact[], ""), code);
}

describe("contact list sections", () => {
  it("sorts names and sections without changing input and puts # last", () => {
    const input = Object.freeze([
      Object.freeze({ id: "z", displayName: "Mira Quill" }),
      Object.freeze({ id: "a", displayName: "mira quill" }),
      { id: "zoe", displayName: "Zora Vale" },
      { id: "digit", displayName: "9 Fictional" },
      { id: "punct", displayName: "!Fictional" },
      { id: "emoji", displayName: "🌙 Fictional" },
      { id: "empty" },
      { id: "accent", displayName: "Élia Reed" },
      { id: "plain", displayName: "Elin Wren" },
    ]);
    expect(grouped(input)).toEqual([
      ["E", ["accent", "plain"]],
      ["M", ["a", "z"]],
      ["Z", ["zoe"]],
      ["#", ["empty", "punct", "emoji", "digit"]],
    ]);
    expect(sectionContacts(input).flatMap((section) => section.contacts)).toContain(input[0]);
    expect(input[0]?.id).toBe("z");
    expect(sectionContacts([])).toEqual([]);
    expect(grouped([{ id: "only" }])).toEqual([["#", ["only"]]]);
  });

  it("respects Swedish, German, Turkish and native-script initials", () => {
    const input = [
      { id: "a", displayName: "Alva" },
      { id: "ae", displayName: "Älva" },
      { id: "aa", displayName: "Ålva" },
      { id: "z", displayName: "Zora" },
    ];
    expect(grouped(input, { locale: "sv" }).map(([label]) => label)).toEqual(["A", "Z", "Å", "Ä"]);
    expect(grouped(input, { locale: "de" }).map(([label]) => label)).toEqual(["A", "Z"]);
    expect(grouped([{ id: "i", displayName: "ipek" }], { locale: "tr" })).toEqual([["İ", ["i"]]]);
    expect(grouped([{ id: "cjk", displayName: "林" }], { locale: "zh" })).toEqual([
      ["林", ["cjk"]],
    ]);
    expect(grouped([{ id: "accent", displayName: "  E\u0301lia  " }])).toEqual([["E", ["accent"]]]);
  });

  it("uses explicit name order without parsing display names or falling back to an email", () => {
    expect(grouped([person])).toEqual([["M", [person.id]]]);
    expect(grouped([person], { nameOrder: "family-given" })).toEqual([["Q", [person.id]]]);
    expect(
      grouped([
        { id: "f", familyName: "Reed" },
        { id: "g", givenName: "Alva" },
      ]),
    ).toEqual([
      ["A", ["g"]],
      ["R", ["f"]],
    ]);
    expect(grouped([{ id: "mail", emails: ["mira@example.org"] }])).toEqual([["#", ["mail"]]]);
    expect(
      grouped([{ id: "display", displayName: "Mira Quill" }], { nameOrder: "family-given" }),
    ).toEqual([["M", ["display"]]]);
  });
});

describe("contact avatar", () => {
  it("uses grapheme initials, explicit order and an unnamed placeholder", () => {
    expect(contactAvatar(person).initials).toBe("MQ");
    expect(contactAvatar(person, { nameOrder: "family-given" }).initials).toBe("QM");
    expect(contactAvatar({ id: "a", displayName: "  Mira of Quill  " }).initials).toBe("MQ");
    expect(contactAvatar({ id: "a", displayName: "Mira" }).initials).toBe("M");
    expect(contactAvatar({ id: "a", givenName: "E\u0301lia", familyName: "𐐨ora" }).initials).toBe(
      "E\u0301𐐀",
    );
    expect(contactAvatar({ id: "a", familyName: "Reed" }).initials).toBe("R");
    expect(contactAvatar({ id: "a", displayName: "ipek" }, { locale: "tr" }).initials).toBe("İ");
    expect(contactAvatar({ id: "a" }).initials).toBe("?");
    expect(contactAvatar({ id: "a", displayName: "🌙" }).initials).toBe("?");
  });

  it("hashes the exact stable ID into the specified 15-hue order", () => {
    expect(CONTACT_HUES).toEqual([
      205, 250, 280, 150, 40, 320, 85, 350, 300, 170, 20, 335, 130, 10, 225,
    ]);
    expect(Object.isFrozen(CONTACT_HUES)).toBe(true);
    // FNV-1a test vector: ASCII 'a' = 0xe40c292c unsigned = 3826002220.
    expect(contactAvatar({ id: "a" }).colourIndex).toBe(3826002220 % 15);
    expect(contactAvatar(person).colourIndex).toBe(
      contactAvatar({ ...person, givenName: "Elin" }).colourIndex,
    );
    const indices = new Set(
      Array.from(
        { length: 200 },
        (_, index) => contactAvatar({ id: `https://example.org/${index}` }).colourIndex,
      ),
    );
    expect([...indices].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 15 }, (_, index) => index),
    );
    expect(contactAvatar({ id: "𐐨" }).colourIndex).toBeGreaterThanOrEqual(0);
  });
});

describe("contact search", () => {
  it("ranks token prefix > email > phone digits > org > name substring > name typo", () => {
    const input: ListContact[] = [
      { id: "typo", displayName: "525" },
      { id: "substring", displayName: "A555B" },
      { id: "org", organization: "Fictional 555 Observatory" },
      { id: "phone", phones: ["+1 (202) 555-0101"] },
      { id: "email", emails: ["555@example.org"] },
      { id: "prefix", displayName: "Mira 555a" },
      { id: "none", displayName: "Zora" },
    ];
    const results = searchContacts(input, "555");
    expect(ids(results)).toEqual(["prefix", "email", "phone", "org", "substring", "typo"]);
    expect(results.map(({ score }) => score)).toEqual([500, 400, 300, 200, 100, 50]);
    expect(results[0]?.highlights).toEqual([{ field: "displayName", index: 0, start: 5, end: 8 }]);
    expect(results[1]?.highlights).toEqual([{ field: "emails", index: 0, start: 0, end: 3 }]);
    expect(results[2]?.highlights).toEqual([{ field: "phones", index: 0, start: 9, end: 12 }]);
    expect(results[3]?.highlights).toEqual([
      { field: "organization", index: 0, start: 10, end: 13 },
    ]);
    expect(results[4]?.highlights).toEqual([{ field: "displayName", index: 0, start: 1, end: 4 }]);
    expect(results[5]?.highlights).toEqual([{ field: "displayName", index: 0, start: 0, end: 3 }]);
  });

  it("matches each name token and each array entry, retaining the original field offsets", () => {
    expect(searchContacts([person], "quil")[0]?.highlights).toEqual([
      { field: "displayName", index: 0, start: 5, end: 9 },
    ]);
    expect(
      searchContacts([{ id: "g", givenName: "Mira", familyName: "Quill" }], "MIR")[0]?.highlights,
    ).toEqual([{ field: "givenName", index: 0, start: 0, end: 3 }]);
    expect(searchContacts([{ id: "f", familyName: "Quill" }], "qui")[0]?.highlights[0]?.field).toBe(
      "familyName",
    );
    const arrays = [
      {
        id: "a",
        emails: ["zora@example.org", "mira@example.org"],
        phones: ["1234", "202-555-0101"],
      },
    ];
    expect(searchContacts(arrays, "mira@")[0]?.highlights).toEqual([
      { field: "emails", index: 1, start: 0, end: 5 },
    ]);
    expect(searchContacts(arrays, "5550101")[0]?.highlights).toEqual([
      { field: "phones", index: 1, start: 4, end: 12 },
    ]);
    expect(searchContacts([person], "+1 (202) 555-0101")[0]?.highlights).toEqual([
      { field: "phones", index: 0, start: 1, end: 17 },
    ]);
    expect(searchContacts([person], "555 0101")).toHaveLength(1);
    expect(searchContacts([person], "no-match")).toEqual([]);
    expect(searchContacts([], "Mira")).toEqual([]);
  });

  it("maps normalization and supplementary characters back to complete source graphemes", () => {
    expect(
      searchContacts([{ id: "a", displayName: "🌙 E\u0301lia" }], "ÉL")[0]?.highlights,
    ).toEqual([{ field: "displayName", index: 0, start: 3, end: 6 }]);
    expect(searchContacts([{ id: "a", displayName: "𐐨ora" }], "𐐀o")[0]?.highlights).toEqual([
      { field: "displayName", index: 0, start: 0, end: 3 },
    ]);
    expect(searchContacts([{ id: "a", displayName: "Işıl" }], "ış", { locale: "tr" })).toHaveLength(
      1,
    );
    expect(searchContacts([{ id: "a", displayName: "किरण" }], "किर")).toHaveLength(1);
    expect(searchContacts([{ id: "a", displayName: "किरण" }], "कर")).toEqual([]);
  });

  it("case-folds sharp S, final sigma and ligatures while retaining expanded-source ranges", () => {
    expect(searchContacts([{ id: "a", displayName: "Straße" }], "STRASSE")[0]?.highlights).toEqual([
      { field: "displayName", index: 0, start: 0, end: 6 },
    ]);
    expect(searchContacts([{ id: "a", displayName: "ΟΣ" }], "ος", { locale: "el" })[0]?.score).toBe(
      500,
    );
    expect(searchContacts([{ id: "a", displayName: "ος" }], "ΟΣ", { locale: "el" })[0]?.score).toBe(
      500,
    );
    expect(searchContacts([{ id: "a", displayName: "ﬃn" }], "ff")[0]?.highlights).toEqual([
      { field: "displayName", index: 0, start: 0, end: 1 },
    ]);
    expect(searchContacts([{ id: "a", displayName: "E\u0301lia" }], "e")[0]?.highlights).toEqual([
      { field: "displayName", index: 0, start: 0, end: 2 },
    ]);
  });

  it("supports a single insertion, deletion or substitution, but no short fuzzy or transposition", () => {
    const contact = [{ id: "a", displayName: "Mira Quill" }];
    for (const query of ["qill", "quilll", "quxll", "miira"]) {
      expect(searchContacts(contact, query)[0]?.score).toBe(50);
    }
    expect(searchContacts(contact, "quxll")[0]?.highlights).toEqual([
      { field: "displayName", index: 0, start: 5, end: 10 },
    ]);
    for (const query of ["qu", "qi", "mxraxx", "quilxx", "qxxll", "qluil"]) {
      if (query === "qu") expect(searchContacts(contact, query)[0]?.score).toBe(500);
      else expect(searchContacts(contact, query)).toEqual([]);
    }
  });

  it("requires all terms, chooses weakest tier then total tier score, and merges ranges", () => {
    const input = [
      { id: "strong", givenName: "Mira Quill" },
      { id: "mixed", givenName: "Mira", organization: "Quill Observatory" },
      { id: "org", organization: "Mira Quill Observatory" },
      { id: "missing", givenName: "Mira" },
    ];
    expect(ids(searchContacts(input, "mira quill"))).toEqual(["strong", "mixed", "org"]);
    expect(searchContacts(input, "mira quill")[0]?.highlights).toHaveLength(2);
    expect(searchContacts([person], "mir mira mira")[0]?.highlights).toEqual([
      { field: "displayName", index: 0, start: 0, end: 4 },
    ]);
    expect(
      searchContacts(
        [{ id: "a", givenName: "Mira", familyName: "Quill" }],
        "qui mir",
      )[0]?.highlights.map(({ field }) => field),
    ).toEqual(["familyName", "givenName"]);
    expect(
      searchContacts(
        [{ id: "a", emails: ["mira@example.org", "quill@example.org"] }],
        "mira@ quill@",
      )[0]?.highlights.map(({ index }) => index),
    ).toEqual([0, 1]);
    expect(searchContacts([{ id: "a", organization: "ab.cd" }], "ab. cd")[0]?.highlights).toEqual([
      { field: "organization", index: 0, start: 0, end: 5 },
    ]);
  });

  it("sorts ties and empty queries by locale/name order and exact ID", () => {
    const input = Object.freeze([
      Object.freeze({ id: "z", givenName: "Mira", familyName: "Alva" }),
      Object.freeze({ id: "a", givenName: "mira", familyName: "alva" }),
      Object.freeze({ id: "b", givenName: "Alva", familyName: "Zora" }),
    ]);
    expect(ids(searchContacts(input, "mira"))).toEqual(["a", "z"]);
    expect(ids(searchContacts(input, ""))).toEqual(["b", "a", "z"]);
    expect(ids(searchContacts(input, "   ", { nameOrder: "family-given" }))).toEqual([
      "a",
      "z",
      "b",
    ]);
    expect(searchContacts([person], "")).toEqual([{ contact: person, score: 0, highlights: [] }]);
    expect(input[0]?.id).toBe("z");
  });
});

describe("fail-closed validation", () => {
  it("rejects malformed projections, duplicate IDs and unusable text through typed errors", () => {
    for (const value of [
      null,
      {},
      "contacts",
      [null],
      [new Date()],
      [{ id: "a", extra: true }],
      [{ id: "a", [Symbol("extra")]: true }],
      [{ id: "a", displayName: undefined }],
      [{ id: "a", givenName: null }],
      [{ id: "a", familyName: " " }],
      [{ id: "" }],
      [{ id: "a\ud800" }],
      [{ id: "a", displayName: "Mira\nQuill" }],
      [{ id: "a", organization: "\u202eHidden" }],
      [{ id: "a", emails: null }],
      [{ id: "a", phones: {} }],
      [{ id: "a", phones: [12] }],
      [{ id: "a", phones: ["202-555-0101 ext 2"] }],
      [{ id: "a", emails: ["mailto:mira@example.org"] }],
      new Array(1),
      [{ id: "a", emails: new Array(1) }],
    ]) {
      invalidContacts(value);
    }
    invalidContacts([{ id: "a" }, { id: "a" }], "duplicate-id");
    fails(
      () => contactAvatar({ id: "a", displayName: 123 } as unknown as ListContact),
      "invalid-contact",
    );
    const hidden = Object.defineProperty({ id: "a" }, "displayName", { value: "Mira" });
    invalidContacts([hidden]);
    const accessor = Object.defineProperty({ id: "a" }, "displayName", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    invalidContacts([accessor]);
    invalidContacts(Object.assign([], { extra: "unsupported" }));
    const getterArray = Object.defineProperty([{}], "0", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    invalidContacts(getterArray);
    invalidContacts(Object.assign([], { [Symbol("extra")]: true }));
    invalidContacts(Object.defineProperty([{}], "0", { value: {}, enumerable: false }));
    const weirdKey = Object.assign([], { "01": {} });
    Object.defineProperty(weirdKey, "length", { value: 1 });
    invalidContacts(weirdKey);
    class ContactArray extends Array<ListContact> {}
    invalidContacts(new ContactArray());
    expect(grouped([Object.assign(Object.create(null), { id: "a", givenName: "Mira" })])).toEqual([
      ["M", ["a"]],
    ]);
  });

  it("rejects invalid options and unavailable locales before returning empty results", () => {
    for (const options of [
      null,
      [],
      { locale: "" },
      { locale: 1 },
      { locale: "not_a_locale" },
      { locale: "zz" },
      { locale: "en-u-co-foobar" },
      { locale: "en-u-kn-true" },
      { nameOrder: "reverse" },
      { nameOrder: null },
      { extra: true },
    ]) {
      fails(() => sectionContacts([], options as ListOptions), "invalid-options");
      fails(() => searchContacts([], "", options as ListOptions), "invalid-options");
      fails(() => contactAvatar(person, options as ListOptions), "invalid-options");
    }
    expect(
      sectionContacts([], { locale: undefined, nameOrder: undefined } as unknown as ListOptions),
    ).toEqual([]);
  });

  it("rejects unusable queries instead of silently stripping unsupported syntax", () => {
    for (const query of [
      null,
      123,
      "\ud800",
      "mira\nquill",
      "x".repeat(257),
      Array.from({ length: 17 }, (_, index) => `q${index}`).join(" "),
      "(555",
      "+0",
      "555)",
      "(0)555",
    ]) {
      fails(() => searchContacts([], query as string), "invalid-query");
    }
    expect(searchContacts([person], "!!!")).toEqual([]);
  });
});
