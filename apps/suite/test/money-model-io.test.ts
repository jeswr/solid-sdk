// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it, vi } from "vitest";
import * as model from "../src/apps/money/lib/model";
import { csvStatement, sgmlStatement, xmlStatement } from "./fixtures/money-statements";

import { account, balance, base, money, options, other, range, row } from "./money-model-fixtures";

function pod() {
  const files = new Map<string, { text: string; etag: string | null; contentType?: string }>();
  const requests: { url: string; init: RequestInit }[] = [];
  let sequence = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    const current = files.get(url);
    if (init.method === "PUT") {
      const headers = new Headers(init.headers);
      if (
        (headers.get("if-none-match") === "*" && current) ||
        (headers.has("if-match") && headers.get("if-match") !== current?.etag)
      )
        return new Response(null, { status: 412 });
      const text = init.body instanceof Blob ? await init.body.text() : String(init.body);
      const etag = `"${++sequence}"`;
      files.set(url, { text, etag, contentType: headers.get("content-type") ?? "text/turtle" });
      return new Response(null, { status: 201, headers: { etag } });
    }
    if (!current) return new Response(null, { status: 404 });
    return new Response(current.text, {
      headers: {
        "content-type": current.contentType ?? "text/turtle",
        ...(current.etag === null ? {} : { etag: current.etag }),
      },
    });
  });
  return { files, requests, fetch, store: model.createMoneyStore(fetch, base) };
}

