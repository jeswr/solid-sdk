// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  formatAddressMultiline,
  formatAddressSingleLine,
  fromVCardAdr,
  ISO_COUNTRY_CODES,
  MAX_ADDRESS_COMPONENT_LENGTH,
  MAX_ADR_VALUE_LENGTH,
  MAX_STREET_LINES,
  type PostalAddress,
  PostalAddressError,
  type PostalAddressErrorCode,
  SUPPORTED_POSTAL_COUNTRIES,
  toVCardAdr,
  validatePostalAddress,
} from "../src/apps/contacts/lib/postal";
import { parseVCards, serializeVCards } from "../src/apps/contacts/lib/vcard";

// Entirely synthetic address content; postal codes exercise syntax, not real recipients.
const blank: PostalAddress = { street: [], locality: "", region: "", postalCode: "" };
const sample: PostalAddress = {
  street: ["12 Example Lane", "Fictional Annex"],
  locality: "Exampletown",
  region: "Example Region",
  postalCode: "12345",
  countryCode: "US",
};

const cases = [
  ["US", "12345", "Exampletown, Example Region 12345"],
  ["CA", "K1A 0B1", "Exampletown Example Region K1A 0B1"],
  ["GB", "SW1A 1AA", "Exampletown\nExample Region\nSW1A 1AA"],
  ["IE", "A65 F4E2", "Exampletown\nExample Region\nA65 F4E2"],
  ["AU", "2000", "Exampletown Example Region 2000"],
  ["NZ", "0123", "Exampletown 0123\nExample Region"],
  ["DE", "01234", "01234 Exampletown\nExample Region"],
  ["FR", "01234", "01234 Exampletown\nExample Region"],
  ["NL", "1234 AB", "1234 AB Exampletown\nExample Region"],
  ["ES", "28001", "28001 Exampletown\nExample Region"],
  ["IT", "00123", "00123 Exampletown Example Region"],
  ["JP", "123-4567", "Exampletown, Example Region\n123-4567"],
] as const;

function rejects(run: () => unknown, code: PostalAddressErrorCode): void {
  expect(run).toThrow(PostalAddressError);
  expect(run).toThrow(expect.objectContaining({ code, name: "PostalAddressError" }));
}

