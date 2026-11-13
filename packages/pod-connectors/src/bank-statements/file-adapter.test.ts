// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { type MoneyDocument, parseMoney, V } from "@jeswr/solid-money";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { type FileImportContext, type ImportFile, MAX_FILE_BYTES } from "../core/file-import.js";
import {
  createMemoryPod,
  fileImport,
  type MemoryPod,
  memoryFile,
  TEST_POD_ROOT,
} from "../core/testing.js";
import { CLASSES, Invoice } from "../core/vocab.js";
import { BankCsvParser, MAX_BANK_FIELD_CHARS } from "./csv.js";
import {
  BANK_CSV_FORMATS,
  bankStatementsFileAdapter,
  createBankStatementsFileAdapter,
  MAX_BANK_ACCOUNT_LABEL_CHARS,
  normaliseAmount,
  parseBankCsv,
  parseFlexibleDate,
  parseOfx,
  parseOfxDate,
  validateBankOptions,
} from "./file-adapter.js";
import { HSBC, MONZO, OFX, REVOLUT, REVOLUT_HEADER, REVOLUT_ROWS, STARLING } from "./fixtures.js";
import { bankDate, subtractAmount } from "./values.js";

function bankDocuments(pod: MemoryPod): string[] {
  return pod.urls().filter((url) => url.includes("/finance/bank/") && url.endsWith(".ttl"));
}
/** Read back through Suite Money's own parser: the stored Turtle is its wire format. */
async function moneyDocuments(pod: MemoryPod): Promise<MoneyDocument[]> {
  return Promise.all(bankDocuments(pod).map((url) => parseMoney(required(pod.get(url)), url)));
}
async function transactions(pod: MemoryPod) {
  return (await moneyDocuments(pod)).flatMap((doc) => doc.transactions());
}
async function accounts(pod: MemoryPod) {
  return (await moneyDocuments(pod)).flatMap((doc) => doc.accounts());
}

const DOC = `${TEST_POD_ROOT}integrations/bank-statements/finance/bank-transactions.ttl`;
const LEGACY = "finance/bank-transactions.ttl";
function invoices(ds: Store): Invoice[] {
  return ds
    .getSubjects(null, CLASSES.Invoice, null)
    .map((subject) => new Invoice(subject, ds, DataFactory));
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected synthetic result");
  return value;
}
function streamed(text: string, size: number, name = "misleading.ofx"): ImportFile {
  const bytes = new TextEncoder().encode(text);
  return {
    ...memoryFile(name, text),
    text: async () => {
      throw new Error("Must stream");
    },
    stream: () => {
      let offset = 0;
      return new ReadableStream({
        pull(controller) {
          if (offset === bytes.length) controller.close();
          else {
            controller.enqueue(bytes.slice(offset, offset + size));
            offset = Math.min(bytes.length, offset + size);
          }
        },
      });
    },
  };
}
function context(maxRows = 100_000): FileImportContext {
  return {
    maxRows,
    resolve: (slug) => `${TEST_POD_ROOT}${slug}`,
    read: async () => undefined,
    write: vi.fn(async (doc) => ({
      url: `${TEST_POD_ROOT}${doc.slug}`,
      category: doc.category,
      forClass: doc.forClass,
    })),
    writeBinary: vi.fn(),
    remove: vi.fn(),
    progress: vi.fn(),
    skip: vi.fn(),
  };
}

