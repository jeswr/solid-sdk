// AUTHORED-BY Codex GPT-6
import type { PodSession } from "@/lib/session/pod-session";
import type { AccountSummary } from "../lib/data/accounts";
import { createAccount } from "../lib/data/accounts";
import { saveCategories } from "../lib/data/categories";
import { moneyRoot, storeOf } from "../lib/data/container";
import { addTransaction, createTransfer } from "../lib/data/ledger";
import type { Category } from "../lib/model";

const flights = new WeakMap<typeof globalThis.fetch, Promise<void>>();
export function ensureSample(session: PodSession, now = new Date()): Promise<void> {
  const existing = flights.get(session.fetch);
  if (existing) return existing;
  const task = seed(session, now).catch((error) => {
    flights.delete(session.fetch);
    throw error;
  });
  flights.set(session.fetch, task);
  return task;
}
async function seed(session: PodSession, now: Date) {
  if (session.mode !== "demo") return;
  const check = await session.fetch(moneyRoot(session), { method: "HEAD" });
  if (check.ok) return;
  if (check.status !== 404) throw new Error("Couldn't check sample data");
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 90);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const current = await createAccount(session, "current", {
    name: "Current account",
    type: "current",
    currency: "GBP",
    openingBalance: "2450",
    date: date(start),
  });
  const savings = await createAccount(session, "savings", {
    name: "Savings",
    type: "savings",
    currency: "GBP",
    openingBalance: "8200",
    date: date(start),
  });
  const base = storeOf(session).resolve("categories.ttl");
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
  await saveCategories(session, () => categories);
  const category = (label: string) => categories.find((c) => c.label === label)?.id;
  let index = 0;
  for (let day = 1; day <= 90; day++) {
    const at = new Date(start);
    at.setUTCDate(at.getUTCDate() + day);
    const postingTime = date(at);
    const write = (description: string, amount: string, label?: string) =>
      addTransaction(session, `sample-${index++}`, {
        account: current.id,
        postingTime,
        description,
        amount,
        currency: "GBP",
        ...(category(label ?? "") ? { category: category(label ?? "") as string } : {}),
      });
    if (at.getUTCDate() === 1) {
      await write("Northbank Studio · Salary", "3200", "Salary");
      await write("Willow Court · Rent", "-1100", "Rent");
      await createTransfer(
        session,
        `sample-transfer-${index++}`,
        { ...current, currency: "GBP" } as AccountSummary,
        { ...savings, currency: "GBP" } as AccountSummary,
        postingTime,
        "350",
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
}