describe("postal formatting", () => {
  it("exports exactly twelve template countries and the assigned ISO country set", () => {
    expect(SUPPORTED_POSTAL_COUNTRIES).toEqual(cases.map(([country]) => country));
    expect(Object.isFrozen(SUPPORTED_POSTAL_COUNTRIES)).toBe(true);
    expect(Object.isFrozen(ISO_COUNTRY_CODES)).toBe(true);
    expect(ISO_COUNTRY_CODES).toHaveLength(249);
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(249);
  });

  it.each(cases)("formats %s domestically and internationally", (countryCode, postalCode, tail) => {
    const address = { ...sample, countryCode, postalCode };
    const domestic = `12 Example Lane\nFictional Annex\n${tail}`;
    const foreignHome = countryCode === "US" ? "CA" : "US";
    expect(formatAddressMultiline(address, countryCode)).toBe(domestic);
    expect(formatAddressMultiline(address, foreignHome)).toBe(`${domestic}\n${countryCode}`);
    expect(formatAddressSingleLine(address, countryCode)).toBe(domestic.split("\n").join(", "));
    expect(formatAddressSingleLine(address, foreignHome)).toBe(
      `${domestic}\n${countryCode}`.split("\n").join(", "),
    );
    expect(validatePostalAddress(address)).toEqual([]);
  });

  it("uses the generic order for every other assigned country", () => {
    for (const countryCode of ISO_COUNTRY_CODES) {
      const address = { ...sample, countryCode };
      expect(fromVCardAdr(toVCardAdr(address))).toEqual(address);
      if (SUPPORTED_POSTAL_COUNTRIES.some((country) => country === countryCode)) continue;
      expect(formatAddressMultiline(address, "US")).toBe(
        `12 Example Lane\nFictional Annex\n12345 Exampletown\nExample Region\n${countryCode}`,
      );
      expect(validatePostalAddress(address)).toEqual([]);
    }
  });

  it("preserves poBox/extended and trims display-only whitespace", () => {
    const address: PostalAddress = Object.freeze({
      ...sample,
      street: Object.freeze([" 12 Example Lane ", "", "   ", " Fictional Annex "]),
      locality: " Exampletown ",
      region: " Example Region ",
      postalCode: " 12345 ",
      poBox: " PO Box 123 ",
      extended: " Fictional Suite ",
    });
    expect(formatAddressMultiline(address, "US")).toBe(
      "PO Box 123\nFictional Suite\n12 Example Lane\nFictional Annex\nExampletown, Example Region 12345",
    );
    expect(fromVCardAdr(toVCardAdr(address))).toEqual(address);
  });

  it("omits every combination of empty components without stray separators", () => {
    for (const countryCode of [...SUPPORTED_POSTAL_COUNTRIES, "CH"]) {
      for (let mask = 0; mask < 8; mask++) {
        const address = {
          ...blank,
          countryCode,
          street: ["", "   "],
          poBox: " ",
          extended: "",
          locality: mask & 1 ? "Exampletown" : " ",
          region: mask & 2 ? "Example Region" : "",
          postalCode: mask & 4 ? "12345" : " ",
        };
        const multiline = formatAddressMultiline(address, countryCode);
        expect(multiline).not.toMatch(/\n\n|^\s|\s$|^,|,$|, ,| {2}/);
        expect(formatAddressSingleLine(address, countryCode)).toBe(
          multiline.split("\n").filter(Boolean).join(", "),
        );
        for (const field of ["Exampletown", "Example Region", "12345"]) {
          expect(multiline.includes(field)).toBe(Object.values(address).includes(field));
        }
      }
    }
    expect(formatAddressMultiline(blank, "US")).toBe("");
    expect(formatAddressSingleLine({ ...blank, countryCode: "US" }, "CA")).toBe("US");
  });

  it("never guesses a code for names, even familiar names in the home country", () => {
    const address = fromVCardAdr(
      ";;12 Example Lane;Exampletown;Example Region;12345;United States",
    );
    expect(address).not.toHaveProperty("countryCode");
    expect(address.countryName).toBe("United States");
    expect(formatAddressMultiline(address, "US")).toBe(
      "12 Example Lane\n12345 Exampletown\nExample Region\nUnited States",
    );
    expect(validatePostalAddress(address)).toEqual([]);
    expect(toVCardAdr(address)).toBe(
      ";;12 Example Lane;Exampletown;Example Region;12345;United States",
    );
    expect(formatAddressMultiline({ ...blank, countryName: "   " }, "US")).toBe("");
  });
});

