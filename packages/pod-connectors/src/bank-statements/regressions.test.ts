// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { type MoneyDocument, parseMoney, V } from "@jeswr/solid-money";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { parseCsv } from "../core/csv.js";
import { fileImport, type MemoryPod, memoryFile, TEST_POD_ROOT } from "../core/testing.js";
import { CLASSES, Invoice } from "../core/vocab.js";
import { transactionKey } from "./csv.js";
import {
  bankStatementsFileAdapter,
  createBankStatementsFileAdapter,
  parseBankCsv,
} from "./file-adapter.js";
import { HSBC, MONZO, OFX, REVOLUT, REVOLUT_HEADER, REVOLUT_ROWS } from "./fixtures.js";
import { genericBankRowParser } from "./generic-csv.js";

function bankDocuments(pod: MemoryPod): string[] {
  return pod.urls().filter((url) => url.includes("/finance/bank/") && url.endsWith(".ttl"));
}
/** Month documents only (the account document holds no transactions). */
function monthDocuments(pod: MemoryPod): string[] {
  return bankDocuments(pod).filter((url) => !url.endsWith("/account.ttl"));
}
async function moneyDocuments(pod: MemoryPod, urls = bankDocuments(pod)): Promise<MoneyDocument[]> {
  return Promise.all(urls.map((url) => parseMoney(pod.get(url) ?? "", url)));
}
async function transactions(pod: MemoryPod, urls = bankDocuments(pod)) {
  return (await moneyDocuments(pod, urls)).flatMap((doc) => doc.transactions());
}

const DOC = `${TEST_POD_ROOT}integrations/bank-statements/finance/bank-transactions.ttl`;
function invoices(ds: Store): Invoice[] {
  return ds
    .getSubjects(null, CLASSES.Invoice, null)
    .map((subject) => new Invoice(subject, ds, DataFactory));
}
const GENERIC =
  "Posting Date,Payee,Value,Currency\n20/07/2026,Synthetic shop,GBP -12.50,USD\n07/21/26,,(3.20),EUR\ninvalid,Synthetic credit,£+001.20,GBP\n2026-07-01,invalid,missing,GBP";

