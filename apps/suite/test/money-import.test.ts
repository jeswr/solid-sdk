// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type CategoryRule,
  type CsvOptions,
  categoriseTransactions,
  compareAmounts,
  detectDuplicates,
  type ImportedTransaction,
  importCsv,
  importOfx,
  parseAmount,
  parseCsv,
  parseDate,
  sniffDateFormat,
  sniffDelimiter,
  transactionHash,
} from "../src/apps/money/lib/import";
import {
  csvStatement,
  qfxStatement,
  sgmlStatement,
  xmlStatement,
} from "./fixtures/money-statements";

const transaction: ImportedTransaction = Object.freeze({
  date: "2026-10-24",
  amount: "-12.5",
  description: "Example Market, North",
});
const csvOptions: CsvOptions = {
  columns: { date: "Date", description: "Payee", amount: "Amount", currency: "Currency" },
};
const xml = (body: string) => `<OFX>${body}</OFX>`;
const record = (body: string) => xml(`<STMTTRN>${body}</STMTTRN>`);
const fields =
  "<DTPOSTED>20261024</DTPOSTED><TRNAMT>-12.50</TRNAMT><NAME>Example Market, North</NAME>";

describe("dates and exact decimal amounts", () => {
  it.each([
    ["2024-2-29", "YYYY-MM-DD", "2024-02-29"],
    ["0001/01/01", "YYYY-MM-DD", "0001-01-01"],
    [" 31/12/2026 ", "DD/MM/YYYY", "2026-12-31"],
    ["12.31.2026", "MM/DD/YYYY", "2026-12-31"],
  ] as const)("parses %s as %s", (input, format, expected) =>
    expect(parseDate(input, format)).toBe(expected));
  it.each([
    "",
    "not a date",
    "2026-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "2026-01-32",
    "0000-01-01",
    "26-01-01",
    "2026/01-01",
    "2026-01-01T00:00Z",
  ])("rejects date %s", (input) => expect(() => parseDate(input, "YYYY-MM-DD")).toThrow());
  it("sniffs only a single format valid for every row", () => {
    expect(sniffDateFormat(["2026-10-24", "2026/10/25"])).toBe("YYYY-MM-DD");
    expect(sniffDateFormat(["24/10/2026", "01/02/2026"])).toBe("DD/MM/YYYY");
    expect(sniffDateFormat(["10/24/2026"])).toBe("MM/DD/YYYY");
    for (const dates of [[], ["01/02/2026"], ["invalid"], ["24/10/2026", "10/25/2026"]])
      expect(sniffDateFormat(dates)).toBeNull();
  });
  it.each([
    [" -001,234.5000 ", ".", "-1234.5"],
    ["+000.00", ".", "0"],
    ["-0", ".", "0"],
    ["(12.50)", ".", "-12.5"],
    ["1.234,50", ",", "1234.5"],
    ["(0,50)", ",", "-0.5"],
    ["9007199254740993.000000001", ".", "9007199254740993.000000001"],
  ] as const)("normalises %s exactly", (input, separator, output) =>
    expect(parseAmount(input, separator)).toBe(output));
  it.each([
    "",
    "NaN",
    "Infinity",
    "1e3",
    "$10",
    "1,23",
    "1.2.3",
    "--1",
    "(+1)",
    ".5",
    "1.",
    "1_234",
  ])("rejects amount %s", (input) => expect(() => parseAmount(input)).toThrow());
  it.each([
    ["1", "1.00", 0],
    ["-1", "0", -1],
    ["0", "-1", 1],
    ["2", "10", -1],
    ["10", "2", 1],
    ["1.01", "1.1", -1],
    ["1.2", "1.11", 1],
    ["-2", "-10", 1],
    ["-10", "-2", -1],
    ["9007199254740993", "9007199254740992", 1],
    ["0.0000000000001", "0", 1],
  ] as const)("compares %s and %s", (a, b, result) => expect(compareAmounts(a, b)).toBe(result));
});

