// AUTHORED-BY Claude Opus 5.5
import { parseMoney } from "@jeswr/solid-money";
import { describe, expect, it, vi } from "vitest";
import type { FileImportAdapter, FileImportContext } from "../core/file-import.js";
import {
  createMemoryPod,
  fileImport,
  type MemoryPod,
  memoryFile,
  TEST_POD_ROOT,
} from "../core/testing.js";
import { parseBankCsv } from "./csv.js";
import {
  BANK_DOCUMENT_BUDGET,
  type BankDocumentBudget,
  BankDocumentBudgetError,
  bankStatementsFileAdapter,
  createBankStatementsFileAdapter,
} from "./file-adapter.js";
import {
  HSBC,
  MONZO,
  MONZO_FULL,
  MONZO_FULL_HEADER,
  MONZO_FULL_ROWS,
  REVOLUT_HEADER,
  REVOLUT_ROWS,
  STARLING,
} from "./fixtures.js";
import { BankMoneyPlan, type BankMoneyRecord } from "./money-documents.js";

function bankDocuments(pod: MemoryPod): string[] {
  return pod
    .urls()
    .filter((url) => url.includes("/finance/bank/") && url.endsWith(".ttl"))
    .sort();
}
function monthDocuments(pod: MemoryPod): string[] {
  return bankDocuments(pod).filter((url) => !url.endsWith("/account.ttl"));
}
async function transactions(pod: MemoryPod, urls = monthDocuments(pod)) {
  const documents = await Promise.all(urls.map((url) => parseMoney(pod.get(url) ?? "", url)));
  return documents.flatMap((doc) => doc.transactions());
}

describe("Monzo export layouts", () => {
  it("detects the short 11-column layout and the full 18-column layout", async () => {
    expect(parseBankCsv(MONZO)).toHaveLength(1);
    const rows = parseBankCsv(MONZO_FULL);
    expect(rows.map((row) => [row.bank, row.amount, row.postingTime])).toEqual([
      ["monzo", "-3.40", "2026-07-02"],
      ["monzo", "-20.00", "2026-07-03"],
      ["monzo", "1500.00", "2026-08-04"],
    ]);
    // An empty Name falls back to Monzo's Description column, then to Type.
    expect(rows.map((row) => row.description)).toEqual([
      "Synthetic bakery",
      "Synthetic pot",
      "Synthetic employer",
    ]);
    const { pod, report } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("monzo.csv", MONZO_FULL),
    );
    expect(report.skipped).toBeUndefined();
    expect(report.unsupported).toBeUndefined();
    const months = monthDocuments(pod);
    expect(months.map((url) => url.replace(/^.*\/finance\/bank\//, ""))).toEqual([
      expect.stringMatching(/^monzo-[0-9a-f]{64}\/2026-07\.ttl$/),
      expect.stringMatching(/^monzo-[0-9a-f]{64}\/2026-08\.ttl$/),
    ]);
    expect(await transactions(pod)).toHaveLength(3);
  });

  it.each([
    ["without Money Out/In", (header: string) => header.replace(",Money Out,Money In", "")],
    [
      "without Category split, Money Out/In",
      (header: string) => header.replace(",Category split,Money Out,Money In", ""),
    ],
    [
      "without notes, address, receipt and description",
      (header: string) => header.replace(",Notes and #tags,Address,Receipt,Description", ""),
    ],
    ["without Emoji/Category", (header: string) => header.replace(",Emoji,Category", "")],
    [
      "with reordered columns",
      (header: string) => header.replace("Transaction ID,Date,Time", "Date,Time,Transaction ID"),
    ],
  ])("accepts the Monzo layout %s", (_name, edit) => {
    const header = edit(MONZO_FULL_HEADER);
    const names = MONZO_FULL_HEADER.split(",");
    const cells = MONZO_FULL_ROWS[0].split(",");
    const row = header
      .split(",")
      .map((name) => cells[names.indexOf(name)] ?? "")
      .join(",");
    const [txn] = parseBankCsv(`${header}\n${row}`);
    expect(txn).toMatchObject({
      bank: "monzo",
      sourceId: "tx_synthetic_full_1",
      amount: "-3.40",
      currency: "GBP",
      postingTime: "2026-07-02",
      description: "Synthetic bakery",
    });
  });

  it.each([
    [`${MONZO_FULL_HEADER},Merchant ID\n${MONZO_FULL_ROWS[0]},m1`, "an unknown extra column"],
    [MONZO_FULL.replace(",Money In", ""), "a broken Money Out/In pair"],
    [MONZO_FULL.replace("Local currency,", ""), "a broken local amount/currency pair"],
    [MONZO_FULL.replace(",Time,", ","), "a missing required Time column"],
    [MONZO_FULL.replace("Transaction ID", "Transaction Ref"), "a renamed Transaction ID"],
    [MONZO_FULL.replace("Name,Emoji", "Name,Name"), "a duplicate column"],
  ])("rejects a near-miss Monzo layout with %s", async (text, _case) => {
    expect(() => parseBankCsv(text)).toThrow("looks like Monzo but the columns differ");
    const { pod, report } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("near.csv", text),
    );
    expect(report.unsupported?.[0]).toContain("looks like Monzo");
    expect(bankDocuments(pod)).toEqual([]);
  });
});

