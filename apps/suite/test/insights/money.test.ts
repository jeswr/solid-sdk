// AUTHORED-BY Codex (GPT-6.1 Sol)
import { calendarDay, shiftDay } from "@jeswr/suite-insights";
import { describe, expect, it, vi } from "vitest";
import { loadSources, moneySource } from "../../src/apps/insights/lib/sources";
import {
  createAccount,
  readMoneyTransactions,
  storeOf,
  type Transaction,
} from "../../src/apps/insights/sources/adapters/money";
import { MoneyDocument, putAccount } from "../../src/apps/money/lib/model";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import type { PodSession } from "../../src/lib/session/pod-session";

function setup() {
  const pod = createDemoPod({ root: "https://insights.test/", latency: 0 });
  const session: PodSession = {
    mode: "demo",
    storageUrl: pod.root,
    webId: `${pod.root}profile#me`,
    displayName: "Fictional sample",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return session;
}

async function addAccount(session: PodSession, key: string, currency = "GBP") {
  return createAccount(session, key, {
    name: `Fictional ${key}`,
    type: "cash",
    currency,
    openingBalance: "1000",
    date: "2026-01-01",
  });
}

function posting(session: PodSession, account: string, at: string, key: string): Transaction {
  return {
    id: storeOf(session).transactionId(key, at),
    account,
    postingTime: at,
    amount: "-12",
    currency: "GBP",
    description: "Fictional spending",
  };
}

describe("Money source range and shard regressions", () => {
  it.each([
    ["Pacific/Auckland", "2026-11-30T12:30:00Z"],
    ["America/Los_Angeles", "2026-11-01T06:30:00Z"],
  ])("retains both boundary civil dates and trims extra days in %s", async (timeZone, at) => {
    const session = setup();
    const account = await addAccount(session, "everyday");
    const now = new Date(at);
    const end = calendarDay(now, timeZone);
    const start = shiftDay(end, -149);
    const dates = [shiftDay(start, -1), start, end, shiftDay(end, 1)];
    await storeOf(session).saveTransactions(
      dates.map((day, index) => posting(session, account.id, day, `boundary-${index}`)),
    );
    const result = await loadSources({ session, now, timeZone }, [moneySource]);
    expect(result[0]).toMatchObject({ status: "found", days: 2, droppedPoints: 0 });
    expect(result[0]?.series[0]?.points).toEqual([
      { at: start, value: 12 },
      { at: end, value: 12 },
    ]);
  });

  it("fetches each month once across accounts, retaining range and currency checks", async () => {
    const session = setup();
    const first = await addAccount(session, "everyday");
    const second = await addAccount(session, "savings");
    await addAccount(session, "unused");
    const rows = [
      posting(session, first.id, "2026-10-01", "before"),
      posting(session, first.id, "2026-10-15", "first-october"),
      posting(session, second.id, "2026-10-20", "second-october"),
      posting(session, first.id, "2026-11-02", "first-november"),
      posting(session, second.id, "2026-11-03", "second-november"),
      posting(session, second.id, "2026-11-30", "after"),
      posting(
        session,
        `${session.storageUrl}money/accounts/unlisted.ttl#account`,
        "2026-11-04",
        "unlisted",
      ),
    ];
    await storeOf(session).saveTransactions(rows);
    const fetch = vi.fn(session.fetch);
    const range = {
      start: new Date("2026-10-15T00:00:00Z"),
      end: new Date("2026-11-15T23:59:59Z"),
    };
    const result = await readMoneyTransactions({ ...session, fetch }, range);
    expect(result.map((row) => row.id).sort()).toEqual(
      rows
        .slice(1, 5)
        .map((row) => row.id)
        .sort(),
    );
    const shards = fetch.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/transactions/"));
    expect(shards).toEqual([
      `${session.storageUrl}money/transactions/2026-10.ttl`,
      `${session.storageUrl}money/transactions/2026-11.ttl`,
    ]);
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);

    await storeOf(session).saveTransactions([
      { ...posting(session, second.id, "2026-11-05", "wrong-currency"), currency: "EUR" },
    ]);
    await expect(readMoneyTransactions(session, range)).rejects.toThrow("Currency mismatch");
  });

  it("skips shards without accounts and rejects an account without an opening balance", async () => {
    const session = setup();
    const fetch = vi.fn(session.fetch);
    const range = { start: new Date("2026-10-01"), end: new Date("2026-11-30") };
    expect(await readMoneyTransactions({ ...session, fetch }, range)).toEqual([]);
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      `${session.storageUrl}money/accounts/`,
    ]);
    const store = storeOf(session);
    const url = store.resolve("accounts/incomplete.ttl");
    const document = new MoneyDocument();
    putAccount(document, { id: `${url}#account`, label: "Fictional incomplete account" });
    await store.write(url, document, { create: true });
    await expect(readMoneyTransactions(session, range)).rejects.toThrow("opening balance");
  });
});