describe("CSV parsing, sniffing and mapping", () => {
  it("parses quoting, embedded delimiters/newlines, BOM, blank lines and trailing cells", () => {
    expect(parseCsv('\uFEFFa,b,c\r\n"one, two","three\nlines","a""b"\r\n\r\nx,y,\rz,w,')).toEqual([
      ["a", "b", "c"],
      ["one, two", "three\nlines", 'a"b'],
      ["x", "y", ""],
      ["z", "w", ""],
    ]);
    expect(parseCsv("\n \n")).toEqual([]);
    expect(parseCsv('"",x')).toEqual([["", "x"]]);
  });
  it.each([
    'a,"unterminated',
    'a,b"c',
    'a,"b"x',
    '"a""',
  ])("rejects malformed quoting: %s", (input) => expect(() => parseCsv(input)).toThrow());
  it.each([",", ";", "\t", "|"] as const)("sniffs %j outside quotes", (delimiter) => {
    expect(
      sniffDelimiter(
        `Date${delimiter}Name${delimiter}Amount\n2026-10-24${delimiter}"Example,;| Market"${delimiter}1`,
      ),
    ).toBe(delimiter);
  });
  it.each([
    "",
    "single",
    "a,b;c\nx,y;z",
    "a,b\nx,y,z",
    'a,"unfinished',
  ])("requires an explicit delimiter for %s", (input) =>
    expect(() => sniffDelimiter(input)).toThrow());
  it("imports a synthetic statement as plain objects", () => {
    expect(importCsv(csvStatement, csvOptions)).toEqual([
      { ...transaction, currency: "GBP" },
      {
        date: "2026-10-25",
        description: 'Morgan Example "refund"',
        amount: "2.5",
        currency: "GBP",
      },
    ]);
  });
  it("supports numeric mappings and headerless exports", () => {
    expect(
      importCsv("24/10/2026;Market;1.234,50", {
        columns: { date: 0, description: 1, amount: 2 },
        hasHeader: false,
        delimiter: ";",
        decimalSeparator: ",",
        currency: "EUR",
      }),
    ).toEqual([{ date: "2026-10-24", description: "Market", amount: "1234.5", currency: "EUR" }]);
    expect(
      importCsv("Date,Payee,Amount\n01/02/2026,Market,0", {
        columns: { date: 0, description: 1, amount: 2 },
        dateFormat: "MM/DD/YYYY",
      }),
    ).toEqual([{ date: "2026-01-02", description: "Market", amount: "0" }]);
  });
  it("maps unsigned debit/credit columns, including a single direction", () => {
    const options: CsvOptions = { columns: { date: 0, description: 1, debit: 2, credit: 3 } };
    expect(
      importCsv(
        "date,name,out,in\n2026-10-24,Market,12.50,\n2026-10-25,Refund,,2\n2026-10-26,Zero,0,",
        options,
      ).map((t) => t.amount),
    ).toEqual(["-12.5", "2", "0"]);
    expect(
      importCsv("d,n,c\n2026-10-24,Income,1", {
        columns: { date: 0, description: 1, credit: 2 },
      })[0]?.amount,
    ).toBe("1");
    expect(
      importCsv("d,n,c\n2026-10-24,Debit,1", { columns: { date: 0, description: 1, debit: 2 } })[0]
        ?.amount,
    ).toBe("-1");
  });
  it("returns empty data with an explicit delimiter or header-only file", () => {
    expect(importCsv("", { ...csvOptions, delimiter: "," })).toEqual([]);
    expect(importCsv("Date,Payee,Amount,Currency", csvOptions)).toEqual([]);
    expect(
      importCsv("Date,Payee,Amount,Currency\n2026-10-24,Market,1,", csvOptions)[0],
    ).not.toHaveProperty("currency");
  });
  it.each([
    { date: "Missing", description: 1, amount: 2 },
    { date: -1, description: 1, amount: 2 },
    { date: 0.5, description: 1, amount: 2 },
    { date: 10, description: 1, amount: 2 },
    { date: 0, description: 1 },
    { date: 0, description: 1, amount: 2, debit: 2 },
    { date: 0, description: 1, amount: 2, credit: 2 },
  ])("rejects invalid column mappings %#", (columns) =>
    expect(() => importCsv(csvStatement, { columns })).toThrow());
  it("rejects duplicate header names and named headerless mappings", () => {
    expect(() =>
      importCsv("Date,Date,Amount\n2026-10-24,Market,1", {
        columns: { date: "Date", description: 1, amount: 2 },
      }),
    ).toThrow();
    expect(() => importCsv(csvStatement, { ...csvOptions, hasHeader: false })).toThrow();
  });
  it("rejects inconsistent widths even when the delimiter is explicit", () => {
    expect(() =>
      importCsv("Date,Payee,Amount,Currency\n2026-10-24,Market,1", {
        ...csvOptions,
        delimiter: ",",
      }),
    ).toThrow("Inconsistent CSV row width");
    expect(() => importCsv("Date,Payee,Amount,Currency\n,,,", csvOptions)).toThrow(
      "Choose a CSV date format",
    );
  });
  it.each([
    "01/02/2026,Market,1",
    "2026-10-24,Market",
    "2026-10-24,,1",
    "2026-10-24,Market,NaN",
    "2026-02-30,Market,1",
  ])("rejects invalid or ambiguous rows: %s", (row) =>
    expect(() =>
      importCsv(`Date,Payee,Amount\n${row}`, { columns: { date: 0, description: 1, amount: 2 } }),
    ).toThrow());
  it.each(["1,2", ",", "-1,", ",-2"])("rejects invalid debit/credit rows: %s", (amounts) =>
    expect(() =>
      importCsv(`d,n,out,in\n2026-10-24,Market,${amounts}`, {
        columns: { date: 0, description: 1, debit: 2, credit: 3 },
      }),
    ).toThrow());
  it("imports 100 synthetic rows in order", () => {
    const rows = Array.from(
      { length: 100 },
      (_, i) => `2026-10-24,Example merchant ${i},-${i}.25`,
    ).join("\n");
    const result = importCsv(`date,name,amount\n${rows}`, {
      columns: { date: 0, description: 1, amount: 2 },
    });
    expect(result).toHaveLength(100);
    expect(result[99]).toEqual({
      date: "2026-10-24",
      description: "Example merchant 99",
      amount: "-99.25",
    });
  });
});

