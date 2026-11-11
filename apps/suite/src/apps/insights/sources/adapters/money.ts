// AUTHORED-BY Codex (GPT-6.1 Sol)
import { storeOf } from "@/apps/money/lib/data/container";
import { monthKeys, runningBalance, type Transaction } from "@/apps/money/lib/model";
import type { PodSession } from "@/lib/session/pod-session";

/** Read overlapping month shards once, then apply Money's ledger checks per account. */
export async function readMoneyTransactions(
  session: PodSession,
  range: { start: Date; end: Date },
): Promise<Transaction[]> {
  const store = storeOf(session);
  const accounts = (await store.accounts()).map((account) => {
    if (!account.balance) throw new Error("This account has no opening balance");
    return { id: account.id, currency: account.balance.currency, rows: [] as Transaction[] };
  });
  if (!accounts.length) return [];
  const byAccount = new Map(accounts.map((account) => [account.id, account]));
  const window = { start: range.start.toISOString(), end: range.end.toISOString() };
  for (const month of monthKeys(window)) {
    const { document } = await store.read(`transactions/${month}.ttl`);
    for (const row of document.transactions()) byAccount.get(row.account)?.rows.push(row);
  }
  return accounts.flatMap((account) =>
    runningBalance(account.rows, account.id, { amount: "0", currency: account.currency }, window),
  );
}
export { ensureSample as seedMoney } from "@/apps/money/demo/sample";
export { createAccount } from "@/apps/money/lib/data/accounts";
export { provision, storeOf } from "@/apps/money/lib/data/container";
export type { Transaction } from "@/apps/money/lib/model";
