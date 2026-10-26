// AUTHORED-BY Codex GPT-6.1-Sol
import { domainToASCII as nativeASCII, domainToUnicode as nativeUnicode } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Address,
  AddressError,
  deduplicateAddresses,
  domainToASCII,
  domainToUnicode,
  formatAddressList,
  normaliseAddress,
  parseAddressList,
  type RecentRecipient,
  type Recipient,
  rankRecipients,
} from "../src/apps/mail/lib/address";

const mailbox = (email: string, name?: string): Address =>
  name === undefined ? { kind: "mailbox", email } : { kind: "mailbox", email, name };

function rejects(run: () => unknown, code?: AddressError["code"]) {
  expect(run).toThrow(AddressError);
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AddressError);
    expect((error as AddressError).name).toBe("AddressError");
    if (code !== undefined) expect((error as AddressError).code).toBe(code);
    expect((error as AddressError).message).toMatch(/^Cannot process addresses: [a-z-]+$/);
  }
}

describe("RFC 5322 address lists", () => {
  it("parses names, bare addresses, quoted pairs and groups without losing their boundaries", () => {
    expect(
      parseAddressList(
        'Mira Lane <mira@EXAMPLE.ORG>, "Vale, Theo" <theo@example.org>, Team: "Ivo \\"River\\"" <ivo@example.org>, noa@example.org;, Undisclosed:;',
      ),
    ).toEqual([
      mailbox("mira@example.org", "Mira Lane"),
      mailbox("theo@example.org", "Vale, Theo"),
      {
        kind: "group",
        name: "Team",
        members: [mailbox("ivo@example.org", 'Ivo "River"'), mailbox("noa@example.org")],
      },
      { kind: "group", name: "Undisclosed", members: [] },
    ]);
  });

  it("strips nested and escaped comments without creating display names or joining tokens", () => {
    expect(
      parseAddressList(
        "(outer (inner) \\) still comment) Mira (note) Lane < (x) mira (y) @ (z) example.org (q) > (end), team (note): (empty);",
      ),
    ).toEqual([
      mailbox("mira@example.org", "Mira Lane"),
      { kind: "group", name: "team", members: [] },
    ]);
    expect(parseAddressList("mira@example.org (Mira Lane)")).toEqual([mailbox("mira@example.org")]);
    expect(parseAddressList('"(literal), : ; < >" <mira@example.org>')).toEqual([
      mailbox("mira@example.org", "(literal), : ; < >"),
    ]);
  });

  it.each(["", " \t ", "(only (comments))"])("accepts an empty list: %j", (input) => {
    expect(parseAddressList(input)).toEqual([]);
  });

  it("supports folded whitespace, unnamed angle addresses and adjacent quoted phrase words", () => {
    expect(parseAddressList("Mira\r\n Lane\t<mira@example.org>, <noa@example.org>")).toEqual([
      mailbox("mira@example.org", "Mira Lane"),
      mailbox("noa@example.org"),
    ]);
    expect(parseAddressList('"Mira""Lane" <mira@example.org>')).toEqual([
      mailbox("mira@example.org", "Mira Lane"),
    ]);
  });

  it("preserves whitespace and escaped punctuation in quoted locals, including @", () => {
    expect(normaliseAddress('"a @ b"@Example.org')).toBe('"a @ b"@example.org');
    expect(normaliseAddress('"a\\\\b\\"c"@example.org')).toBe('"a\\\\b\\"c"@example.org');
    expect(normaliseAddress('"a\r\n \tb"@example.org')).toBe('"a \tb"@example.org');
    expect(normaliseAddress('""@example.org')).toBe('""@example.org');
    expect(normaliseAddress('"Mira.Lane"@EXAMPLE.ORG')).toBe("Mira.Lane@example.org");
    expect(normaliseAddress("mira+tag.lane@example.org")).toBe("mira+tag.lane@example.org");
  });

  it("preserves duplicates until deduplication is requested", () => {
    expect(parseAddressList("mira@example.org, mira@example.org")).toHaveLength(2);
  });

  it.each([
    "mira",
    "mira@",
    "@example.org",
    "mira@@example.org",
    "mira@example.org,",
    ",mira@example.org",
    "mira@example.org,,noa@example.org",
    "mira@example.org noa@example.org",
    "Mira <mira@example.org",
    "Mira <>",
    "<mira@example.org>>",
    "Mira (unclosed",
    "mira@example.org (trailing\\",
    '"unclosed',
    '"trailing\\',
    "Team:mira@example.org",
    "Team:mira@example.org,;",
    ":;",
    "Team:; extra",
    "mira@example.org;",
    '"":;',
    '"" <mira@example.org>',
    "Mira . Lane <mira@example.org>",
  ])("rejects malformed lists atomically: %j", (input) => {
    rejects(() => parseAddressList(input));
  });

  it.each([
    "a..b@example.org",
    "a.@example.org",
    "a. b@example.org",
    "a .b@example.org",
    "a(note).b@example.org",
    "a(note)b@example.org",
    '"a".b@example.org',
    "a@example .org",
    "a@example. org",
    "a@[192.0.2.1]",
    "a@[IPv6:2001:db8::1]",
    "<@example.org:a@example.org>",
    "Outer: Inner: a@example.org;;",
    "a\\b@example.org",
    "a@example.org)",
    "a@exa[mple.org",
    "mïra@example.org",
    '"mïra"@example.org',
    "=?UTF-8?Q?Mira?= <mira@example.org>",
  ])("fails closed for unsupported grammar: %j", (input) => {
    rejects(() => parseAddressList(input));
  });

  it.each([
    null,
    42,
    {},
    [],
    "a\nb@example.org",
    "a\rb@example.org",
    "a\r\nb@example.org",
    "a@example.org\r\nBcc: noa@example.org",
    "\0",
    "\u007f",
    "\u200d",
    "\u2028",
    "\ud800",
    " ".repeat(65_537),
  ])("rejects invalid text without leaking input", (input) => {
    rejects(() => parseAddressList(input as string), "invalid-input");
  });

  it("bounds comments and mailbox lengths", () => {
    expect(parseAddressList(`${"(".repeat(32)}x${")".repeat(32)}mira@example.org`)).toHaveLength(1);
    rejects(
      () => parseAddressList(`${"(".repeat(33)}x${")".repeat(33)}mira@example.org`),
      "unsupported-syntax",
    );
    expect(normaliseAddress(`${"a".repeat(64)}@example.org`)).toContain("@example.org");
    rejects(() => normaliseAddress(`${"a".repeat(65)}@example.org`), "invalid-recipient");
    rejects(
      () =>
        normaliseAddress(
          `${"a".repeat(64)}@${["b".repeat(63), "c".repeat(63), "d".repeat(63), "org"].join(".")}`,
        ),
      "invalid-recipient",
    );
    rejects(() => normaliseAddress("Mira <mira@example.org>"));
    rejects(() => normaliseAddress("mira@example.org, noa@example.org"));
  });
});