describe("advisory postal validation", () => {
  it.each(cases)("warns without preventing %s formatting or conversion", (countryCode) => {
    const address = { ...sample, countryCode, postalCode: "messy!" };
    expect(validatePostalAddress(address)).toEqual([
      { code: "INVALID_POSTAL_CODE", field: "postalCode", countryCode },
    ]);
    expect(formatAddressSingleLine(address, countryCode)).toContain("messy!");
    expect(fromVCardAdr(toVCardAdr(address))).toEqual(address);
    expect(validatePostalAddress({ ...address, postalCode: "" })).toEqual([]);
  });

  it.each([
    ["US", ["00000", "12345-6789"], ["1234", "123456", "12345-678", "１２３４５"]],
    ["CA", ["k1a0b1", "H0H 0H0"], ["W1A 0B1", "K1D 0B1", "K1A  0B1"]],
    [
      "GB",
      ["M1 1AA", "M60 1NW", "W1A 1AA", "EC1A 1BB", "GIR0AA", "sw1a1aa"],
      ["12345", "ZZ1 1AA", "W1A 1CC"],
    ],
    ["IE", ["D6W F4E2", "a65f4e2"], ["A65 F4O2", "D6X F4E2", "A6 F4E2"]],
    ["AU", ["0000", "9999"], ["123", "12345", "12-34"]],
    ["NZ", ["0000", "9999"], ["123", "12345"]],
    ["DE", ["00000", "99999"], ["1234", "123456"]],
    ["FR", ["00000", "99999"], ["1234", "123456"]],
    ["NL", ["1234ab", "9999 ZZ"], ["0123 AB", "1234 A", "1234  AB"]],
    ["ES", ["01000", "52000"], ["00000", "53000", "1234"]],
    ["IT", ["00000", "99999"], ["1234", "123456"]],
    ["JP", ["0000000", "999-9999"], ["123456", "1234-567", "123 4567"]],
  ] as const)("checks fixed %s syntax without changing spelling", (countryCode, valid, invalid) => {
    for (const postalCode of valid) {
      expect(validatePostalAddress({ ...blank, countryCode, postalCode })).toEqual([]);
    }
    for (const postalCode of invalid) {
      expect(validatePostalAddress({ ...blank, countryCode, postalCode })).toHaveLength(1);
    }
  });
});

describe("seven-component vCard ADR", () => {
  it("round-trips literal semicolons, commas and backslashes in every field", () => {
    const address: PostalAddress = {
      street: ["12 Example\\Lane;East,West", "", "Annex, A;\\"],
      locality: "Fictional;Town,\\",
      region: "Fictional;Region,\\",
      postalCode: "Code;,\\",
      poBox: "Box;,\\",
      extended: "Suite;,\\",
      countryName: "Country;,\\",
    };
    const encoded = toVCardAdr(address);
    expect(encoded).toContain("12 Example\\\\Lane\\;East\\,West,,Annex\\, A\\;\\\\");
    expect(fromVCardAdr(encoded)).toEqual(address);
    expect(toVCardAdr(fromVCardAdr(encoded))).toBe(encoded);
  });

  it("preserves names verbatim, optional fields, leading zeroes and empty positions", () => {
    expect(toVCardAdr(blank)).toBe(";;;;;;");
    expect(fromVCardAdr(";;;;;;")).toEqual(blank);
    expect(fromVCardAdr(";;,;;;;").street).toEqual(["", ""]);
    expect(fromVCardAdr("Box;Suite;;Town;Region;00001;New Fictional Country")).toEqual({
      ...blank,
      poBox: "Box",
      extended: "Suite",
      locality: "Town",
      region: "Region",
      postalCode: "00001",
      countryName: "New Fictional Country",
    });
    for (const name of ["France", "united states", "USA", " 日本 "]) {
      expect(fromVCardAdr(`;;;;;;${name}`).countryName).toBe(name);
    }
  });

  it("interoperates with the existing vCard structured street list", () => {
    const encoded = toVCardAdr(sample);
    const card = parseVCards(
      `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Fictional Person\r\nEMAIL:fictional@example.org\r\nADR:${encoded}\r\nEND:VCARD\r\n`,
    )[0];
    expect(card?.addresses[0]?.value).toEqual({
      poBox: [""],
      extended: [""],
      street: [...sample.street],
      locality: [sample.locality],
      region: [sample.region],
      postalCode: [sample.postalCode],
      country: ["US"],
    });
    expect(parseVCards(serializeVCards([card as NonNullable<typeof card>]))).toEqual([card]);
  });

  it.each([
    "",
    "one;two",
    ";;;;;",
    ";;;;;;;",
    ";;street\\q;;;;",
    ";;;;;;country\\",
    ";;first\\nsecond;;;;",
    ";;first\\Nsecond;;;;",
    "a,b;;;;;;",
    ";a,b;;;;;",
    ";;;a,b;;;",
    ";;;;a,b;;",
    ";;;;;a,b;",
    ";;;;;;a,b",
  ])("rejects unsupported or malformed ADR %j", (value) => {
    rejects(() => fromVCardAdr(value), "INVALID_ADR");
  });

  it("rejects raw control characters instead of injecting display lines", () => {
    rejects(() => fromVCardAdr(";;one\ntwo;;;;"), "INVALID_ADDRESS");
    rejects(() => fromVCardAdr(";;one\r\ntwo;;;;"), "INVALID_ADDRESS");
    rejects(() => fromVCardAdr(42 as unknown as string), "INVALID_ADR");
  });
});

