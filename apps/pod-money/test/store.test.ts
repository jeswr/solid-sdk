// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  FINANCE_PATH,
  LEDGER_RESOURCE,
  MoneyStore,
  PreconditionFailedError,
  PUBLIC_TYPE_INDEX_PATH,
  WriteError,
} from "../src/store.js";
import { FinClass, SolidTerm } from "../src/vocab.js";
import { fakeFetch, fakeFetchRdf, type RecordedPut } from "./helpers.js";

const POD = "https://alice.pod.example/";
const LEDGER = `${POD}finance/ledger.ttl`;
const INDEX = `${POD}settings/publicTypeIndex.ttl`;

const SEED_LEDGER = `
  @prefix fin: <https://TBD.example/solid/finance#> .
  @prefix pm: <https://w3id.org/jeswr/pod-money#> .
  @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
  <#acc> a fin:FinancialAccount, fin:CurrentAccount, fin:ActiveFinancialAccount ;
    skos:prefLabel "Everyday" .
  <#amt> a fin:MonetaryAmount ; fin:amount "-12.50"^^<http://www.w3.org/2001/XMLSchema#decimal> ; fin:currency "GBP" .
  <#t> a fin:Transaction, fin:CardPayment ; pm:account <#acc> ; fin:hasMonetaryAmount <#amt> .
`;

describe("MoneyStore construction + URL shaping", () => {
  it("rejects a podRoot without a trailing slash", () => {
    expect(() => new MoneyStore({ podRoot: "https://x.example" })).toThrow(TypeError);
  });

  it("derives the finance container, ledger and type-index URLs", () => {
    const store = new MoneyStore({ podRoot: POD });
    expect(store.financeContainer).toBe(`${POD}${FINANCE_PATH}`);
    expect(store.ledgerUrl).toBe(`${POD}${FINANCE_PATH}${LEDGER_RESOURCE}`);
    expect(store.publicTypeIndexUrl).toBe(`${POD}${PUBLIC_TYPE_INDEX_PATH}`);
  });

  it("exposes the primary class + forClass IRIs for federation", () => {
    expect(MoneyStore.primaryClass).toBe(FinClass.Transaction);
    expect(MoneyStore.typeIndexForClass).toBe(SolidTerm.forClass);
  });

  it("defaults fetchRdf and fetch to the ambient globals", () => {
    const store = new MoneyStore({ podRoot: POD });
    expect(store).toBeInstanceOf(MoneyStore);
  });
});

describe("MoneyStore.load", () => {
  it("reads an existing resource into a typed document with its ETag", async () => {
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [LEDGER]: { turtle: SEED_LEDGER, etag: '"v1"' } }),
    });
    const { document, etag, exists, url } = await store.loadLedger();
    expect(etag).toBe('"v1"');
    expect(exists).toBe(true);
    expect(url).toBe(LEDGER);
    expect([...document.accounts]).toHaveLength(1);
  });

  it("treats a 404 as an empty, non-existent document with no ETag", async () => {
    const store = new MoneyStore({ podRoot: POD, fetchRdf: fakeFetchRdf({}) });
    const { document, dataset, etag, exists } = await store.loadLedger();
    expect(etag).toBeNull();
    expect(exists).toBe(false);
    expect(dataset.size).toBe(0);
    expect([...document.accounts]).toHaveLength(0);
  });

  it("re-throws a non-404 fetch error", async () => {
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [LEDGER]: { status: 500 } }),
    });
    await expect(store.loadLedger()).rejects.toBeInstanceOf(RdfFetchError);
  });
});

describe("MoneyStore.listAccounts / listTransactions", () => {
  it("projects accounts", async () => {
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [LEDGER]: { turtle: SEED_LEDGER } }),
    });
    const accounts = await store.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ kind: "Current", status: "Active", label: "Everyday" });
    expect(accounts[0]?.id).toBe(`${LEDGER}#acc`);
  });

  it("projects transactions and resolves their monetary amount", async () => {
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [LEDGER]: { turtle: SEED_LEDGER } }),
    });
    const txns = await store.listTransactions();
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ kind: "CardPayment", amount: -12.5, currency: "GBP" });
    expect(txns[0]?.account).toBe(`${LEDGER}#acc`);
  });

  it("returns empty lists when the ledger is absent", async () => {
    const store = new MoneyStore({ podRoot: POD, fetchRdf: fakeFetchRdf({}) });
    expect(await store.listAccounts()).toEqual([]);
    expect(await store.listTransactions()).toEqual([]);
  });
});