describe("OFX/QFX SGML and XML", () => {
  it.each([
    ["-12,500", "-12.5"],
    ["+0012,5000", "12.5"],
    ["-0,000", "0"],
    ["1234.50", "1234.5"],
    ["9007199254740993,000000001", "9007199254740993.000000001"],
  ])("parses OFX decimal %s exactly in XML and SGML", (input, amount) => {
    expect(importOfx(record(fields.replace("-12.50", input)))).toEqual([
      { ...transaction, amount },
    ]);
    expect(importOfx(sgmlStatement.replace("-12.50", input))[0]?.amount).toBe(amount);
  });
  it.each([
    "1,234.50",
    "1.234,50",
    "1,234,567",
    "1.234.567",
    "1 234",
    "(12.50)",
    "$12",
    "1e3",
  ])("rejects grouping and non-OFX numeric syntax: %s", (input) => {
    expect(() => importOfx(record(fields.replace("-12.50", input)))).toThrow("Invalid OFX amount");
    expect(() => importOfx(sgmlStatement.replace("-12.50", input))).toThrow("Invalid OFX amount");
  });
  it.each([
    "<CURRENCY><CURRATE>1.25</CURRATE><CURSYM>USD</CURSYM></CURRENCY>",
    "<CURRENCY/>",
  ])("rejects transaction currency overrides atomically: %s", (override) => {
    const body = `<STMTRS><CURDEF>GBP</CURDEF><BANKTRANLIST><STMTTRN>${fields}</STMTTRN><STMTTRN>${fields}${override}</STMTTRN></BANKTRANLIST></STMTRS>`;
    expect(() => importOfx(xml(body))).toThrow(
      "OFX transaction currency overrides are unsupported",
    );
  });
  it("rejects SGML currency overrides", () => {
    const source = sgmlStatement.replace(
      "</STMTTRN>",
      "<CURRENCY><CURRATE>1.25<CURSYM>USD</CURRENCY></STMTTRN>",
    );
    expect(() => importOfx(source)).toThrow("OFX transaction currency overrides are unsupported");
  });
  it("keeps statement currency for amounts already converted from ORIGCURRENCY", () => {
    const original = "<ORIGCURRENCY><CURRATE>0.8</CURRATE><CURSYM>USD</CURSYM></ORIGCURRENCY>";
    expect(
      importOfx(
        xml(`<STMTRS><CURDEF>GBP</CURDEF><STMTTRN>${fields}${original}</STMTTRN></STMTRS>`),
      ),
    ).toEqual([{ ...transaction, currency: "GBP" }]);
    expect(
      importOfx(
        sgmlStatement.replace(
          "</STMTTRN>",
          "<ORIGCURRENCY><CURRATE>0.8<CURSYM>USD</ORIGCURRENCY></STMTTRN>",
        ),
      )[0]?.currency,
    ).toBe("GBP");
  });
  it.each([
    "<CORRECTFITID>example-original</CORRECTFITID><CORRECTACTION>REPLACE</CORRECTACTION>",
    "<CORRECTFITID>example-original</CORRECTFITID><CORRECTACTION>DELETE</CORRECTACTION>",
    "<CORRECTFITID/>",
    "<CORRECTACTION/>",
  ])("rejects correction records atomically, including incomplete metadata: %s", (correction) => {
    const original = `<STMTTRN>${fields}<FITID>example-original</FITID></STMTTRN>`;
    const replacement = fields.replace("-12.50", "-20.00");
    expect(() =>
      importOfx(xml(`${original}<STMTTRN>${replacement}${correction}</STMTTRN>`)),
    ).toThrow("OFX transaction corrections are unsupported");
  });
  it.each(["REPLACE", "DELETE"])("rejects SGML %s corrections", (action) => {
    const source = sgmlStatement.replace(
      "<FITID>example-2",
      `<FITID>example-2<CORRECTFITID>example-1<CORRECTACTION>${action}`,
    );
    expect(() => importOfx(source)).toThrow("OFX transaction corrections are unsupported");
  });
  it("accepts QFX institution extension tags with implicit and explicit closing tags", () => {
    expect(importOfx(qfxStatement)).toEqual(importOfx(sgmlStatement));
    expect(
      importOfx(qfxStatement.replace("<INTU.BID>000001", "<INTU.BID>000001</INTU.BID>")),
    ).toEqual(importOfx(sgmlStatement));
  });
  it("imports SGML implicit leaf endings and bank metadata", () => {
    expect(importOfx(sgmlStatement)).toEqual([
      {
        ...transaction,
        currency: "GBP",
        accountId: "EXAMPLE-001",
        externalId: "example-1",
        memo: "Receipt at https://example.org/receipt/1",
      },
      {
        date: "2026-10-25",
        amount: "2.5",
        description: "Morgan Example & Co",
        currency: "GBP",
        accountId: "EXAMPLE-001",
        externalId: "example-2",
      },
    ]);
  });
  it("imports XML QFX credit-card data, CDATA and entities", () => {
    expect(importOfx(xmlStatement)).toEqual([
      {
        date: "2026-10-24",
        amount: "-8.75",
        description: "Example <Cafe>",
        currency: "USD",
        accountId: "EXAMPLE-CARD",
        externalId: "qfx-1",
        memo: "https://example.org/?receipt=1&copy=2",
      },
    ]);
  });
  it("supports XML attributes, self-closing elements, memo-only descriptions and numeric entities", () => {
    expect(
      importOfx(
        record(
          "<DTPOSTED>20261024</DTPOSTED><TRNAMT>0</TRNAMT><NAME/><MEMO>Example &quot;Cafe&quot; &apos;x&apos; &gt; &#65; &#x1F34E;</MEMO>",
        ),
      )[0],
    ).toEqual({
      date: "2026-10-24",
      amount: "0",
      description: "Example \"Cafe\" 'x' > A 🍎",
      memo: "Example \"Cafe\" 'x' > A 🍎",
    });
    expect(importOfx("<OFX version=\"2\"><EMPTY foo='bar'/></OFX>")).toEqual([]);
    expect(importOfx(record(fields))).toEqual([transaction]);
  });
  it("keeps currencies and account identifiers local to their statements", () => {
    const body = `<STMTRS><CURDEF>GBP</CURDEF><BANKACCTFROM><ACCTID>EXAMPLE-1</ACCTID></BANKACCTFROM><STMTTRN>${fields}</STMTTRN></STMTRS>`;
    expect(importOfx(xml(`${body}<CCSTMTRS><STMTTRN>${fields}</STMTTRN></CCSTMTRS>`))[1]).toEqual(
      transaction,
    );
    expect(
      importOfx(xml(`<STMTRS><BANKACCTFROM/><STMTTRN>${fields}</STMTTRN></STMTRS>`))[0],
    ).toEqual(transaction);
  });
  it("handles empty SGML leaves and explicitly closed SGML fields", () => {
    const source = `OFXHEADER:100\n<OFX><STMTTRN><DTPOSTED>20261024</DTPOSTED><TRNAMT>1<NAME><MEMO>Example</STMTTRN></OFX>`;
    expect(importOfx(source)[0]?.description).toBe("Example");
  });
  it.each([
    "",
    "not OFX",
    "<!DOCTYPE OFX><OFX/>",
    '<!ENTITY x SYSTEM "https://example.org/secret"><OFX/>',
    "<OFX><",
    "<OFX><garbage",
    "<OFX>",
    "<OFX></WRONG>",
    "<OFX></OFX></OFX>",
    "<OFX></OFX><OFX></OFX>",
    "<OFX></OFX>outside",
    "<OFX></OFX><![CDATA[outside]]>",
    "<OFX><!BAD></OFX>",
    "<OFX></OFX bad>",
    "<OFX><X></OFX>",
  ])("rejects invalid or unsafe markup: %s", (source) => expect(() => importOfx(source)).toThrow());
  it.each([
    "&unknown;",
    "&constructor;",
    "&#0;",
    "&#xD800;",
    "&#1114112;",
    "&#xZZ;",
  ])("rejects unsupported entities: %s", (entity) =>
    expect(() => importOfx(record(fields.replace("Example Market, North", entity)))).toThrow());
  it.each([
    fields.replace("20261024", "20260230"),
    fields.replace("20261024", "2026-10-24"),
    fields.replace("-12.50", "NaN"),
    fields.replace("Example Market, North", ""),
    fields.replace("<TRNAMT>-12.50</TRNAMT>", ""),
    fields.replace("<DTPOSTED>20261024</DTPOSTED>", ""),
    `${fields}<NAME>Duplicate</NAME>`,
    fields.replace("Example Market, North", "<X>Nested</X>"),
  ])("rejects invalid transaction fields %#", (body) =>
    expect(() => importOfx(record(body))).toThrow());
});

