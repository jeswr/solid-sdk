// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  describeRecurrence,
  recurringPayments,
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

  it("keeps a schedule up to a week after a missed date", () => {
    const rows = monthly("Phone", "12", "-18", ["07", "08", "09"]);
    expect(recurringPayments(rows, `2026-10-${12 + STOPPED_AFTER_DAYS}`)).toHaveLength(1);
    expect(recurringPayments(rows, `2026-10-${13 + STOPPED_AFTER_DAYS}`)).toHaveLength(0);
  });

  it("skips an account whose history the detector refuses, keeping the others", () => {
    const other = "https://pod.example/money/accounts/other.ttl#it";
    const rows = [
      ...monthly("Rent", "01", "-1100", ["08", "09", "10"]),
      // A duplicate id makes the detector refuse this account's history.
      ...monthly("Club", "02", "-10", ["08", "09", "10"]).map((value) => ({
        ...value,
        id: "https://pod.example/dup",
        account: other,
      })),
    ];
    expect(recurringPayments(rows, "2026-10-28").map((value) => value.payee)).toEqual(["Rent"]);
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