describe("month routing", () => {
  it("routes by solid-money's UTC month, as Suite Money does", async () => {
    // 00:30 on 1 August in London is 23:30 UTC on 31 July.
    const row = REVOLUT_ROWS[3].replaceAll("2026-07-04 09:00:00", "2026-08-01 00:30:00");
    const { pod } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("edge.csv", `${REVOLUT_HEADER}\n${row}`),
    );
    const [url] = monthDocuments(pod);
    expect(url).toMatch(/\/2026-07\.ttl$/);
    expect((await transactions(pod))[0]?.postingTime).toBe("2026-07-31T23:30:00.000Z");
  });
});

describe("posting-date window", () => {
  it("skips and counts known-bank rows before 1970 or more than a year ahead", async () => {
    const future = ddmmyyyy(new Date(Date.now() + 2 * 366 * 24 * 60 * 60 * 1000));
    const soon = ddmmyyyy(new Date(Date.now() + 300 * 24 * 60 * 60 * 1000));
    const rows = [
      ["early", "31/12/1969"],
      ["epoch", "01/01/1970"],
      ["soon", soon],
      ["future", future],
      ["far", "01/01/9999"],
    ].map(([id, date]) => MONZO.split("\n")[1]?.replace("synthetic-1,01/07/2026", `${id},${date}`));
    const text = `${MONZO.split("\n")[0]}\n${rows.join("\n")}`;
    expect(parseBankCsv(text).map((txn) => txn.sourceId)).toEqual(["epoch", "soon"]);
    const { pod, report } = await fileImport(bankStatementsFileAdapter, memoryFile("a.csv", text));
    expect(report.skipped).toBe(3);
    expect(await transactions(pod)).toHaveLength(2);
  });
});