describe("duplicate candidates", () => {
  it("canonicalises date, amount, Unicode, whitespace and case", () => {
    expect(transactionHash(transaction)).toMatch(/^[\da-f]{8}$/);
    expect(
      transactionHash({
        ...transaction,
        date: "2026/10/24",
        amount: "-012.500",
        description: "  ＥXAMPLE Market,\n North  ",
      }),
    ).toBe(transactionHash(transaction));
    for (const change of [
      { date: "2026-10-25" },
      { amount: "12.5" },
      { description: "Other market" },
    ])
      expect(transactionHash({ ...transaction, ...change })).not.toBe(transactionHash(transaction));
  });
  it("detects duplicates within and across statements without changing the inputs", () => {
    const another = { ...transaction, description: "Another market" };
    const incoming = Object.freeze([transaction, another, { ...another, amount: "-12.50" }]);
    expect(detectDuplicates(incoming, [transaction])).toEqual({
      unique: [another],
      duplicates: [transaction, { ...another, amount: "-12.50" }],
    });
    expect(detectDuplicates([transaction, transaction])).toEqual({
      unique: [transaction],
      duplicates: [transaction],
    });
    expect(detectDuplicates([])).toEqual({ unique: [], duplicates: [] });
    expect(incoming).toHaveLength(3);
  });
  it("does not discard distinct tuples with an FNV hash collision", () => {
    // Fixed synthetic collision, generated deterministically against the public hash.
    const first = { ...transaction, description: "example merchant 3954503238" };
    const second = { ...transaction, description: "example merchant 3265592378" };
    expect(transactionHash(first)).toBe(transactionHash(second));
    expect(detectDuplicates([first, second]).unique).toHaveLength(2);
  });
});

