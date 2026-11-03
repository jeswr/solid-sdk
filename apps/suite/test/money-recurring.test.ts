// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  describeRecurrence,
  recurringPayments,
  SHIFT_DAYS,
  STOPPED_AFTER_DAYS,
} from "../src/apps/money/lib/data/recurring";
import type { Transaction } from "../src/apps/money/lib/model";

let n = 0;
const row = (
  description: string,
  date: string,
  amount: string,
  extra: Partial<Transaction> = {},
): Transaction => ({
  id: `https://pod.example/money/transactions/${date.slice(0, 7)}.ttl#t${++n}`,
  account: "https://pod.example/money/accounts/current.ttl#it",
  postingTime: `${date}T09:00:00Z`,
  description,
  amount,
  currency: "GBP",
  ...extra,
});
const monthly = (description: string, day: string, amount: string, months: string[]) =>
  months.map((month) => row(description, `2026-${month}-${day}`, amount));

describe("recurring payments", () => {
  it("finds bills and income on a schedule, with their next date", () => {
    const rows = [
      ...monthly("Willow Court · Rent", "01", "-1100", ["08", "09", "10"]),
      ...monthly("Northbank Studio · Salary", "01", "3200", ["08", "09", "10"]),
      // Energy varies a little; still one schedule.
      row("Bright Energy", "2026-08-12", "-86.40"),
      row("Bright Energy", "2026-09-12", "-91.10"),
      row("Bright Energy", "2026-10-12", "-79.95"),
      // Weekly, with the payee field preferred over the description.
      ...["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].map((date) =>
        row("CARD 1234", date, "-12", { payee: "  City transport " }),
      ),
    ];
    const found = recurringPayments(rows, "2026-10-28");
    expect(found.map((value) => [value.payee, value.amount, value.nextDate, value.count])).toEqual(
      [
        ["City transport", "-12.00", "2026-11-02", 4],
        ["Northbank Studio · Salary", "3200.00", "2026-11-01", 3],
        ["Willow Court · Rent", "-1100.00", "2026-11-01", 3],
        ["Bright Energy", "-79.95", "2026-11-12", 3],
      ].sort(
        (a, b) =>
          String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0])),
      ),
    );
    expect(found.find((value) => value.payee === "Bright Energy")).toMatchObject({
      recurrence: { frequency: "monthly", day: 12 },
      lastDate: "2026-10-12",
      currency: "GBP",
    });
    expect(new Set(found.map((value) => value.key)).size).toBe(found.length);
  });

  it("leaves out transfers, unreadable rows, irregular payees and stopped schedules", () => {
    const rows = [
      ...monthly("Savings", "01", "-350", ["08", "09", "10"]).map((value) => ({
        ...value,
        debitAccount: "x",
      })),
      ...monthly("Savings in", "01", "350", ["08", "09", "10"]).map((value) => ({
        ...value,
        creditAccount: "x",
      })),
      ...monthly("   ", "03", "-5", ["08", "09", "10"]),
      ...monthly("Odd currency", "04", "-5", ["08", "09", "10"]).map((value) => ({
        ...value,
        currency: "XXX",
      })),
      // Amount swings too much to be one bill.
      row("Shop", "2026-08-05", "-5"),
      row("Shop", "2026-09-05", "-95"),
      row("Shop", "2026-10-05", "-50"),
      // Only twice.
      ...monthly("Gym", "06", "-30", ["09", "10"]),
      // Last seen in July: its August date passed long ago.
      ...monthly("Old subscription", "07", "-9.99", ["05", "06", "07"]),
    ];
    expect(recurringPayments(rows, "2026-10-28")).toEqual([]);
  });

  it("keeps a schedule up to a week after a missed date, marked late", () => {
    const rows = monthly("Phone", "12", "-18", ["07", "08", "09"]);
    expect(recurringPayments(rows, "2026-10-12")[0]?.late).toBe(false);
    const late = recurringPayments(rows, `2026-10-${12 + STOPPED_AFTER_DAYS}`);
    expect(late.map((value) => [value.nextDate, value.late])).toEqual([["2026-10-12", true]]);
    expect(recurringPayments(rows, `2026-10-${13 + STOPPED_AFTER_DAYS}`)).toHaveLength(0);
  });

  it("follows a price change and the latest run, ignoring older history", () => {
    const rows = [
      // A small rise stays one schedule, at the new price.
      ...monthly("Rent", "01", "-1100", ["04", "05", "06", "07"]),
      ...monthly("Rent", "01", "-1150", ["08", "09", "10"]),
      // A big rise starts a new run: the old one ends at the change.
      ...monthly("Broadband", "03", "-25", ["01", "02", "03", "04", "05"]),
      ...monthly("Broadband", "03", "-45", ["08", "09", "10"]),
      // Paid on the 5th until June, then moved to the 20th.
      ...monthly("Insurance", "05", "-40", ["01", "02", "03", "04", "05", "06"]),
      ...monthly("Insurance", "20", "-40", ["08", "09", "10"]),
    ];
    const found = recurringPayments(rows, "2026-10-28");
    expect(found.map((value) => [value.payee, value.amount, value.count])).toEqual([
      ["Rent", "-1150.00", 7],
      ["Broadband", "-45.00", 3],
      ["Insurance", "-40.00", 3],
    ]);
    expect(found.find((value) => value.payee === "Insurance")?.recurrence).toEqual({
      frequency: "monthly",
      day: 20,
    });
  });

  it("skips stray one-off payments to the same payee", () => {
    const rows = [
      ...monthly("Gym", "01", "-30", ["06", "07", "08", "09", "10"]),
      // A class paid for separately, mid-month.
      row("Gym", "2026-09-15", "-12"),
      // The latest payment is a one-off too.
      row("Gym", "2026-10-20", "-8"),
    ];
    expect(
      recurringPayments(rows, "2026-10-28").map((value) => [value.amount, value.count]),
    ).toEqual([["-30.00", 5]]);
  });

  it("allows more variation for larger amounts and in whole currency units", () => {
    const rows = [
      // 20% of 310 is 62: still one schedule.
      row("Council tax", "2026-08-01", "-260"),
      row("Council tax", "2026-09-01", "-300"),
      row("Council tax", "2026-10-01", "-310"),
      // Small payments may vary by £5.
      row("Coffee club", "2026-08-02", "-1"),
      row("Coffee club", "2026-09-02", "-5.50"),
      row("Coffee club", "2026-10-02", "-1"),
      // Yen have no minor unit: the floor is 5 yen, not 500.
      ...[
        ["2026-08-03", "-10"],
        ["2026-09-03", "-16"],
        ["2026-10-03", "-10"],
      ].map(([date, amount]) =>
        row("Locker", date as string, amount as string, { currency: "JPY" }),
      ),
    ];
    expect(recurringPayments(rows, "2026-10-28").map((value) => value.payee)).toEqual([
      "Council tax",
      "Coffee club",
    ]);
  });

  it("finds yearly payments, leaving out 29 February with no next date in range", () => {
    const yearly = (date: string) => row("Licence", date, "-169");
    expect(
      recurringPayments(
        [yearly("2024-03-01"), yearly("2025-03-01"), yearly("2026-03-01")],
        "2026-10-28",
      ),
    ).toMatchObject([{ recurrence: { frequency: "yearly" }, nextDate: "2027-03-01" }]);
    const leap = [yearly("2088-02-29"), yearly("2092-02-29"), yearly("2096-02-29")];
    expect(recurringPayments(leap, "2096-03-01")).toEqual([]);
    // No 29 February in 2100: nothing to walk back to.
    expect(recurringPayments([...leap, yearly("2104-02-29")], "2104-03-01")).toEqual([]);
  });

  it("skips one unreadable or zero row without losing its payee", () => {
    const rows = [
      ...monthly("Water", "09", "-30", ["07", "08", "09", "10"]),
      row("Water", "2026-10-09", "-30", { postingTime: "not a date" }),
      row("Water", "2026-10-10", "0"),
      row("Water", "2026-10-11", "not money"),
      // A one-off on the same day as the latest bill.
      row("Water", "2026-10-09", "-2"),
    ];
    expect(recurringPayments(rows, "2026-10-28").map((value) => value.count)).toEqual([4]);
  });

  it("keeps accounts apart", () => {
    const other = "https://pod.example/money/accounts/other.ttl#it";
    const rows = [
      ...monthly("Rent", "01", "-1100", ["08", "09", "10"]),
      ...monthly("Club", "02", "-10", ["08", "09"]),
      ...monthly("Club", "02", "-10", ["10"]).map((value) => ({ ...value, account: other })),
    ];
    expect(recurringPayments(rows, "2026-10-28").map((value) => value.payee)).toEqual(["Rent"]);
  });

  it("counts a payment taken a few days late, after a weekend", () => {
    // 1 November 2026 is a Sunday: the rent leaves on Tuesday the 3rd.
    const rows = [
      ...monthly("Rent", "01", "-1100", ["08", "09", "10"]),
      row("Rent", "2026-11-03", "-1100"),
    ];
    expect(recurringPayments(rows, "2026-11-05")).toMatchObject([
      {
        recurrence: { frequency: "monthly", day: 1 },
        count: 4,
        lastDate: "2026-11-03",
        nextDate: "2026-12-01",
        late: false,
      },
    ]);
    // Not late during the grace days, late after them.
    const before = rows.slice(0, 3);
    expect(recurringPayments(before, `2026-11-0${1 + SHIFT_DAYS}`)[0]?.late).toBe(false);
    expect(recurringPayments(before, `2026-11-0${2 + SHIFT_DAYS}`)[0]?.late).toBe(true);
  });

  it("finds two schedules with one payee, but not daily spending", () => {
    const rows = [
      ...monthly("Northbank · Pay", "01", "1500", ["07", "08", "09", "10"]),
      ...monthly("Northbank · Pay", "15", "1500", ["07", "08", "09", "10"]),
      // Every day for three months is no weekly schedule.
      ...Array.from({ length: 90 }, (_, day) =>
        row("Corner café", new Date(Date.UTC(2026, 7, 1 + day)).toISOString().slice(0, 10), "-3"),
      ),
    ];
    expect(
      recurringPayments(rows, "2026-10-28").map((value) => [
        value.payee,
        describeRecurrence(value.recurrence),
        value.count,
      ]),
    ).toEqual([
      ["Northbank · Pay", "Monthly on the 1st", 4],
      ["Northbank · Pay", "Monthly on the 15th", 4],
    ]);
  });

  it("handles the last day of the month and long histories quickly", () => {
    const ends = ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"];
    expect(
      recurringPayments(
        ends.map((date) => row("Card bill", date, "-40")),
        "2026-10-28",
      ),
    ).toMatchObject([
      { recurrence: { frequency: "monthly", day: "last" }, nextDate: "2026-10-31" },
    ]);
    // Ten years of weekly payments, plus noise from many other payees.
    const weekly = Array.from({ length: 520 }, (_, week) =>
      row("Allotment", new Date(Date.UTC(2016, 10, 7 + week * 7)).toISOString().slice(0, 10), "-4"),
    );
    const noise = Array.from({ length: 3000 }, (_, index) =>
      row(
        `Shop ${index % 40}`,
        new Date(Date.UTC(2017, 0, 1 + index)).toISOString().slice(0, 10),
        `-${1 + (index % 17)}`,
      ),
    );
    const started = performance.now();
    const found = recurringPayments([...weekly, ...noise], "2026-10-28");
    expect(performance.now() - started).toBeLessThan(500);
    expect(found.find((value) => value.payee === "Allotment")).toMatchObject({ count: 520 });
  });

  it("describes schedules in words", () => {
    expect(describeRecurrence({ frequency: "weekly" })).toBe("Weekly");
    expect(describeRecurrence({ frequency: "biweekly" })).toBe("Every 2 weeks");
    expect(describeRecurrence({ frequency: "yearly" })).toBe("Yearly");
    expect(describeRecurrence({ frequency: "monthly", day: "last" })).toBe(
      "Monthly on the last day",
    );
    expect(
      [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map((day) =>
        describeRecurrence({ frequency: "monthly", day }).replace("Monthly on the ", ""),
      ),
    ).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
  });
});
