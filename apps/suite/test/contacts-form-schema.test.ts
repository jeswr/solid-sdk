// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  contactFormData,
  contactFormDefaults,
  contactFormSchema,
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
    });
    expect(contactFormData({ ...contactFormDefaults(), name: "Mira" })).toEqual({
      name: "Mira",
      emails: [],
      phones: [],
      organization: undefined,
      note: undefined,
      webId: undefined,
    });
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
