// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { refuseRedirects } from "@jeswr/guarded-fetch";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import type { AccountSummary } from "../lib/data/accounts";
import type { BudgetFile } from "../lib/data/budget";
import { loadCategories } from "../lib/data/categories";
import { type MoneyClient, moneyRoot, storeOf } from "../lib/data/container";
import { loadRules, RulesFileError } from "../lib/data/rules";
import {
  addAmounts,
  categoryTree,
  latestBalance,
  MoneyIoError,
  type Transaction,
} from "../lib/model";
import { readBudget } from "../lib/model/budget";

export interface ReadProblem {
  url: string;
  kind: "accounts" | "transactions" | "categories" | "rules" | "budgets";
  error: unknown;
}

/** A missing collection is first use; a member advertised by a listing is required. */
export async function readMoneySnapshot(client: MoneyClient, today: string) {
  const store = storeOf(client);
  const problems: ReadProblem[] = [];
  const root = moneyRoot(client);
  let members = new Set<string>();
  try {
    const result = await fetchRdf(root, { fetch: refuseRedirects(client.fetch) });
    members = new Set(
      [...new Container(root, result.dataset, DataFactory).contains].map((n) => n.value),
    );
  } catch (error) {
    if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
  }
  const indexedClient: MoneyClient = {
    ...client,
    fetch: async (input, init) => {
      const response = await client.fetch(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (response.status === 404 && members.has(url)) throw new MoneyIoError(404);
      return response;
    },
  };
  const required = async (url: string) => {
    const loaded = await store.read(url);
    if (!loaded.exists) throw new MoneyIoError(404);
    return loaded;
  };
  const listing = async (path: string) => {
    const loaded = await store.read(path);
    if (!loaded.exists && members.has(loaded.url)) throw new MoneyIoError(404);
    return [...new Container(loaded.url, loaded.document.dataset, DataFactory).contains].map((n) =>
      store.resolve(n.value),
    );
  };
  // Read the main indexes before item reads: a failed index cannot masquerade as an empty list.
  const accountUrls = await listing("accounts/");
  const transactionUrls = await listing("transactions/");
  const transactions: Transaction[] = [];
  const collect = async (kind: ReadProblem["kind"], url: string, read: () => Promise<void>) => {
    try {
      await read();
    } catch (error) {
      problems.push({ kind, url, error });
    }
  };
  for (const url of transactionUrls.filter((url) => /\/transactions\/\d{4}-\d{2}\.ttl$/.test(url)))
    await collect("transactions", url, async () => {
      transactions.push(...(await required(url)).document.transactions());
    });
  const accountDocuments: Awaited<ReturnType<typeof required>>[] = [];
  for (const url of accountUrls)
    await collect("accounts", url, async () => {
      const loaded = await required(url);
      // Validate each document before including it in the cross-document balance lookup.
      loaded.document.accounts();
      loaded.document.balances();
      accountDocuments.push(loaded);
    });
  const accounts: AccountSummary[] = [];
  const balances = accountDocuments.flatMap(({ document }) => document.balances());
  for (const { url, document } of accountDocuments)
    await collect("accounts", url, async () => {
      const rows = document.accounts().map((account): AccountSummary => {
        const balance = latestBalance(balances, account.id);
        if (!balance) throw new Error("This account has no opening balance");
        const asOf = balance.asOf ?? "0001-01-01";
        const currentBalance = transactions
          .filter(
            (row) =>
              row.account === account.id &&
              Date.parse(row.postingTime) > Date.parse(asOf) &&
              row.postingTime.slice(0, 10) <= today,
          )
          .reduce((amount, row) => {
            if (row.currency !== balance.currency) throw new Error("Account currency mismatch");
            return addAmounts(amount, row.amount);
          }, balance.amount);
        return {
          ...account,
          balance,
          asOf,
          currentBalance,
          currency: balance.currency,
          type: document.node(account.id).description ?? "current",
        };
      });
      accounts.push(...rows);
    });
  let categories: Awaited<ReturnType<typeof loadCategories>> = { categories: [], upgraded: false };
  await collect("categories", store.resolve("categories.ttl"), async () => {
    const result = await loadCategories(indexedClient);
    categoryTree(result.categories);
    categories = result;
  });
  let rules: Awaited<ReturnType<typeof loadRules>>["rules"] = [];
  let rulesProblem: "invalid" | "unavailable" | undefined;
  await collect("rules", store.resolve("rules.json"), async () => {
    try {
      rules = (await loadRules(indexedClient)).rules;
    } catch (error) {
      rulesProblem = error instanceof RulesFileError ? "invalid" : "unavailable";
      throw error;
    }
  });
  const budgets: BudgetFile[] = [];
  let budgetProblem: unknown;
  await collect("budgets", store.resolve("budgets/"), async () => {
    let urls: string[];
    try {
      urls = await listing("budgets/");
    } catch (error) {
      budgetProblem = error;
      throw error;
    }
    for (const url of urls) {
      const name = url.slice(store.resolve("budgets/").length);
      if (!url.startsWith(store.resolve("budgets/")) || !/^\d{4}-(0[1-9]|1[0-2])\.ttl$/.test(name))
        continue;
      await collect("budgets", url, async () => {
        const loaded = await required(url);
        const month = name.slice(0, 7);
        budgets.push({ month, assignments: readBudget(loaded.document, url, month) });
      });
    }
  });
  return {
    accounts,
    transactions,
    ...categories,
    rules,
    rulesProblem,
    budgets,
    budgetProblem,
    problems,
  };
}