describe("typed structural and country errors", () => {
  it.each([
    "us",
    "Us",
    "ZZ",
    "UK",
    "XK",
    "SU",
    "USA",
    "",
    " US",
    "US ",
    "ＵＳ",
  ])("rejects non-assigned or non-uppercase countryCode %j on all consumers", (countryCode) => {
    const address = { ...blank, countryCode };
    for (const run of [
      () => validatePostalAddress(address),
      () => toVCardAdr(address),
      () => formatAddressMultiline(address, "US"),
      () => formatAddressSingleLine(address, "US"),
      () => formatAddressMultiline(sample, countryCode),
    ])
      rejects(run, "INVALID_COUNTRY");
  });

  it.each(["us", "Us", "ZZ", "UK", "XK"])("rejects a code-shaped ADR country %s", (code) => {
    rejects(() => fromVCardAdr(`;;;;;;${code}`), "INVALID_COUNTRY");
    rejects(() => toVCardAdr({ ...blank, countryName: code }), "INVALID_COUNTRY");
  });

  it("rejects conflicting country representations and wrong country types", () => {
    rejects(() => toVCardAdr({ ...sample, countryName: "United States" }), "INVALID_COUNTRY");
    rejects(
      () => validatePostalAddress({ ...blank, countryCode: 12 as unknown as string }),
      "INVALID_COUNTRY",
    );
    rejects(
      () => formatAddressMultiline(sample, undefined as unknown as string),
      "INVALID_COUNTRY",
    );
    rejects(
      () => formatAddressSingleLine(sample, "x".repeat(MAX_ADDRESS_COMPONENT_LENGTH + 1)),
      "ADDRESS_TOO_LARGE",
    );
  });

  it.each([
    null,
    undefined,
    1,
    "address",
    [],
    {},
    { ...blank, street: "line" },
    { ...blank, street: [1] },
    { ...blank, street: Array(1) },
    { ...blank, locality: undefined },
    { ...blank, region: null },
    { ...blank, postalCode: 12345 },
    { ...blank, poBox: 1 },
    { ...blank, extended: [] },
    { ...blank, countryName: true },
  ])("rejects invalid address shape %j", (value) => {
    rejects(() => validatePostalAddress(value as PostalAddress), "INVALID_ADDRESS");
  });

  it.each([
    "\n",
    "\r",
    "\t",
    "\u0000",
    "\u007f",
    "\u0085",
    "\u2028",
    "\u2029",
  ])("rejects embedded unsupported controls %j in any component", (control) => {
    for (const field of ["locality", "region", "postalCode", "poBox", "extended", "countryName"]) {
      rejects(() => toVCardAdr({ ...blank, [field]: `first${control}second` }), "INVALID_ADDRESS");
    }
    rejects(() => toVCardAdr({ ...blank, street: [`first${control}second`] }), "INVALID_ADDRESS");
  });

  it("does not echo caller input in error messages", () => {
    try {
      toVCardAdr({ ...blank, locality: "Private fictional address\n" });
    } catch (error) {
      expect(error).toBeInstanceOf(PostalAddressError);
      expect((error as Error).message).toBe("Postal address: INVALID_ADDRESS");
    }
  });
});

