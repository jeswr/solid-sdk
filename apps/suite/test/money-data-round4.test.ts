// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { createAccount, listAccounts, renameAccount } from "../src/apps/money/lib/data/accounts";
import {
  deleteCategory,
  loadCategories,
  saveCategories,
} from "../src/apps/money/lib/data/categories";
import { type MoneyClient, storeOf } from "../src/apps/money/lib/data/container";
import {
  assertImportDeletionAllowed,
  commitImport,
  importStatus,
  previewImport,
  suggestMapping,
} from "../src/apps/money/lib/data/import";
import {
  addTransaction,
  allTransactions,
  bulkCategorise,
  deleteTransaction,
  updateTransaction,
} from "../src/apps/money/lib/data/ledger";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { must } from "./money/helpers";

async function fixture() {
  const pod = createDemoPod({ root: "https://round4.example/", latency: 0 });
  const client = { fetch: pod.fetch, storageUrl: pod.root };
  const account = await createAccount(client, "current", {
    name: "Current",
    type: "current",
    currency: "GBP",
    openingBalance: "500",
    date: "2026-09-01",
  });
  const store = storeOf(client);
  const root = store.resolve("categories.ttl");
  const food = { id: `${root}#food`, label: "Food" };
  const fun = { id: `${root}#fun`, label: "Fun" };
  await saveCategories(client, () => [food, fun]);
  const row = await addTransaction(client, "purchase", {
    account: account.id,
    currency: "GBP",
    amount: "-10",
    postingTime: "2026-10-02",
    description: "Shop",
  });
  return { client, store, account, row, food, fun };
}

describe("idempotent Money update and delete intents", () => {
  it.each([
    "debitAccount",
    "creditAccount",
  ] as const)("refuses an ordinary edit after the row gains a transfer %s", async (field) => {
    const { client, store, row } = await fixture();
    const loaded = await store.read("transactions/2026-10.ttl");
    loaded.document.node(row.id)[field] = row.account;
    await store.write(loaded.url, loaded.document, loaded.condition);
    await expect(updateTransaction(client, row, { ...row, amount: "-25" })).rejects.toThrow(
      "Transfer legs must be changed together",
    );
    expect((await allTransactions(client))[0]?.amount).toBe("-10");
  });
  it.each([
    "edit",
    "rename",
    "categorise",
    "rename category",
    "move category",
    "delete category",
    "delete row",
  ] as const)("recovers a lost response for %s without changing its result", async (kind) => {
    const { client, account, row, food, fun } = await fixture();
    const operation = (target: MoneyClient) => {
      switch (kind) {
        case "edit":
          return updateTransaction(target, row, {
            ...row,
            amount: "-25",
            payee: "https://round4.example/shop",
            category: food.id,
          });
        case "rename":
          return renameAccount(target, account.id, "Daily spending");
        case "categorise":
          return bulkCategorise(target, [row.id], food.id);
        case "rename category":
          return saveCategories(target, (tree) =>
            tree.map((category) =>
              category.id === food.id ? { ...category, label: "Meals" } : category,
            ),
          );
        case "move category":
          return saveCategories(target, (tree) =>
            tree.map((category) =>
              category.id === food.id ? { ...category, parent: fun.id } : category,
            ),
          );
        case "delete category":
          return deleteCategory(target, food.id);
        case "delete row":
          return deleteTransaction(target, row);
      }
    };
    let once = true;
    const lost: MoneyClient = {
      ...client,
      fetch: async (input, init) => {
        const response = await client.fetch(input, init);
        if (once && init?.method === "PUT" && response.ok) {
          once = false;
          throw new Error("Lost response");
        }
        return response;
      },
    };
    await expect(operation(lost)).rejects.toThrow("Lost response");
    const before = await allTransactions(client);
    const categories = await loadCategories(client);
    const accounts = await listAccounts(client, "2026-11-01");
    await operation(client);
    expect(await allTransactions(client)).toEqual(before);
    expect(await loadCategories(client)).toEqual(categories);
    expect(await listAccounts(client, "2026-11-01")).toEqual(accounts);
    if (kind === "edit") expect(before[0]).toMatchObject({ amount: "-25", category: food.id });
    if (kind === "delete row") expect(before).toEqual([]);
  });

  it.each([
    "edit",
    "rename",
    "categorise",
    "categories",
    "delete category",
    "delete row",
    "move",
  ] as const)("confirms an identical competing %s before reporting a 412", async (kind) => {
    const { client, account, row, food } = await fixture();
    const operation = (target: MoneyClient) => {
      switch (kind) {
        case "edit":
          return updateTransaction(target, row, { ...row, amount: "-25" });
        case "rename":
          return renameAccount(target, account.id, "Renamed");
        case "categorise":
          return bulkCategorise(target, [row.id], food.id);
        case "categories":
          return saveCategories(target, (tree) =>
            tree.map((category) => ({ ...category, label: "Renamed" })),
          );
        case "delete category":
          return deleteCategory(target, food.id);
        case "delete row":
          return deleteTransaction(target, row);
        case "move":
          return updateTransaction(target, row, { ...row, postingTime: "2026-11-02" });
      }
    };
    let once = true;
    const racing: MoneyClient = {
      ...client,
      fetch: async (input, init) => {
        if (once && init?.method === "PUT") {
          once = false;
          await operation(client);
        }
        return client.fetch(input, init);
      },
    };
    await operation(racing);
    expect(once).toBe(false);
    const rows = await allTransactions(client);
    expect(rows).toHaveLength(kind === "delete row" ? 0 : 1);
  });

  it.each([
    "label",
    "parent",
    "id",
    "length",
  ] as const)("rejects a different concurrent category %s", async (field) => {
    const { client, food, fun } = await fixture();
    let once = true;
    const racing: MoneyClient = {
      ...client,
      fetch: async (input, init) => {
        if (once && init?.method === "PUT") {
          once = false;
          const changed =
            field === "label"
              ? [{ ...food, label: "Other" }, fun]
              : field === "parent"
                ? [{ ...food, parent: fun.id }, fun]
                : field === "id"
                  ? [{ ...food, id: `${food.id}-other` }, fun]
                  : [fun];
          await saveCategories(client, () => changed);
        }
        return client.fetch(input, init);
      },
    };
    await expect(saveCategories(racing, () => [food, fun])).rejects.toMatchObject({ status: 412 });
  });
});