describe("generic CSV compatibility", () => {
  it.each([
    ["Date,Description,Amount,Currency", "01/07/2026,Synthetic shop,-5.25,GBP"],
    ["Date,Type,Description,Amount,Balance", "01/07/2026,Card,Synthetic shop,-5.25,100"],
    ["Date,Name,Amount,Unknown", "01/07/2026,Synthetic shop,-5.25,x"],
    ["Transaction ID,Date,Name,Amount", "synthetic-1,01/07/2026,Synthetic shop,-5.25"],
    ["Emoji,Date,Name,Amount", ",01/07/2026,Synthetic shop,-5.25"],
  ])("retains origin/main generic parsing and Invoice IDs for %s", async (header, row) => {
    const text = `${header}\n${row}`;
    const { headers, rows } = parseCsv(text);
    const expected = rows.map(genericBankRowParser(headers));
    expect(parseBankCsv(text)).toEqual(expected);
    const { pod, report } = await fileImport(bankStatementsFileAdapter, new File([text], "a.csv"));
    expect(report.unsupported).toBeUndefined();
    expect(bankDocuments(pod)).toEqual([]);
    const [invoice] = invoices(pod.dataset(DOC));
    expect(invoice?.value).toBe(`${DOC}#txn-synthetic-shop-0464cda1`);
    expect(invoice?.totalPaymentDue).toBe("-5.25");
    expect(invoice?.dateCreated?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(invoice?.priceCurrency).toBeUndefined();
  });

  it("preserves the original aliases, lenient dates/amounts and exact Invoice IDs", async () => {
    const expected = [
      { date: new Date("2026-07-20T00:00:00Z"), description: "Synthetic shop", amount: "-12.50" },
      { date: new Date("2026-07-21T00:00:00Z"), description: "Transaction", amount: "-3.20" },
      { date: undefined, description: "Synthetic credit", amount: "001.20" },
    ];
    expect(parseBankCsv(GENERIC)).toEqual(expected);
    expect(parseBankCsv(GENERIC, 1)).toEqual(expected.slice(0, 1));
    const { pod } = await fileImport(bankStatementsFileAdapter, memoryFile("old.csv", GENERIC));
    const rows = invoices(pod.dataset(DOC));
    expect(rows.map((row) => row.value)).toEqual([
      `${DOC}#txn-synthetic-shop-b0eed4f4`,
      `${DOC}#txn-transaction-4075dfde`,
      `${DOC}#txn-synthetic-credit-4699d1e8`,
    ]);
    expect(rows.map((row) => row.totalPaymentDue)).toEqual(expected.map((row) => row.amount));
    expect(rows.map((row) => row.dateCreated)).toEqual(expected.map((row) => row.date));
    expect(rows.every((row) => !row.priceCurrency)).toBe(true);
    expect(pod.dataset(DOC).getQuads(null, V.account, null, null)).toEqual([]);
    await fileImport(bankStatementsFileAdapter, new File([GENERIC], "renamed.csv"), { pod });
    expect(invoices(pod.dataset(DOC)).map((row) => row.value)).toEqual(
      rows.map((row) => row.value),
    );
    // The generic importer retains its original snapshot semantics.
    await fileImport(bankStatementsFileAdapter, memoryFile("next.csv", "Memo,Amount\nOnly,1"), {
      pod,
    });
    expect(invoices(pod.dataset(DOC)).map((row) => row.name)).toEqual(["Only"]);
  });

  it("preserves debit/credit precedence, zero omission and missing-date defaults", () => {
    expect(
      parseBankCsv("Narrative,Paid out,Money in\nDebit,£12.50,20\nCredit,,£3.40\nZero,0,0\n,1,"),
    ).toEqual([
      { date: undefined, description: "Debit", amount: "-12.5" },
      { date: undefined, description: "Credit", amount: "3.4" },
      { date: undefined, description: "Transaction", amount: "-1" },
    ]);
    expect(parseBankCsv("Date,Amount\n2026-02-30,1")[0]?.date?.toISOString()).toBe(
      "2026-03-02T00:00:00.000Z",
    );
  });

  it("keeps known-bank precedence, explicit format constraints and explicit-only HSBC", () => {
    expect(parseBankCsv(REVOLUT)[0]?.amount).toBe("-12.70");
    expect(parseBankCsv(REVOLUT)[0]?.bank).toBe("revolut");
    expect(() => parseBankCsv(GENERIC, 100, { csvFormat: "revolut" })).toThrow("Unrecognised");
    expect(() => parseBankCsv(REVOLUT, 100, { csvFormat: "monzo" })).toThrow("Unrecognised");
    expect(() => parseBankCsv(HSBC)).toThrow("Unrecognised");
  });

  it("retains the old empty-snapshot behavior when a generic file has no amount aliases", async () => {
    const { pod } = await fileImport(bankStatementsFileAdapter, memoryFile("a.csv", GENERIC));
    await fileImport(bankStatementsFileAdapter, memoryFile("b.csv", "Mystery,Unknown\na,b"), {
      pod,
    });
    expect(invoices(pod.dataset(DOC))).toEqual([]);
    expect(parseBankCsv("__proto__,constructor\na,b")).toEqual([]);
  });
});

describe("isolated bank account documents", () => {
  it("counts matching Invoice descriptions, exact decimal amounts and dates only", async () => {
    const old =
      "Date,Description,Amount\n01/07/2026,Synthetic shop,-005.2500\n02/07/2026,Synthetic shop,-5.25\n01/07/2026,Other shop,-5.25\n01/07/2026,Synthetic shop,-5.24\n01/07/2026,Synthetic shop,-5.25";
    const { pod } = await fileImport(bankStatementsFileAdapter, memoryFile("old.csv", old));
    const before = pod.get(DOC);
    const { report } = await fileImport(bankStatementsFileAdapter, memoryFile("new.csv", MONZO), {
      pod,
    });
    expect(report.unsupported).toEqual([
      "2 transactions from this statement also exist in the older shared bank document; remove them there or re-import that document with a generic/OFX file to avoid double counts.",
    ]);
    expect(pod.get(DOC)).toBe(before);
    expect(await transactions(pod)).toHaveLength(1);
  });

  it("propagates the generic 100,000 source-row truncation warning to the run report", async () => {
    const text = `Date,Description,Amount\n${"2026-01-01,Invalid,missing\n".repeat(100_000)}2026-01-01,Outside cap,1`;
    const { pod, report } = await fileImport(
      bankStatementsFileAdapter,
      new File([text], "long.csv"),
    );
    expect(report.unsupported).toEqual([
      "Generic bank CSV truncated to the first 100000 source rows.",
    ]);
    expect(invoices(pod.dataset(DOC))).toEqual([]);
    expect(bankDocuments(pod)).toEqual([]);
  });

  it.each([
    MONZO,
    `${REVOLUT_HEADER}\n${REVOLUT_ROWS[0]}`,
  ])("warns about previous-release rows without changing the shared document (%#)", async (text) => {
    const { headers, rows } = parseCsv(text);
    const legacy = rows.map(genericBankRowParser(headers));
    const previousRelease = {
      ...bankStatementsFileAdapter,
      async importFile(_file, ctx) {
        const store = new Store();
        for (const [i, txn] of legacy.entries()) {
          if (!txn) continue;
          const inv = new Invoice(
            `${ctx.resolve("finance/bank-transactions.ttl")}#old-${i}`,
            store,
            DataFactory,
          ).mark();
          inv.name = txn.description;
          inv.totalPaymentDue = txn.amount;
          inv.dateCreated = txn.date;
        }
        await ctx.write({
          slug: "finance/bank-transactions.ttl",
          category: "finance",
          forClass: CLASSES.Invoice,
          dataset: store,
        });
      },
    } satisfies typeof bankStatementsFileAdapter;
    const { pod } = await fileImport(previousRelease, memoryFile("old.csv", text));
    const before = pod.get(DOC);
    const etag = (await pod.fetch(DOC)).headers.get("etag");
    const read = vi.spyOn(pod, "fetch");
    const { report } = await fileImport(bankStatementsFileAdapter, memoryFile("new.csv", text), {
      pod,
    });
    expect(read.mock.calls.filter(([url]) => url === DOC)).toHaveLength(1);
    expect(report.unsupported).toEqual([
      "1 transactions from this statement also exist in the older shared bank document; remove them there or re-import that document with a generic/OFX file to avoid double counts.",
    ]);
    expect(pod.get(DOC)).toBe(before);
    expect((await pod.fetch(DOC)).headers.get("etag")).toBe(etag);
    expect(await transactions(pod)).toHaveLength(1);
    expect(report.written.every(({ url }) => url !== DOC)).toBe(true);
  });

  it.each([
    undefined,
    "Stable",
  ])("adding/changing accountLabel %s creates a new account document", async (accountLabel) => {
    const { pod, report } = await fileImport(
      createBankStatementsFileAdapter({ accountLabel }),
      memoryFile("first.csv", MONZO),
    );
    const firstUrls = report.written.map(({ url }) => url);
    expect(firstUrls).toHaveLength(2);
    const before = firstUrls.map((url) => pod.get(url));
    const { report: later } = await fileImport(
      createBankStatementsFileAdapter({ accountLabel: "Changed" }),
      memoryFile("next.csv", MONZO),
      { pod },
    );
    for (const { url } of later.written) expect(firstUrls).not.toContain(url);
    expect(firstUrls.map((url) => pod.get(url))).toEqual(before);
    // An account document plus one month document per account.
    expect(bankDocuments(pod)).toHaveLength(4);
  });

  it.each([
    false,
    true,
  ])("keeps generic and Monzo imports isolated (generic first: %s)", async (genericFirst) => {
    const imports = genericFirst ? [GENERIC, MONZO] : [MONZO, GENERIC];
    const { pod, report: first } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("first.csv", imports[0] ?? ""),
    );
    const firstUrls = first.written.map(({ url }) => url);
    const before = firstUrls.map((url) => pod.get(url));
    const firstTags = await Promise.all(
      firstUrls.map(async (url) => (await pod.fetch(url)).headers.get("etag")),
    );
    const { report: second } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("next.csv", imports[1] ?? ""),
      { pod },
    );
    expect(firstUrls.map((url) => pod.get(url))).toEqual(before);
    expect(
      await Promise.all(firstUrls.map(async (url) => (await pod.fetch(url)).headers.get("etag"))),
    ).toEqual(firstTags);
    for (const { url } of second.written) expect(firstUrls).not.toContain(url);
    expect(invoices(pod.dataset(DOC))).toHaveLength(3);
    const [monzoUrl] = monthDocuments(pod);
    expect(monzoUrl).toMatch(/\/finance\/bank\/monzo-[0-9a-f]{64}\/2026-07\.ttl$/);
    expect(bankDocuments(pod)).toEqual(
      [monzoUrl?.replace("2026-07.ttl", "account.ttl"), monzoUrl].sort(),
    );
    expect(await transactions(pod)).toHaveLength(1);
    expect(pod.get(second.indexUrl)).toContain(
      `${TEST_POD_ROOT}integrations/bank-statements/finance/bank/`,
    );
    expect(pod.get(second.indexUrl)).toContain(
      `${TEST_POD_ROOT}integrations/bank-statements/finance/`,
    );
  });

  it("uses hashed account keys in separate documents and preserves other accounts on overlap", async () => {
    const label = "12345678";
    const adapter = createBankStatementsFileAdapter({ accountLabel: label });
    const { pod, report } = await fileImport(adapter, memoryFile("first.csv", MONZO));
    const firstUrl = report.written[1]?.url ?? "";
    expect(firstUrl).toMatch(/\/monzo-[0-9a-f]{64}\/2026-07\.ttl$/);
    expect(firstUrl).not.toContain(label);
    expect((await transactions(pod, [firstUrl]))[0]?.id).toMatch(/#txn-[0-9a-f]{64}$/);
    const other = createBankStatementsFileAdapter({ accountLabel: "Other account" });
    const { report: otherReport } = await fileImport(other, memoryFile("second.csv", MONZO), {
      pod,
    });
    const otherUrl = otherReport.written[1]?.url ?? "";
    const before = pod.get(otherUrl);
    const row = MONZO.split("\n")[1] ?? "";
    await fileImport(
      adapter,
      memoryFile("overlap.csv", `${MONZO}\n${row.replace("synthetic-1", "synthetic-2")}`),
      { pod },
    );
    expect(await transactions(pod, [firstUrl])).toHaveLength(2);
    expect(pod.get(otherUrl)).toBe(before);
    expect(pod.get(DOC)).toBeUndefined();
  });
});

