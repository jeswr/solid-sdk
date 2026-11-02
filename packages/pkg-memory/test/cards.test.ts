// AUTHORED-BY Claude Opus 5.5
import { DataFactory as df } from "n3";
import { describe, expect, it } from "vitest";
import {
  containsCardNumber,
  createFactAssertion,
  type Fact,
  findCardNumbers,
  PAYMENT_CARD_BRANDS,
} from "../src/index.js";
import { NS } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const owner = exampleBuildOptions().owner;
const CARD = "https://example.org/entities/card";
const BILLING = "https://example.org/entities/residence";

function card(value: Record<string, unknown>): Fact {
  return { template: "paymentCard", value } as unknown as Fact;
}

const valid = {
  id: CARD,
  brand: "visa",
  last4: "1111",
  expires: { value: "2027-09", datatype: "gYearMonth" },
  billingAddress: BILLING,
};

function naive(digits: string): boolean {
  for (let start = 0; start < digits.length; start += 1)
    for (let length = 12; length <= 19 && start + length <= digits.length; length += 1) {
      const window = digits.slice(start, start + length);
      if (!/^(?:4|5[1-5]|2[2-7]|3[0-9]|6)/.test(window)) continue;
      let sum = 0;
      for (let i = 0; i < window.length; i += 1) {
        let digit = Number(window[window.length - 1 - i]);
        if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
        sum += digit;
      }
      if (sum % 10 === 0) return true;
    }
  return false;
}

describe("payment-card fact template", () => {
  it("records brand, last four, expiry month and billing address only", () => {
    const store = createFactAssertion(owner, card(valid));
    const has = (s: string, p: string, o: string) =>
      store.has(df.quad(df.namedNode(s), df.namedNode(p), df.namedNode(o)));
    expect(has(owner, `${NS.schema}owns`, CARD)).toBe(true);
    expect(has(CARD, `${NS.rdf}type`, `${NS.schema}PaymentCard`)).toBe(true);
    expect(has(CARD, `${NS.schema}address`, BILLING)).toBe(true);
    const literals = store
      .getQuads(null, null, null, null)
      .flatMap(({ object }) => (object.termType === "Literal" ? [object.value] : []));
    expect(literals.sort()).toEqual(["1111", "2027-09", "last4", "visa"]);
    const expiry = store.getQuads(
      df.namedNode(CARD),
      df.namedNode(`${NS.schema}validThrough`),
      null,
      null,
    );
    expect(expiry[0]?.object).toMatchObject({ datatype: { value: `${NS.xsd}gYearMonth` } });
    const noAddress = createFactAssertion(owner, card({ ...valid, billingAddress: undefined }));
    expect(noAddress.getQuads(null, df.namedNode(`${NS.schema}address`), null, null)).toEqual([]);
    for (const brand of PAYMENT_CARD_BRANDS)
      expect(() => createFactAssertion(owner, card({ ...valid, brand }))).not.toThrow();
  });

  it.each([
    ["a full card number field", { ...valid, pan: "4111111111111111" }],
    ["a security code field", { ...valid, cvv: "123" }],
    ["a number field", { ...valid, number: "4111111111111111" }],
    ["five digits as last four", { ...valid, last4: "11111" }],
    ["a full number as last four", { ...valid, last4: "4111111111111111" }],
    ["non-ASCII digits as last four", { ...valid, last4: "١١١١" }],
    ["letters as last four", { ...valid, last4: "11a1" }],
    ["an unknown brand", { ...valid, brand: "4111111111111111" }],
    ["a day-precision expiry", { ...valid, expires: { value: "2027-09-01", datatype: "date" } }],
    ["an expiry with extra fields", { ...valid, expires: { ...valid.expires, cvv: "123" } }],
    [
      "an expiry carrying a number",
      { ...valid, expires: { value: "4111111111111111", datatype: "gYearMonth" } },
    ],
    ["a card number in the id", { ...valid, id: "https://example.org/cards/4111-1111-1111-1111" }],
    [
      "a card number in the address",
      { ...valid, billingAddress: "https://example.org/4111111111111111" },
    ],
    ["a non-string id", { ...valid, id: 4111111111111111 }],
    ["a non-string address", { ...valid, billingAddress: 4111111111111111 }],
    ["a missing value", undefined],
  ])("refuses %s without echoing it", (_label, value) => {
    let message = "";
    try {
      createFactAssertion(owner, card(value as Record<string, unknown>));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Invalid (payment card|temporal bound)$/);
    expect(message).not.toMatch(/\d{4}/);
  });
});

describe("card number detection", () => {
  it("finds cards in ASCII, Unicode digits and any separator", () => {
    for (const text of [
      "4111111111111111",
      "4111 1111 1111 1111 exp 09/28",
      "Contact 07524 455523, 4111 1111 1111 1111",
      "4111.1111.1111.1111",
      "4111 1111 1111—1111",
      "４１１１１１１１１１１１１１１１",
      "٤١١١١١١١١١١١١١١١",
      "𝟒𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏",
      "378282246310005",
      `${"0".repeat(70)}4111111111111111`,
    ])
      expect(containsCardNumber(text), text).toBe(true);
    for (const text of [
      "4111111111111112",
      "1111 1111 1111 1117",
      "phone 07700 900123",
      "",
      "4111 1111 x 1111 1111",
    ])
      expect(containsCardNumber(text), text).toBe(false);
  });

  it("reports UTF-16 spans that cover every card digit", () => {
    const text = "card 𝟒𝟏𝟏𝟏 𝟏𝟏𝟏𝟏 𝟏𝟏𝟏𝟏 𝟏𝟏𝟏𝟏 ok";
    const [span, ...rest] = findCardNumbers(text);
    expect(rest).toEqual([]);
    expect(text.slice(...(span as [number, number]))).toBe("𝟒𝟏𝟏𝟏 𝟏𝟏𝟏𝟏 𝟏𝟏𝟏𝟏 𝟏𝟏𝟏𝟏");
  });

  it("agrees with a naive scan of every window on random runs", () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 3000; n += 1) {
      const digits = Array.from({ length: 1 + Math.floor(random() * 40) }, () =>
        Math.floor(random() * 10),
      ).join("");
      expect(containsCardNumber(digits), digits).toBe(naive(digits));
    }
  });

  it("scans a large document in linear time", () => {
    const started = Date.now();
    findCardNumbers("4 ".repeat(500_000));
    findCardNumbers("٤".repeat(200_000));
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
