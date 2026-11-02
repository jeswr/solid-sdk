// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { type MoneyClient, storeOf } from "../src/apps/money/lib/data/container";
import {
  checkRule,
  importRules,
  loadRules,
  parseRules,
  RULES_FILE,
  ruleMatches,
  type SavedRule,
  saveRules,
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
    expect(await loadRules(c)).toEqual({ rules: [], etag: null });
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
});