describe("bank row identity and values", () => {
  it("keeps identical HSBC purchases distinct and re-imports idempotent", async () => {
    const row = "01/07/2026,Identical purchase,-5.00";
    const text = `${row}\n02/07/2026,Other,1\n${row}`;
    const options = { csvFormat: "hsbc-uk" as const, accountLabel: "Everyday" };
    const adapter = createBankStatementsFileAdapter(options);
    const parsed = parseBankCsv(text, 100, options);
    expect(parsed.map((txn) => txn.occurrence)).toEqual([0, 0, 1]);
    expect(new Set(parsed.map(transactionKey)).size).toBe(3);
    const { pod } = await fileImport(adapter, memoryFile("a.csv", text));
    const ids = (await transactions(pod)).map((txn) => txn.id).sort();
    expect(
      (await transactions(pod)).filter((txn) => txn.description === "Identical purchase"),
    ).toHaveLength(2);
    const turtle = monthDocuments(pod).map((url) => pod.get(url));
    await fileImport(adapter, new File([text], "renamed.csv"), { pod });
    await fileImport(adapter, memoryFile("overlap.csv", `${row}\n${row}`), { pod });
    expect((await transactions(pod)).map((txn) => txn.id).sort()).toEqual(ids);
    // Upserts reuse each monetary amount node: re-imports do not grow the document.
    expect(monthDocuments(pod).map((url) => pod.get(url)?.length)).toEqual(
      turtle.map((text) => text?.length),
    );
  });

  it.each([
    ["-12.50", "-0.20", "-12.30"],
    ["0.00", "-0.50", "0.50"],
    ["9007199254740993.01", "-0.02", "9007199254740993.03"],
    ["-0.01", "0.02", "-0.03"],
  ])("subtracts signed fees exactly (%s - %s)", async (amount, fee, net) => {
    const text = `${REVOLUT_HEADER}\n${REVOLUT_ROWS[0].replace("-12.50,0.20", `${amount},${fee}`)}`;
    expect(parseBankCsv(text)[0]?.amount).toBe(net);
    const { pod, report } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("fees.csv", text),
    );
    expect(report.skipped).toBeUndefined();
    const [txn] = await transactions(pod);
    expect(txn?.amount).toBe(net);
    // No solid-money fee field: the signed fee is kept, with its currency, in the description.
    expect(txn?.description).toBe(`Synthetic café, "Orbit" (fee ${fee} GBP)`);
  });

  it("omits zero fees, including when a merge replaces a formerly nonzero fee", async () => {
    const { pod } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("fee.csv", `${REVOLUT_HEADER}\n${REVOLUT_ROWS[0]}`),
    );
    const zero = REVOLUT_ROWS[0].replace("-12.50,0.20", "-12.70,-0.00");
    await fileImport(
      bankStatementsFileAdapter,
      memoryFile("zero.csv", `${REVOLUT_HEADER}\n${zero}`),
      { pod },
    );
    const rows = await transactions(pod);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe('Synthetic café, "Orbit"');
    expect(rows[0]?.amount).toBe("-12.70");
  });

  it("preserves the OFX posting date as xsd:dateTime at UTC midnight", async () => {
    const { pod } = await fileImport(bankStatementsFileAdapter, memoryFile("a.ofx", OFX));
    expect(pod.dataset(DOC).getObjects(null, `${NS.SCHEMA}dateCreated`, null)[0]).toMatchObject({
      value: "2026-01-20T00:00:00.000Z",
      datatype: { value: `${NS.XSD}dateTime` },
    });
  });
});