describe("descriptions without visible text", () => {
  it.each([
    ["Monzo Name", MONZO.replace("Synthetic shop", "\u0001\u0002"), "Card payment"],
    [
      "Revolut Description",
      `${REVOLUT_HEADER}\n${REVOLUT_ROWS[3].replace("Synthetic saving", "\u0007")}`,
      "TRANSFER",
    ],
    [
      "Starling Counter Party and Reference",
      STARLING.replace('Synthetic shop,"=1+1, inert"', "\u0003,"),
      "CARD_PAYMENT",
    ],
    [
      "Starling Counter Party and Reference (both control-only)",
      STARLING.replace('Synthetic shop,"=1+1, inert"', '"\u0003","\u0004"'),
      "CARD_PAYMENT",
    ],
    [
      "Starling Counter Party (Reference kept alone)",
      STARLING.replace('Synthetic shop,"=1+1, inert"', '"\u0003",Synthetic ref'),
      "Synthetic ref",
    ],
  ])("falls back from a control-only %s to the row's type", async (_name, text, expected) => {
    const { pod, report } = await fileImport(bankStatementsFileAdapter, memoryFile("a.csv", text));
    expect(report.skipped).toBeUndefined();
    expect((await transactions(pod)).map((txn) => txn.description)).toEqual([expected]);
  });

  it("skips (and counts) a row with no visible text in any description column", async () => {
    const text = MONZO_FULL.replace("Synthetic employer", "\u0001")
      .replace("SYNTHETIC SALARY", "")
      .replace("Faster payment", " ");
    const { pod, report } = await fileImport(bankStatementsFileAdapter, memoryFile("a.csv", text));
    expect(report.skipped).toBe(1);
    expect(await transactions(pod)).toHaveLength(2);
    const hsbc = createBankStatementsFileAdapter({ csvFormat: "hsbc-uk", accountLabel: "HSBC" });
    const row = `${HSBC}03/07/2026,"\u0001\u0002",-1.00\n`;
    const { report: second } = await fileImport(hsbc, memoryFile("h.csv", row));
    expect(second.skipped).toBe(1);
    expect(() => createBankStatementsFileAdapter({ accountLabel: "\u0001" })).toThrow("label");
  });
});

/** A host-like adapter over the shared plan, so tests can lower the budget. */
function plannedAdapter(
  records: readonly BankMoneyRecord[],
  limits: Partial<BankDocumentBudget>,
  wrap: (ctx: FileImportContext) => FileImportContext = (ctx) => ctx,
) {
  return {
    ...bankStatementsFileAdapter,
    async importFile(_file, ctx) {
      const plan = new BankMoneyPlan({ ...BANK_DOCUMENT_BUDGET, ...limits });
      for (const record of records) plan.add(record);
      await plan.write(wrap(ctx));
    },
  } satisfies FileImportAdapter;
}
const record = (
  i: number,
  description = `Synthetic purchase ${i}`,
  month = "2026-07",
): BankMoneyRecord => ({
  accountSlug: `monzo-${"a".repeat(64)}`,
  accountLabel: "Synthetic Monzo GBP",
  identity: i.toString(16).padStart(64, "0"),
  postingTime: `${month}-${String((i % 28) + 1).padStart(2, "0")}`,
  description,
  amount: `-${i}.25`,
  currency: "GBP",
});
/** A bare adapter context: only reads are observed; no write may happen. */
function readOnlyContext() {
  return {
    maxRows: 100_000,
    resolve: (slug: string) => `${TEST_POD_ROOT}${slug}`,
    read: vi.fn(async (_slug: string) => undefined),
    write: vi.fn(),
    writeBinary: vi.fn(),
    remove: vi.fn(),
    progress: vi.fn(),
    skip: vi.fn(),
  } satisfies FileImportContext;
}
const ddmmyyyy = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
const FILE = memoryFile("unused.csv", "");

