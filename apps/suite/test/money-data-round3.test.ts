// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { ensureSample } from "../src/apps/money/demo/sample";
import { createAccount, listAccounts, renameAccount } from "../src/apps/money/lib/data/accounts";
import {
  deleteCategory,
  loadCategories,
  saveCategories,
} from "../src/apps/money/lib/data/categories";
import { type MoneyClient, storeOf } from "../src/apps/money/lib/data/container";
import {
  commitImport,
  previewImport,
  recoveryPreview,
  statementId,
  suggestMapping,
} from "../src/apps/money/lib/data/import";
import {
  addTransaction,
  allTransactions,
  bulkCategorise,
  loadLedger,
  updateTransaction,
} from "../src/apps/money/lib/data/ledger";
import { loadOverview } from "../src/apps/money/lib/data/overview";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { sgmlStatement } from "./fixtures/money-statements";
import { must } from "./money/helpers";

const today = "2026-11-01";
function podFixture() {
  const pod = createDemoPod({ root: "https://round3.example/", latency: 0 });
  const session: PodSession = {
    fetch: pod.fetch,
    storageUrl: pod.root,
    mode: "demo",
    webId: `${pod.root}me`,
    displayName: "Example",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return { pod, session, store: storeOf(session) };
}
async function fixture() {
  const f = podFixture();
  const account = await createAccount(f.session, "current", {
    name: "Current",
    type: "current",
    currency: "GBP",
    openingBalance: "500",
    date: "2026-08-01",
  });
  return { ...f, account };
}
function intercept(
  client: MoneyClient,
  handler: (url: string, init?: RequestInit) => Promise<Response | undefined>,
): MoneyClient {
  return {
    ...client,
    fetch: async (input, init) => (await handler(String(input), init)) ?? client.fetch(input, init),
  };
}

describe("Money round 3 reader regressions", () => {
  it("treats inserts racing category deletion as Uncategorised and allows bulk repair", async () => {
    const { session, store, account } = await fixture();
    const old = { id: `${store.resolve("categories.ttl")}#old`, label: "Old" };
    const replacement = { id: `${store.resolve("categories.ttl")}#new`, label: "New" };
    await saveCategories(session, () => [old, replacement]);
    const value = {
      account: account.id,
      postingTime: today,
      currency: "GBP",
      amount: "-10",
      description: "Purchase",
      category: old.id,
    };
    const first = await addTransaction(session, "first", value);
    let inserted = "";
    const racing = intercept(session, async (url, init) => {
      if (init?.method === "PUT" && url.endsWith("categories.ttl"))
        inserted = (
          await addTransaction(session, "racing-insert", {
            ...value,
            description: "Concurrent purchase",
          })
        ).id;
    });
    await deleteCategory(racing, old.id, replacement.id);
    expect((await allTransactions(session)).find((row) => row.id === inserted)?.category).toBe(
      old.id,
    );
    const summary = must((await listAccounts(session, today))[0]);
    const range = { start: today, end: today };
    const uncategorised = await loadLedger(session, summary, range, {
      category: "uncategorised",
      query: "concurrent",
    });
    expect(uncategorised.map((row) => row.id)).toEqual([inserted]);
    expect(await loadLedger(session, summary, range, { category: old.id })).toEqual([]);
    expect(
      (await loadLedger(session, summary, range, { category: replacement.id })).map(
        (row) => row.id,
      ),
    ).toEqual([first.id]);
    const report = await loadOverview(session, today);
    expect(report.spending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: null, amount: "10.00" }),
        expect.objectContaining({ category: replacement.id, amount: "10.00" }),
      ]),
    );
    await bulkCategorise(session, [inserted], replacement.id);
    expect(await loadLedger(session, summary, range, { category: "uncategorised" })).toEqual([]);
    expect((await loadLedger(session, summary, range, { category: replacement.id })).length).toBe(
      2,
    );
  });
  it("classifies inflows independently of category names, IDs, ancestry and later renames", async () => {
    const { session, store, account } = await fixture();
    const root = { id: `${store.resolve("categories.ttl")}#opaque`, label: "Income" };
    const child = { id: `${root.id}-child`, label: "Salary", parent: root.id };
    const expense = { id: `${root.id}-food`, label: "Food" };
    await saveCategories(session, () => [root, child, expense]);
    const value = {
      account: account.id,
      currency: "GBP",
      postingTime: today,
      description: "Salary",
      amount: "3200",
      category: child.id,
    };
    await addTransaction(session, "salary", value);
    await addTransaction(session, "purchase", { ...value, amount: "-20", category: expense.id });
    await addTransaction(session, "refund", { ...value, amount: "5", category: expense.id });
    await addTransaction(session, "reversal", { ...value, amount: "-3" });
    const before = await loadOverview(session, today);
    expect(before.spending.map((row) => row.amount)).toEqual(["20.00", "3.00"]);
    await saveCategories(session, (current) =>
      current.map((category) => ({
        ...category,
        label: category.id === root.id ? "Earnings" : "Renamed",
      })),
    );
    expect(await loadOverview(session, today)).toEqual(before);
  });
});

