// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { createAccount, listAccounts, renameAccount } from "../src/apps/money/lib/data/accounts";
import { type MoneyClient, storeOf } from "../src/apps/money/lib/data/container";
import { commitImport, previewImport, suggestMapping } from "../src/apps/money/lib/data/import";
import {
  addTransaction,
  allTransactions,
  createTransfer,
  deleteTransaction,
  loadLedger,
  updateTransaction,
} from "../src/apps/money/lib/data/ledger";
import { putAccount } from "../src/apps/money/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { must } from "./money/helpers";

const input = {
  name: "Current",
  type: "current",
  currency: "GBP",
  openingBalance: "500",
  date: "2026-11-01",
} as const;
async function setup() {
  const pod = createDemoPod({ root: "https://round2.example/", latency: 0 });
  const client = { fetch: pod.fetch, storageUrl: pod.root };
  const account = await createAccount(client, "current", input);
  const value = {
    account: account.id,
    postingTime: input.date,
    description: "Purchase",
    currency: "GBP",
    amount: "-10",
  };
  return { pod, client, account, value, store: storeOf(client) };
}
function intercept(
  client: MoneyClient,
  handler: (url: string, init?: RequestInit) => Promise<Response | undefined>,
): MoneyClient {
  return {
    ...client,
    fetch: async (url, init) => (await handler(String(url), init)) ?? client.fetch(url, init),
  };
}
function lostWrite(client: MoneyClient, suffix: string) {
  return intercept(client, async (url, init) => {
    if (init?.method === "PUT" && url.endsWith(suffix)) {
      await client.fetch(url, init);
      throw new Error("Lost successful response");
    }
  });
}