describe("IDN domain conversion", () => {
  it.each([
    "\u0301.example.org",
    "aא.example.org",
    "xn--0.example.org",
    "xn--999999999999.example.org",
    "xn--a-0hc.example.org",
    "xn--c0a.example.org",
    "xn--ib9b.example.org",
    "xn--en32g.example.org",
  ])("rejects malformed IDNA and punycode without hanging: %s", (input) => {
    rejects(() => domainToASCII(input), "invalid-domain");
  });
  it.each([
    "example.org",
    "BÜCHER.example.org",
    "bücher.example.org",
    "mañana.example.org",
    "例子.example.org",
    "παράδειγμα.example.org",
    "مثال.example.org",
    "faß.example.org",
    "éèêëēėę.example.org",
    "é中.example.org",
    "𐐀.example.org",
    "e\u0301.example.org",
    "xn--bcher-kva.example.org",
    "123",
    "127.1",
    "a".repeat(63),
  ])("matches the platform IDNA oracle for a synthetic domain: %s", (input) => {
    const ascii = domainToASCII(input);
    // Suffix keeps numeric domain labels out of WHATWG IPv4 parsing in both implementations.
    expect(`${ascii}.invalid`).toBe(nativeASCII(`${input}.invalid`));
    expect(`${domainToUnicode(input)}.invalid`).toBe(nativeUnicode(`${ascii}.invalid`));
    expect(domainToASCII(domainToUnicode(ascii))).toBe(ascii);
  });

  it.each([
    "",
    ".example.org",
    "example.org.",
    "a..example.org",
    "-a.example.org",
    "a-.example.org",
    "a_b.example.org",
    "example.org:443",
    "example.org/path",
    "example.org?x",
    "example.org#x",
    "%65xample.org",
    "a@example.org",
    "[192.0.2.1]",
    "a。example.org",
    "☃.example.org",
    "xn--n3h.example.org",
    "xn--a.example.org",
    "xn--invalid-.example.org",
    "a".repeat(64),
    ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(63)].join("."),
  ])("rejects invalid or unsupported domains: %j", (input) => {
    rejects(() => domainToASCII(input), "invalid-domain");
    rejects(() => domainToUnicode(input), "invalid-domain");
  });

  it("normalises IDN mailboxes in groups and Unicode display names", () => {
    expect(
      parseAddressList("Élo Lane <mira@bücher.example.org>, Amis: noa@例子.example.org;"),
    ).toEqual([
      mailbox("mira@xn--bcher-kva.example.org", "Élo Lane"),
      { kind: "group", name: "Amis", members: [mailbox("noa@xn--fsqu00a.example.org")] },
    ]);
  });
});

