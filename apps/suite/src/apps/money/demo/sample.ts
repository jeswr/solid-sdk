// AUTHORED-BY Codex GPT-6
import type { PodSession } from "@/lib/session/pod-session";
import { parseMoney } from "../lib/budget";
import type { AccountSummary } from "../lib/data/accounts";
import { createAccount } from "../lib/data/accounts";
import { saveBudgetAssignments } from "../lib/data/budget";
import { saveCategories } from "../lib/data/categories";
import { provision, storeOf } from "../lib/data/container";
import {
  addTransaction,
  allTransactions,
  createTransfer,
  transactionKey,
} from "../lib/data/ledger";
import { type Category, MoneyIoError } from "../lib/model";

const flights = new WeakMap<typeof globalThis.fetch, Promise<void>>();
export function ensureSample(session: PodSession, now = new Date()): Promise<void> {
  const existing = flights.get(session.fetch);
  if (existing) return existing;
  const task = seed(session, now).finally(() => flights.delete(session.fetch));
  flights.set(session.fetch, task);
  return task;
}
async function seed(session: PodSession, now: Date) {
  if (session.mode !== "demo") return;
  const store = storeOf(session);
  const check = await session.fetch(store.resolve(".sample-complete"), {
    method: "HEAD",
    redirect: "error",
  });
  if (check.ok) return;
  if (check.status !== 404) throw new Error("Couldn't check sample data");
  await provision(session);
  // Reserve the date first so retries on later days retain the same IDs and values.
  await alreadyDone(() =>
    store.put(
      ".sample-progress.json",
      JSON.stringify({ at: now.toISOString() }),
      "application/json",
      {
        create: true,
      },
    ),
  );
  const progress = await session.fetch(store.resolve(".sample-progress.json"), {
    redirect: "error",
  });
  if (!progress.ok) throw new MoneyIoError(progress.status);
  const seedDate = new Date((await progress.json()).at);
  const start = new Date(seedDate);
  start.setUTCDate(start.getUTCDate() - 90);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  await alreadyDone(() =>
    createAccount(session, "current", {
      name: "Current account",
      type: "current",
      currency: "GBP",
      openingBalance: "2450",
      date: date(start),
    }),
  );
  await alreadyDone(() =>
    createAccount(session, "savings", {
      name: "Savings",
      type: "savings",
      currency: "GBP",
      openingBalance: "8200",
      date: date(start),
    }),
  );
  const current = {
    id: `${store.resolve("accounts/current.ttl")}#account`,
    currency: "GBP",
  } as AccountSummary;
  const savings = {
    id: `${store.resolve("accounts/savings.ttl")}#account`,
    currency: "GBP",
  } as AccountSummary;
  const base = store.resolve("categories.ttl");
  const categories: Category[] = [];
  for (const [parent, children] of [
    ["Income", ["Salary"]],
    ["Bills", ["Rent", "Utilities", "Phone"]],
    ["Food", ["Groceries", "Eating out"]],
    ["Transport", []],
    ["Fun", []],
  ] as const) {
    const id = `${base}#${parent.toLowerCase()}`;
    categories.push({ id, label: parent });
    for (const label of children)
      categories.push({
        id: `${base}#${label.toLowerCase().replaceAll(" ", "-")}`,
        label,
        parent: id,
      });
  }
  await alreadyDone(() => saveCategories(session, () => categories, true));
  const category = (label: string) => categories.find((c) => c.label === label)?.id;
  let index = 0;
  for (let day = 1; day <= 90; day++) {
    const at = new Date(start);
    at.setUTCDate(at.getUTCDate() + day);
    const postingTime = date(at);
    const write = (description: string, amount: string, label?: string) => {
      const key = `sample-${index++}`;
      return alreadyDone(
        () =>
          addTransaction(session, key, {
            account: current.id,
            postingTime,
            description,
            amount,
            currency: "GBP",
            ...(category(label ?? "") ? { category: category(label ?? "") as string } : {}),
          }),
        async () => (await allTransactions(session)).some((row) => transactionKey(row.id) === key),
      );
    };
    if (at.getUTCDate() === 1) {
      await write("Northbank Studio · Salary", "3200", "Salary");
      await write("Willow Court · Rent", "-1100", "Rent");
      const key = `sample-transfer-${index++}`;
      await alreadyDone(
        () => createTransfer(session, key, current, savings, postingTime, "350"),
        async () => {
          const keys = new Set(
            (await allTransactions(session)).map((row) => transactionKey(row.id)),
          );
          return keys.has(`${key}-debit`) && keys.has(`${key}-credit`);
        },
      );
    }
    if (at.getUTCDate() === 12) {
      await write("Bright Energy", "-86.4", "Utilities");
      await write("Mobile plan", "-18", "Phone");
    }
    if (day % 7 === 0) {
      await write("Green Lane Market", `-${42 + (day % 19)}.65`, "Groceries");
      await write("The Corner Kitchen", "-24.5", "Eating out");
      await write("City transport", "-16.8", "Transport");
      await write(
        day % 14 === 0 ? "Weekend cinema" : "Bookshop",
        "-12",
        day % 21 === 0 ? undefined : "Fun",
      );
    }
  }
  for (const offset of [-1, 0]) {
    const month = new Date(seedDate);
    month.setUTCDate(1);
    month.setUTCMonth(month.getUTCMonth() + offset);
    await saveBudgetAssignments(
      session,
      month.toISOString().slice(0, 7),
      [
        { categoryId: category("Rent") as string, amount: parseMoney("GBP", "1100") },
        { categoryId: category("Groceries") as string, amount: parseMoney("GBP", "250") },
      ],
      [],
    );
  }
  await alreadyDone(() => store.put(".sample-complete", "", "text/plain", { create: true }));
}

/** A create conflict is a completed deterministic write from an earlier attempt. */
async function alreadyDone(write: () => Promise<unknown>, exists = async () => true) {
  try {
    await write();
  } catch (error) {
    if (!(error instanceof MoneyIoError) || error.status !== 412 || !(await exists())) throw error;
  }
}