describe("injected money store", () => {
  it.each([
    {
      contentType: "application/trig",
      text: `<${base}note> <${NS.SCHEMA}description> "Default" . <${base}graph> { <${base}note> <${NS.SCHEMA}description> "Named" . }`,
    },
    {
      contentType: "application/trig",
      text: `_:graph { <${base}note> <${NS.SCHEMA}description> "Blank graph" . }`,
    },
    {
      contentType: "application/ld+json",
      text: JSON.stringify({
        "@id": `${base}graph`,
        "@graph": [{ "@id": `${base}note`, [`${NS.SCHEMA}description`]: [{ "@value": "Named" }] }],
      }),
    },
  ])("rejects writing named graphs read from $contentType before any PUT", async (file) => {
    const { store, files, requests } = pod();
    const path = "transactions/2026-10.ttl";
    const original = { ...file, etag: '"original"' };
    files.set(store.resolve(path), original);
    const loaded = await store.read(path);
    const before = [...loaded.document.dataset];
    expect(before.some((quad) => quad.graph.termType !== "DefaultGraph")).toBe(true);
    await expect(model.serialiseMoney(loaded.document)).rejects.toThrow("named graphs");
    await expect(store.write(path, loaded.document, loaded.condition)).rejects.toThrow(
      "named graphs",
    );
    await expect(store.saveTransactions([row])).rejects.toThrow("named graphs");
    expect([...loaded.document.dataset]).toEqual(before);
    expect(files.get(store.resolve(path))).toEqual(original);
    expect(requests.filter((request) => request.init.method === "PUT")).toEqual([]);
  });
  it("creates, conditionally edits and deletes a shard while preserving unrelated RDF", async () => {
    const { store, requests } = pod();
    expect(await store.saveTransactions([])).toEqual([]);
    await store.saveTransactions([row, { ...row, id: `${row.id}-other` }]);
    const path = "transactions/2026-10.ttl";
    expect((await store.read(path)).exists).toBe(true);
    await store.saveTransactions([{ ...row, amount: "-20" }]);
    expect(
      (await store.transactions(account, range, money)).map((value) => value.runningBalance),
    ).toEqual(["80", "67.5"]);
    await store.deleteTransaction("tx", row.postingTime);
    const loaded = await store.read(path);
    expect(loaded.document.transactions()).toHaveLength(1);
    expect(loaded.document.nodes(model.V.amountClass)).toHaveLength(1);
    await store.deleteTransaction("missing", row.postingTime);
    expect(
      requests
        .filter((request) => request.init.method === "PUT")
        .map((request) => new Headers(request.init.headers).get("if-match")),
    ).toEqual([null, '"1"', '"2"', '"3"']);
    expect(requests.every((request) => request.init.redirect === "manual")).toBe(true);
    await expect(store.saveTransactions([{ ...row, postingTime: "2026-11-01" }])).rejects.toThrow(
      "month shard",
    );
  });
  it("keeps referenced amounts when deleting a transaction, and handles an absent amount", async () => {
    const { store } = pod();
    const document = new model.MoneyDocument();
    model.putTransaction(document, row);
    model.putTransaction(document, { ...row, id: `${row.id}-other` });
    document.node(`${row.id}-other`).amountNode = document.node(row.id).amountNode;
    await store.write("transactions/2026-10.ttl", document, { create: true });
    await store.deleteTransaction("tx", row.postingTime);
    expect((await store.read("transactions/2026-10.ttl")).document.transactions()[0]?.amount).toBe(
      row.amount,
    );
    await store.deleteTransaction("empty", row.postingTime);
  });
  it.each([
    false,
    true,
  ])("keeps both suffix-keyed transactions readable after deleting either (%s)", async (deleteFirst) => {
    const { store } = pod();
    const next = { ...row, id: `${row.id}-amount`, amount: "42", currency: "EUR" };
    await store.saveTransactions([row, next]);
    await store.deleteTransaction(deleteFirst ? "tx" : "tx-amount", row.postingTime);
    expect((await store.read("transactions/2026-10.ttl")).document.transactions()).toEqual([
      deleteFirst ? next : row,
    ]);
  });
  it.each([
    false,
    true,
  ])("preserves a legacy subject serving as both transaction and amount (%s)", async (deleteFirst) => {
    const { store } = pod();
    const document = new model.MoneyDocument();
    const next = { ...row, id: `${row.id}-amount`, amount: "42" };
    model.putTransaction(document, row);
    model.putTransaction(document, next);
    // Reproduce a document written by the previous named amount allocator.
    document.node(row.id).amountNode = next.id;
    document.node(next.id).types.add(model.V.amountClass);
    document.node(next.id).amount = row.amount;
    document.node(next.id).currency = row.currency;
    const legacy = await model.parseMoney(
      `<${next.id}> <${NS.FINANCE}amount> "${row.amount}"; <${NS.FINANCE}currency> "GBP" .`,
      base,
    );
    for (const quad of legacy.dataset) document.dataset.add(quad);
    await store.write("transactions/2026-10.ttl", document, { create: true });
    await store.deleteTransaction(deleteFirst ? "tx" : "tx-amount", row.postingTime);
    const remaining = (await store.read("transactions/2026-10.ttl")).document;
    expect(remaining.transactions()).toEqual([deleteFirst ? next : row]);
    expect(remaining.node(next.id).amount).toBe(deleteFirst ? undefined : row.amount);
  });
  it("reads account files with latest balances and handles missing resources/shards", async () => {
    const { store, files } = pod();
    expect(await store.accounts()).toEqual([]);
    expect(await store.transactions(account, range, money)).toEqual([]);
    const document = new model.MoneyDocument();
    model.putAccount(document, { id: account, label: "Current" });
    model.putBalance(document, balance);
    model.putBalance(document, {
      ...balance,
      id: `${balance.id}-later`,
      asOf: range.start,
      amount: "500",
    });
    files.set(`${base}accounts/`, {
      etag: '"list"',
      text: `<${base}accounts/> <${NS.LDP}contains> <${base}accounts/current.ttl> .`,
    });
    await store.write("accounts/current.ttl", document, { create: true });
    expect((await store.accounts())[0]?.balance?.amount).toBe("500");
    expect((await store.read("categories.ttl")).condition).toEqual({ create: true });
  });
  it("writes transfer pairs in one shard and refuses an isolated transfer deletion", async () => {
    const { store, requests } = pod();
    const pair = await store.transfer("move", account, other, row.postingTime, money);
    expect(pair).toHaveLength(2);
    await expect(store.saveTransactions(pair)).rejects.toThrow("together");
    expect(requests.filter((request) => request.init.method === "PUT")).toHaveLength(1);
    await expect(store.deleteTransaction("move-debit", row.postingTime)).rejects.toThrow(
      "together",
    );
    await expect(
      store.transfer("move2", account, account, row.postingTime, money),
    ).rejects.toThrow();
    expect((await store.read("transactions/2026-10.ttl")).document.transactions()).toHaveLength(2);
  });
  it("fails closed on missing/weak validators, 412 conflicts, permission/network failures and escaped paths", async () => {
    expect(model.conditionalHeaders({ create: true })).toEqual({ "if-none-match": "*" });
    for (const etag of ["", 'W/"weak"', '"bad\r\n"'])
      expect(() => model.conditionalHeaders({ etag })).toThrow();
    const { store, files, requests } = pod();
    files.set(`${base}categories.ttl`, { text: "", etag: null });
    const loaded = await store.read("categories.ttl");
    await expect(store.write("categories.ttl", loaded.document, loaded.condition)).rejects.toThrow(
      "strong ETag",
    );
    expect(requests).toHaveLength(1);
    await expect(
      store.write("categories.ttl", loaded.document, { etag: '"stale"' }),
    ).rejects.toMatchObject({ status: 412 });
    for (const path of [
      "../private.ttl",
      "https://evil.example/",
      "categories.ttl#it",
      "categories.ttl?query",
    ])
      expect(() => store.resolve(path)).toThrow();
    const denied = model.createMoneyStore(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })),
      base,
    );
    await expect(denied.read("categories.ttl")).rejects.toMatchObject({ status: 403 });
    const network = model.createMoneyStore(
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
      base,
    );
    await expect(network.read("categories.ttl")).rejects.toThrow();
    const redirect = model.createMoneyStore(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
        ),
      base,
    );
    await expect(redirect.read("categories.ttl")).rejects.toThrow();
  });
});