describe("saved statement previews", () => {
  it("loads the reserved CSV mapping, inclusion and categories before any new parsing", async () => {
    const { session, store, account } = await fixture();
    const text =
      "Date,Payee,Amount,Alternative\n2026-09-03,A,-1,-100\n2026-10-03,B,-2,-200\n2026-10-04,C,-3,bad";
    const options = suggestMapping(text).options;
    expect(await recoveryPreview(session, account.id, "GBP", text, "csv")).toBeUndefined();
    const rows = await previewImport(session, account.id, "GBP", text, "csv", options);
    const category = `${store.resolve("categories.ttl")}#food`;
    const selected = rows.map((row, index) => ({
      ...row,
      include: index !== 1,
      duplicate: index === 1,
      category: index === 0 ? category : undefined,
    }));
    const broken = intercept(session, async (url, init) =>
      init?.method === "PUT" && url.endsWith("2026-10.ttl")
        ? new Response(null, { status: 500 })
        : undefined,
    );
    await expect(
      commitImport(broken, account.id, "GBP", text, "csv", options, selected, vi.fn()),
    ).rejects.toMatchObject({ status: 500 });
    const recovered = must(await recoveryPreview(session, account.id, "GBP", text, "csv"));
    expect(recovered).toEqual(selected);
    const invalidOptions = { ...options, columns: { ...options.columns, amount: 3 } };
    await expect(
      previewImport(session, account.id, "GBP", text, "csv", invalidOptions),
    ).rejects.toThrow();
    for (const [target, currency, format] of [
      ["other", "GBP", "csv"],
      [account.id, "USD", "csv"],
      [account.id, "GBP", "ofx"],
    ] as const)
      await expect(recoveryPreview(session, target, currency, text, format)).rejects.toThrow(
        "original account",
      );
    await commitImport(
      session,
      account.id,
      "GBP",
      text,
      "csv",
      invalidOptions,
      recovered,
      vi.fn(),
      true,
    );
    expect((await allTransactions(session)).map((row) => row.amount)).toEqual(["-1", "-3"]);
    await expect(recoveryPreview(session, account.id, "GBP", text, "csv")).rejects.toThrow(
      "already been imported",
    );
  });
  it("previews OFX recovery and reads older plans without duplicate hints or a row decision", async () => {
    const { session, store, account } = await fixture();
    const options = { columns: { date: 0, description: 1, amount: 2 } };
    const rows = await previewImport(session, account.id, "GBP", sgmlStatement, "ofx", options);
    const broken = intercept(session, async (url, init) =>
      init?.method === "PUT" && url.includes("transactions/")
        ? new Response(null, { status: 500 })
        : undefined,
    );
    await expect(
      commitImport(broken, account.id, "GBP", sgmlStatement, "ofx", options, rows, vi.fn()),
    ).rejects.toMatchObject({ status: 500 });
    const path = `statements/${statementId(sgmlStatement)}.import.json`;
    const response = await session.fetch(store.resolve(path));
    const plan = await response.json();
    plan.selection = [{ include: true }];
    await store.put(path, JSON.stringify(plan), "application/json", {
      etag: must(response.headers.get("etag")),
    });
    const recovered = must(await recoveryPreview(session, account.id, "GBP", sgmlStatement, "ofx"));
    expect(recovered.map((row) => row.row)).toEqual(rows.map((row) => row.row));
    expect(recovered[0]).toMatchObject({ include: true, duplicate: false });
    expect(recovered[1]).toMatchObject({ include: false, duplicate: false });
  });
});

it.each([
  "account",
  "shard",
  "conflict",
  "completion",
  "lost response",
])("resumes sample initialization after a failed %s write using its reserved dates", async (phase) => {
  const { pod, session, store } = podFixture();
  let writes = 0;
  let fail = true;
  const recovering: PodSession = {
    ...session,
    fetch: async (input, init) => {
      const url = String(input);
      if (
        init?.method === "PUT" &&
        ((phase === "account" && url.endsWith("accounts/current.ttl")) ||
          ((phase === "shard" || phase === "conflict") &&
            url.includes("transactions/") &&
            url.endsWith(".ttl") &&
            ++writes === 8) ||
          (phase === "completion" && url.endsWith(".sample-complete")) ||
          (phase === "lost response" && url.endsWith("accounts/current.ttl"))) &&
        fail
      ) {
        fail = false;
        if (phase === "lost response") {
          await pod.fetch(input, init);
          throw new Error("Lost response");
        }
        return new Response(null, { status: phase === "conflict" ? 412 : 500 });
      }
      return pod.fetch(input, init);
    },
  };
  await expect(ensureSample(recovering, new Date(today))).rejects.toThrow();
  expect(pod.has(store.resolve(".sample-complete"))).toBe(false);
  const rows = await allTransactions(session);
  const first = rows.find((row) => !row.debitAccount);
  if (first) await updateTransaction(session, first, { ...first, description: "Keep this edit" });
  const current = (await listAccounts(session, today)).find((a) => a.label === "Current account");
  if (current) await renameAccount(session, current.id, "Keep account name");
  const categories = (await loadCategories(session)).categories;
  if (categories.length)
    await saveCategories(session, (tree) =>
      tree.map((category) => ({ ...category, label: `Edited ${category.label}` })),
    );
  await ensureSample(recovering, new Date("2026-11-02"));
  expect(pod.has(store.resolve(".sample-complete"))).toBe(true);
  expect(await listAccounts(session, today)).toHaveLength(2);
  const complete = await allTransactions(session);
  expect(complete.length).toBeGreaterThan(65);
  expect(new Set(complete.map((row) => row.id)).size).toBe(complete.length);
  expect(complete.every((row) => row.postingTime <= today)).toBe(true);
  if (first)
    expect(complete.find((row) => row.id === first.id)?.description).toBe("Keep this edit");
  if (current)
    expect((await listAccounts(session, today)).find((a) => a.id === current.id)?.label).toBe(
      "Keep account name",
    );
  if (categories.length)
    expect((await loadCategories(session)).categories[0]?.label).toMatch(/^Edited /);
  const count = pod.snapshot().etagSeq;
  await ensureSample({ ...recovering, fetch: (input, init) => recovering.fetch(input, init) });
  expect(pod.snapshot().etagSeq).toBe(count);
});