describe("per-document budget", () => {
  it("defaults well under fetch-rdf's 16 MiB / 1,000,000-quad reader limits", () => {
    expect(BANK_DOCUMENT_BUDGET).toEqual({
      transactions: 2_000,
      bytes: 4 * 1024 * 1024,
      parts: 1_000,
      accounts: 50,
      documents: 600,
    });
    expect(Object.isFrozen(BANK_DOCUMENT_BUDGET)).toBe(true);
  });

  it("splits a month into parts by record count and keeps re-imports idempotent", async () => {
    const budget = { transactions: 2, bytes: 4 * 1024 * 1024, parts: 10 };
    const pod = createMemoryPod();
    const first = [1, 2, 3, 4, 5].map((i) => record(i));
    await fileImport(plannedAdapter(first, budget), FILE, { pod });
    const names = monthDocuments(pod).map((url) => url.replace(/^.*\//, ""));
    expect(names).toEqual(["2026-07-part-2.ttl", "2026-07-part-3.ttl", "2026-07.ttl"]);
    for (const url of monthDocuments(pod))
      expect((await transactions(pod, [url])).length).toBeLessThanOrEqual(2);
    const ids = (await transactions(pod)).map((txn) => txn.id).sort();
    expect(ids).toHaveLength(5);
    // Re-import with one changed description and one new record: upsert in place, append last.
    const second = [...first.slice(0, 4), record(5, "Revised"), record(6)];
    await fileImport(plannedAdapter(second, budget), FILE, { pod });
    const after = await transactions(pod);
    expect(after).toHaveLength(6);
    expect(after.filter((txn) => ids.includes(txn.id))).toHaveLength(5);
    expect(after.find((txn) => txn.description === "Revised")?.id).toBe(
      ids.find((id) => id.endsWith(record(5).identity)),
    );
    const last = monthDocuments(pod).find((url) => url.endsWith("2026-07-part-3.ttl")) ?? "";
    expect((await transactions(pod, [last])).map((txn) => txn.description).sort()).toEqual([
      "Revised",
      "Synthetic purchase 6",
    ]);
  });

  it("splits by serialised size and every stored document stays within the byte budget", async () => {
    const budget = { transactions: 1_000, bytes: 12_000, parts: 50 };
    const records = Array.from({ length: 12 }, (_, i) => record(i + 1));
    const { pod } = await fileImport(plannedAdapter(records, budget), FILE);
    const months = monthDocuments(pod);
    expect(months.length).toBeGreaterThan(2);
    for (const url of months)
      expect(new TextEncoder().encode(pod.get(url)).byteLength).toBeLessThanOrEqual(budget.bytes);
    expect(await transactions(pod)).toHaveLength(12);
  });

  it.each([
    ["a single transaction above the byte budget", { transactions: 10, bytes: 2_000, parts: 5 }, 1],
    ["more parts than allowed", { transactions: 1, bytes: 4 * 1024 * 1024, parts: 2 }, 3],
  ])("fails before any write for %s", async (_name, budget, count) => {
    const records = Array.from({ length: count }, (_, i) => record(i + 1));
    const pod = createMemoryPod();
    await expect(fileImport(plannedAdapter(records, budget), FILE, { pod })).rejects.toThrow(
      "document budget",
    );
    expect(bankDocuments(pod)).toEqual([]);
  });

  it("refuses an update that would push a stored document over budget, leaving it unchanged", async () => {
    const budget = { transactions: 10, bytes: 6_000, parts: 5 };
    const pod = createMemoryPod();
    await fileImport(plannedAdapter([record(1)], budget), FILE, { pod });
    const before = bankDocuments(pod).map((url) => pod.get(url));
    await expect(
      fileImport(plannedAdapter([record(1, "x".repeat(8_000))], budget), FILE, { pod }),
    ).rejects.toBeInstanceOf(BankDocumentBudgetError);
    expect(bankDocuments(pod).map((url) => pod.get(url))).toEqual(before);
  });
});

describe("per-import budget", () => {
  it("fails while parsing, before any Pod read, above 50 accounts", async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      REVOLUT_ROWS[3].replace("TRANSFER,Savings", `TRANSFER,Product ${i}`),
    );
    const ctx = readOnlyContext();
    await expect(
      bankStatementsFileAdapter.importFile(
        memoryFile("many.csv", `${REVOLUT_HEADER}\n${rows.join("\n")}`),
        ctx,
      ),
    ).rejects.toThrow(new BankDocumentBudgetError("more than 50 accounts in one import"));
    expect(ctx.read).not.toHaveBeenCalled();
    expect(ctx.write).not.toHaveBeenCalled();
    // 50 accounts are admitted.
    await expect(
      bankStatementsFileAdapter.importFile(
        memoryFile("fifty.csv", `${REVOLUT_HEADER}\n${rows.slice(0, 50).join("\n")}`),
        readOnlyContext(),
      ),
    ).resolves.toBeDefined();
  });

  it("fails while parsing, before any Pod read, above 600 account and month documents", async () => {
    const [header, row] = MONZO.split("\n");
    // One account plus 600 distinct months (1975-01 onwards, inside the date window).
    const rows = Array.from({ length: 600 }, (_, i) =>
      (row ?? "").replace(
        "synthetic-1,01/07/2026",
        `synthetic-${i},01/${String((i % 12) + 1).padStart(2, "0")}/${1975 + Math.floor(i / 12)}`,
      ),
    );
    const ctx = readOnlyContext();
    await expect(
      bankStatementsFileAdapter.importFile(
        memoryFile("months.csv", `${header}\n${rows.join("\n")}`),
        ctx,
      ),
    ).rejects.toThrow("more than 600 account and month documents in one import");
    expect(ctx.read).not.toHaveBeenCalled();
    expect(ctx.write).not.toHaveBeenCalled();
  });

  it("bounds the documents read during planning, including probed parts", async () => {
    const pod = createMemoryPod();
    const months = [record(1), record(2, undefined, "2026-08")];
    // Account + two absent month documents: 3 reads.
    await fileImport(plannedAdapter(months, { documents: 4 }), FILE, { pod });
    const before = bankDocuments(pod).map((url) => pod.get(url));
    // Account + two stored months + one absent probe after each: 5 reads.
    await expect(
      fileImport(plannedAdapter(months, { documents: 4 }), FILE, { pod }),
    ).rejects.toThrow("more than 4 documents to read in one import");
    expect(bankDocuments(pod).map((url) => pod.get(url))).toEqual(before);
    await fileImport(plannedAdapter(months, { documents: 5 }), FILE, { pod });
  });

  it("reads the absent overflow part once when a full month extends into it", async () => {
    const pod = createMemoryPod();
    await fileImport(plannedAdapter([record(1), record(2)], { transactions: 2 }), FILE, { pod });
    const fetch = vi.spyOn(pod, "fetch");
    await fileImport(plannedAdapter([record(3)], { transactions: 2 }), FILE, { pod });
    const part2 = monthDocuments(pod).find((url) => url.endsWith("2026-07-part-2.ttl")) ?? "";
    expect(part2).not.toBe("");
    const reads = fetch.mock.calls.filter(
      ([url, init]) => String(url) === part2 && (init?.method ?? "GET") === "GET",
    );
    expect(reads).toHaveLength(1);
    expect(await transactions(pod)).toHaveLength(3);
  });

  it("converges on re-run after a 412 part-way through the writes", async () => {
    const pod = createMemoryPod();
    const records = [record(1), record(2, undefined, "2026-08"), record(3, undefined, "2026-09")];
    let writes = 0;
    // A concurrent writer creates the August document between planning and its write.
    const racing = plannedAdapter(records, {}, (ctx) => ({
      ...ctx,
      async write(doc, conditions) {
        if (++writes === 3) {
          const response = await pod.fetch(ctx.resolve(doc.slug), {
            method: "PUT",
            headers: { "content-type": "text/turtle" },
            body: '<#concurrent> <https://schema.org/name> "Concurrent edit".',
          });
          expect(response.ok).toBe(true);
        }
        return ctx.write(doc, conditions);
      },
    }));
    await expect(fileImport(racing, FILE, { pod })).rejects.toThrow(/412|precondition/i);
    // Account and July were written before the failure; September was not.
    expect(monthDocuments(pod).map((url) => url.replace(/^.*\//, ""))).toEqual([
      "2026-07.ttl",
      "2026-08.ttl",
    ]);
    await fileImport(plannedAdapter(records, {}), FILE, { pod });
    const rows = await transactions(pod);
    expect(rows.map((row) => row.amount).sort()).toEqual(["-1.25", "-2.25", "-3.25"]);
    const august = monthDocuments(pod).find((url) => url.endsWith("2026-08.ttl")) ?? "";
    expect(pod.get(august)).toContain("Concurrent edit");
    // Re-running again changes nothing but provenance.
    await fileImport(plannedAdapter(records, {}), FILE, { pod });
    expect(await transactions(pod)).toHaveLength(3);
  });
});