describe("known bank CSV exports", () => {
  it.each([1, 7, 65536])("maps Revolut with BOM/CRLF/quotes in %i-byte chunks", async (size) => {
    const { pod, report } = await fileImport(bankStatementsFileAdapter, streamed(REVOLUT, size));
    expect(report.categories).toEqual(["finance"]);
    expect(report.skipped).toBe(1);
    expect(report.state?.counts.skipped).toBe(1);
    const rows = await transactions(pod);
    expect(rows).toHaveLength(3);
    const coffee = required(rows.find((row) => row.description.includes("café")));
    expect(coffee.amount).toBe("-12.70");
    // solid-money has no fee field: the nonzero fee stays in the description.
    expect(coffee.description).toBe('Synthetic café, "Orbit" (fee 0.20 GBP)');
    expect(coffee.postingTime).toBe("2026-07-01T09:00:00.000Z");
    expect(coffee.currency).toBe("GBP");
    expect(rows.find((row) => row.currency === "EUR")?.amount).toBe("9007199254740993.01");
    expect(new Set(rows.map((row) => row.account)).size).toBe(3);
    expect(await accounts(pod)).toHaveLength(3);
    expect(pod.get(report.indexUrl)).toContain(V.transactionClass);
    expect(pod.get(report.indexUrl)).toContain(V.accountClass);
  });

  it("uses one account per Product/Currency across multiple rows", () => {
    const rows = parseBankCsv(
      `${REVOLUT_HEADER}\n${REVOLUT_ROWS[0]}\n${REVOLUT_ROWS[0]?.replace("987.30", "974.60")}`,
    );
    expect(rows[0]?.accountKey).toBe(rows[1]?.accountKey);
  });

  it("normalises supported headers", () => {
    const header = REVOLUT_HEADER.toUpperCase().replace("COMPLETED DATE", " Completed   Date ");
    const rows = parseBankCsv(`${header}\n${REVOLUT_ROWS[0]}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe("-12.70");
  });

  it.each([
    1, 7, 65536,
  ])("imports explicit headerless HSBC including its first row (%i-byte chunks)", async (size) => {
    const adapter = createBankStatementsFileAdapter({
      csvFormat: "hsbc-uk",
      accountLabel: "Everyday HSBC",
    });
    const { pod } = await fileImport(adapter, streamed(`\uFEFF${HSBC}`, size));
    const rows = (await transactions(pod)).sort((a, b) =>
      a.postingTime.localeCompare(b.postingTime),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.amount).toBe("-1234.56");
    expect(rows[0]?.postingTime).toBe("2026-07-01");
    expect(rows[0]?.currency).toBe("GBP");
    expect(rows[0]?.account).toBe(rows[1]?.account);
  });

  it("keeps HSBC credit-card and current-account identities separate via user labels", async () => {
    const pod = createMemoryPod();
    for (const accountLabel of ["Current", "Credit card"])
      await fileImport(
        createBankStatementsFileAdapter({ csvFormat: "hsbc-uk", accountLabel }),
        memoryFile("same.csv", HSBC),
        { pod },
      );
    expect(await transactions(pod)).toHaveLength(4);
    expect(await accounts(pod)).toHaveLength(2);
  });

  it.each([
    [MONZO, "-5.25", "GBP"],
    [STARLING, "-2.50", "GBP"],
  ])("imports per-account documents for Monzo/Starling (%#)", async (text, amount, currency) => {
    const { pod } = await fileImport(bankStatementsFileAdapter, streamed(text, 7));
    const row = required((await transactions(pod))[0]);
    expect(row.amount).toBe(amount);
    expect(row.currency).toBe(currency);
    expect(row.postingTime).toBe("2026-07-01");
  });

  it("retains formula characters and quoted multiline text as inert literals", async () => {
    const text = MONZO.replace("Synthetic shop", '"=SUM(1,2)\n+cmd @data -text"');
    const { pod } = await fileImport(bankStatementsFileAdapter, streamed(text, 1));
    const row = required((await transactions(pod))[0]);
    expect(row.description).toBe("=SUM(1,2)\n+cmd @data -text");
    // The Monzo transaction ID only feeds the hashed subject (no solid-money field).
    expect(row.id).toMatch(/#txn-[0-9a-f]{64}$/);
    expect(bankDocuments(pod).some((url) => pod.get(url)?.includes("synthetic-1"))).toBe(false);
  });

  it("preserves rows from overlapping statements, independent of filename, order and decimal scale", async () => {
    const pod = createMemoryPod();
    await fileImport(bankStatementsFileAdapter, memoryFile("first.csv", REVOLUT), { pod });
    const original = new Set((await transactions(pod)).map((row) => row.id));
    const overlap = REVOLUT_ROWS[0]
      .replace("-12.50,0.20", "-12.500,0.200")
      .replace("987.30", "987.300");
    const additional = REVOLUT_ROWS[0].replace("987.30", "974.60");
    const text = `${REVOLUT_HEADER}\n${additional}\n${overlap}`;
    await fileImport(bankStatementsFileAdapter, memoryFile("renamed.csv", text), { pod });
    const rows = await transactions(pod);
    expect(rows).toHaveLength(4);
    for (const id of original) expect(rows.some((row) => row.id === id)).toBe(true);
    await fileImport(bankStatementsFileAdapter, memoryFile("again.ofx", text), { pod });
    expect(await transactions(pod)).toHaveLength(4);
  });

  it("uses bank ids when available, independent of changed descriptions", async () => {
    const pod = createMemoryPod();
    await fileImport(bankStatementsFileAdapter, memoryFile("a.csv", MONZO), { pod });
    await fileImport(
      bankStatementsFileAdapter,
      memoryFile("b.csv", MONZO.replace("Synthetic shop", "Changed")),
      { pod },
    );
    expect(await transactions(pod)).toHaveLength(1);
    expect((await transactions(pod))[0]?.description).toBe("Changed");
  });

  it("pending-only reports count every skipped row without replacing previous data", async () => {
    const pod = createMemoryPod();
    await fileImport(bankStatementsFileAdapter, memoryFile("a.csv", REVOLUT), { pod });
    const before = bankDocuments(pod).map((url) => pod.get(url));
    const { report } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("b.csv", `${REVOLUT_HEADER}\n${REVOLUT_ROWS[2]}`),
      { pod },
    );
    expect(report.skipped).toBe(1);
    expect(report.written).toEqual([]);
    expect(bankDocuments(pod).map((url) => pod.get(url))).toEqual(before);
  });
});

describe("fail-closed bank detection and bounds", () => {
  it("reads the legacy document only for bank imports and omits warnings when absent", async () => {
    const ctx = { ...context(), read: vi.fn(async (_slug: string) => undefined) };
    const outcome = await bankStatementsFileAdapter.importFile(memoryFile("a.csv", MONZO), ctx);
    expect(ctx.read.mock.calls.filter(([slug]) => slug === LEGACY)).toHaveLength(1);
    expect(outcome?.unsupported).toBeUndefined();
    ctx.read.mockClear();
    await bankStatementsFileAdapter.importFile(
      memoryFile("pending.csv", `${REVOLUT_HEADER}\n${REVOLUT_ROWS[2]}`),
      ctx,
    );
    expect(ctx.read).toHaveBeenCalledExactlyOnceWith("finance/bank-transactions.ttl");
    ctx.read.mockClear();
    await bankStatementsFileAdapter.importFile(
      memoryFile("generic.csv", "Description,Amount\nShop,1"),
      ctx,
    );
    await bankStatementsFileAdapter.importFile(memoryFile("a.ofx", OFX), ctx);
    expect(ctx.read).not.toHaveBeenCalled();
  });

  it("ignores non-Invoices and incomplete or nonmatching legacy values", async () => {
    const store = new Store();
    const other = new Invoice("https://pod.test/other", store, DataFactory);
    other.name = "Synthetic shop";
    other.totalPaymentDue = "-5.25";
    other.dateCreated = new Date("2026-07-01T00:00:00Z");
    for (const [i, name, amount, date] of [
      [0, undefined, "-5.25", "2026-07-01"],
      [1, "Synthetic shop", undefined, "2026-07-01"],
      [2, "Synthetic shop", "-5.25", "2026-07-02"],
      [3, "Synthetic shop", "-5.24", "2026-07-01"],
      [4, "Other", "-5.25", "2026-07-01"],
      [5, "Synthetic shop", "invalid", "2026-07-01"],
    ] as const) {
      const row = new Invoice(`https://pod.test/invoice-${i}`, store, DataFactory).mark();
      row.name = name;
      row.totalPaymentDue = amount;
      row.dateCreated = new Date(date);
    }
    const ctx = {
      ...context(),
      read: vi.fn(async (slug: string) => (slug === LEGACY ? store : undefined)),
    };
    const before = store.size;
    const outcome = await bankStatementsFileAdapter.importFile(memoryFile("a.csv", MONZO), ctx);
    expect(outcome?.unsupported).toBeUndefined();
    expect(store.size).toBe(before);
    expect(ctx.remove).not.toHaveBeenCalled();
  });

  it.each([
    "quads",
    "characters",
    "invoices",
  ])("bounds legacy comparison by %s through custom reader ports", {
    timeout: 30_000,
  }, async (bound) => {
    const store = new Store();
    if (bound === "quads") Object.defineProperty(store, "size", { value: 1_600_001 });
    else if (bound === "characters") {
      new Invoice("https://pod.test/large", store, DataFactory).name = "x".repeat(1024);
      const quad = required(store.getQuads(null, null, null, null)[0]);
      vi.spyOn(store, Symbol.iterator).mockImplementation(function* () {
        for (let i = 0; i < 65536; i++) yield quad;
      });
    } else {
      for (let i = 0; i <= 100_000; i++)
        new Invoice(`https://pod.test/i-${i}`, store, DataFactory).mark();
    }
    const ctx = {
      ...context(),
      read: vi.fn(async (slug: string) => (slug === LEGACY ? store : undefined)),
    };
    const outcome = await bankStatementsFileAdapter.importFile(memoryFile("a.csv", MONZO), ctx);
    expect(outcome?.unsupported).toEqual([
      "The older shared bank document exceeds the comparison limit; check it manually for duplicate transactions.",
    ]);
    // One account document and one month document.
    expect(ctx.write).toHaveBeenCalledTimes(2);
    expect(ctx.remove).not.toHaveBeenCalled();
  });

  it("turns a failed legacy read into a warning and still writes the bank documents", async () => {
    const ctx = {
      ...context(),
      read: vi.fn(async (slug: string) => {
        if (slug === LEGACY) throw new Error("403 Forbidden");
        return undefined;
      }),
    };
    const outcome = await bankStatementsFileAdapter.importFile(memoryFile("a.csv", MONZO), ctx);
    expect(outcome?.unsupported).toEqual([
      "Could not check the older shared bank document for duplicate transactions; check it manually.",
    ]);
    expect(ctx.write).toHaveBeenCalledTimes(2);
    expect(ctx.remove).not.toHaveBeenCalled();
  });

  it("fails without any write when an account or month document cannot be read", async () => {
    const failure = new Error("403 Forbidden");
    const ctx = {
      ...context(),
      read: vi.fn(async (slug: string) => {
        if (slug.endsWith("/2026-07.ttl")) throw failure;
        return undefined;
      }),
    };
    await expect(
      bankStatementsFileAdapter.importFile(memoryFile("a.csv", MONZO), ctx),
    ).rejects.toBe(failure);
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it("honours cancellation during the legacy read before any bank write", async () => {
    const abort = new AbortController();
    const reason = new Error("Cancelled legacy comparison");
    const ctx = {
      ...context(),
      signal: abort.signal,
      read: vi.fn(async () => {
        abort.abort(reason);
        return undefined;
      }),
    };
    await expect(
      bankStatementsFileAdapter.importFile(memoryFile("a.csv", MONZO), ctx),
    ).rejects.toBe(reason);
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it("admits exact field/digit bounds and rejects invalid row budgets", () => {
    const text = `${REVOLUT_HEADER}\n${REVOLUT_ROWS[3].replace("Synthetic saving", "x".repeat(MAX_BANK_FIELD_CHARS))}`;
    expect(parseBankCsv(text)).toHaveLength(1);
    expect(normaliseAmount("9".repeat(64))).toBe("9".repeat(64));
    for (const limit of [NaN, -1, 1.5])
      expect(() => parseBankCsv(REVOLUT, limit)).toThrow("row limit");
    expect(() => parseBankCsv(REVOLUT, 0)).toThrow("row cap");
  });

  it("counts missing required fields and currencies on the other bank paths", async () => {
    for (const [text, row] of [
      [MONZO, MONZO.split("\n")[1]],
      [STARLING, STARLING.split("\n")[1]],
    ] as const) {
      const header = text.split("\n")[0];
      const { report } = await fileImport(
        bankStatementsFileAdapter,
        memoryFile("a.csv", `${header}\ninvalid\n${row}`),
      );
      expect(report.skipped).toBe(1);
    }
    expect(parseBankCsv(MONZO.replace("synthetic-1,", ","))).toEqual([]);
    expect(parseBankCsv(STARLING.replace("97.50", "invalid"))).toEqual([]);
    expect(
      parseBankCsv(HSBC, 100, { csvFormat: "hsbc-uk", accountLabel: "Foreign", currency: "USD" })[0]
        ?.currency,
    ).toBe("USD");
    expect(parseBankCsv(REVOLUT, 100, { currency: "USD" })).toEqual([]);
    expect(() =>
      parseBankCsv("01/07/2026,Two columns", 100, { csvFormat: "hsbc-uk", accountLabel: "HSBC" }),
    ).toThrow("Unrecognised");
  });
  it.each([HSBC, ""])("refuses ambiguous headerless CSV (%#)", async (text) => {
    const { pod, report } = text
      ? await fileImport(bankStatementsFileAdapter, memoryFile("revolut.csv", text))
      : { pod: createMemoryPod(), report: undefined };
    if (!text) {
      await expect(
        fileImport(bankStatementsFileAdapter, memoryFile("empty.csv", text)),
      ).rejects.toThrow("No importable");
      return;
    }
    expect(report?.unsupported?.[0]).toMatch(/Unrecognised CSV; detected headers:/);
    expect(report?.written).toEqual([]);
    expect(pod.get(DOC)).toBeUndefined();
    expect(() => parseBankCsv(text)).toThrow("Unrecognised CSV");
  });

  it("refuses mismatched or duplicate supported headers", () => {
    expect(() => parseBankCsv(REVOLUT, 100, { csvFormat: "monzo" })).toThrow("Unrecognised");
    expect(() => parseBankCsv(`${REVOLUT_HEADER},Amount\n${REVOLUT_ROWS[0]},1`)).toThrow(
      "Unrecognised",
    );
  });

  it.each([
    [REVOLUT.replace("Completed Date", "Posting Date"), "Revolut"],
    [REVOLUT.replace("Type,Product", "Product,Type"), "Revolut"],
    [`${REVOLUT_HEADER},Extra\n${REVOLUT_ROWS[0]},ignored`, "Revolut"],
    [MONZO.replace(",Local currency", ""), "Monzo"],
    [STARLING.replace("Balance (GBP)", "Closing balance"), "Starling"],
    ["Product,State\nCurrent,COMPLETED", "Revolut"],
    ["Started Date,Completed Date\n2026-07-01,2026-07-01", "Revolut"],
    ["Transaction ID,Emoji\nid,x", "Monzo"],
    ["Counter Party,Amount (GBP)\nShop,1", "Starling"],
    ["Amount (GBP),Spending Category\n1,Shopping", "Starling"],
  ])("rejects near-miss bank headers before any data writes (%#)", async (text, bank) => {
    const message = `looks like ${bank} but the columns differ`;
    expect(() => parseBankCsv(text)).toThrow(message);
    expect(() => parseBankCsv(text, 100, { csvFormat: "monzo" })).toThrow(message);
    const ctx = context();
    const result = await bankStatementsFileAdapter.importFile(streamed(text, 7), ctx);
    expect(result?.unsupported?.[0]).toContain(message);
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it.each([
    "2026-01-01,Valid,1",
    "2026-01-01,Invalid,missing",
    "2026-01-01,Excess,1,extra",
  ])("counts every generic source row, including skipped/malformed rows (%#)", async (row) => {
    const ctx = context(2);
    const text = `Date,Description,Amount\n${row}\n${row}\n2026-01-01,Third,1`;
    const outcome = await bankStatementsFileAdapter.importFile(streamed(text, 7), ctx);
    expect(outcome?.unsupported).toEqual([
      "Generic bank CSV truncated to the first 2 source rows.",
    ]);
    expect(ctx.write).toHaveBeenCalledOnce();
  });

  it("enforces the 100,000 generic source-row ceiling and counts oversized records", {
    timeout: 30_000,
  }, async () => {
    const header = "Date,Description,Amount";
    const atCap = `${header}\n${"2026-01-01,Invalid,missing\n".repeat(100_000)}`;
    expect(parseBankCsv(atCap)).toEqual([]);
    const ctx = context(200_000);
    const outcome = await bankStatementsFileAdapter.importFile(
      streamed(`${atCap}2026-01-01,Extra,1`, 65536),
      ctx,
    );
    expect(outcome?.unsupported).toEqual([
      "Generic bank CSV truncated to the first 100000 source rows.",
    ]);
    expect(parseBankCsv(`${atCap}2026-01-01,Extra,1`)).toEqual([]);
    const parser = new BankCsvParser({}, 1, () => {});
    parser.record(header);
    parser.skippedRecord();
    expect(parser.record("2026-01-01,Valid,1")).toBeUndefined();
    expect(ctx.write).toHaveBeenCalledOnce();
  });

  it(
    "imports the first 100,000 valid generic rows and warns only on overflow",
    { timeout: 30_000 },
    async () => {
      const atCap = `Date,Description,Amount\n${"2026-01-01,Keep,1\n".repeat(100_000)}`;
      const text = `${atCap}2026-01-01,Discard,2`;
      expect(parseBankCsv(text)).toHaveLength(100_000);
      const ctx = context();
      const outcome = await bankStatementsFileAdapter.importFile(streamed(text, 65536), ctx);
      expect(outcome?.unsupported).toEqual([
        "Generic bank CSV truncated to the first 100000 source rows.",
      ]);
      const doc = vi.mocked(ctx.write).mock.calls[0]?.[0];
      const rows = invoices(new Store(doc?.dataset));
      expect(rows).toHaveLength(100_000);
      expect(rows.every((row) => row.name === "Keep")).toBe(true);
      const small = await bankStatementsFileAdapter.importFile(
        memoryFile("exact.csv", "Description,Amount\nKeep,1\nKeep,1"),
        context(2),
      );
      expect(small?.unsupported).toBeUndefined();
    },
    20_000,
  );

  it("exports the host-facing format allowlist and label validation", () => {
    expect(BANK_CSV_FORMATS).toEqual(["revolut", "hsbc-uk", "monzo", "starling"]);
    for (const csvFormat of BANK_CSV_FORMATS)
      expect(() => validateBankOptions({ csvFormat, accountLabel: "Label" })).not.toThrow();
    for (const csvFormat of ["auto", "ofx", "csv", "HSBC-UK", "hsbc", ""])
      expect(() =>
        validateBankOptions({ csvFormat: csvFormat as (typeof BANK_CSV_FORMATS)[number] }),
      ).toThrow("Unsupported bank CSV format");
    expect(MAX_BANK_ACCOUNT_LABEL_CHARS).toBe(256);
    expect(() => validateBankOptions({ accountLabel: "x".repeat(256) })).not.toThrow();
    for (const accountLabel of ["", " \t", "\u0001", "x".repeat(257), 7 as unknown as string])
      expect(() => validateBankOptions({ accountLabel })).toThrow("Account label");
  });

  it("validates host options and snapshots them", async () => {
    expect(() => createBankStatementsFileAdapter({ csvFormat: "hsbc-uk" })).toThrow("accountLabel");
    expect(() => createBankStatementsFileAdapter({ currency: "gbp" })).toThrow("Currency");
    expect(() => createBankStatementsFileAdapter({ accountLabel: " " })).toThrow("label");
    const options = { csvFormat: "hsbc-uk" as const, accountLabel: "Original" };
    const adapter = createBankStatementsFileAdapter(options);
    options.accountLabel = "Changed";
    const { pod } = await fileImport(adapter, memoryFile("a.csv", HSBC));
    expect(
      bankDocuments(pod)
        .map((url) => pod.get(url))
        .join("\n"),
    ).toContain('"Original"');
  });

  it.each([
    ["-12.50,0.20,GBP,COMPLETED,987.30", "NaN,0.20,GBP,COMPLETED,987.30"],
    ["-12.50,0.20,GBP,COMPLETED,987.30", "1e9,0.20,GBP,COMPLETED,987.30"],
    [",GBP,", ",gbp,"],
    [",GBP,", ",GB,"],
    [",GBP,", ",ZZZ,"],
    ["2026-07-01 10:00:00", "2026-02-30 10:00:00"],
    ["Synthetic café", "x".repeat(MAX_BANK_FIELD_CHARS + 1)],
  ])("skips malformed records once (%#)", async (from, to) => {
    const text = `${REVOLUT_HEADER}\n${REVOLUT_ROWS[0].replace(from, to)}\n${REVOLUT_ROWS[3]}`;
    const { pod, report } = await fileImport(bankStatementsFileAdapter, streamed(text, 65536));
    expect(report.skipped).toBe(1);
    expect(await transactions(pod)).toHaveLength(1);
  });

  it("skips malformed quoting and excess columns and refuses unterminated quotes", async () => {
    const text = `${REVOLUT_HEADER}\n${REVOLUT_ROWS[3]},extra\n${REVOLUT_ROWS[3].replace("Synthetic saving", 'bad""quote')}\n${REVOLUT_ROWS[3]}`;
    const { report } = await fileImport(bankStatementsFileAdapter, memoryFile("a.csv", text));
    expect(report.skipped).toBe(2);
    await expect(
      fileImport(bankStatementsFileAdapter, streamed(`${REVOLUT_HEADER}\n"unfinished`, 1)),
    ).rejects.toThrow("Unterminated");
  });

  it.each([
    "valid",
    "pending",
    "malformed",
  ])("counts all %s rows against one cap before any writes", async (kind) => {
    const ctx = context(2);
    const row =
      kind === "pending" ? REVOLUT_ROWS[2] : kind === "malformed" ? "bad" : REVOLUT_ROWS[3];
    await expect(
      bankStatementsFileAdapter.importFile(
        memoryFile("a.csv", `${REVOLUT_HEADER}\n${[row, row, row].join("\n")}`),
        ctx,
      ),
    ).rejects.toThrow("row cap");
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it("bounds oversized records and their skip accounting", async () => {
    const parser = new BankCsvParser({}, 1, () => {});
    parser.record(REVOLUT_HEADER);
    parser.skippedRecord();
    expect(() => parser.skippedRecord()).toThrow("row cap");
    const ctx = context();
    const text = `${REVOLUT_HEADER}\n${"x".repeat(4 * 1024 * 1024 + 1)}\n${REVOLUT_ROWS[3]}`;
    const outcome = await bankStatementsFileAdapter.importFile(streamed(text, 65536), ctx);
    expect(outcome?.skipped).toBe(1);
    expect(ctx.write).toHaveBeenCalledTimes(2);
  });

  it("checks declared and actual file sizes and cancels lying streams", async () => {
    const ctx = context();
    await expect(
      bankStatementsFileAdapter.importFile(
        { ...memoryFile("a.csv", ""), size: MAX_FILE_BYTES + 1 },
        ctx,
      ),
    ).rejects.toThrow("64 MiB");
    const cancel = vi.fn();
    // The reader must reject the byte count before decoding an oversized chunk.
    const block = new Uint8Array(MAX_FILE_BYTES + 1);
    let first = true;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(first ? new TextEncoder().encode(`${REVOLUT_HEADER}\n`) : block);
          first = false;
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    await expect(
      bankStatementsFileAdapter.importFile(
        { ...memoryFile("a.csv", ""), stream: () => stream },
        ctx,
      ),
    ).rejects.toThrow("64 MiB");
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it("cancels and unlocks a stream when aborted during its read", async () => {
    const abort = new AbortController();
    const ctx = { ...context(), signal: abort.signal };
    const cancel = vi.fn();
    const reason = new Error("Synthetic cancellation");
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          abort.abort(reason);
          controller.enqueue(new TextEncoder().encode(REVOLUT));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    await expect(
      bankStatementsFileAdapter.importFile(
        { ...memoryFile("a.csv", ""), stream: () => stream },
        ctx,
      ),
    ).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(ctx.write).not.toHaveBeenCalled();
  });
});

describe("decimal and date validation", () => {
  it.each([
    ["£1,234.56", "1234.56"],
    ["-$3.50", "-3.50"],
    ["(12.50)", "-12.50"],
    ["+001.20", "1.20"],
    ["-0.00", "0.00"],
    ["9007199254740993.01", "9007199254740993.01"],
  ])("normalises %s exactly", (raw, expected) => expect(normaliseAmount(raw)).toBe(expected));
  it.each([
    "",
    "NaN",
    "Infinity",
    "1e3",
    "1,23.00",
    "12.3.4",
    "--1",
    "GBP 1",
    "=1+1",
    "1".repeat(65),
  ])("refuses invalid amounts %s", (raw) => expect(normaliseAmount(raw)).toBeUndefined());
  it("subtracts without rounding or losing negative sub-unit signs", () => {
    expect(subtractAmount("-0.01", "0.02")).toBe("-0.03");
    expect(subtractAmount("9007199254740993.01", "0.02")).toBe("9007199254740992.99");
    expect(subtractAmount("1.2", "0.01")).toBe("1.19");
  });
  it("uses Europe/London across daylight-saving boundaries", () => {
    expect(bankDate("2026-01-20 12:00:00")).toBe("2026-01-20T12:00:00.000Z");
    expect(bankDate("2026-07-20 12:00:00.123")).toBe("2026-07-20T11:00:00.123Z");
    expect(bankDate("2026-10-25 01:30:00")).toBe("2026-10-25T00:30:00.000Z");
    expect(bankDate("2026-03-29 01:30:00")).toBe("2026-03-29T01:30:00.000Z");
    expect(bankDate("2026-07-20T12:00:00+02:00")).toBe("2026-07-20T10:00:00.000Z");
  });
  it.each([
    "2026-02-30",
    "2025-02-29",
    "2026-07-20T25:00:00Z",
    "2026-07-20T12:60:00Z",
    "2026-07-20T12:00:00+14:01",
    "07/20/2026",
    "2026-07-20junk",
  ])("refuses invalid dates %s", (raw) => expect(bankDate(raw)).toBeUndefined());
});

describe("OFX compatibility", () => {
  it("keeps the original Invoice IDs, amount/date policies and replacement mode", async () => {
    const { pod } = await fileImport(bankStatementsFileAdapter, streamed(OFX, 1));
    const rows = invoices(pod.dataset(DOC));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBeInstanceOf(Invoice);
    expect(rows[0]?.value).toBe(`${DOC}#txn-synthetic-groceries-f3e94439`);
    expect(rows[0]?.totalPaymentDue).toBe("-12.50");
    expect(rows[0]?.priceCurrency).toBe("GBP");
    expect(pod.dataset(DOC).getQuads(null, V.account, null, null)).toEqual([]);
    expect(rows[0]?.identifier).toBeUndefined();
    await fileImport(
      bankStatementsFileAdapter,
      memoryFile("statement.qfx", OFX.replace("Synthetic groceries", "Revised")),
      { pod },
    );
    expect(invoices(pod.dataset(DOC))).toHaveLength(1);
    expect(invoices(pod.dataset(DOC))[0]?.name).toBe("Revised");
    expect(bankDocuments(pod)).toEqual([]);
    expect(parseOfxDate("20230214120000")?.toISOString().slice(0, 10)).toBe("2023-02-14");
    expect(parseOfxDate("20230230")?.toISOString().slice(0, 10)).toBe("2023-03-02");
    expect(parseOfxDate(undefined)).toBeUndefined();
    expect(parseOfx(OFX.replace("<TRNAMT>-12.50", "<TRNAMT>NaN"))[0]?.amount).toBe("NaN");
    expect(parseFlexibleDate("07/20/2026")?.toISOString().slice(0, 10)).toBe("2026-07-20");
  });
});
