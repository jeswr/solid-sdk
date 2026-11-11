// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import type { Quad_Object, Store } from "n3";
import { DataFactory as df } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildNanopublications,
  containsCardNumber,
  createFactAssertion,
  type Fact,
  findCardNumbers,
  PAYMENT_CARD_BRANDS,
  parseNanopublications,
  redactCardNumbers,
  serializeNanopublications,
} from "../src/index.js";
import { NS } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const owner = exampleBuildOptions().owner;
const BILLING = "https://example.org/entities/residence";

function card(value: Record<string, unknown>): Fact {
  return { template: "paymentCard", value } as unknown as Fact;
}

const valid = {
  brand: "visa",
  last4: "1111",
  expires: { value: "2027-09", datatype: "gYearMonth" },
  billingAddress: BILLING,
};

function serialize(store: Store): string {
  return store
    .getQuads(null, null, null, null)
    .map(({ object }) => object.value)
    .join(" ");
}

function luhn(window: string): boolean {
  let sum = 0;
  for (let i = 0; i < window.length; i += 1) {
    let digit = Number(window[window.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

function naive(digits: string): boolean {
  for (let start = 0; start < digits.length; start += 1)
    for (let length = 13; length <= 19 && start + length <= digits.length; length += 1)
      if (/^[2-6]$/.test(digits[start] ?? "") && luhn(digits.slice(start, start + length)))
        return true;
  return false;
}

describe("payment-card fact template", () => {
  it("records brand, last four, expiry month and billing address only", () => {
    const store = createFactAssertion(owner, card(valid));
    const [owns, ...more] = store.getQuads(
      df.namedNode(owner),
      df.namedNode(`${NS.schema}owns`),
      null,
      null,
    );
    expect(more).toEqual([]);
    const node = owns?.object as Quad_Object;
    expect(node.termType).toBe("BlankNode");
    expect(
      store.has(
        df.quad(
          node as never,
          df.namedNode(`${NS.rdf}type`),
          df.namedNode(`${NS.schema}PaymentCard`),
        ),
      ),
    ).toBe(true);
    expect(
      store.has(df.quad(node as never, df.namedNode(`${NS.schema}address`), df.namedNode(BILLING))),
    ).toBe(true);
    const literals = store
      .getQuads(null, null, null, null)
      .flatMap(({ object }) => (object.termType === "Literal" ? [object.value] : []));
    expect(literals.sort()).toEqual(["1111", "2027-09", "last4", "visa"]);
    const expiry = store.getQuads(
      node as never,
      df.namedNode(`${NS.schema}validThrough`),
      null,
      null,
    );
    expect(expiry[0]?.object).toMatchObject({ datatype: { value: `${NS.xsd}gYearMonth` } });
    const noAddress = createFactAssertion(owner, card({ ...valid, billingAddress: undefined }));
    expect(noAddress.getQuads(null, df.namedNode(`${NS.schema}address`), null, null)).toEqual([]);
    for (const brand of PAYMENT_CARD_BRANDS)
      expect(() => createFactAssertion(owner, card({ ...valid, brand }))).not.toThrow();
    for (const address of [
      "https://example.org/entities/flat-12",
      "https://example.org/entities/1234",
      "urn:x:residence",
    ])
      expect(() =>
        createFactAssertion(owner, card({ ...valid, billingAddress: address })),
      ).not.toThrow();
  });

  it("ignores inherited fields, so a polluted prototype cannot supply one", () => {
    const { billingAddress: _omitted, ...withoutAddress } = valid;
    const polluted = Object.assign(
      Object.create({
        billingAddress: "https://example.org/polluted",
      }),
      withoutAddress,
    );
    const store = createFactAssertion(owner, card(polluted));
    expect(store.getQuads(null, df.namedNode(`${NS.schema}address`), null, null)).toEqual([]);
    const { brand: _brand, ...withoutBrand } = valid;
    expect(() =>
      createFactAssertion(
        owner,
        card(Object.assign(Object.create({ brand: "visa" }), withoutBrand)),
      ),
    ).toThrow("Invalid payment card");
    const expires = Object.assign(Object.create({ datatype: "gYearMonth" }), { value: "2027-09" });
    expect(() => createFactAssertion(owner, card({ ...valid, expires }))).toThrow(
      "Invalid payment card",
    );
  });

  it("never takes an absent billing address from a polluted Object.prototype", () => {
    // Non-enumerable, so for-in loops elsewhere are unaffected while property lookup still sees it.
    Object.defineProperty(Object.prototype, "billingAddress", {
      value: "https://example.org/polluted",
      configurable: true,
      enumerable: false,
      writable: true,
    });
    try {
      const { billingAddress: _omitted, ...withoutAddress } = valid;
      for (const value of [withoutAddress, { ...valid, billingAddress: undefined }]) {
        const store = createFactAssertion(owner, card(value));
        expect(store.getQuads(null, df.namedNode(`${NS.schema}address`), null, null)).toEqual([]);
      }
    } finally {
      delete (Object.prototype as Record<string, unknown>).billingAddress;
    }
  });

  it("validates brands against a frozen list", () => {
    expect(Object.isFrozen(PAYMENT_CARD_BRANDS)).toBe(true);
    expect(() => (PAYMENT_CARD_BRANDS as unknown as string[]).push("4111111111111111")).toThrow();
    expect(() => createFactAssertion(owner, card({ ...valid, brand: "4111111111111111" }))).toThrow(
      "Invalid payment card",
    );
  });

  it("reads each field once, so a getter or proxy cannot swap in a card number", () => {
    const pan = "4111111111111111";
    const swapping = (safe: string) => {
      let reads = 0;
      return { enumerable: true, get: () => (reads++ === 0 ? safe : pan) };
    };
    for (const [key, safe] of [
      ["brand", "visa"],
      ["last4", "1111"],
      ["billingAddress", BILLING],
    ] as const) {
      const value = Object.defineProperty({ ...valid }, key, swapping(safe));
      const store = createFactAssertion(owner, card(value));
      expect(serialize(store)).not.toContain("4111111111111111");
    }
    let reads = 0;
    const proxy = new Proxy(
      { ...valid },
      { get: (target, key) => (key === "last4" && reads++ > 0 ? pan : Reflect.get(target, key)) },
    );
    expect(serialize(createFactAssertion(owner, card(proxy)))).not.toContain(pan);
    let monthReads = 0;
    const expires = Object.defineProperty({ datatype: "gYearMonth" }, "value", {
      enumerable: true,
      get: () => (monthReads++ === 0 ? "2027-09" : pan),
    });
    expect(serialize(createFactAssertion(owner, card({ ...valid, expires })))).not.toContain(pan);
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
    ["a caller-chosen id", { ...valid, id: "https://example.org/cards/4111-1111-1111-1111" }],
    [
      "a card number in the address",
      { ...valid, billingAddress: "https://example.org/4111111111111111" },
    ],
    [
      "a truncated card number in the address",
      { ...valid, billingAddress: "https://example.org/a/453201511283" },
    ],
    [
      "seven digits split by letters",
      { ...valid, billingAddress: "https://example.org/4a5b3c2d0e1f5g" },
    ],
    [
      "URL-encoded separators",
      { ...valid, billingAddress: "https://example.org/4111%201111%201111%201111" },
    ],
    [
      "percent-encoded digits",
      { ...valid, billingAddress: "https://example.org/%34%31%31%31%31%31%31" },
    ],
    [
      "double-encoded digits",
      { ...valid, billingAddress: "https://example.org/%2534%2531%2531%2531%2531%2531%2531" },
    ],
    ["a broken escape", { ...valid, billingAddress: "https://example.org/%E0%A4%A" }],
    ["an encoded query", { ...valid, billingAddress: "https://example.org/a%3Fcvv=123" }],
    ["a query", { ...valid, billingAddress: "https://example.org/visa?cvv=123" }],
    ["a fragment", { ...valid, billingAddress: "https://example.org/visa#123" }],
    ["form-encoded spaces", { ...valid, billingAddress: "urn:x:4111+1111+1111+1111" }],
    ["circled digits", { ...valid, billingAddress: "urn:x:④①①①①①①" }],
    ["superscript digits", { ...valid, billingAddress: "urn:x:⁴¹¹¹¹¹¹" }],
    ["full-width digits", { ...valid, billingAddress: "urn:x:４１１１１１１" }],
    [
      "zero-width separators",
      { ...valid, billingAddress: "urn:x:4\u200b1\u200b1\u200b1\u200b1\u200b1\u200b1" },
    ],
    ["five digits in the address", { ...valid, billingAddress: "https://example.org/a/12345" }],
    [
      "a middle chunk of a card number",
      { ...valid, billingAddress: "https://example.org/a/111111" },
    ],
    [
      "a UUID address",
      { ...valid, billingAddress: "urn:uuid:aaaabbbb-cccc-dddd-eeee-ffffff001122" },
    ],
    ["a non-string address", { ...valid, billingAddress: 4111111111111111 }],
    ["a missing expiry", { ...valid, expires: undefined }],
    ["a null expiry", { ...valid, expires: null }],
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

describe("payment-card nanopublications", () => {
  it("build, serialise and parse with both card nodes skolemised", async () => {
    const built = await buildNanopublications(
      {
        batch_id: "cards",
        worker: { agent_id: "https://example.org/agents/test", agent_label: "Synthetic" },
        sources: [{ id: "doc", kind: "document", url: "https://example.org/document" }],
        claims: [
          {
            id: "card",
            epistemic: "SelfReportedExplicit",
            assertion: createFactAssertion(owner, card(valid)),
            evidence: [{ source: "doc", quote: "Visa ending 1111, expires 09/27." }],
          },
        ],
      },
      exampleBuildOptions(),
    );
    const trig = await serializeNanopublications(built);
    const parsed = await parseNanopublications(trig);
    const cards = [...parsed.dataset].filter((q) => q.object.value === `${NS.schema}PaymentCard`);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.subject.termType).toBe("NamedNode");
    const identifiers = [...parsed.dataset].filter(
      (q) => q.predicate.value === `${NS.schema}identifier`,
    );
    expect(identifiers.map((q) => q.object.termType)).toEqual(["NamedNode"]);
  });
});

describe("card number detection", () => {
  it("finds cards in ASCII, Unicode digits and design A separators", () => {
    for (const text of [
      "4111111111111111",
      "4111 1111 1111 1111 exp 09/28",
      "4111-1111-1111-1111",
      "Contact 07524 455523, 4111 1111 1111 1111",
      "4111 1111 1111—1111",
      "４１１１１１１１１１１１１１１１",
      "٤١١١١١١١١١١١١١١١",
      "𝟒𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏𝟏",
      "378282246310005",
      "5018000000000009",
      "5600000000000003",
      "④①①①①①①①①①①①①①①①",
      "⁴¹¹¹¹¹¹¹¹¹¹¹¹¹¹¹",
      "⒋⒈⒈⒈⒈⒈⒈⒈⒈⒈⒈⒈⒈⒈⒈⒈",
      "⑷⑴⑴⑴⑴⑴⑴⑴⑴⑴⑴⑴⑴⑴⑴⑴",
      `${"0".repeat(70)}4111111111111111`,
    ])
      expect(containsCardNumber(text), text).toBe(true);
    for (const text of [
      "0000 0000 0000 0000",
      "12345678901",
      "ⅣⅠⅠⅠ ⅣⅠⅠⅠ ⅣⅠⅠⅠ ⅣⅠⅠⅠ",
      "phone 07700 900123",
      '"4111","1111","1111","1111"',
      "4111.1111.1111.1111",
      "8100000000000002",
      "100000000000009",
      "4111+1111+1111+1111",
      "urn:card:4111:1111:1111:1111",
      "4111\u200b1111\u00ad1111\u200b1111",
      "4111·1111·1111·1111",
      "4111|1111|1111|1111",
      "(4111)1111-1111-1111",
      "4111'1111'1111'1111",
      "4111\u09031111\u09031111\u09031111",
      "4111\\1111\\1111\\1111",

      "",
      "4111 1111 x 1111 1111",
    ])
      expect(containsCardNumber(text), text).toBe(false);
  });

  it("covers every Luhn-valid window with a span, on random grouped runs", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 1500; n += 1) {
      let text = "";
      const at: number[] = [];
      for (let i = 0, length = 13 + Math.floor(random() * 30); i < length; i += 1) {
        if (random() < 0.2) text += [" ", "-", "\u00a0", "\u2009"][Math.floor(random() * 4)];
        at.push(text.length);
        text += String(Math.floor(random() * 10));
      }
      const digits = at.map((index) => text[index]).join("");
      const spans = findCardNumbers(text);
      for (let start = 0; start < digits.length; start += 1)
        for (let length = 13; length <= 19 && start + length <= digits.length; length += 1)
          if (/^[2-6]$/.test(digits[start] ?? "") && luhn(digits.slice(start, start + length))) {
            const from = at[start] as number;
            const to = (at[start + length - 1] as number) + 1;
            expect(
              spans.some(([a, b]) => a <= from && to <= b),
              text,
            ).toBe(true);
          }
    }
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

  it.each([
    "Call 07700 900123, 07700 900456 or 07700 900789.",
    "Meetings: 2026-11-11, 2026-11-12, 2026-11-13",
    "versions 1.2.3, 4.5.6, 7.8.9",
  ])("preserves ordinary prose: %s", (text) => {
    expect(redactCardNumbers(text)).toEqual({ text, count: 0 });
  });

  it("requires 13-19 digits and a leading digit in 2-6", () => {
    for (const first of "0123456789")
      for (const length of [12, 13, 14, 15, 16, 17, 18, 19]) {
        const body = first + "0".repeat(length - 2);
        const pan = Array.from({ length: 10 }, (_, digit) => body + digit).find(luhn) as string;
        expect(containsCardNumber(pan), pan).toBe(length >= 13 && /^[2-6]$/.test(first));
      }
  });

  it.each([
    "\t",
    "\n",
    "\r",
    "\u3000",
    "\u2011",
    "\u200b",
    "\u00ad",
    ".",
    ",",
    "_",
    "/",
    "·",
    "\u2027",
    "+",
    "=",
    "~",
    "|",
    "'",
    "\\",
    "\u0903",
  ])("ends digit runs at unsupported separator %j", (separator) => {
    const text = ["4111", "1111", "1111", "1111"].join(separator);
    expect(redactCardNumbers(text)).toEqual({ text, count: 0 });
  });

  it("scans a large document in linear time", () => {
    // CPU time, not wall time: a loaded CI runner stretches wall time but not the work done.
    // A quadratic scan of these inputs would take hours, so 8 s of CPU still separates the two.
    const started = process.cpuUsage();
    findCardNumbers("4 ".repeat(500_000));
    findCardNumbers("٤".repeat(200_000));
    const used = process.cpuUsage(started);
    expect((used.user + used.system) / 1000).toBeLessThan(8000);
  }, 60_000);
});

describe("shared Unicode card redaction", () => {
  const pan = "4111111111111111";
  const scripts = [0xff10, 0x0660, 0x0966, 0x1d7ce];
  const digits = (zero: number) =>
    [...pan].map((digit) => String.fromCodePoint(zero + Number(digit))).join("");
  it("maps every decimal script and mixed scripts back to original UTF-16 offsets", () => {
    for (const value of [
      ...scripts.map(digits),
      [...pan]
        .map((digit, i) =>
          String.fromCodePoint((scripts[i % scripts.length] as number) + Number(digit)),
        )
        .join(""),
    ]) {
      const prefix = "😀 owner 🧠 ";
      const text = `${prefix}${value} end 🎉`;
      expect(findCardNumbers(text)).toEqual([[prefix.length, prefix.length + value.length]]);
      expect(redactCardNumbers(text, "[hidden]")).toEqual({
        text: `${prefix}[hidden] end 🎉`,
        count: 1,
      });
    }
  });
  it.each([
    " ",
    "-",
    "\u00a0",
    "\u2009",
    "\u202f",
    "\u2013",
    "\u2014",
  ])("redacts Unicode grouping %j", (separator) => {
    const grouped = ["４１１１", "١١١١", "११११", "𝟏𝟏𝟏𝟏"].join(separator);
    expect(redactCardNumbers(`😀 ${grouped} done`)).toEqual({
      text: "😀 [card number removed] done",
      count: 1,
    });
  });
  it("merges overlapping and adjacent matches and preserves non-card numbers", () => {
    expect(redactCardNumbers(pan + pan)).toEqual({ text: "[card number removed]", count: 1 });
    expect(redactCardNumbers(`${pan} ${pan}`)).toEqual({ text: "[card number removed]", count: 1 });
    expect(redactCardNumbers(`${pan}x${pan}`)).toEqual({
      text: "[card number removed]x[card number removed]",
      count: 2,
    });
    expect(redactCardNumbers("000000000000000000000000000000")).toEqual({
      text: "000000000000000000000000000000",
      count: 0,
    });
    expect(redactCardNumbers("999999999999999999999999")).toEqual({
      text: "999999999999999999999999",
      count: 0,
    });
    expect(redactCardNumbers("6011000990139424123").text).toBe("[card number removed]");
  });
  it("finishes a 1 MiB digit run well below one second", () => {
    const text = "4".repeat(1024 * 1024);
    // Count CPU work so concurrent suite workers do not turn scheduler delays into failures.
    const started = process.cpuUsage();
    findCardNumbers(text);
    const used = process.cpuUsage(started);
    expect((used.user + used.system) / 1000).toBeLessThan(900);
  });
});

it("refuses decimal-script PANs in card template inputs without echoing digits", () => {
  for (const zero of [0xff10, 0x0660, 0x0966, 0x1d7ce]) {
    const pan = [..."4111111111111111"]
      .map((digit) => String.fromCodePoint(zero + Number(digit)))
      .join("");
    expect(containsCardNumber(pan)).toBe(true);
    for (const field of ["last4", "brand", "billingAddress"]) {
      try {
        createFactAssertion(
          owner,
          card({ ...valid, [field]: field === "billingAddress" ? `urn:x:${pan}` : pan }),
        );
        throw new Error("accepted PAN");
      } catch (error) {
        expect((error as Error).message).toBe("Invalid payment card");
        expect((error as Error).message).not.toContain(pan);
      }
    }
  }
});
