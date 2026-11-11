// AUTHORED-BY Codex (GPT-6.1 Sol)
import { storeOf } from "@/apps/money/lib/data/container";
import type { Transaction } from "@/apps/money/lib/model";
import type { PodSession } from "@/lib/session/pod-session";

/** The ledger's ranged reader requests only month shards overlapping the window. */
export async function readMoneyTransactions(
  session: PodSession,
  range: { start: Date; end: Date },
): Promise<Transaction[]> {
  const store = storeOf(session);
  const rows: Transaction[] = [];
  for (const account of await store.accounts()) {
    if (!account.balance) throw new Error("This account has no opening balance");
    rows.push(
      ...(await store.transactions(
        account.id,
        { start: range.start.toISOString(), end: range.end.toISOString() },
        { amount: "0", currency: account.balance.currency },
      )),
    );
  }
  return rows;
}
export { ensureSample as seedMoney } from "@/apps/money/demo/sample";
export { createAccount } from "@/apps/money/lib/data/accounts";
export { provision, storeOf } from "@/apps/money/lib/data/container";
export type { Transaction } from "@/apps/money/lib/model";
