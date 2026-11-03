// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/apps/money/lib/data/accounts";
import { type MoneyClient, storeOf } from "../src/apps/money/lib/data/container";
import { previewImport } from "../src/apps/money/lib/data/import";
import {
  addTransaction,
  allTransactions,
  updateTransaction,
} from "../src/apps/money/lib/data/ledger";
import {
  addRule,
  categoriseByRules,
  checkRule,
  importRules,
  loadRules,
  parseRules,
  RULES_FILE,
  RulesFileError,
  replaceRule,
  resetRules,
  ruleMatches,
  type SavedRule,
  saveRules,
  stillUncategorised,
} from "../src/apps/money/lib/data/rules";
import type { Category, Transaction } from "../src/apps/money/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

function client(): MoneyClient & { pod: ReturnType<typeof createDemoPod> } {
  const pod = createDemoPod({ root: "https://rules.example/", latency: 0 });
  return { pod, fetch: pod.fetch, storageUrl: pod.root };
}
const rule = (id: string, value: string, category: string, match = "contains"): SavedRule =>
  ({ id, match, value, category }) as SavedRule;
const categories: Category[] = [
  { id: "food", label: "Food" },
  { id: "groceries", label: "Groceries", parent: "food" },
  { id: "travel", label: "Travel" },
];
const G = "https://rules.example/money/categories.ttl#groceries";
const T = "https://rules.example/money/categories.ttl#travel";
const F = "https://rules.example/money/categories.ttl#food";
const iriCategories: Category[] = [
  { id: F, label: "Food" },
  { id: G, label: "Groceries", parent: F },
  { id: T, label: "Travel" },
];
const tx = (id: string, description: string, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  account: "acct",
  postingTime: "2026-10-01T00:00:00Z",
  description,
  amount: "-10.00",
  currency: "GBP",
  ...extra,
});

