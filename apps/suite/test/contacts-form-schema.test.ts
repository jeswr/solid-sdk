// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type AddressFormValues,
  contactFormData,
  contactFormDefaults,
  contactFormSchema,
  contactFormSchemaFor,
  emptyAddress,
  secureContactUrl,
} from "../src/apps/contacts/lib/form-schema";

describe("contact form validation and normalization", () => {
  it.each([
    "https://example.org/id#me",
    "http://localhost:3000/me",
    "http://127.0.0.1:3000",
    "http://[::1]/me",
  ])("accepts %s", (url) => expect(secureContactUrl(url)).toBe(true));
  it.each([
    "/relative",
    "https://example.org/ a",
    "https://example.org\\evil",
    "https://[",
    "https://user:secret@example.org/",
    "http://example.org/",
    "http://localhost.evil/",
    "javascript:alert(1)",
  ])("rejects %s", (url) => expect(secureContactUrl(url)).toBe(false));
  it("supplies raw editable defaults and retains multiple values", () => {
    expect(contactFormDefaults()).toEqual({
      name: "",
      organization: "",
      emails: [{ value: "" }],
      phones: [{ value: "" }],
      addresses: [],
      webId: "",
      note: "",
      labels: [],
    });
    const values = contactFormDefaults(
      {
        name: "Mira",
        emails: ["mailto:mira@example.org", "other@example.org"],
        phones: ["tel:+12025550123", "+442079460018"],
        organization: "Org",
        note: "Note",
        webId: "https://example.org/",
      },
      ["label"],
    );
    expect(values.emails).toEqual([{ value: "mira@example.org" }, { value: "other@example.org" }]);
    expect(values.phones).toEqual([{ value: "+12025550123" }, { value: "+442079460018" }]);
    expect(values).toMatchObject({
      labels: ["label"],
      organization: "Org",
      note: "Note",
      webId: "https://example.org/",
    });
    expect(contactFormDefaults({ name: "a", emails: [], phones: [] }).emails).toEqual([
      { value: "" },
    ]);
  });
  it("trims fields, drops blank rows, canonicalizes IRIs and clears optional values", () => {
    const values = {
      ...contactFormDefaults(),
      name: "  Mira  ",
      organization: " Org ",
      note: " Note ",
      webId: " https://EXAMPLE.org ",
      emails: [
        { value: " Mira@example.org " },
        { value: "mailto:other@example.org" },
        { value: " " },
      ],
      phones: [{ value: " tel:+1 (202) 555-0123 " }, { value: "" }],
    };
    expect(contactFormData(values)).toEqual({
      name: "Mira",
      organization: "Org",
      note: "Note",
      webId: "https://example.org/",
      emails: ["mailto:Mira@example.org", "mailto:other@example.org"],
      phones: ["tel:+12025550123"],
      addresses: [],
    });
    expect(contactFormData({ ...contactFormDefaults(), name: "Mira" })).toEqual({
      name: "Mira",
      emails: [],
      phones: [],
      addresses: [],
      organization: undefined,
      note: undefined,
      webId: undefined,
    });
  });
  // AUTHORED-BY Claude Opus 5.5
  it("edits postal addresses: defaults, trimming, blank street lines and empty rows", () => {
    const defaults = contactFormDefaults({
      name: "Mira",
      addresses: [
        { kind: "work", street: "1 Way\nUnit 2", locality: "Paris", country: "France" },
        { postalCode: "12345" },
      ],
    });
    expect(defaults.addresses).toEqual([
      {
        kind: "work",
        street: "1 Way\nUnit 2",
        locality: "Paris",
        region: "",
        postalCode: "",
        country: "France",
      },
      { kind: "", street: "", locality: "", region: "", postalCode: "12345", country: "" },
    ]);
    const [work, code] = defaults.addresses as [AddressFormValues, AddressFormValues];
    expect(emptyAddress()).toEqual({ ...code, postalCode: "" });
    const blank = {
      kind: "home" as const,
      street: " \n ",
      locality: "",
      region: "",
      postalCode: "",
      country: " ",
    };
    expect(
      contactFormData({
        ...defaults,
        addresses: [
          {
            ...work,
            street: "  1 Way \r\n\r\n Unit 2\r",
            region: " IDF ",
          },
          code,
          blank,
        ],
      }).addresses,
    ).toEqual([
      {
        kind: "work",
        street: "1 Way\nUnit 2",
        locality: "Paris",
        region: "IDF",
        country: "France",
      },
      { postalCode: "12345" },
    ]);
    const long = contactFormSchema.safeParse({
      ...defaults,
      addresses: [{ ...blank, locality: "x".repeat(257), street: "y".repeat(2049) }],
    });
    expect(long.success).toBe(false);
    const crowded = contactFormSchema.safeParse({
      ...defaults,
      addresses: Array.from({ length: 17 }, () => blank),
    });
    expect(crowded.success).toBe(false);
    if (!crowded.success)
      expect(crowded.error.issues.map((issue) => issue.message)).toEqual([
        "A contact can have at most 16 addresses.",
      ]);
    if (!long.success)
      expect(long.error.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
        ["addresses.0.street", "This address is too long."],
        ["addresses.0.locality", "This address is too long."],
      ]);
    // Addresses loaded past the limits pass while unchanged (padding aside), and fail once edited.
    const loaded = Array.from({ length: 17 }, () => ({ ...blank, locality: "x".repeat(300) }));
    const schema = contactFormSchemaFor(loaded);
    const padded = loaded.map((row) => ({ ...row, locality: ` ${row.locality} ` }));
    expect(schema.safeParse({ ...defaults, addresses: padded }).success).toBe(true);
    expect(contactFormData({ ...defaults, addresses: loaded }, schema).addresses).toHaveLength(17);
    expect(schema.safeParse({ ...defaults, addresses: loaded.slice(1) }).success).toBe(false);
  });
  it("requires a name, valid email, a parsed international phone without extension and a secure WebID", () => {
    const invalid = contactFormSchema.safeParse({
      ...contactFormDefaults(),
      name: " ",
      emails: [{ value: "broken" }],
      phones: [{ value: "not a phone" }],
      webId: "http://example.org/",
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "name",
        "emails.0.value",
        "phones.0.value",
        "webId",
      ]);
    expect(
      contactFormSchema.safeParse({
        ...contactFormDefaults(),
        name: "Mira",
        phones: [{ value: "+12025550123 ext. 01" }],
      }).success,
    ).toBe(false);
    expect(() => contactFormData(contactFormDefaults())).toThrow();
  });
});