describe("literal categorisation rules", () => {
  it.each([
    ["contains", "market"],
    ["equals", "example market, north"],
    ["startsWith", "example"],
    ["endsWith", "north"],
  ] as const)("matches %s ignoring case by default", (match, value) => {
    expect(
      categoriseTransactions(
        [transaction],
        [{ category: "Groceries", description: { match, value } }],
      )[0]?.category,
    ).toBe("Groceries");
  });
  it("treats regular expression characters as literal text and supports case sensitivity", () => {
    expect(
      categoriseTransactions(
        [transaction],
        [{ category: "No", description: { match: "contains", value: ".*" } }],
      )[0],
    ).toEqual(transaction);
    const rule: CategoryRule = {
      category: "Food",
      description: { match: "contains", value: "Market", caseSensitive: true },
    };
    expect(categoriseTransactions([transaction], [rule])[0]?.category).toBe("Food");
    expect(
      categoriseTransactions(
        [transaction],
        [
          {
            ...rule,
            description: { match: "equals", value: "EXAMPLE MARKET, NORTH", caseSensitive: true },
          },
        ],
      )[0],
    ).toEqual(transaction);
  });
  it("ANDs description and inclusive signed amount bounds with first match winning", () => {
    const rules: CategoryRule[] = [
      { category: "Wrong name", description: { match: "contains", value: "absent" } },
      { category: "Too low", amount: { max: "-13" } },
      { category: "Too high", amount: { min: "-12" } },
      {
        category: "Food",
        description: { match: "contains", value: "Market" },
        amount: { min: "-12.50", max: "-12.50" },
      },
      { category: "Later", amount: { max: "0" } },
    ];
    expect(categoriseTransactions([transaction], rules)[0]?.category).toBe("Food");
    expect(
      categoriseTransactions([transaction], [{ category: "Out", amount: { max: "0" } }])[0]
        ?.category,
    ).toBe("Out");
    expect(
      categoriseTransactions(
        [{ ...transaction, amount: "9007199254740993" }],
        [{ category: "Large", amount: { min: "9007199254740993" } }],
      )[0]?.category,
    ).toBe("Large");
  });
  it("preserves existing categories and produces new plain objects without mutation", () => {
    const existing = Object.freeze({ ...transaction, category: "Existing" });
    const input = Object.freeze([existing, transaction]);
    const rules = Object.freeze([{ category: "New", amount: { max: "0" } }]);
    expect(categoriseTransactions(input, rules).map((t) => t.category)).toEqual([
      "Existing",
      "New",
    ]);
    expect(categoriseTransactions([transaction], [])[0]).not.toBe(transaction);
    expect(transaction).not.toHaveProperty("category");
  });
  it.each([
    { category: "", amount: { min: "0" } },
    { category: "Empty" },
    { category: "Empty", description: { match: "contains", value: "" } },
    { category: "Empty", amount: {} },
    { category: "Invalid", amount: { min: "NaN" } },
    { category: "Invalid", amount: { max: "Infinity" } },
    { category: "Reversed", amount: { min: "1", max: "-1" } },
  ] satisfies CategoryRule[])("rejects invalid rules even with no input %#", (rule) =>
    expect(() => categoriseTransactions([], [rule])).toThrow());
  it("composes import, duplicate review and categorisation", () => {
    const fromCsv = importCsv(csvStatement, csvOptions);
    const fromOfx = importOfx(sgmlStatement);
    const result = detectDuplicates(fromCsv, fromOfx);
    expect(result.duplicates).toHaveLength(1);
    expect(
      categoriseTransactions(result.unique, [{ category: "Refunds", amount: { min: "0" } }])[0]
        ?.category,
    ).toBe("Refunds");
  });
});
