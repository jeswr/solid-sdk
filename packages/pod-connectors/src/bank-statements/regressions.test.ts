// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, type Store } from "n3";
import { describe, expect, it } from "vitest";
import { fileImport, memoryFile, TEST_POD_ROOT } from "../core/testing.js";
import { CLASSES } from "../core/vocab.js";
import { transactionKey } from "./csv.js";
import {
  bankStatementsFileAdapter,
  createBankStatementsFileAdapter,
  parseBankCsv,
} from "./file-adapter.js";
import { HSBC, MONZO, OFX, REVOLUT, REVOLUT_HEADER, REVOLUT_ROWS } from "./fixtures.js";
import { BANK, BankInvoice } from "./vocab.js";

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

describe("bank upgrade safety", () => {
  it.each([
    REVOLUT,
    OFX,
  ])("retires legacy invoices and companion activities in one ETag-guarded PUT (%#)", async (text) => {
    const legacyCsv =
      text === OFX
        ? "Date,Description,Amount\n2026-01-20,Synthetic groceries,-12.50"
        : `Date,Description,Amount\n${parseBankCsv(text)
            .map((txn) =>
              [
                txn.postingTime?.slice(0, 10),
                `"${txn.description.replaceAll('"', '""')}"`,
                txn.amount,
              ].join(","),
            )
            .join("\n")}`;
    const { pod } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("legacy.csv", legacyCsv),
    );
    const legacy = invoices(pod.dataset(DOC)).map((row) => row.value);
    const { pod: modern } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("monzo.csv", MONZO),
    );
    const modernIds = invoices(modern.dataset(DOC)).map((row) => row.value);
    await pod.fetch(DOC, { method: "PUT", body: `${pod.get(DOC)}\n${modern.get(DOC)}` });
    const before = await pod.fetch(DOC);
    const etag = before.headers.get("etag");
    const fetchPod = pod.fetch;
    let writes = 0;
    pod.fetch = async (input, init) => {
      if (input === DOC && init?.method === "PUT") {
        writes++;
        expect(new Headers(init.headers).get("if-match")).toBe(etag);
        for (const id of legacy) expect(String(init.body)).not.toContain(id);
      }
      return fetchPod(input, init);
    };
    const { report } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("reimport.csv", text),
      { pod },
    );
    expect(writes).toBe(1);
    expect(report.removedLegacySubjects).toBe(legacy.length);
    const ds = pod.dataset(DOC);
    expect(invoices(ds)).toHaveLength(text === OFX ? 2 : 4);
    for (const id of legacy) {
      expect(ds.countQuads(id, null, null, null)).toBe(0);
      expect(ds.countQuads(`${id}-activity`, null, null, null)).toBe(0);
    }
    for (const id of modernIds) expect(invoices(ds).some((row) => row.value === id)).toBe(true);
    expect(report.state?.counts.items).toBe(text === OFX ? 2 : 6);
    pod.fetch = fetchPod;
    const { report: again } = await fileImport(
      bankStatementsFileAdapter,
      memoryFile("again.csv", text),
      { pod },
    );
    expect(again.removedLegacySubjects).toBeUndefined();
    expect(invoices(pod.dataset(DOC))).toHaveLength(text === OFX ? 2 : 4);
  });

  it("refuses a stale migration ETag without deleting or inserting any invoices", async () => {
    const { pod } = await fileImport(bankStatementsFileAdapter, memoryFile("old.csv", GENERIC));
    const legacy = pod.get(DOC);
    const fetchPod = pod.fetch;
    pod.fetch = async (input, init) => {
      if (input === DOC && init?.method === "PUT") {
        await fetchPod(DOC, { method: "PUT", body: legacy });
      }
      return fetchPod(input, init);
    };
    await expect(
      fileImport(bankStatementsFileAdapter, memoryFile("new.csv", REVOLUT), { pod }),
    ).rejects.toThrow();
    expect(pod.get(DOC)).toBe(legacy);
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
    const ids = invoices(pod.dataset(DOC))
      .map((txn) => txn.value)
      .sort();
    expect(
      invoices(pod.dataset(DOC)).filter((txn) => txn.name === "Identical purchase"),
    ).toHaveLength(2);
    await fileImport(adapter, new File([text], "renamed.csv"), { pod });
    await fileImport(adapter, memoryFile("overlap.csv", `${row}\n${row}`), { pod });
    expect(
      invoices(pod.dataset(DOC))
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
    const ds = pod.dataset(DOC);
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
    expect(invoices(pod.dataset(DOC))).toHaveLength(1);
    expect(pod.dataset(DOC).getObjects(null, BANK.fee, null)).toEqual([]);
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
    expect(invoices(pod.dataset(DOC))[0]?.postingTime).toBe(expected);
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
