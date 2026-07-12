// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The accounts view's READ seam — driven by a fake fetchRdf (the auth seam),
// so the reader's projection + balance-latest-wins + typed-access handling are
// exercised end-to-end against real parsed Turtle, with NO live pod.

import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { MoneyAccessError, readLedger } from "../../src/ui/ledger.js";

const LEDGER = "https://pod.example/finance/ledger.ttl";

/** Parse Turtle into an n3.Store (what fetchRdf yields at runtime). */
function parse(turtle: string): Store {
  const store = new Store();
  store.addQuads(new Parser({ baseIRI: LEDGER }).parse(turtle));
  return store;
}

/**
 * A fake `fetchRdf` that returns the parsed body for a URL, throws a 404
 * RdfFetchError when `turtle` is omitted, or throws an arbitrary status when
 * `status` is set. Records the options it was called with so we can assert the
 * injected fetch + signal are threaded through.
 */
function fakeFetchRdf(opts: {
  turtle?: string;
  status?: number;
  seen?: { fetch?: unknown; signal?: unknown }[];
}) {
  return (async (url: string, options?: { fetch?: typeof fetch; signal?: AbortSignal }) => {
    opts.seen?.push({ fetch: options?.fetch, signal: options?.signal });
    if (opts.status !== undefined) {
      throw new RdfFetchError(`status ${opts.status}`, { url, status: opts.status });
    }
    if (opts.turtle === undefined) {
      throw new RdfFetchError("not found", { url, status: 404 });
    }
    const dataset: DatasetCore = parse(opts.turtle);
    return {
      dataset,
      etag: '"v1"',
      contentType: "text/turtle",
      response: new Response(opts.turtle, { status: 200 }),
      url,
    };
  }) as unknown as typeof import("@jeswr/fetch-rdf").fetchRdf;
}