describe("MoneyStore.save (conditional write)", () => {
  it("sends If-Match when an ETag is present", async () => {
    const record: RecordedPut[] = [];
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [LEDGER]: { turtle: SEED_LEDGER, etag: '"v1"' } }),
      fetch: fakeFetch(record),
    });
    const { dataset, etag, exists } = await store.loadLedger();
    await store.save(LEDGER, dataset, { etag, exists });
    expect(record).toHaveLength(1);
    expect(record[0]?.headers["if-match"]).toBe('"v1"');
    expect(record[0]?.headers["content-type"]).toBe("text/turtle");
    expect(record[0]?.headers["if-none-match"]).toBeUndefined();
  });

  it("sends If-None-Match:* when creating (resource did not exist)", async () => {
    const record: RecordedPut[] = [];
    const store = new MoneyStore({ podRoot: POD, fetch: fakeFetch(record) });
    await store.save(LEDGER, new Store(), { etag: null, exists: false });
    expect(record[0]?.headers["if-none-match"]).toBe("*");
    expect(record[0]?.headers["if-match"]).toBeUndefined();
  });

  it("sends If-None-Match:* by default (omitted condition = create)", async () => {
    const record: RecordedPut[] = [];
    const store = new MoneyStore({ podRoot: POD, fetch: fakeFetch(record) });
    await store.save(LEDGER, new Store());
    expect(record[0]?.headers["if-none-match"]).toBe("*");
  });

  it("does an UNCONDITIONAL PUT for an existing resource with no ETag (degraded server)", async () => {
    // Regression: a legacy NSS-style server returns an existing resource with
    // no ETag. Sending If-None-Match:* here would 412 forever; sending no
    // precondition at all is the correct degraded-update path.
    const record: RecordedPut[] = [];
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [LEDGER]: { turtle: SEED_LEDGER, etag: null } }),
      fetch: fakeFetch(record),
    });
    const { dataset, etag, exists } = await store.loadLedger();
    expect(etag).toBeNull();
    expect(exists).toBe(true);
    await store.save(LEDGER, dataset, { etag, exists });
    expect(record[0]?.headers["if-none-match"]).toBeUndefined();
    expect(record[0]?.headers["if-match"]).toBeUndefined();
  });

  it("throws PreconditionFailedError on a 412", async () => {
    const store = new MoneyStore({ podRoot: POD, fetch: fakeFetch([], [412]) });
    await expect(
      store.save(LEDGER, new Store(), { etag: '"stale"', exists: true }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it("throws WriteError on a non-2xx, non-412 status", async () => {
    const store = new MoneyStore({ podRoot: POD, fetch: fakeFetch([], [403]) });
    await expect(
      store.save(LEDGER, new Store(), { etag: null, exists: false }),
    ).rejects.toBeInstanceOf(WriteError);
  });

  it("resolves with the response on success", async () => {
    const store = new MoneyStore({ podRoot: POD, fetch: fakeFetch([], [201]) });
    const res = await store.save(LEDGER, new Store(), { etag: null, exists: false });
    expect(res.status).toBe(201);
  });
});

describe("MoneyStore mutators", () => {
  it("addAccount reads-modifies-writes a new account", async () => {
    const record: RecordedPut[] = [];
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [LEDGER]: { turtle: SEED_LEDGER, etag: '"v1"' } }),
      fetch: fakeFetch(record),
    });
    await store.addAccount({ iri: `${LEDGER}#savings`, kind: "Savings", label: "Rainy Day" });
    expect(record).toHaveLength(1);
    expect(record[0]?.body).toContain("fin:SavingsAccount");
    expect(record[0]?.body).toContain("Rainy Day");
    expect(record[0]?.headers["if-match"]).toBe('"v1"');
  });

  it("addAccount defaults status to Active and creates the ledger if absent", async () => {
    const record: RecordedPut[] = [];
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({}),
      fetch: fakeFetch(record),
    });
    await store.addAccount({ iri: `${LEDGER}#a`, kind: "Current" });
    expect(record[0]?.body).toContain("fin:ActiveFinancialAccount");
    expect(record[0]?.headers["if-none-match"]).toBe("*");
  });

  it("addTransaction writes the transaction and its monetary-amount node", async () => {
    const record: RecordedPut[] = [];
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({}),
      fetch: fakeFetch(record),
    });
    await store.addTransaction({
      iri: `${LEDGER}#t1`,
      kind: "Payment",
      account: `${LEDGER}#acc`,
      amount: 25,
      currency: "EUR",
      amountIri: `${LEDGER}#amt1`,
      postingTime: new Date("2026-06-15T09:00:00.000Z"),
      category: `${LEDGER}#cat`,
      counterparty: "https://shop.example/me#agent",
    });
    const body = record[0]?.body ?? "";
    expect(body).toContain("fin:Payment");
    expect(body).toContain("fin:MonetaryAmount");
    expect(body).toContain("EUR");
    expect(body).toContain("pm:category");
    expect(body).toContain("fin:hasCounterparty");
  });

  it("addTransaction omits optional category/counterparty when not given", async () => {
    const record: RecordedPut[] = [];
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({}),
      fetch: fakeFetch(record),
    });
    await store.addTransaction({
      iri: `${LEDGER}#t2`,
      kind: "Transfer",
      account: `${LEDGER}#acc`,
      amount: 5,
      currency: "GBP",
      amountIri: `${LEDGER}#amt2`,
      postingTime: new Date(),
    });
    const body = record[0]?.body ?? "";
    expect(body).toContain("fin:Transfer");
    expect(body).not.toContain("pm:category");
    expect(body).not.toContain("fin:hasCounterparty");
  });
});

