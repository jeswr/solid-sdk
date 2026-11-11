// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { fileImport, type MemoryPod, memoryFile, TEST_POD_ROOT } from "../core/testing.js";
import { CLASSES } from "../core/vocab.js";
import { transactionKey } from "./csv.js";
import {
  bankStatementsFileAdapter,
  createBankStatementsFileAdapter,
  parseBankCsv,
} from "./file-adapter.js";
import { HSBC, MONZO, OFX, REVOLUT, REVOLUT_HEADER, REVOLUT_ROWS } from "./fixtures.js";
import { BANK, BankInvoice } from "./vocab.js";

function bankDocuments(pod: MemoryPod): string[] {
  return pod.urls().filter((url) => url.includes("/finance/bank/") && url.endsWith(".ttl"));
}
function bankDataset(pod: MemoryPod): Store {
  const result = new Store();
  for (const url of bankDocuments(pod)) for (const quad of pod.dataset(url)) result.add(quad);
  return result;
}

const DOC = `${TEST_POD_ROOT}integrations/bank-statements/finance/bank-transactions.ttl`;
function invoices(ds: Store): BankInvoice[] {
  return ds
    .getSubjects(null, CLASSES.Invoice, null)
    .map((subject) => new BankInvoice(subject, ds, DataFactory));
}
const GENERIC =
  "Posting Date,Payee,Value,Currency\n20/07/2026,Synthetic shop,GBP -12.50,USD\n07/21/26,,(3.20),EUR\ninvalid,Synthetic credit,£+001.20,GBP\n2026-07-01,invalid,missing,GBP";

describe("generic CSV compatibility", () => {
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
    expect(rows.every((row) => !row.account && !row.priceCurrency)).toBe(true);
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
  it.each([
    false,
    true,
  ])("keeps generic and Monzo imports isolated (generic first: %s)", async (genericFirst) => {
    const imports = genericFirst ? [GENERIC, MONZO] : [MONZO, GENERIC];
    const { pod, report: first } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("first.csv", imports[0] ?? ""),
    );
    const firstUrl = first.written[0]?.url ?? "";
    const before = pod.get(firstUrl);
    const firstTag = (await pod.fetch(firstUrl)).headers.get("etag");
    const { report: second } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("next.csv", imports[1] ?? ""),
      { pod },
    );
    expect(pod.get(firstUrl)).toBe(before);
    expect((await pod.fetch(firstUrl)).headers.get("etag")).toBe(firstTag);
    expect(second.written[0]?.url).not.toBe(firstUrl);
    expect(invoices(pod.dataset(DOC))).toHaveLength(3);
    const [monzoUrl] = bankDocuments(pod);
    expect(monzoUrl).toMatch(/\/finance\/bank\/monzo-[0-9a-f]{64}\.ttl$/);
    expect(invoices(bankDataset(pod))).toHaveLength(1);
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
    const firstUrl = report.written[0]?.url ?? "";
    expect(firstUrl).toMatch(/\/monzo-[0-9a-f]{64}\.ttl$/);
    expect(firstUrl).not.toContain(label);
    expect(invoices(pod.dataset(firstUrl))[0]?.value).toMatch(/#txn-[0-9a-f]{64}$/);
    const other = createBankStatementsFileAdapter({ accountLabel: "Other account" });
    const { report: otherReport } = await fileImport(other, memoryFile("second.csv", MONZO), {
      pod,
    });
    const otherUrl = otherReport.written[0]?.url ?? "";
    const before = pod.get(otherUrl);
    const row = MONZO.split("\n")[1] ?? "";
    await fileImport(
      adapter,
      memoryFile("overlap.csv", `${MONZO}\n${row.replace("synthetic-1", "synthetic-2")}`),
      { pod },
    );
    expect(invoices(pod.dataset(firstUrl))).toHaveLength(2);
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
    const ids = invoices(bankDataset(pod))
      .map((txn) => txn.value)
      .sort();
    expect(
      invoices(bankDataset(pod)).filter((txn) => txn.name === "Identical purchase"),
    ).toHaveLength(2);
    await fileImport(adapter, new File([text], "renamed.csv"), { pod });
    await fileImport(adapter, memoryFile("overlap.csv", `${row}\n${row}`), { pod });
    expect(
      invoices(bankDataset(pod))
        .map((txn) => txn.value)
        .sort(),
    ).toEqual(ids);
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
    const ds = bankDataset(pod);
    expect(invoices(ds)[0]?.totalPaymentDue).toBe(net);
    const fees = ds.getObjects(null, BANK.fee, null);
    expect(fees).toHaveLength(1);
    expect(fees[0]?.value).toBe(`${fee} GBP`);
    expect(fees[0]).toMatchObject({ termType: "Literal", datatype: { value: `${NS.XSD}string` } });
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
    expect(invoices(bankDataset(pod))).toHaveLength(1);
    expect(bankDataset(pod).getObjects(null, BANK.fee, null)).toEqual([]);
  });

  it("preserves the OFX posting date as xsd:dateTime at UTC midnight", async () => {
    const { pod } = await fileImport(bankStatementsFileAdapter, memoryFile("a.ofx", OFX));
    expect(pod.dataset(DOC).getObjects(null, BANK.postingTime, null)[0]).toMatchObject({
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
    expect(invoices(bankDataset(pod))[0]?.postingTime).toBe(expected);
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