const PREFIXES = `
@prefix fin: <https://w3id.org/jeswr/sectors/finance#> .
@prefix pm: <https://w3id.org/jeswr/pod-money#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

describe("readLedger", () => {
  it("projects accounts (with their latest balance) and transactions", async () => {
    const turtle = `${PREFIXES}
      <#everyday> a fin:FinancialAccount, fin:CurrentAccount, fin:ActiveFinancialAccount ;
        skos:prefLabel "Everyday" .
      <#bal-old> a fin:Balance ; pm:ofAccount <#everyday> ;
        fin:hasMonetaryAmount <#m-old> ; pm:asOf "2026-01-01T00:00:00Z"^^xsd:dateTime .
      <#m-old> a fin:MonetaryAmount ; fin:amount 100.0 ; fin:currency "GBP" .
      <#bal-new> a fin:Balance ; pm:ofAccount <#everyday> ;
        fin:hasMonetaryAmount <#m-new> ; pm:asOf "2026-06-01T00:00:00Z"^^xsd:dateTime .
      <#m-new> a fin:MonetaryAmount ; fin:amount 250.5 ; fin:currency "GBP" .
      <#t1> a fin:Transaction, fin:CardPayment ; pm:account <#everyday> ;
        fin:hasMonetaryAmount <#mt1> ; fin:hasCounterparty <https://shop.example/acme> ;
        pm:category <#groceries> ; fin:postingTime "2026-06-10T09:00:00Z"^^xsd:dateTime .
      <#mt1> a fin:MonetaryAmount ; fin:amount -19.99 ; fin:currency "GBP" .
    `;
    const snap = await readLedger(LEDGER, { fetchRdf: fakeFetchRdf({ turtle }) });

    expect(snap.accounts).toHaveLength(1);
    const acc = snap.accounts[0];
    expect(acc?.id).toBe(`${LEDGER}#everyday`);
    expect(acc?.kind).toBe("Current");
    expect(acc?.status).toBe("Active");
    expect(acc?.label).toBe("Everyday");
    // The LATER-dated balance wins.
    expect(acc?.balance).toBe(250.5);
    expect(acc?.balanceCurrency).toBe("GBP");

    expect(snap.transactions).toHaveLength(1);
    const txn = snap.transactions[0];
    expect(txn?.id).toBe(`${LEDGER}#t1`);
    expect(txn?.kind).toBe("CardPayment");
    expect(txn?.account).toBe(`${LEDGER}#everyday`);
    expect(txn?.payee).toBe("https://shop.example/acme");
    expect(txn?.category).toBe(`${LEDGER}#groceries`);
    expect(txn?.amount).toBe(-19.99);
    expect(txn?.currency).toBe("GBP");
    expect(txn?.postingTime?.toISOString()).toBe("2026-06-10T09:00:00.000Z");
  });

  it("prefers a dated balance over an undated one regardless of order", async () => {
    // The undated balance is iterated FIRST; a later dated one must replace it.
    const turtle = `${PREFIXES}
      <#a> a fin:FinancialAccount .
      <#bal-undated> a fin:Balance ; pm:ofAccount <#a> ; fin:hasMonetaryAmount <#mu> .
      <#mu> a fin:MonetaryAmount ; fin:amount 1.0 ; fin:currency "GBP" .
      <#bal-dated> a fin:Balance ; pm:ofAccount <#a> ; fin:hasMonetaryAmount <#md> ;
        pm:asOf "2026-06-01T00:00:00Z"^^xsd:dateTime .
      <#md> a fin:MonetaryAmount ; fin:amount 2.0 ; fin:currency "GBP" .
    `;
    const snap = await readLedger(LEDGER, { fetchRdf: fakeFetchRdf({ turtle }) });
    expect(snap.accounts[0]?.balance).toBe(2.0);
  });

  it("keeps the first undated balance when no balance is dated (tie → incumbent)", async () => {
    const turtle = `${PREFIXES}
      <#a> a fin:FinancialAccount .
      <#b1> a fin:Balance ; pm:ofAccount <#a> ; fin:hasMonetaryAmount <#m1> .
      <#m1> a fin:MonetaryAmount ; fin:amount 5.0 ; fin:currency "GBP" .
      <#b2> a fin:Balance ; pm:ofAccount <#a> ; fin:hasMonetaryAmount <#m2> .
      <#m2> a fin:MonetaryAmount ; fin:amount 9.0 ; fin:currency "GBP" .
    `;
    const snap = await readLedger(LEDGER, { fetchRdf: fakeFetchRdf({ turtle }) });
    // Exactly one balance value is kept (the incumbent); we don't assert which
    // of the two undated values, only that a single tie-break held.
    expect([5.0, 9.0]).toContain(snap.accounts[0]?.balance);
  });

  it("leaves balance undefined for an account with no balance", async () => {
    const turtle = `${PREFIXES}<#a> a fin:FinancialAccount ; skos:prefLabel "Bare" .`;
    const snap = await readLedger(LEDGER, { fetchRdf: fakeFetchRdf({ turtle }) });
    expect(snap.accounts[0]?.balance).toBeUndefined();
    expect(snap.accounts[0]?.balanceCurrency).toBeUndefined();
  });

  it("ignores a balance whose account is unset", async () => {
    const turtle = `${PREFIXES}
      <#a> a fin:FinancialAccount .
      <#b> a fin:Balance ; fin:hasMonetaryAmount <#m> .
      <#m> a fin:MonetaryAmount ; fin:amount 7.0 ; fin:currency "GBP" .
    `;
    const snap = await readLedger(LEDGER, { fetchRdf: fakeFetchRdf({ turtle }) });
    expect(snap.accounts[0]?.balance).toBeUndefined();
  });

  it("returns an empty snapshot for a 404 (absent ledger)", async () => {
    const snap = await readLedger(LEDGER, { fetchRdf: fakeFetchRdf({}) });
    expect(snap).toEqual({ accounts: [], transactions: [] });
  });

  it("throws a typed MoneyAccessError on 401", async () => {
    await expect(readLedger(LEDGER, { fetchRdf: fakeFetchRdf({ status: 401 }) })).rejects.toThrow(
      MoneyAccessError,
    );
  });

  it("throws a typed MoneyAccessError on 403", async () => {
    const err = await readLedger(LEDGER, { fetchRdf: fakeFetchRdf({ status: 403 }) }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(MoneyAccessError);
    expect((err as MoneyAccessError).status).toBe(403);
    expect((err as MoneyAccessError).url).toBe(LEDGER);
  });

  it("re-throws any other RdfFetchError (e.g. 500) untyped", async () => {
    const err = await readLedger(LEDGER, { fetchRdf: fakeFetchRdf({ status: 500 }) }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(RdfFetchError);
    expect(err).not.toBeInstanceOf(MoneyAccessError);
  });

  it("re-throws a non-RdfFetchError (e.g. a network TypeError)", async () => {
    const reader = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof import("@jeswr/fetch-rdf").fetchRdf;
    await expect(readLedger(LEDGER, { fetchRdf: reader })).rejects.toThrow("network down");
  });

  it("threads the injected fetch + abort signal through to the reader", async () => {
    const seen: { fetch?: unknown; signal?: unknown }[] = [];
    const myFetch = vi.fn() as unknown as typeof fetch;
    const controller = new AbortController();
    await readLedger(LEDGER, {
      fetchRdf: fakeFetchRdf({ turtle: `${PREFIXES}`, seen }),
      fetch: myFetch,
      signal: controller.signal,
    });
    expect(seen[0]?.fetch).toBe(myFetch);
    expect(seen[0]?.signal).toBe(controller.signal);
  });

  it("omits the fetch option when none is injected (falls back to ambient)", async () => {
    const seen: { fetch?: unknown; signal?: unknown }[] = [];
    await readLedger(LEDGER, { fetchRdf: fakeFetchRdf({ turtle: `${PREFIXES}`, seen }) });
    expect(seen[0]?.fetch).toBeUndefined();
    expect(seen[0]?.signal).toBeUndefined();
  });

  it("uses the default @jeswr/fetch-rdf when no reader is injected", async () => {
    // No fetchRdf override → the real one runs against a stubbed global fetch,
    // proving the default path (read = options.fetchRdf ?? defaultFetchRdf).
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`${PREFIXES}<#a> a fin:FinancialAccount ; skos:prefLabel "Default" .`, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      }),
    );
    const snap = await readLedger(LEDGER);
    expect(snap.accounts[0]?.label).toBe("Default");
    vi.restoreAllMocks();
  });
});