describe("Revolut wall-clock time zones", () => {
  it.each([
    [undefined, "2026-03-29 01:30:00", "2026-03-29T01:30:00.000Z"],
    ["America/New_York", "2026-03-08 02:30:00.123", "2026-03-08T07:30:00.123Z"],
    ["America/New_York", "2026-11-01 01:30:00", "2026-11-01T05:30:00.000Z"],
    ["Asia/Kolkata", "2026-07-01 10:00:00", "2026-07-01T04:30:00.000Z"],
    ["Australia/Lord_Howe", "2026-10-04 02:15:00", "2026-10-03T15:45:00.000Z"],
    ["Pacific/Apia", "2011-12-30 12:00:00", "2011-12-30T22:00:00.000Z"],
    ["America/New_York", "2026-07-01T10:00:00+02:00", "2026-07-01T08:00:00.000Z"],
  ])("converts %s / %s with compatible disambiguation", async (timeZone, completed, expected) => {
    const text = `${REVOLUT_HEADER}\n${REVOLUT_ROWS[0].replace("2026-07-01 10:00:00", completed)}`;
    const adapter = createBankStatementsFileAdapter({ timeZone });
    expect(parseBankCsv(text, 100, { timeZone })[0]?.postingTime).toBe(expected);
    const { pod, report } = await fileImport(adapter, memoryFile("zone.csv", text));
    expect(report.skipped).toBeUndefined();
    expect((await transactions(pod))[0]?.postingTime).toBe(expected);
  });

  it.each([
    "",
    "Not/AZone",
    "+01:00",
    "Europe/London ",
    "x".repeat(257),
  ])("validates IANA zone %j before importing", (timeZone) => {
    expect(() => createBankStatementsFileAdapter({ timeZone })).toThrow("IANA time zone");
    expect(() => parseBankCsv(REVOLUT, 100, { timeZone })).toThrow("IANA time zone");
  });
});
