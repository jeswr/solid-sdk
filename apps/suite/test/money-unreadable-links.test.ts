// AUTHORED-BY Claude Opus 5.5
// A stored record whose optional link does not project lists without it and is read-only:
// no app flow may write the listed copy anywhere or delete the source's quads behind it.
import { describe, expect, it, vi } from "vitest";
import { createAccount } from "../src/apps/money/lib/data/accounts";
import { type MoneyClient, storeOf } from "../src/apps/money/lib/data/container";
import { commitImport, previewImport, suggestMapping } from "../src/apps/money/lib/data/import";
import {
  addTransaction,
  allTransactions,
  bulkCategorise,
  deleteTransaction,
  READ_ONLY_TRANSACTION,
  updateTransaction,
} from "../src/apps/money/lib/data/ledger";
import { categoriseByRules, type SavedRule } from "../src/apps/money/lib/data/rules";
import { type Category, parseMoney, serialiseMoney, V } from "../src/apps/money/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { must } from "./money/helpers";

const root = "https://unreadable.example/";
const G = `${root}money/categories.ttl#groceries`;
const categories: Category[] = [{ id: G, label: "Groceries" }];
const rule: SavedRule = { id: "r1", match: "contains", value: "tesco", category: G };

async function setup() {
  const pod = createDemoPod({ root, latency: 0 });
  const client: MoneyClient = { fetch: pod.fetch, storageUrl: pod.root };
  const account = await createAccount(client, "current", {
    name: "Current",
    type: "current",
    currency: "GBP",
    openingBalance: "0",
    date: "2026-08-01",
  });
  const add = (key: string, description: string, postingTime: string) =>
    addTransaction(client, key, {
      account: account.id,
      postingTime,
      description,
      amount: "-1",
      currency: "GBP",
    });
  return { client, store: storeOf(client), account, add };
}
/** Append raw Turtle about `id` to its shard, as another producer would. */
async function inject(client: MoneyClient, id: string, turtle: string) {
  const store = storeOf(client);
  const shard = await store.read(id.slice(0, id.indexOf("#")));
  const extra = await parseMoney(`<${id}> ${turtle} .`, shard.url);
  for (const quad of extra.dataset) shard.document.dataset.add(quad);
  await store.write(shard.url, shard.document, shard.condition);
  return shard.url;
}
async function shardText(client: MoneyClient, url: string) {
  return serialiseMoney((await storeOf(client).read(url)).document);
}

