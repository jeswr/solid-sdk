// AUTHORED-BY Codex GPT-6

import { NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ensureSample } from "../src/apps/money/demo/sample";
import * as accounts from "../src/apps/money/lib/data/accounts";
import * as categories from "../src/apps/money/lib/data/categories";
import {
  type MoneyClient,
  moneyRoot,
  provision,
  storeOf,
} from "../src/apps/money/lib/data/container";
import * as imports from "../src/apps/money/lib/data/import";
import * as ledger from "../src/apps/money/lib/data/ledger";
import { loadOverview, overview } from "../src/apps/money/lib/data/overview";
import { MoneyDocument, putAccount, putBalance, V } from "../src/apps/money/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { sgmlStatement } from "./fixtures/money-statements";
import { must } from "./money/helpers";

const today = "2026-11-01";
const range = { start: "2026-09-01", end: "2026-11-30T23:59:59Z" };
function setup() {
  const pod = createDemoPod({ root: "https://money.example/", latency: 0 });
  const client = { fetch: pod.fetch, storageUrl: pod.root };
  const session: PodSession = {
    ...client,
    mode: "demo",
    webId: `${pod.root}profile#me`,
    displayName: "Example",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return { pod, client, session, store: storeOf(client) };
}
async function account(client: MoneyClient, key = "current", currency = "GBP") {
  return accounts.createAccount(client, key, {
    name: key,
    type: "current",
    currency,
    openingBalance: "1000",
    date: "2026-08-31",
  });
}
async function add(
  client: MoneyClient,
  id: string,
  key: string,
  amount = "-10",
  date = "2026-10-20",
  category?: string,
) {
  return ledger.addTransaction(client, key.replaceAll(" ", "-"), {
    account: id,
    postingTime: date,
    description: key,
    amount,
    currency: "GBP",
    ...(category ? { category } : {}),
  });
}
const fail =
  (status: number): typeof globalThis.fetch =>
  async () =>
    new Response(null, { status });
describe("Money data against the demo pod", () => {
  it("provisions create-only, propagates failures, and creates, renames and computes current accounts", async () => {
    const { client, pod, store } = setup();
    expect(moneyRoot(client)).toBe(`${pod.root}money/`);
    await provision(client);
    await provision(client);
    for (const path of ["", "accounts/", "transactions/", "statements/"])
      expect(pod.has(`${moneyRoot(client)}${path}`)).toBe(true);
    await expect(provision({ ...client, fetch: fail(500) })).rejects.toMatchObject({ status: 500 });
    const a = await account(client);
    await account(client, "savings");
    await add(client, a.id, "before", "-22", "2026-08-15");
    await add(client, a.id, "later", "-10");
    await add(client, a.id, "future", "100", "2026-12-01");
    const loaded = await accounts.listAccounts(client, today);
    expect(must(loaded[0])).toMatchObject({
      currentBalance: "990",
      currency: "GBP",
      type: "current",
      asOf: "2026-08-30T23:59:59.999Z",
    });
    await accounts.renameAccount(client, a.id, "Daily spending");
    expect(must((await store.accounts())[0]).label).toBe("Daily spending");
    await expect(account(client)).rejects.toMatchObject({ status: 412 });
    await expect(
      accounts.createAccount(client, "bad", {
        name: "a",
        type: "wrong" as accounts.AccountType,
        currency: "GBP",
        openingBalance: "0",
        date: today,
      }),
    ).rejects.toThrow("type");
    await expect(accounts.renameAccount(client, a.id, " ")).rejects.toThrow();
    const extra = await store.read("accounts/savings.ttl");
    extra.document.node(`${extra.url}#account`).description = undefined;
    await store.write(extra.url, extra.document, extra.condition);
    expect(must((await accounts.listAccounts(client, today))[1]).type).toBe("current");
    const missing = new MoneyDocument();
    putAccount(missing, {
      id: `${store.resolve(must("accounts/missing.ttl#x".split("#")[0]))}#x`,
      label: "Missing",
    });
    await store.write("accounts/missing.ttl", missing, { create: true });
    await expect(accounts.listAccounts(client, today)).rejects.toThrow("opening balance");
  });
  it("handles undated snapshots and rejects a transaction in a different currency", async () => {
    const { client, store } = setup();
    const a = await account(client);
    const loaded = await store.read("accounts/current.ttl");
    const balance = must(loaded.document.balances()[0]);
    const { asOf: _asOf, ...undated } = balance;
    putBalance(loaded.document, undated);
    await store.write(loaded.url, loaded.document, loaded.condition);
    expect(must((await accounts.listAccounts(client, today))[0]).asOf).toBe("0001-01-01");
    await ledger.addTransaction(client, "foreign", {
      account: a.id,
      postingTime: today,
      description: "foreign",
      amount: "1",
      currency: "USD",
    });
    await expect(accounts.listAccounts(client, today)).rejects.toThrow("currency mismatch");
  });
  it("loads every shard, keeps balances through filters, edits and explicitly moves months", async () => {
    const { client, store } = setup();
    const a = await account(client);
    const cat = `${store.resolve("categories.ttl")}#food`;
    const first = await add(client, a.id, "first", "-10", "2026-09-01", cat);
    const second = await add(client, a.id, "second", "20", "2026-10-01");
    await add(client, a.id, "third", "-5", "2026-10-02", cat);
    await store.put("transactions/readme.txt", "inert", "text/plain", { create: true });
    const [summary] = (await accounts.listAccounts(client, today)) as [accounts.AccountSummary];
    const rows = await ledger.loadLedger(client, summary, range);
    expect(rows.map((r) => r.runningBalance)).toEqual(["990", "1010", "1005"]);
    expect(
      must(
        ledger.ledgerRows(
          summary,
          await ledger.allTransactions(client),
          range,
          {
            category: cat,
            sign: "out",
            query: "THIRD",
          },
          [{ id: cat, label: "Test category" }],
        )[0],
      ).runningBalance,
    ).toBe("1005");
    expect(
      ledger.ledgerRows(
        summary,
        await ledger.allTransactions(client),
        range,
        {
          category: "uncategorised",
          query: "second",
          sign: "in",
        },
        [{ id: cat, label: "Test category" }],
      ),
    ).toHaveLength(1);
    expect(
      ledger.ledgerRows(
        summary,
        await ledger.allTransactions(client),
        range,
        {
          category: cat,
          sign: "in",
        },
        [{ id: cat, label: "Test category" }],
      ),
    ).toHaveLength(0);
    await expect(add(client, a.id, "first", "1", "2026-09-01")).rejects.toMatchObject({
      status: 412,
    });
    await ledger.updateTransaction(client, first, { ...first, description: "updated" });
    await expect(
      ledger.updateTransaction(client, first, { ...first, id: `${first.id}x` }),
    ).rejects.toThrow("cannot change");
    const moved = await ledger.updateTransaction(client, second, {
      ...second,
      postingTime: "2026-11-01",
    });
    expect(moved.id).toContain("2026-11");
    expect((await ledger.allTransactions(client)).some((r) => r.id === second.id)).toBe(false);
    await ledger.deleteTransaction(client, moved);
    expect(await ledger.allTransactions(client)).toHaveLength(2);
  });
  it("rebases an intermediate latest snapshot so historical and filtered balances stay correct", async () => {
    const { client, store } = setup();
    const a = await account(client);
    await add(client, a.id, "early", "-20", "2026-09-20");
    await add(client, a.id, "at", "10", "2026-10-01");
    await add(client, a.id, "after", "-3", "2026-10-02");
    const loaded = await store.read("accounts/current.ttl");
    putBalance(loaded.document, {
      id: `${loaded.url}#latest`,
      account: a.id,
      amount: "1200",
      currency: "GBP",
      asOf: "2026-10-01",
    });
    await store.write(loaded.url, loaded.document, loaded.condition);
    const [summary] = (await accounts.listAccounts(client, today)) as [accounts.AccountSummary];
    expect(summary.currentBalance).toBe("1197");
    expect((await ledger.loadLedger(client, summary, range)).map((r) => r.runningBalance)).toEqual([
      "1190",
      "1200",
      "1197",
    ]);
  });
  it("compares balance snapshot instants exactly, including fractional seconds", async () => {
    const { client, store } = setup();
    const a = await account(client);
    const loaded = await store.read("accounts/current.ttl");
    putBalance(loaded.document, {
      id: `${loaded.url}#latest`,
      account: a.id,
      amount: "1000",
      currency: "GBP",
      asOf: "2026-10-01T12:00:00Z",
    });
    await store.write(loaded.url, loaded.document, loaded.condition);
    await add(client, a.id, "before-instant", "-5", "2026-10-01T11:59:59.999Z");
    await add(client, a.id, "at-instant", "10", "2026-10-01T12:00:00Z");
    await add(client, a.id, "after-instant", "20", "2026-10-01T12:00:00.100Z");
    const [summary] = (await accounts.listAccounts(client, today)) as [accounts.AccountSummary];
    expect(summary.currentBalance).toBe("1020");
    expect(
      (await ledger.loadLedger(client, summary, range)).map((row) => row.runningBalance),
    ).toEqual(["990", "1000", "1020"]);
  });
  it("bulk categorises once per shard, rejects missing rows and protects both transfer legs", async () => {
    const { client, store } = setup();
    const a = await account(client);
    await account(client, "other");
    const x = await add(client, a.id, "x");
    const y = await add(client, a.id, "y");
    const z = await add(client, a.id, "z", "-4", "2026-09-30");
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT") calls.push(String(input));
      return client.fetch(input, init);
    };
    const category = `${store.resolve("categories.ttl")}#a`;
    await ledger.bulkCategorise({ ...client, fetch }, [x.id, y.id, z.id], category);
    expect(calls).toHaveLength(2);
    await ledger.bulkCategorise(client, [x.id]);
    expect(
      (await ledger.allTransactions(client)).find((r) => r.id === x.id)?.category,
    ).toBeUndefined();
    await ledger.bulkCategorise(client, []);
    await expect(ledger.bulkCategorise(client, ["missing"])).rejects.toThrow("no longer exists");
    const [from, to] = (await accounts.listAccounts(client, today)) as [
      accounts.AccountSummary,
      accounts.AccountSummary,
    ];
    await ledger.createTransfer(client, "pair", from, to, "2026-10-25", "50");
    const pair = (await ledger.allTransactions(client)).filter((r) => r.debitAccount);
    expect(pair.map((r) => r.amount)).toEqual(["-50", "50"]);
    expect(await ledger.loadLedger(client, from, range)).toHaveLength(4);
    expect(await ledger.loadLedger(client, to, range)).toHaveLength(1);
    await expect(ledger.updateTransaction(client, must(pair[0]), must(pair[0]))).rejects.toThrow(
      "together",
    );
    await expect(
      ledger.updateTransaction(
        client,
        (({ debitAccount: _debitAccount, ...rest }) => rest)(must(pair[0])),
        must(pair[0]),
      ),
    ).rejects.toThrow("together");
    await expect(ledger.bulkCategorise(client, [must(pair[0]).id], category)).rejects.toThrow(
      "together",
    );
    await expect(ledger.deleteTransaction(client, must(pair[0]))).rejects.toThrow("together");
    await expect(
      ledger.createTransfer(client, "foreign", from, { ...to, currency: "USD" }, today, "2"),
    ).rejects.toThrow("same currency");
    await expect(ledger.createTransfer(client, "same", from, from, today, "2")).rejects.toThrow();
  });
  it("migrates categories, keeps unrelated RDF, validates moves, and recategorises before deleting", async () => {
    const { client, store } = setup();
    await provision(client);
    expect(await categories.loadCategories(client)).toEqual({ categories: [], upgraded: false });
    const url = store.resolve("categories.ttl");
    const food = { id: `${url}#food`, label: "Food" };
    const child = { id: `${url}#child`, label: "Groceries", parent: food.id };
    const other = { id: `${url}#other`, label: "Other" };
    const { namedNode: nn, literal, quad } = DataFactory;
    const legacy = new MoneyDocument();
    legacy.dataset.add(quad(nn(food.id), nn(V.type), nn(`${NS.POD_MONEY}Category`)));
    legacy.dataset.add(quad(nn(food.id), nn(V.label), literal("Food")));
    legacy.dataset.add(quad(nn(child.id), nn(V.type), nn(`${NS.POD_MONEY}Category`)));
    legacy.dataset.add(quad(nn(child.id), nn(V.label), literal("Groceries")));
    legacy.dataset.add(quad(nn(child.id), nn(`${NS.POD_MONEY}parent`), nn(food.id)));
    // Write legacy vocabulary through the RDF serializer, bypassing the model's migration writer.
    const { serialize } = await import("@jeswr/rdf-serialize");
    await store.put(
      "categories.ttl",
      await serialize([...legacy.dataset], { format: "text/turtle" }),
      "text/turtle",
      { create: true },
    );
    expect((await categories.loadCategories(client)).upgraded).toBe(true);
    const loaded = await store.read("categories.ttl");
    loaded.document.node(food.id).types.add(`${NS.SCHEMA}Thing`);
    loaded.document.node(`${url}#note`).description = "Preserve me";
    await store.write(url, loaded.document, loaded.condition);
    await categories.saveCategories(client, () => [
      food,
      categories.reparent(child, food.id),
      other,
    ]);
    expect((await categories.loadCategories(client)).upgraded).toBe(false);
    const a = await account(client);
    await add(client, a.id, "purchase", "-4", today, food.id);
    await expect(
      categories.saveCategories(client, () => [{ ...food, parent: child.id }, child, other]),
    ).rejects.toThrow("hierarchy");
    await expect(categories.deleteCategory(client, food.id)).rejects.toThrow("in use");
    await expect(categories.deleteCategory(client, "absent")).rejects.toThrow("no longer exists");
    await expect(categories.deleteCategory(client, food.id, food.id)).rejects.toThrow("another");
    await expect(categories.deleteCategory(client, food.id, "missing")).rejects.toThrow("another");
    await categories.deleteCategory(client, food.id, other.id);
    expect(must((await ledger.allTransactions(client))[0]).category).toBe(other.id);
    expect(
      (await categories.loadCategories(client)).categories.find((c) => c.id === child.id)?.parent,
    ).toBeUndefined();
    expect((await store.read("categories.ttl")).document.node(`${url}#note`).description).toBe(
      "Preserve me",
    );
    await categories.deleteCategory(client, child.id);
    expect((await categories.loadCategories(client)).categories).toEqual([other]);
    await expect(categories.loadCategories({ ...client, fetch: fail(500) })).rejects.toMatchObject({
      status: 500,
    });
    await expect(
      categories.loadCategories({
        ...client,
        fetch: async () => {
          throw new Error("network");
        },
      }),
    ).rejects.toThrow("network");
  });
  it("detects formats, suggests mappings and hashes the exact original", () => {
    expect(imports.detectFormat("s.csv", "Date,Payee,Amount\n2026-10-01,A,-1")).toBe("csv");
    expect(imports.detectFormat("x.qfx", "anything")).toBe("ofx");
    expect(imports.detectFormat("x.txt", sgmlStatement)).toBe("ofx");
    expect(() => imports.detectFormat("s.pdf", "anything")).toThrow("not supported");
    expect(() => imports.detectFormat("s.txt", "%PDF-1.7")).toThrow("not supported");
    const suggested = imports.suggestMapping("Date;Payee;Amount\n2026-10-01;A;-1");
    expect(suggested.options.columns).toEqual({ date: 0, description: 1, amount: 2 });
    expect(
      imports.suggestMapping("Date,Details,Debit,Credit\n2026-10-01,A,1,").options.columns,
    ).toEqual({ date: 0, description: 1, debit: 2, credit: 3 });
    expect(imports.suggestMapping("When,Name,Other\na,b,c").options.columns).toEqual({
      date: 0,
      description: 0,
    });
    expect(imports.suggestMapping("Date,Payee,Debit\n2026-10-01,A,1").options.columns).toEqual({
      date: 0,
      description: 1,
      debit: 2,
    });
    expect(imports.suggestMapping("Date,Payee,Credit\n2026-10-01,A,1").options.columns).toEqual({
      date: 0,
      description: 1,
      credit: 2,
    });
    const headerless = imports.suggestMapping("2026-10-01,Shop,-10\n2026-10-02,Cafe,-2");
    expect(headerless.options.hasHeader).toBe(false);
    expect(headerless.options.columns).toEqual({ date: 0, description: 1, amount: 2 });
    expect(headerless.sample).toHaveLength(2);
    const withCurrency = imports.suggestMapping(
      "Date,Payee,Amount,Currency,Balance\n2026-10-01,Shop,-10,GBP,990",
    );
    expect(withCurrency.options.columns.currency).toBe(3);
    expect(withCurrency.balanceColumn).toBe(4);
    expect(imports.statementId("a")).toBe(imports.statementId("a"));
    expect(imports.statementId("a")).not.toBe(imports.statementId("b"));
    expect(imports.statementId("😀")).toMatch(/^statement-/);
  });
  it("previews duplicates within one account/currency and imports selected rows with progress and provenance", async () => {
    const { client, store } = setup();
    const a = await account(client);
    const other = await account(client, "other");
    await add(client, a.id, "Shop", "-10", "2026-10-20");
    await add(client, other.id, "Other purchase", "-3", "2026-10-21");
    await ledger.addTransaction(client, "foreign", {
      account: a.id,
      postingTime: today,
      description: "Other",
      amount: "-2",
      currency: "USD",
    });
    await add(client, a.id, "old", "-1", "2026-01-01");
    const text =
      "Date,Payee,Amount\n2026-10-20,Shop,-10\n2026-10-21,Other purchase,-3\n2026-11-01,Salary,20\n2026-11-01,Salary,20";
    const options = imports.suggestMapping(text).options;
    const cat = `${store.resolve("categories.ttl")}#income`;
    const preview = await imports.previewImport(client, a.id, "GBP", text, "csv", options, [
      { category: cat, description: { match: "contains", value: "Salary" } },
    ]);
    expect(preview.map((row) => row.duplicate)).toEqual([true, false, false, true]);
    expect(must(preview[2]).category).toBe(cat);
    const progress = vi.fn();
    const result = await imports.commitImport(
      client,
      a.id,
      "GBP",
      text,
      "csv",
      options,
      preview,
      progress,
    );
    expect(result.count).toBe(2);
    expect(progress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    const imported = (await ledger.allTransactions(client)).filter((row) => row.derivedFrom);
    expect(imported).toHaveLength(2);
    expect(imported.find((row) => row.amount === "20")?.category).toBe(cat);
    expect(await (await client.fetch(result.source)).text()).toBe(text);
    await expect(
      imports.commitImport(client, a.id, "GBP", text, "csv", options, preview, progress),
    ).rejects.toThrow("already been imported");
    const ofx = await imports.previewImport(client, a.id, "GBP", sgmlStatement, "ofx", options);
    await imports.commitImport(client, a.id, "GBP", sgmlStatement, "ofx", options, ofx, progress);
    await expect(
      imports.previewImport(client, a.id, "USD", sgmlStatement, "ofx", options),
    ).rejects.toThrow("currency mismatch");
    const noCurrency = "Date,Payee,Amount\n2026-11-01,One,2";
    expect(
      await imports.previewImport(
        client,
        a.id,
        "GBP",
        noCurrency,
        "csv",
        imports.suggestMapping(noCurrency).options,
      ),
    ).toHaveLength(1);
    const none = await imports.previewImport(
      client,
      a.id,
      "GBP",
      "Date,Payee,Amount\n2026-11-01,None,3",
      "csv",
      options,
    );
    expect(
      (
        await imports.commitImport(
          client,
          a.id,
          "GBP",
          "Date,Payee,Amount\n2026-11-01,None,3",
          "csv",
          options,
          none.map((row) => ({ ...row, include: false })),
          progress,
        )
      ).count,
    ).toBe(0);
  });
  it("propagates conflicts and partial imports without silently retrying", async () => {
    const { client } = setup();
    const a = await account(client);
    const text = "Date,Payee,Amount\n2026-09-01,A,-1\n2026-10-01,B,-2";
    const options = imports.suggestMapping(text).options;
    const preview = await imports.previewImport(client, a.id, "GBP", text, "csv", options);
    await expect(
      imports.commitImport(
        {
          ...client,
          fetch: async (input, init) =>
            init?.method === "PUT"
              ? new Response(null, { status: 500 })
              : client.fetch(input, init),
        },
        a.id,
        "GBP",
        text,
        "csv",
        options,
        preview,
        () => {},
      ),
    ).rejects.toMatchObject({ status: 500 });
    await expect(
      imports.commitImport(
        {
          ...client,
          fetch: async (input, init) => {
            if (init?.method === "PUT") throw new Error("network write");
            return client.fetch(input, init);
          },
        },
        a.id,
        "GBP",
        text,
        "csv",
        options,
        preview,
        () => {},
      ),
    ).rejects.toThrow("network write");
    const broken: MoneyClient = {
      ...client,
      fetch: async (input, init) =>
        init?.method === "PUT" && String(input).endsWith("2026-10.ttl")
          ? new Response(null, { status: 412 })
          : client.fetch(input, init),
    };
    await expect(
      imports.commitImport(broken, a.id, "GBP", text, "csv", options, preview, () => {}),
    ).rejects.toMatchObject({ status: 412 });
    expect(await ledger.allTransactions(client)).toHaveLength(1);
    const noEtag: MoneyClient = {
      ...client,
      fetch: async (input, init) => {
        const response = await client.fetch(input, init);
        if (!init?.method) {
          response.headers.delete("etag");
        }
        return response;
      },
    };
    await expect(
      ledger.bulkCategorise(noEtag, [must((await ledger.allTransactions(client))[0]).id]),
    ).rejects.toThrow("strong ETag");
    await expect(ledger.allTransactions({ ...client, fetch: fail(403) })).rejects.toMatchObject({
      status: 403,
    });
  });
  it("groups net worth by currency and excludes transfers from category spending", async () => {
    const { client, store } = setup();
    const a = await account(client);
    await account(client, "usd", "USD");
    const cat = store.resolve("categories.ttl");
    const cats = [
      { id: `${cat}#food`, label: "Food" },
      { id: `${cat}#child`, label: "Shop", parent: `${cat}#food` },
      { id: `${cat}#income`, label: "Income" },
      { id: `${cat}#salary`, label: "Salary", parent: `${cat}#income` },
    ];
    await categories.saveCategories(client, () => cats);
    await add(client, a.id, "purchase", "-12", today, must(cats[1]).id);
    await add(client, a.id, "refund", "2", today, must(cats[1]).id);
    await add(client, a.id, "income", "100", today, must(cats[3]).id);
    await add(client, a.id, "unknown income", "10", today);
    await add(client, a.id, "unknown expense", "-1", today);
    await add(client, a.id, "future", "-10", "2027-01-01");
    const current = must((await accounts.listAccounts(client, today))[0]);
    await ledger.createTransfer(
      client,
      "pair",
      current,
      { ...current, id: `${store.resolve("accounts/other.ttl")}#a` },
      today,
      "30",
    );
    const result = await loadOverview(client, today);
    expect(result.totals).toEqual([
      { currency: "GBP", amount: "1069" },
      { currency: "USD", amount: "1000" },
    ]);
    expect(result.spending.map((row) => row.amount)).toEqual(["12.00", "1.00"]);
    expect(result.recent).toHaveLength(7);
    expect(overview([], [], [], today)).toEqual({ totals: [], recent: [], spending: [] });
  });
  it("seeds once, resumes an incomplete container, and skips completed or non-demo samples", async () => {
    const { client, session, pod } = setup();
    await Promise.all([
      ensureSample(session, new Date(today)),
      ensureSample(session, new Date(today)),
    ]);
    expect(await accounts.listAccounts(client, today)).toHaveLength(2);
    expect((await categories.loadCategories(client)).categories).toHaveLength(11);
    expect((await ledger.allTransactions(client)).length).toBeGreaterThan(65);
    const count = pod.snapshot().etagSeq;
    await ensureSample({ ...session });
    expect(pod.snapshot().etagSeq).toBe(count);
    const fresh = setup();
    await provision(fresh.client);
    await ensureSample(fresh.session);
    expect(await accounts.listAccounts(fresh.client, today)).toHaveLength(2);
    const non = setup();
    await ensureSample({ ...non.session, mode: "live" } as unknown as PodSession);
    expect(non.pod.has(moneyRoot(non.client))).toBe(false);
    const failed = setup();
    await expect(ensureSample({ ...failed.session, fetch: fail(500) })).rejects.toThrow(
      "check sample",
    );
  });
});