describe("statement import pipeline", () => {
  it("keeps CSV, OFX and PDF imports with the same key distinct in a shared shard", async () => {
    const { store, files } = pod();
    const csv = await model.importStatement(store, "bank", account, "GBP", {
      format: "csv",
      text: csvStatement,
      options,
    });
    const ofx = await model.importStatement(store, "bank", other, "GBP", {
      format: "ofx",
      text: sgmlStatement,
    });
    const pdf = await model.importStatement(store, "bank", other, "USD", {
      format: "pdf",
      file: new Blob(["%PDF synthetic"]),
      adapter: async () => [{ date: row.postingTime, amount: "900", description: "PDF purchase" }],
    });
    const expected = [...csv.transactions, ...ofx.transactions, ...pdf.transactions];
    expect(new Set(expected.map((value) => value.id)).size).toBe(expected.length);
    expect((await store.read("transactions/2026-10.ttl")).document.transactions()).toEqual(
      expected,
    );
    for (const result of [csv, ofx, pdf]) {
      expect(files.has(result.source)).toBe(true);
      expect(result.transactions.every((value) => value.derivedFrom === result.source)).toBe(true);
    }
    // The format-qualified row IDs remain deterministic, including for long statement keys.
    const fresh = pod();
    const repeated = await model.importStatement(fresh.store, "bank", account, "GBP", {
      format: "csv",
      text: csvStatement,
      options,
    });
    expect(repeated.transactions).toEqual(csv.transactions);
    await model.importStatement(fresh.store, "x".repeat(128), account, "GBP", {
      format: "csv",
      text: csvStatement,
      options,
    });
  });
  it("maps CSV, stores its original first and links every transaction to it", async () => {
    const { store, files, requests } = pod();
    const result = await model.importStatement(store, "csv", account, "GBP", {
      format: "csv",
      text: csvStatement,
      options,
    });
    expect(result.transactions.length).toBeGreaterThan(0);
    expect(
      result.transactions.every((value) => value.derivedFrom === `${base}statements/csv.csv`),
    ).toBe(true);
    expect(files.get(result.source)?.text).toBe(csvStatement);
    expect(requests[0]?.url).toBe(result.source);
    expect(requests[0]?.init.method).toBe("PUT");
    expect((await store.transactions(account, range, money)).length).toBeGreaterThan(0);
  });
  it.each([
    sgmlStatement,
    xmlStatement,
  ])("imports OFX fixture records into finance shards", async (text) => {
    const { store, files } = pod();
    const result = await model.importStatement(
      store,
      "ofx",
      account,
      text === xmlStatement ? "USD" : "GBP",
      {
        format: "ofx",
        text,
      },
    );
    expect(result.transactions.length).toBeGreaterThan(0);
    expect(files.get(result.source)?.text).toBe(text);
    expect(
      (await store.read("transactions/2026-10.ttl")).document.transactions()[0]?.derivedFrom,
    ).toBe(result.source);
  });
  it("accepts an injected PDF adapter, validates its rows and stores binary bytes before provenance", async () => {
    const { store, files } = pod();
    const file = new Blob(["%PDF synthetic"], { type: "application/pdf" });
    const adapter = vi.fn().mockResolvedValue([
      { date: "2026-10-24", amount: "-2.30", description: "PDF row" },
      { date: "2026-11-01", amount: "1", description: "Next month", currency: "GBP" },
    ]);
    const result = await model.importStatement(store, "pdf", account, "GBP", {
      format: "pdf",
      file,
      adapter,
    });
    expect(adapter).toHaveBeenCalledWith(file);
    expect(result.shards).toHaveLength(2);
    expect(files.get(result.source)?.text).toBe(await file.text());
  });
  it("performs no writes for invalid imports; surfaces source-write and shard-write conflicts", async () => {
    const { store, requests, files } = pod();
    const file = new Blob(["%PDF"]);
    await expect(
      model.importStatement(store, "bad", account, "GBP", {
        format: "pdf",
        file,
        adapter: async () => [
          { date: "2026-10-24", amount: "1", description: "Bad", currency: "USD" },
        ],
      }),
    ).rejects.toThrow("currency mismatch");
    await expect(
      model.importStatement(store, "bad", account, "GBP", {
        format: "pdf",
        file,
        adapter: async () => [{ date: "2026-10-24", amount: "NaN", description: "Bad" }],
      }),
    ).rejects.toThrow();
    await expect(
      model.importStatement(store, "bad", account, "GBP", {
        format: "csv",
        text: "broken",
        options,
      }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
    await model.importStatement(store, "once", account, "GBP", {
      format: "csv",
      text: csvStatement,
      options,
    });
    await expect(
      model.importStatement(store, "once", account, "GBP", {
        format: "csv",
        text: csvStatement,
        options,
      }),
    ).rejects.toMatchObject({ status: 412 });
    files.set(`${base}transactions/2026-10.ttl`, { etag: null, text: "" });
    await expect(
      model.importStatement(store, "partial", account, "GBP", {
        format: "csv",
        text: csvStatement,
        options,
      }),
    ).rejects.toThrow("strong ETag");
    expect(files.has(`${base}statements/partial.csv`)).toBe(true);
  });
});