describe("exported postal bounds", () => {
  it("accepts eight street lines and rejects nine through structured and wire APIs", () => {
    expect(MAX_STREET_LINES).toBe(8);
    const street = Array.from({ length: MAX_STREET_LINES }, (_, i) => `Fictional Line ${i}`);
    const address = { ...blank, street };
    expect(fromVCardAdr(toVCardAdr(address))).toEqual(address);
    expect(formatAddressMultiline(address, "US").split("\n")).toEqual(street);
    rejects(() => toVCardAdr({ ...address, street: [...street, "ninth"] }), "ADDRESS_TOO_LARGE");
    rejects(() => fromVCardAdr(`;;${[...street, "ninth"].join(",")};;;;`), "ADDRESS_TOO_LARGE");
    // Even empty lines count; do not first filter an oversized array.
    rejects(
      () => toVCardAdr({ ...blank, street: Array(MAX_STREET_LINES + 1).fill("") }),
      "ADDRESS_TOO_LARGE",
    );
    rejects(() => fromVCardAdr(`;;${",".repeat(MAX_STREET_LINES)};;;;`), "ADDRESS_TOO_LARGE");
  });

  it("checks street array size before accessing any element", () => {
    const street = Array(MAX_STREET_LINES + 1);
    Object.defineProperty(street, "0", {
      get() {
        throw new Error("must not read an element");
      },
    });
    rejects(() => validatePostalAddress({ ...blank, street }), "ADDRESS_TOO_LARGE");
  });

  it.each([
    "street",
    "locality",
    "region",
    "postalCode",
    "poBox",
    "extended",
    "countryName",
  ])("accepts component %s at 256 and rejects 257 before display or escaping", (field) => {
    expect(MAX_ADDRESS_COMPONENT_LENGTH).toBe(256);
    const value = "\\".repeat(MAX_ADDRESS_COMPONENT_LENGTH);
    const address = { ...blank, [field]: field === "street" ? [value] : value };
    expect(fromVCardAdr(toVCardAdr(address))).toEqual(address);
    expect(formatAddressMultiline(address, "US")).toBe(value);
    expect(validatePostalAddress(address)).toEqual([]);
    const tooLarge = { ...blank, [field]: field === "street" ? [`${value}x`] : `${value}x` };
    for (const run of [
      () => toVCardAdr(tooLarge),
      () => formatAddressMultiline(tooLarge, "US"),
      () => validatePostalAddress(tooLarge),
    ]) {
      rejects(run, "ADDRESS_TOO_LARGE");
    }
    const components = ["", "", "", "", "", "", ""];
    components[
      ["poBox", "extended", "street", "locality", "region", "postalCode", "countryName"].indexOf(
        field,
      )
    ] = "x".repeat(MAX_ADDRESS_COMPONENT_LENGTH + 1);
    rejects(() => fromVCardAdr(components.join(";")), "ADDRESS_TOO_LARGE");
  });

  it("applies the component bound to a country code before country lookup", () => {
    rejects(
      () =>
        validatePostalAddress({
          ...blank,
          countryCode: "X".repeat(MAX_ADDRESS_COMPONENT_LENGTH + 1),
        }),
      "ADDRESS_TOO_LARGE",
    );
  });

  it("accepts the largest escaped ADR and rejects raw bound+1 before parsing", () => {
    const value = "\\".repeat(MAX_ADDRESS_COMPONENT_LENGTH);
    const address = {
      street: Array(MAX_STREET_LINES).fill(value),
      locality: value,
      region: value,
      postalCode: value,
      countryName: value,
      poBox: value,
      extended: value,
    };
    const encoded = toVCardAdr(address);
    expect(MAX_ADR_VALUE_LENGTH).toBe(7181);
    expect(encoded.length).toBe(MAX_ADR_VALUE_LENGTH);
    expect(fromVCardAdr(encoded)).toEqual(address);
    rejects(() => fromVCardAdr(`${encoded}x`), "ADDRESS_TOO_LARGE");
    // Would otherwise be INVALID_ADR at the very first character's escape.
    rejects(() => fromVCardAdr(`\\q${"x".repeat(MAX_ADR_VALUE_LENGTH - 1)}`), "ADDRESS_TOO_LARGE");
  });
});