it("blocks deletion of pending-import rows, including moved rows, until recovery completes", async () => {
  const { client, row, account, store } = await fixture();
  const text = "Date,Payee,Amount\n2026-09-03,A,-1\n2026-10-03,B,-2";
  const options = suggestMapping(text).options;
  const preview = await previewImport(client, account.id, "GBP", text, "csv", options);
  const commit = (target: MoneyClient, recover = false) =>
    commitImport(target, account.id, "GBP", text, "csv", options, preview, vi.fn(), recover);
  const broken: MoneyClient = {
    ...client,
    fetch: async (input, init) =>
      init?.method === "PUT" && String(init.body).includes('"completed"')
        ? new Response(null, { status: 500 })
        : client.fetch(input, init),
  };
  await expect(commit(broken)).rejects.toMatchObject({ status: 500 });
  const saved = must((await allTransactions(client)).find((value) => value.derivedFrom));
  await expect(deleteTransaction(client, saved)).rejects.toThrow("Resume the statement import");
  const moved = await updateTransaction(client, saved, { ...saved, postingTime: "2026-11-02" });
  await expect(deleteTransaction(client, moved)).rejects.toThrow("unfinished import");
  expect(await importStatus(client, text)).toBe("pending");
  const balance = (await listAccounts(client, "2026-12-01"))[0]?.currentBalance;
  await commit(client, true);
  expect((await listAccounts(client, "2026-12-01"))[0]?.currentBalance).toBe(balance);
  expect(await allTransactions(client)).toHaveLength(3);
  await deleteTransaction(client, moved);
  await expect(commit(client, true)).rejects.toThrow("already been imported");
  expect(
    (await allTransactions(client)).some((value) => value.id === moved.id || value.id === saved.id),
  ).toBe(false);
  await deleteTransaction(client, row);
  // Legacy, unrelated and external provenance has no managed pending plan.
  await assertImportDeletionAllowed(client, "https://other.example/statements/statement-a.csv");
  await assertImportDeletionAllowed(client, store.resolve("statements/legacy.csv"));
  await assertImportDeletionAllowed(client, store.resolve("statements/statement-a.csv"));
  const forbidden: MoneyClient = {
    ...client,
    fetch: async () => new Response(null, { status: 403 }),
  };
  await expect(assertImportDeletionAllowed(forbidden, saved.derivedFrom)).rejects.toMatchObject({
    status: 403,
  });
});