describe("formatting and deduplication", () => {
  it("formats and round-trips names, escapes, groups, empty groups and empty lists", () => {
    const input =
      'Mira Lane <mira@example.org>, "Lane, Noa" <noa@example.org>, "Team: friends": "Ivo \\"River\\"" <ivo@example.org>;, Empty:;';
    const parsed = parseAddressList(input);
    expect(formatAddressList(parsed)).toBe(input);
    expect(parseAddressList(formatAddressList(parsed))).toEqual(parsed);
    expect(formatAddressList([])).toBe("");
    const slash = [mailbox("a@example.org", "Mira\\Lane")];
    expect(parseAddressList(formatAddressList(slash))).toEqual(slash);
  });

  it("renders ASCII or Unicode domains without confusing an @ inside the local part", () => {
    const parsed = parseAddressList('Élo <"a@b"@bücher.example.org>');
    expect(formatAddressList(parsed)).toBe('"Élo" <"a@b"@xn--bcher-kva.example.org>');
    expect(formatAddressList(parsed, true)).toBe('"Élo" <"a@b"@bücher.example.org>');
    const group = parseAddressList("Équipe: mira@bücher.example.org;");
    expect(formatAddressList(group, true)).toBe('"Équipe": mira@bücher.example.org;');
    expect(formatAddressList([mailbox("mira@example.org")])).toBe("mira@example.org");
  });

  it("deduplicates across group boundaries, preserving first names, local case, tags and dots", () => {
    const input = parseAddressList(
      'Mira <"mira"@BÜCHER.example.org>, Team: Later <mira@xn--bcher-kva.example.org>, Mira@bücher.example.org, mira+tag@bücher.example.org;, mira.lane@bücher.example.org, Empty:;',
    );
    const snapshot = structuredClone(input);
    const unique = deduplicateAddresses(input);
    expect(formatAddressList(unique, true)).toBe(
      "Mira <mira@bücher.example.org>, Team: Mira@bücher.example.org, mira+tag@bücher.example.org;, mira.lane@bücher.example.org, Empty:;",
    );
    expect(input).toEqual(snapshot);
    expect(unique[0]).not.toBe(input[0]);
    expect(unique[1]).not.toBe(input[1]);
    expect(
      formatAddressList(
        deduplicateAddresses(
          parseAddressList("Team: mira@example.org;, mira@example.org, Again: mira@example.org;"),
        ),
      ),
    ).toBe("Team: mira@example.org;, Again:;");
    expect(deduplicateAddresses([])).toEqual([]);
  });

  it.each([
    null,
    {},
    [null],
    [{ kind: "unknown", email: "mira@example.org" }],
    [{ kind: "mailbox", email: "mira@example.org\r\nBcc: noa@example.org" }],
    [{ kind: "mailbox", email: "mira@example.org", name: "" }],
    [{ kind: "mailbox", email: "mira@example.org", name: 42 }],
    [{ kind: "mailbox", email: "mira@example.org", name: "Mira\nLane" }],
    [{ kind: "mailbox", email: "mira@example.org", name: "=?UTF-8?Q?Mira?=" }],
    [{ kind: "group", name: "Team", members: null }],
    [{ kind: "group", name: "Team", members: [{ kind: "group", name: "Nested", members: [] }] }],
    [{ kind: "group", name: "", members: [] }],
  ])("validates structured inputs for formatting and deduplication", (input) => {
    rejects(() => formatAddressList(input as Address[]));
    rejects(() => deduplicateAddresses(input as Address[]));
  });

  it("rejects an invalid output mode", () => {
    rejects(() => formatAddressList([], "unicode" as unknown as boolean));
  });

  it("rejects sparse arrays and cyclic groups with typed errors", () => {
    const sparse = Array<Address>(1);
    const cyclic = { kind: "group", name: "Team", members: [] } as unknown as Address & {
      members: Address[];
    };
    cyclic.members.push(cyclic);
    for (const list of [
      sparse,
      [cyclic],
      [{ kind: "group", name: "Team", members: sparse }] as Address[],
    ]) {
      rejects(() => formatAddressList(list));
      rejects(() => deduplicateAddresses(list));
    }
    rejects(() => rankRecipients("", Array<Recipient>(1), []));
    rejects(() => rankRecipients("", [], Array<RecentRecipient>(1)));
  });

  it("round-trips synthetic arbitrary quoted local parts and display names", () => {
    const safe = fc
      .array(fc.constantFrom("a", "Z", " ", "@", ".", ",", "\\", '"'), { maxLength: 20 })
      .map((chars) => chars.join(""));
    fc.assert(
      fc.property(
        safe,
        safe.filter((name) => name.length > 0),
        (local, name) => {
          const email = `"${local.replace(/["\\]/g, "\\$&")}"@example.org`;
          const list = [mailbox(email, name)];
          const formatted = formatAddressList(list);
          expect(parseAddressList(formatted)).toEqual([mailbox(normaliseAddress(email), name)]);
          expect(formatAddressList(parseAddressList(formatted))).toBe(formatted);
        },
      ),
      { numRuns: 200, seed: 5322 },
    );
  });
});

