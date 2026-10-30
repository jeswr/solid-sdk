// AUTHORED-BY Codex GPT-6.1-Sol
import type * as model from "../src/apps/money/lib/model";
export const base = "https://pod.example/money/";
export const account = `${base}accounts/current.ttl#it`;
export const other = `${base}accounts/savings.ttl#it`;
export const source = `${base}statements/bank.csv`;
export const range = { start: "2026-10-01", end: "2026-10-31T23:59:59Z" };
export const money = { amount: "100", currency: "GBP" };
export const row: model.Transaction = {
  id: `${base}transactions/2026-10.ttl#tx`,
  account,
  amount: "-12.50",
  currency: "GBP",
  postingTime: "2026-10-24",
  description: "Market",
};
export const balance = { id: `${base}accounts/current.ttl#balance`, account, ...money };
export const categories: [model.Category, model.Category] = [
  { id: `${base}categories.ttl#food`, label: "Food" },
  { id: `${base}categories.ttl#shop`, label: "Shop", parent: `${base}categories.ttl#food` },
];
export const options = {
  columns: { date: "Date", description: "Payee", amount: "Amount", currency: "Currency" },
};