describe("MoneyStore type-index registration + discovery", () => {
  it("creates and registers the primary class when the index is absent", async () => {
    const record: RecordedPut[] = [];
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({}),
      fetch: fakeFetch(record),
    });
    await store.registerInTypeIndex();
    const body = record[0]?.body ?? "";
    expect(record[0]?.url).toBe(INDEX);
    expect(body).toContain("solid:TypeIndex");
    expect(body).toContain("solid:ListedDocument");
    expect(body).toContain("solid:TypeRegistration");
    expect(body).toContain("fin:Transaction");
    expect(body).toContain("https://alice.pod.example/finance/");
    expect(record[0]?.headers["if-none-match"]).toBe("*");
  });

  it("updates an existing index conditionally", async () => {
    const record: RecordedPut[] = [];
    const existing = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <> a solid:TypeIndex, solid:ListedDocument .
    `;
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [INDEX]: { turtle: existing, etag: '"idx"' } }),
      fetch: fakeFetch(record),
    });
    await store.registerInTypeIndex();
    expect(record[0]?.headers["if-match"]).toBe('"idx"');
  });

  it("discovers a registered class location", async () => {
    const idx = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix fin: <https://TBD.example/solid/finance#> .
      <> a solid:TypeIndex, solid:ListedDocument .
      <#r> a solid:TypeRegistration ;
        solid:forClass fin:Transaction ;
        solid:instanceContainer <https://alice.pod.example/finance/> .
    `;
    const store = new MoneyStore({
      podRoot: POD,
      fetchRdf: fakeFetchRdf({ [INDEX]: { turtle: idx } }),
    });
    expect(await store.discover(FinClass.Transaction)).toEqual([
      { container: "https://alice.pod.example/finance/" },
    ]);
  });

  it("discover returns an empty list when the index is absent", async () => {
    const store = new MoneyStore({ podRoot: POD, fetchRdf: fakeFetchRdf({}) });
    expect(await store.discover(FinClass.Transaction)).toEqual([]);
  });
});

describe("MoneyStore error types", () => {
  it("PreconditionFailedError carries url + etag", () => {
    const e = new PreconditionFailedError(LEDGER, '"x"');
    expect(e.name).toBe("PreconditionFailedError");
    expect(e.url).toBe(LEDGER);
    expect(e.etag).toBe('"x"');
    expect(e.message).toContain('"x"');
  });

  it("PreconditionFailedError renders <none> for a null etag", () => {
    expect(new PreconditionFailedError(LEDGER, null).message).toContain("<none>");
  });

  it("WriteError carries url + status", () => {
    const e = new WriteError(LEDGER, 500);
    expect(e.name).toBe("WriteError");
    expect(e.url).toBe(LEDGER);
    expect(e.status).toBe(500);
  });
});

describe("MoneyStore uses the ambient fetch when none injected", () => {
  it("calls globalThis.fetch on save", async () => {
    const record: RecordedPut[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch(record, [205]));
    try {
      const store = new MoneyStore({ podRoot: POD });
      await store.save(LEDGER, new Store(), { etag: '"v1"', exists: true });
      expect(record).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