describe("Money round 2 persistence regressions", () => {
  it("includes opening-day expenses in both current and running balances", async () => {
    const { client, value } = await setup();
    await addTransaction(client, "purchase", value);
    const account = must((await listAccounts(client, input.date))[0]);
    expect(account.asOf).toBe("2026-10-31T23:59:59.999Z");
    expect(account.currentBalance).toBe("490");
    expect(
      (await loadLedger(client, account, { start: input.date, end: input.date }))[0]
        ?.runningBalance,
    ).toBe("490");
    await expect(
      createAccount(client, "invalid", { ...input, date: "2026-02-30" }),
    ).rejects.toThrow("date");
  });
  it("reconciles account creation after a lost success and rejects changed or incomplete drafts", async () => {
    const { client, store } = await setup();
    const lost = lostWrite(client, "new.ttl");
    await expect(createAccount(lost, "new", input)).rejects.toThrow("Lost successful response");
    const saved = await createAccount(client, "new", input);
    expect(await createAccount(client, "new", input)).toEqual(saved);
    expect(await listAccounts(client, input.date)).toHaveLength(2);
    for (const changes of [
      { name: "Changed" },
      { type: "savings" as const },
      { openingBalance: "600" },
    ])
      await expect(createAccount(client, "new", { ...input, ...changes })).rejects.toMatchObject({
        status: 412,
      });
    const doc = await store.read("accounts/new.ttl");
    putAccount(doc.document, { id: saved.id, label: "Changed elsewhere" });
    await store.write(doc.url, doc.document, doc.condition);
    await expect(createAccount(client, "new", input)).rejects.toMatchObject({ status: 412 });
  });
  it("reconciles transaction and transfer retries, including changed dates, without duplicating", async () => {
    const { client, value } = await setup();
    const lost = lostWrite(client, "2026-11.ttl");
    await expect(addTransaction(lost, "purchase", value)).rejects.toThrow(
      "Lost successful response",
    );
    const row = await addTransaction(client, "purchase", value);
    expect(await allTransactions(client)).toEqual([row]);
    await expect(
      addTransaction(client, "purchase", { ...value, postingTime: "2026-12-01" }),
    ).rejects.toMatchObject({ status: 412 });
    await createAccount(client, "savings", { ...input, name: "Savings", type: "savings" });
    const accounts = await listAccounts(client, input.date);
    const from = must(accounts[0]);
    const to = must(accounts[1]);
    await expect(createTransfer(lost, "transfer", from, to, input.date, "20")).rejects.toThrow(
      "Lost successful response",
    );
    const pair = await createTransfer(client, "transfer", from, to, input.date, "20");
    expect(pair).toHaveLength(2);
    expect(await allTransactions(client)).toHaveLength(3);
    await expect(
      createTransfer(client, "transfer", from, to, input.date, "30"),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      createTransfer(client, "transfer", from, to, "2026-12-01", "20"),
    ).rejects.toMatchObject({ status: 412 });
  });
  it("does not overwrite a transaction created between the listing and shard read", async () => {
    const { client, value } = await setup();
    let once = true;
    const racing = intercept(client, async (url, init) => {
      if (once && !init?.method && url.endsWith("2026-11.ttl")) {
        once = false;
        await addTransaction(client, "purchase", value);
      }
    });
    await expect(addTransaction(racing, "purchase", value)).rejects.toThrow("already exists");
    expect(await allTransactions(client)).toHaveLength(1);
  });
  it("refuses to rename a disappeared account or recreate a missing subject", async () => {
    const { client, store, pod, account } = await setup();
    const url = store.resolve("accounts/current.ttl");
    await client.fetch(url, { method: "DELETE" });
    await expect(renameAccount(client, account.id, "Renamed")).rejects.toMatchObject({
      status: 412,
    });
    expect(pod.has(url)).toBe(false);
    await createAccount(client, "current", input);
    await expect(renameAccount(client, `${url}#missing`, "Renamed")).rejects.toMatchObject({
      status: 412,
    });
    let once = true;
    const racing = intercept(client, async (path, init) => {
      if (once && init?.method === "PUT" && path === url) {
        once = false;
        await client.fetch(url, { method: "DELETE" });
      }
    });
    await expect(renameAccount(racing, account.id, "Renamed")).rejects.toMatchObject({
      status: 412,
    });
    expect(pod.has(url)).toBe(false);
  });
  it.each([
    "read",
    "write",
  ])("rejects stale deletion and a race during the model's %s", async (phase) => {
    const { client, value } = await setup();
    const row = await addTransaction(client, "purchase", value);
    const edited = await updateTransaction(client, row, { ...row, amount: "-20" });
    await expect(deleteTransaction(client, row)).rejects.toMatchObject({ status: 412 });
    let once = true;
    let reads = 0;
    const racing = intercept(client, async (url, init) => {
      const boundary = phase === "read" ? !init?.method && ++reads === 2 : init?.method === "PUT";
      if (once && boundary && url.endsWith("2026-11.ttl")) {
        once = false;
        await updateTransaction(client, edited, { ...edited, description: "Newer edit" });
      }
    });
    await expect(deleteTransaction(racing, edited)).rejects.toMatchObject({ status: 412 });
    const current = must((await allTransactions(client))[0]);
    expect(current.description).toBe("Newer edit");
    const other = await addTransaction(client, "unrelated", value);
    await deleteTransaction(client, { ...current, runningBalance: "480" } as typeof current);
    expect(await allTransactions(client)).toEqual([other]);
    await expect(deleteTransaction(client, current)).resolves.toBeUndefined();
  });
  it("recovers an unfinished import after a saved row is moved to a different shard", async () => {
    const { client, account } = await setup();
    const text = "Date,Payee,Amount\n2026-09-01,Purchase,-10\n2026-10-01,Another,-20";
    const options = suggestMapping(text).options;
    const preview = await previewImport(client, account.id, "GBP", text, "csv", options);
    const broken = intercept(client, async (url, init) => {
      if (init?.method === "PUT" && url.endsWith("2026-10.ttl"))
        return new Response(null, { status: 500 });
    });
    await expect(
      commitImport(broken, account.id, "GBP", text, "csv", options, preview, () => {}),
    ).rejects.toMatchObject({ status: 500 });
    const saved = must((await allTransactions(client))[0]);
    const moved = await updateTransaction(client, saved, {
      ...saved,
      postingTime: "2026-12-15",
      description: "Moved purchase",
    });
    await commitImport(client, account.id, "GBP", text, "csv", options, preview, () => {}, true);
    const rows = await allTransactions(client);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(moved);
    expect(rows.some((row) => row.id === saved.id)).toBe(false);
  });
});