describe("recipient autocomplete", () => {
  it("merges contacts and usage, sums frequency, keeps latest usage and does not mutate inputs", () => {
    const contacts = Object.freeze([
      Object.freeze({ email: "mira@BÜCHER.example.org", name: "Mira Lane" }),
      Object.freeze({ email: "noa@example.org" }),
      Object.freeze({ email: "noa@example.org", name: "Noa Vale" }),
    ]);
    const recent = Object.freeze([
      Object.freeze({
        email: "mira@xn--bcher-kva.example.org",
        name: "Old Name",
        frequency: 2,
        lastUsed: 100,
      }),
      Object.freeze({ email: "mira@bücher.example.org", frequency: 3, lastUsed: 50 }),
      Object.freeze({ email: "ivo@example.org", frequency: 1, lastUsed: 0 }),
      Object.freeze({ email: "ivo@example.org", name: "Ivo Finch", frequency: 1, lastUsed: 10 }),
    ]);
    expect(rankRecipients("", contacts, recent)).toEqual([
      {
        ...mailbox("mira@xn--bcher-kva.example.org", "Mira Lane"),
        frequency: 5,
        lastUsed: 100,
        source: "both",
      },
      { ...mailbox("ivo@example.org", "Ivo Finch"), frequency: 2, lastUsed: 10, source: "recent" },
      {
        ...mailbox("noa@example.org", "Noa Vale"),
        frequency: 0,
        lastUsed: null,
        source: "contact",
      },
    ]);
    expect(rankRecipients("old", contacts, recent)[0]?.name).toBe("Mira Lane");
    expect(rankRecipients("noa va", contacts, recent)[0]?.name).toBe("Noa Vale");
  });

  it("filters by full name/address prefix, with Unicode/ASCII IDN forms and NFC/case folding", () => {
    const contacts = [{ email: "mira@bücher.example.org", name: "Élo Lane" }];
    for (const prefix of [" MIRA@BÜ ", "mira@xn--", "E\u0301LO", "élo l"]) {
      expect(rankRecipients(prefix, contacts, [])).toHaveLength(1);
    }
    for (const prefix of ["lane", "bücher", "ira", "elo", "missing"]) {
      expect(rankRecipients(prefix, contacts, [])).toEqual([]);
    }
    expect(rankRecipients("", [], [])).toEqual([]);
  });

  it("ranks frequency, then recency, then canonical address, with explicit limits", () => {
    const recent = [
      { email: "z@example.org", frequency: 4, lastUsed: 0 },
      { email: "a@example.org", frequency: 1, lastUsed: 100 },
      { email: "b@example.org", frequency: 1, lastUsed: 100 },
      { email: "c@example.org", frequency: 1, lastUsed: 200 },
    ];
    const contacts = [{ email: "e@example.org" }, { email: "d@example.org" }];
    expect(rankRecipients("", contacts, recent).map((entry) => entry.email)).toEqual([
      "z@example.org",
      "c@example.org",
      "a@example.org",
      "b@example.org",
      "d@example.org",
      "e@example.org",
    ]);
    expect(rankRecipients("", contacts, recent, 2)).toHaveLength(2);
    expect(rankRecipients("", contacts, recent, 0)).toEqual([]);
    expect(
      rankRecipients(
        "",
        Array.from({ length: 12 }, (_, i) => ({ email: `person${i}@example.org` })),
        [],
      ),
    ).toHaveLength(10);
    expect(
      rankRecipients("", [{ email: "Mira@example.org" }, { email: "mira@example.org" }], []),
    ).toHaveLength(2);
  });

  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "2",
  ])("rejects invalid frequency %j", (frequency) => {
    rejects(
      () =>
        rankRecipients(
          "",
          [],
          [{ email: "mira@example.org", frequency, lastUsed: 0 } as RecentRecipient],
        ),
      "invalid-recipient",
    );
  });

  it.each([
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "2",
  ])("rejects invalid last-used %j", (lastUsed) => {
    rejects(
      () =>
        rankRecipients(
          "",
          [],
          [{ email: "mira@example.org", frequency: 1, lastUsed } as RecentRecipient],
        ),
      "invalid-recipient",
    );
  });

  it.each([-1, 1.5, NaN, Infinity, "10"])("rejects invalid limit %j", (limit) => {
    rejects(() => rankRecipients("", [], [], limit as number));
  });

  it("validates all candidates, queries and lists before filtering or limiting", () => {
    rejects(() => rankRecipients(null as unknown as string, [], []));
    rejects(() => rankRecipients("\n", [], []));
    rejects(() => rankRecipients("", null as unknown as Recipient[], []));
    rejects(() => rankRecipients("", [], null as unknown as RecentRecipient[]));
    rejects(() => rankRecipients("unmatched", [{ email: "bad" }], [], 0));
    rejects(() => rankRecipients("", [null as unknown as Recipient], []));
    rejects(() => rankRecipients("", [], [null as unknown as RecentRecipient]));
    rejects(
      () =>
        rankRecipients(
          "",
          [],
          [
            { email: "mira@example.org", frequency: Number.MAX_SAFE_INTEGER, lastUsed: 0 },
            { email: "mira@example.org", frequency: 1, lastUsed: 0 },
          ],
        ),
      "invalid-recipient",
    );
  });
});