describe("Money records with unreadable optional links", () => {
  it("refuses a cross-month move before any write, keeping the source quads intact", async () => {
    const { client, add } = await setup();
    const good = await add("good", "Good", "2026-10-30");
    const bad = await add("bad", "Bad", "2026-10-31");
    const shard = await inject(client, bad.id, `<${V.derivedFrom}> <#stmtA>, <#stmtB>`);
    const listed = must((await allTransactions(client)).find((row) => row.id === bad.id));
    expect(listed.derivedFrom).toBeUndefined();
    expect(listed.unreadableLinks).toEqual(["derivedFrom"]);
    const writes = vi.fn();
    const watched: MoneyClient = {
      ...client,
      fetch: async (input, init) => {
        if (init?.method && init.method !== "GET") writes(String(input));
        return client.fetch(input, init);
      },
    };
    await expect(
      updateTransaction(watched, listed, { ...listed, postingTime: "2026-11-01" }),
    ).rejects.toThrow(READ_ONLY_TRANSACTION);
    // A snapshot without the marker (built elsewhere) is refused by the source check.
    const { unreadableLinks: _marker, ...unmarked } = listed;
    await expect(
      updateTransaction(watched, unmarked, { ...unmarked, postingTime: "2026-11-01" }),
    ).rejects.toThrow(READ_ONLY_TRANSACTION);
    await expect(
      updateTransaction(watched, unmarked, { ...unmarked, description: "In place" }),
    ).rejects.toThrow(READ_ONLY_TRANSACTION);
    expect(writes).not.toHaveBeenCalled();
    const text = await shardText(client, shard);
    expect(text).toContain("stmtA");
    expect(text).toContain("stmtB");
    const rows = await allTransactions(client);
    expect(rows.map((row) => row.id).sort()).toEqual([bad.id, good.id].sort());
    expect(rows.some((row) => row.postingTime.startsWith("2026-11"))).toBe(false);
  });

  it("refuses a move of a transfer leg whose debit and credit links are both unreadable", async () => {
    const { client, add } = await setup();
    const bad = await add("leg", "Leg", "2026-10-31");
    const shard = await inject(
      client,
      bad.id,
      `a <${V.transferClass}>; <${V.debitAccount}> "x"; <${V.creditAccount}> "y"`,
    );
    const listed = must((await allTransactions(client)).find((row) => row.id === bad.id));
    expect(listed.debitAccount ?? listed.creditAccount).toBeUndefined();
    expect(listed.unreadableLinks).toEqual(["debitAccount", "creditAccount"]);
    const { unreadableLinks: _marker, ...unmarked } = listed;
    await expect(
      updateTransaction(client, unmarked, { ...unmarked, postingTime: "2026-11-01" }),
    ).rejects.toThrow(READ_ONLY_TRANSACTION);
    expect(await allTransactions(client)).toHaveLength(1);
    expect(await shardText(client, shard)).toContain('"x"');
  });

  it("skips a record with a literal category in a rule run and files the others", async () => {
    const { client, add } = await setup();
    await add("s1", "Tesco 1", "2026-09-01");
    const bad = await add("s2", "Tesco 2", "2026-09-02");
    await add("s3", "Tesco 3", "2026-10-01");
    const shard = await inject(client, bad.id, `<${V.category}> "Groceries"`);
    expect(await categoriseByRules(client, [rule], categories)).toBe(2);
    const byDescription = Object.fromEntries(
      (await allTransactions(client)).map((row) => [row.description, row.category]),
    );
    expect(byDescription).toEqual({ "Tesco 1": G, "Tesco 2": undefined, "Tesco 3": G });
    expect(await shardText(client, shard)).toContain('"Groceries"');
    // Running again neither fails nor touches the bad record.
    expect(await categoriseByRules(client, [rule], categories)).toBe(0);
    // Bulk categorise refuses up front rather than half-applying a selection.
    const ids = (await allTransactions(client)).map((row) => row.id);
    await expect(bulkCategorise(client, ids)).rejects.toThrow("links Money can't read");
    expect((await allTransactions(client)).filter((row) => row.category === G)).toHaveLength(2);
  });

  it("checks every stored derivedFrom value against pending imports before a delete", async () => {
    const { client, account, add } = await setup();
    const text = "Date,Payee,Amount\n2026-09-03,A,-1\n2026-10-03,B,-2";
    const options = suggestMapping(text).options;
    const preview = await previewImport(client, account.id, "GBP", text, "csv", options);
    const broken: MoneyClient = {
      ...client,
      fetch: async (input, init) =>
        init?.method === "PUT" && String(init.body).includes('"completed"')
          ? new Response(null, { status: 500 })
          : client.fetch(input, init),
    };
    await expect(
      commitImport(broken, account.id, "GBP", text, "csv", options, preview, vi.fn()),
    ).rejects.toMatchObject({ status: 500 });
    const imported = must((await allTransactions(client)).find((row) => row.derivedFrom));
    const statement = must(imported.derivedFrom);
    // A second, overlapping source makes the link ambiguous, so it lists as absent.
    await inject(client, imported.id, `<${V.derivedFrom}> <${root}money/statements/other.csv>`);
    const listed = must((await allTransactions(client)).find((row) => row.id === imported.id));
    expect(listed.derivedFrom).toBeUndefined();
    await expect(deleteTransaction(client, listed)).rejects.toThrow("unfinished import");
    expect((await allTransactions(client)).some((row) => row.id === imported.id)).toBe(true);
    expect(statement).toContain("statements/statement-");
    // A record with an unreadable link that belongs to no pending import can still be deleted.
    const plain = await add("plain", "Plain", "2026-09-04");
    await inject(client, plain.id, `<${V.derivedFrom}> <#x>, <#y>`);
    const plainListed = must((await allTransactions(client)).find((row) => row.id === plain.id));
    await deleteTransaction(client, plainListed);
    expect((await allTransactions(client)).some((row) => row.id === plain.id)).toBe(false);
  });
});