describe("categorisation rules", () => {
  it("checks and parses rules, refusing malformed files", () => {
    expect(checkRule(rule("a", "  Tesco ", "groceries"))).toEqual(rule("a", "Tesco", "groceries"));
    expect(() => checkRule(rule("a", " ", "groceries"))).toThrow("Enter the text");
    expect(() => checkRule(rule("a", "x".repeat(201), "groceries"))).toThrow("under 200");
    expect(() => checkRule(rule("a", "Tesco", ""))).toThrow("Choose a category");
    expect(() => checkRule(rule("a", "Tesco", "groceries", "regex"))).toThrow("how the text");
    expect(parseRules({ rules: [rule("a", "Tesco", "groceries", "equals")] })).toHaveLength(1);
    for (const bad of [
      null,
      [],
      { rules: {} },
      { rules: [null] },
      { rules: [{ ...rule("a", "x", "y"), id: "" }] },
      { rules: [rule("a", "x", "y"), rule("a", "z", "y")] },
      { rules: [{ ...rule("a", "x", "y"), value: 3 }] },
      { rules: [{ ...rule("a", "x", "y"), match: 3 }] },
      { rules: [{ ...rule("a", "x", "y"), category: 3 }] },
      { rules: [{ id: 1, match: "contains", value: "x", category: "y" }] },
    ])
      expect(() => parseRules(bad)).toThrow(TypeError);
  });

  it("saves rules with conditional writes and reads them back", async () => {
    const c = client();
    expect(await loadRules(c)).toEqual({ rules: [], etag: null, exists: false });
    await saveRules(c, (rules) => [...rules, rule("a", "Tesco", "groceries")]);
    await saveRules(c, (rules) => [...rules, rule("b", "Rail", "travel", "startsWith")]);
    const loaded = await loadRules(c);
    expect(loaded.rules.map((value) => value.id)).toEqual(["a", "b"]);
    expect(loaded.etag).toMatch(/^"/);
    // Re-saving the same rules is a no-op that still succeeds.
    expect(await saveRules(c, (rules) => rules)).toEqual(loaded.rules);
    await expect(saveRules(c, (rules) => [...rules, rule("a", "Again", "travel")])).rejects.toThrow(
      "Duplicate rule",
    );
    await expect(saveRules(c, (rules) => [...rules, rule("c", "", "travel")])).rejects.toThrow(
      "Enter the text",
    );
  });

  it("treats a lost response as saved when the pod already holds the result", async () => {
    const c = client();
    await saveRules(c, () => [rule("a", "Tesco", "groceries")]);
    const url = storeOf(c).resolve(RULES_FILE);
    let first = true;
    const flaky: MoneyClient = {
      storageUrl: c.storageUrl,
      fetch: async (input, init) => {
        const response = await c.fetch(input, init);
        if (init?.method === "PUT" && String(input) === url && first) {
          first = false;
          // The write landed, then a second identical write conflicts.
          return c.fetch(input, { ...init, headers: { ...init.headers, "if-match": '"stale"' } });
        }
        return response;
      },
    };
    const next = await saveRules(flaky, (rules) => [...rules, rule("b", "Rail", "travel")]);
    expect(next).toHaveLength(2);
    expect((await loadRules(c)).rules).toEqual(next);
  });

  it("reports read failures and conflicting edits", async () => {
    const c = client();
    const failing: MoneyClient = {
      storageUrl: c.storageUrl,
      fetch: async () => new Response(null, { status: 500 }),
    };
    await expect(loadRules(failing)).rejects.toMatchObject({ status: 500 });
    await saveRules(c, () => [rule("a", "Tesco", "groceries")]);
    const url = storeOf(c).resolve(RULES_FILE);
    const racing: MoneyClient = {
      storageUrl: c.storageUrl,
      fetch: async (input, init) => {
        if (init?.method === "PUT" && String(input) === url) {
          // Someone else saves first, so this write's ETag is stale.
          await c.fetch(url, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ rules: [rule("z", "Other", "travel")] }),
          });
        }
        return c.fetch(input, init);
      },
    };
    await expect(
      saveRules(racing, (rules) => [...rules, rule("b", "Rail", "travel")]),
    ).rejects.toMatchObject({ status: 412 });
  });

  it("puts the user's rules before category-name guesses, skipping deleted categories", () => {
    expect(
      importRules([rule("a", "Tesco", "groceries"), rule("b", "x", "gone", "equals")], categories),
    ).toEqual([
      { category: "groceries", description: { match: "contains", value: "Tesco" } },
      { category: "groceries", description: { match: "contains", value: "Groceries" } },
      { category: "travel", description: { match: "contains", value: "Travel" } },
    ]);
  });

  it("finds uncategorised transactions the rules would file", () => {
    const groups = ruleMatches(
      [rule("a", "tesco", "groceries"), rule("b", "RAIL", "travel", "startsWith")],
      categories,
      [
        tx("1", "TESCO STORES 123"),
        tx("2", "Rail ticket"),
        tx("3", "Tesco", { category: "food" }),
        tx("4", "Tesco transfer", { debitAccount: "x" }),
        tx("5", "Tesco transfer", { creditAccount: "x" }),
        tx("6", "Cinema"),
      ],
    );
    expect(Object.fromEntries(groups)).toEqual({ groceries: ["1"], travel: ["2"] });
  });

  it("adds by id and refuses to bring back a rule deleted elsewhere", () => {
    const a = rule("a", "Tesco", "groceries");
    expect(addRule([a], a)).toEqual([a]);
    // A retry with changed text keeps the latest text.
    const other = rule("z", "Other", "travel");
    expect(addRule([other, a], { ...a, value: "Aldi" })).toEqual([other, { ...a, value: "Aldi" }]);
    expect(addRule([], a)).toEqual([a]);
    expect(replaceRule([a], { ...a, value: "Aldi" })).toEqual([{ ...a, value: "Aldi" }]);
    const b = rule("b", "Rail", "travel");
    expect(replaceRule([a, b], { ...a, value: "Aldi" })).toEqual([{ ...a, value: "Aldi" }, b]);
    expect(() => replaceRule([], a)).toThrow(expect.objectContaining({ status: 412 }));
    expect(stillUncategorised(tx("1", "x"))).toBe(true);
    expect(stillUncategorised(undefined)).toBe(false);
    expect(stillUncategorised(tx("1", "x", { category: "food" }))).toBe(false);
    expect(stillUncategorised(tx("1", "x", { debitAccount: "a" }))).toBe(false);
    expect(stillUncategorised(tx("1", "x", { creditAccount: "a" }))).toBe(false);
  });

  it("tells unusable files from failed reads, and resets only a still-broken file", async () => {
    const c = client();
    const url = storeOf(c).resolve(RULES_FILE);
    const write = (body: string) =>
      c.fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body });
    // Nothing to reset yet.
    expect(await resetRules(c)).toBe(false);
    await write(
      JSON.stringify({ rules: [{ id: "a", match: "regex", value: "x", category: "y" }] }),
    );
    await expect(loadRules(c)).rejects.toBeInstanceOf(RulesFileError);
    await write("{");
    await expect(loadRules(c)).rejects.toBeInstanceOf(RulesFileError);
    expect(await resetRules(c)).toBe(true);
    expect(await loadRules(c)).toMatchObject({ rules: [], exists: true });
    // A file that reads fine again (repaired elsewhere) is never reset.
    await saveRules(c, () => [rule("a", "Tesco", "groceries")]);
    expect(await resetRules(c)).toBe(false);
    expect((await loadRules(c)).rules).toHaveLength(1);
    const tagless: MoneyClient = {
      storageUrl: c.storageUrl,
      fetch: async (input, init) => {
        const response = await c.fetch(input, init);
        const headers = new Headers(response.headers);
        headers.delete("etag");
        return new Response(await response.text(), { status: response.status, headers });
      },
    };
    // Rules still load without a version tag, but can't be saved or reset safely.
    expect(await loadRules(tagless)).toMatchObject({ etag: null, exists: true });
    await expect(saveRules(tagless, (rules) => rules.slice(1))).rejects.toThrow(
      "didn't say which version",
    );
    await write("{");
    await expect(resetRules(tagless)).rejects.toThrow("didn't say which version");
    const weak: MoneyClient = {
      storageUrl: c.storageUrl,
      fetch: async (input, init) => {
        const response = await c.fetch(input, init);
        const headers = new Headers(response.headers);
        headers.set("etag", 'W/"weak"');
        return new Response(await response.text(), { status: response.status, headers });
      },
    };
    await expect(resetRules(weak)).rejects.toThrow("didn't say which version");
    const failing: MoneyClient = {
      storageUrl: c.storageUrl,
      fetch: async () => new Response(null, { status: 503 }),
    };
    await expect(loadRules(failing)).rejects.not.toBeInstanceOf(RulesFileError);
    await expect(resetRules(failing)).rejects.toMatchObject({ status: 503 });
  });

  it("applies saved rules ahead of category names when previewing an import", async () => {
    const c = client();
    const account = await createAccount(c, "current", {
      name: "Current",
      type: "current",
      currency: "GBP",
      openingBalance: "0",
      date: "2026-08-01",
    });
    const rows = await previewImport(
      c,
      account.id,
      "GBP",
      "Date,Description,Amount\n2026-09-01,Travel shop TESCO,-5.00\n2026-09-02,Travel pass,-3.00\n",
      "csv",
      { columns: { date: "Date", description: "Description", amount: "Amount" } },
      importRules([rule("a", "tesco", "groceries")], categories),
    );
    expect(rows.map((row) => row.category)).toEqual(["groceries", "travel"]);
  });

  it("categorises existing transactions from the latest ledger, month by month", async () => {
    const c = client();
    const account = await createAccount(c, "current", {
      name: "Current",
      type: "current",
      currency: "GBP",
      openingBalance: "0",
      date: "2026-08-01",
    });
    const add = (key: string, description: string, at: string, category?: string) =>
      addTransaction(c, key, {
        account: account.id,
        postingTime: at,
        description,
        amount: "-1",
        currency: "GBP",
        ...(category ? { category } : {}),
      });
    await add("s1", "TESCO 1", "2026-09-01T00:00:00Z");
    await add("s2", "Tesco 2", "2026-10-01T00:00:00Z");
    await add("s3", "Tesco 3", "2026-10-02T00:00:00Z", F);
    const rules = [rule("a", "tesco", G)];
    // Another device files s2 between the page's snapshot and this action.
    const stale = await allTransactions(c);
    expect(ruleMatches(rules, iriCategories, stale).get(G)).toHaveLength(2);
    const s2 = stale.find((row) => row.description === "Tesco 2") as Transaction;
    await updateTransaction(c, s2, { ...s2, category: T });
    expect(await categoriseByRules(c, rules, iriCategories)).toBe(1);
    const byDescription = Object.fromEntries(
      (await allTransactions(c)).map((row) => [row.description, row.category]),
    );
    expect(byDescription).toMatchObject({
      "TESCO 1": G,
      "Tesco 2": T,
      "Tesco 3": F,
    });
    // Running it again has nothing left to do.
    expect(await categoriseByRules(c, rules, iriCategories)).toBe(0);
    // A row filed elsewhere after the ledger was read is left alone.
    await add("s4", "Tesco 4", "2026-11-01T00:00:00Z");
    const shard = storeOf(c).resolve("transactions/2026-11.ttl");
    let reads = 0;
    const racing: MoneyClient = {
      storageUrl: c.storageUrl,
      fetch: async (input, init) => {
        if ((init?.method ?? "GET") === "GET" && String(input) === shard && ++reads === 2) {
          const row = (await allTransactions(c)).find((value) => value.description === "Tesco 4");
          await updateTransaction(c, row as Transaction, { ...(row as Transaction), category: F });
        }
        return c.fetch(input, init);
      },
    };
    expect(await categoriseByRules(racing, rules, iriCategories)).toBe(0);
    expect(
      (await allTransactions(c)).find((value) => value.description === "Tesco 4")?.category,
    ).toBe(F);
  });

  it("says how many were saved when a later month fails", async () => {
    const c = client();
    const account = await createAccount(c, "current", {
      name: "Current",
      type: "current",
      currency: "GBP",
      openingBalance: "0",
      date: "2026-08-01",
    });
    for (const [key, at] of [
      ["a", "2026-09-01T00:00:00Z"],
      ["b", "2026-10-01T00:00:00Z"],
    ] as const)
      await addTransaction(c, key, {
        account: account.id,
        postingTime: at,
        description: "Tesco",
        amount: "-1",
        currency: "GBP",
      });
    const rules = [rule("a", "tesco", G)];
    let puts = 0;
    const flaky = (failAt: number): MoneyClient => ({
      storageUrl: c.storageUrl,
      fetch: async (input, init) =>
        init?.method === "PUT" && String(input).includes("/transactions/") && ++puts === failAt
          ? new Response(null, { status: 500 })
          : c.fetch(input, init),
    });
    await expect(categoriseByRules(flaky(1), rules, iriCategories)).rejects.toMatchObject({
      status: 500,
    });
    puts = 0;
    await expect(categoriseByRules(flaky(2), rules, iriCategories)).rejects.toThrow(
      "Categorised 1 of 2 transactions",
    );
  });
});
