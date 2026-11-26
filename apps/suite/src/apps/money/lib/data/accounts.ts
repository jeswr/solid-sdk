// AUTHORED-BY Codex GPT-6
import {
  addAmounts,
  type Balance,
  instant,
  MoneyDocument,
  putAccount,
  putBalance,
} from "@jeswr/solid-money";
import { MoneyIoError } from "../model";
import { parseMoney } from "../reports";
import { type MoneyClient, provision, storeOf } from "./container";
import { allTransactions } from "./ledger";
import { reconcileMutation } from "./mutations";
export const accountTypes = ["current", "savings", "credit card", "cash"] as const;
export type AccountType = (typeof accountTypes)[number];
export interface AccountSummary {
  id: string;
  label: string;
  type: string;
  currency: string;
  balance: Balance;
  asOf: string;
  currentBalance: string;
}
export async function listAccounts(client: MoneyClient, today: string): Promise<AccountSummary[]> {
  const store = storeOf(client);
  const transactions = await allTransactions(client);
  return Promise.all(
    (await store.accounts()).map(async (account) => {
      if (!account.balance) throw new Error("This account has no opening balance");
      const document = (await store.read(account.id.slice(0, account.id.indexOf("#")))).document;
      const asOf = account.balance.asOf ?? "0001-01-01";
      let currentBalance = account.balance.amount;
      for (const row of transactions)
        if (
          row.account === account.id &&
          Date.parse(row.postingTime) > Date.parse(asOf) &&
          row.postingTime.slice(0, 10) <= today
        ) {
          if (row.currency !== account.balance.currency)
            throw new Error("Account currency mismatch");
          currentBalance = addAmounts(currentBalance, row.amount);
        }
      return {
        ...account,
        balance: account.balance,
        asOf,
        currency: account.balance.currency,
        type: document.node(account.id).description ?? "current",
        currentBalance,
      };
    }),
  );
}
export async function createAccount(
  client: MoneyClient,
  key: string,
  input: {
    name: string;
    type: AccountType;
    currency: string;
    openingBalance: string;
    date: string;
  },
) {
  parseMoney(input.currency, input.openingBalance);
  if (!accountTypes.includes(input.type)) throw new Error("Choose an account type");
  const store = storeOf(client);
  const url = store.resolve(`accounts/${key}.ttl`);
  const account = { id: `${url}#account`, label: input.name.trim() };
  const document = new MoneyDocument();
  putAccount(document, account);
  document.node(account.id).description = input.type;
  putBalance(document, {
    id: `${url}#opening`,
    account: account.id,
    amount: input.openingBalance,
    currency: input.currency,
    asOf: new Date(instant(input.date) - 1).toISOString(),
  });
  await provision(client);
  const existing = await store.read(url);
  if (existing.exists) {
    const saved = existing.document.accounts().find((row) => row.id === account.id);
    const opening = existing.document.balances().find((row) => row.id === `${url}#opening`);
    if (
      saved?.label !== account.label ||
      existing.document.node(account.id).description !== input.type ||
      JSON.stringify(opening) !== JSON.stringify(document.balances()[0])
    )
      throw new MoneyIoError(412);
    return saved;
  }
  await store.write(url, document, { create: true });
  return account;
}
export async function renameAccount(client: MoneyClient, id: string, label: string) {
  const store = storeOf(client);
  const read = () => store.read(id.slice(0, id.indexOf("#")));
  const loaded = await read();
  await reconcileMutation(
    loaded,
    (value) => value.document.accounts().some((row) => row.id === id && row.label === label),
    async () => {
      if (!loaded.document.accounts().some((row) => row.id === id)) throw new MoneyIoError(412);
      putAccount(loaded.document, { id, label });
      await store.write(loaded.url, loaded.document, loaded.condition);
    },
    read,
  );
}
