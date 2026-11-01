// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { createAccount } from "../src/apps/money/lib/data/accounts";
import {
  deleteCategory,
  loadCategories,
  saveCategories,
} from "../src/apps/money/lib/data/categories";
import { type MoneyClient, storeOf } from "../src/apps/money/lib/data/container";
import {
  commitImport,
  importStatus,
  PendingImportError,
  previewImport,
  statementId,
  suggestMapping,
} from "../src/apps/money/lib/data/import";
import {
  addTransaction,
  allTransactions,
  bulkCategorise,
  deleteTransaction,
  updateTransaction,
} from "../src/apps/money/lib/data/ledger";
import { putTransaction, type Transaction } from "../src/apps/money/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

async function setup() {
  const pod = createDemoPod({ root: "https://recovery.example/", latency: 0 });
  const client = { fetch: pod.fetch, storageUrl: pod.root };
  const a = await createAccount(client, "current", {
    name: "Current",
    type: "current",
    currency: "GBP",
    openingBalance: "500",
    date: "2026-08-31",
  });
  const row = await addTransaction(client, "purchase", {
    account: a.id,
    currency: "GBP",
    amount: "-10",
    postingTime: "2026-09-02",
    description: "Shop",
  });
  return { client, store: storeOf(client), a, row };
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
const movedValue = (row: Transaction) => ({ ...row, postingTime: "2026-10-02" });

describe("Money conditional edits and recovery", () => {
  it("rejects stale form saves and missing transactions rather than restoring old amounts", async () => {
    const { client, row } = await setup();
    await updateTransaction(client, row, {
      ...row,
      amount: "-20",
      payee: "https://recovery.example/payee",
    });
    await expect(
      updateTransaction(client, row, { ...row, description: "Old form" }),
    ).rejects.toMatchObject({ status: 412 });
    expect((await allTransactions(client))[0]).toMatchObject({
      amount: "-20",
      payee: "https://recovery.example/payee",
      description: "Shop",
    });
    await expect(updateTransaction(client, row, movedValue(row))).rejects.toMatchObject({
      status: 412,
    });
    await deleteTransaction(client, row);
    await expect(updateTransaction(client, row, row)).rejects.toMatchObject({ status: 412 });
    await expect(updateTransaction(client, row, movedValue(row))).rejects.toMatchObject({
      status: 412,
    });
  });
  it("keeps unrelated concurrent shard edits and rejects a race after the conditional read", async () => {
    const { client, store, row } = await setup();
    const other = await addTransaction(client, "other", { ...row, description: "Other" });
    await updateTransaction(client, other, { ...other, amount: "7" });
    await updateTransaction(client, row, { ...row, description: "Updated" });
    expect((await allTransactions(client)).find((r) => r.id === other.id)?.amount).toBe("7");
    const displayed = { ...row, description: "Updated", runningBalance: "497" };
    await updateTransaction(client, displayed, { ...displayed, description: "From ledger" });
    const current = (await allTransactions(client)).find((r) => r.id === row.id)!;
    let once = true;
    const racing = intercept(client, async (url, init) => {
      if (once && init?.method === "PUT") {
        once = false;
        const doc = await store.read(url);
        putTransaction(doc.document, { ...current, amount: "-30" });
        await store.write(url, doc.document, doc.condition);
      }
    });
    await expect(
      updateTransaction(racing, current, { ...current, description: "Racing" }),
    ).rejects.toMatchObject({ status: 412 });
    expect((await allTransactions(client)).find((r) => r.id === row.id)?.amount).toBe("-30");
  });
  it("creates a moved row before deleting the source and resumes partial completion without duplicates", async () => {
    const { client, row } = await setup();
    const destinationFailure = intercept(client, async (url, init) => {
      if (init?.method === "PUT" && url.endsWith("2026-10.ttl"))
        return new Response(null, { status: 500 });
    });
    await expect(updateTransaction(destinationFailure, row, movedValue(row))).rejects.toMatchObject(
      { status: 500 },
    );
    expect(await allTransactions(client)).toEqual([row]);
    const sourceFailure = intercept(client, async (url, init) => {
      if (init?.method === "PUT" && url.endsWith("2026-09.ttl"))
        return new Response(null, { status: 500 });
    });
    await expect(updateTransaction(sourceFailure, row, movedValue(row))).rejects.toThrow(
      "Retry the same edit",
    );
    expect(await allTransactions(client)).toHaveLength(2);
    const moved = await updateTransaction(client, row, movedValue(row));
    expect(await allTransactions(client)).toEqual([moved]);
    // A lost successful delete response can also be recovered after reopening the form.
    expect(await updateTransaction(client, row, movedValue(row))).toEqual(moved);
    await expect(
      updateTransaction(client, row, { ...movedValue(row), amount: "-99" }),
    ).rejects.toMatchObject({ status: 412 });
  });
  it("recovers when the source deletion succeeds but its response is lost", async () => {
    const { client, row } = await setup();
    const lost = intercept(client, async (url, init) => {
      if (init?.method === "PUT" && url.endsWith("2026-09.ttl")) {
        await client.fetch(url, init);
        throw new Error("Lost deletion response");
      }
    });
    await expect(updateTransaction(lost, row, movedValue(row))).rejects.toThrow(
      "Retry the same edit",
    );
    const moved = await updateTransaction(client, row, movedValue(row));
    expect(await allTransactions(client)).toEqual([moved]);
  });
  it("does not delete a source changed after destination creation or replace a different destination", async () => {
    const { client, row } = await setup();
    let once = true;
    const racing = intercept(client, async (url, init) => {
      if (once && init?.method === "PUT" && url.endsWith("2026-09.ttl")) {
        once = false;
        await updateTransaction(client, row, { ...row, amount: "-25" });
      }
    });
    await expect(updateTransaction(racing, row, movedValue(row))).rejects.toThrow(
      "Retry the same edit",
    );
    expect((await allTransactions(client)).find((r) => r.id === row.id)?.amount).toBe("-25");
    await expect(
      updateTransaction(client, { ...row, amount: "-25" }, { ...movedValue(row), amount: "-25" }),
    ).rejects.toMatchObject({ status: 412 });
  });
  it("bulk category edits apply only that field to the current shard and reject disappeared or newly paired rows", async () => {
    const { client, store, row } = await setup();
    let gets = 0;
    const racing = intercept(client, async (url, init) => {
      if (!init?.method && url.endsWith("2026-09.ttl") && ++gets === 2)
        await updateTransaction(client, row, { ...row, amount: "-20" });
    });
    await bulkCategorise(racing, [row.id], "https://recovery.example/food");
    expect((await allTransactions(client))[0]).toMatchObject({
      amount: "-20",
      category: "https://recovery.example/food",
    });
    for (const change of ["delete", "debit", "credit"] as const) {
      const current = (await allTransactions(client))[0] ?? row;
      if (change !== "delete") await store.saveTransactions([current]);
      gets = 0;
      const changing = intercept(client, async (url, init) => {
        if (!init?.method && url.endsWith("2026-09.ttl") && ++gets === 2) {
          if (change === "delete") await deleteTransaction(client, current);
          else {
            const loaded = await store.read(url);
            // A writer turns the selected subject into a paired transfer between listing and mutation.
            loaded.document.node(row.id)[change === "debit" ? "debitAccount" : "creditAccount"] =
              row.account;
            await store.write(url, loaded.document, loaded.condition);
          }
        }
      });
      if (change === "debit") await store.saveTransactions([row]);
      if (change === "credit") {
        const loaded = await store.read("transactions/2026-09.ttl");
        loaded.document.node(row.id).debitAccount = undefined;
        await store.write(loaded.url, loaded.document, loaded.condition);
      }
      await expect(bulkCategorise(changing, [row.id])).rejects.toMatchObject({ status: 412 });
    }
  });
  it("mutates categories in one loaded document and detects changes during delete recategorisation", async () => {
    const { client, store, row } = await setup();
    const base = store.resolve("categories.ttl");
    const food = { id: base + "#food", label: "Food" };
    const other = { id: base + "#other", label: "Other" };
    const added = { id: base + "#added", label: "Concurrent" };
    await saveCategories(client, () => [food, other]);
    // The UI's stale tree need never be written back: the intended rename operates on the current tree.
    await saveCategories(client, (current) => [...current, added]);
    await saveCategories(client, (current) =>
      current.map((c) => (c.id === food.id ? { ...c, label: "Meals" } : c)),
    );
    expect((await loadCategories(client)).categories).toContainEqual(added);
    let once = true;
    const racing = intercept(client, async (url, init) => {
      if (once && init?.method === "PUT" && url.endsWith("categories.ttl")) {
        once = false;
        await saveCategories(client, (current) => [
          ...current,
          { id: base + "#race", label: "Race" },
        ]);
      }
    });
    await expect(
      saveCategories(racing, (current) =>
        current.map((c) => (c.id === food.id ? { ...c, label: "Stale" } : c)),
      ),
    ).rejects.toMatchObject({ status: 412 });
    await bulkCategorise(client, [row.id], food.id);
    await expect(deleteCategory(racing, food.id, other.id)).resolves.toBeUndefined();
    await saveCategories(client, (current) => [...current, food]);
    await bulkCategorise(client, [row.id], food.id);
    once = true;
    const duringRecategorise = intercept(client, async (url, init) => {
      if (once && init?.method === "PUT" && url.includes("transactions/")) {
        once = false;
        await saveCategories(client, (current) => [
          ...current,
          { id: base + "#during", label: "During delete" },
        ]);
      }
    });
    await expect(deleteCategory(duringRecategorise, food.id, other.id)).rejects.toMatchObject({
      status: 412,
    });
    expect((await loadCategories(client)).categories).toContainEqual(food);
    expect((await loadCategories(client)).categories.some((c) => c.label === "During delete")).toBe(
      true,
    );
  });
});

const text = "Date,Payee,Amount\n2026-09-03,A,-1\n2026-10-03,B,-2";
async function importFixture() {
  const f = await setup();
  const options = suggestMapping(text).options;
  const preview = await previewImport(f.client, f.a.id, "GBP", text, "csv", options);
  const commit = (
    client = f.client,
    recover = false,
    account = f.a.id,
    currency = "GBP",
    format: "csv" | "ofx" = "csv",
  ) => commitImport(client, account, currency, text, format, options, preview, vi.fn(), recover);
  return { ...f, options, preview, commit };
}
describe("pending statement recovery", () => {
  it.each([
    "2026-09.ttl",
    "2026-10.ttl",
  ])("resumes missing deterministic rows after %s fails, preserving saved edits", async (shard) => {
    const { client, commit, row, a, options } = await importFixture();
    const broken = intercept(client, async (url, init) => {
      if (init?.method === "PUT" && url.endsWith(shard)) return new Response(null, { status: 500 });
    });
    expect(await importStatus(client, text)).toBe("new");
    await expect(commit(broken)).rejects.toMatchObject({ status: 500 });
    expect(await importStatus(client, text)).toBe("pending");
    await expect(commit()).rejects.toBeInstanceOf(PendingImportError);
    const saved = (await allTransactions(client)).find((r) => r.derivedFrom);
    if (saved)
      await updateTransaction(client, saved, {
        ...saved,
        description: "Edited after partial import",
      });
    // A fresh preview excludes already imported duplicates; recovery uses the reserved selection.
    const fresh = await previewImport(client, a.id, "GBP", text, "csv", options);
    const recovered = await commitImport(
      client,
      a.id,
      "GBP",
      text,
      "csv",
      options,
      fresh,
      vi.fn(),
      true,
    );
    expect(recovered.count).toBe(2);
    const rows = await allTransactions(client);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.derivedFrom)).toHaveLength(2);
    expect(rows.find((r) => r.id === row.id)).toEqual(row);
    if (saved)
      expect(rows.find((r) => r.id === saved.id)?.description).toBe("Edited after partial import");
    expect(await importStatus(client, text)).toBe("completed");
    await expect(commit(client, true)).rejects.toThrow("already been imported");
  });
  it("recovers a lost original write response and a failed completion marker without rewriting saved shards", async () => {
    const { client, commit } = await importFixture();
    const lost = intercept(client, async (url, init) => {
      if (init?.method === "PUT" && url.endsWith(".csv")) {
        await client.fetch(url, init);
        throw new Error("Lost response");
      }
    });
    await expect(commit(lost)).rejects.toThrow("Lost response");
    for (const args of [
      ["https://recovery.example/another", "GBP", "csv"],
      [undefined, "USD", "csv"],
      [undefined, "GBP", "ofx"],
    ] as const)
      await expect(commit(client, true, args[0], args[1], args[2])).rejects.toThrow(
        "original account",
      );
    const failedCompletion = intercept(client, async (url, init) => {
      if (
        init?.method === "PUT" &&
        url.endsWith(".json") &&
        String(init.body).includes('"completed"')
      )
        return new Response(null, { status: 500 });
    });
    await expect(commit(failedCompletion, true)).rejects.toMatchObject({ status: 500 });
    const writes: string[] = [];
    const tracking = intercept(client, async (url, init) => {
      if (init?.method === "PUT") writes.push(url);
    });
    expect((await commit(tracking, true)).count).toBe(2);
    expect(writes.some((url) => url.includes("transactions/"))).toBe(false);
  });
  it("handles originals without journals, read failures, altered source content and absent validators", async () => {
    const { client, store, commit } = await importFixture();
    const source = `statements/${statementId(text)}.csv`;
    await store.put(source, text, "text/csv", { create: true });
    await expect(commit()).rejects.toThrow("already been imported");
    const brokenReads = (suffix: string, status: number) =>
      intercept(client, async (url, init) => {
        if (!init?.method && url.endsWith(suffix)) return new Response(null, { status });
      });
    await expect(commit(brokenReads(".json", 500))).rejects.toMatchObject({ status: 500 });
    await expect(commit(brokenReads(".csv", 403))).rejects.toMatchObject({ status: 403 });
    const f = await importFixture();
    const noEtag = intercept(f.client, async (url, init) => {
      if (url.endsWith(".json")) {
        const response = await f.client.fetch(url, init);
        response.headers.delete("etag");
        return response;
      }
    });
    await expect(f.commit(noEtag)).rejects.toThrow("strong ETag");
    await expect(f.commit(noEtag, true)).rejects.toThrow("strong ETag");
    const failedOriginal = intercept(f.client, async (url, init) => {
      if (init?.method === "PUT" && url.endsWith(".csv"))
        return new Response(null, { status: 500 });
    });
    await expect(f.commit(failedOriginal, true)).rejects.toMatchObject({ status: 500 });
    await f.store.put(source, "Different contents", "text/csv", { create: true });
    await expect(f.commit(f.client, true)).rejects.toThrow("already been imported");
  });
});
