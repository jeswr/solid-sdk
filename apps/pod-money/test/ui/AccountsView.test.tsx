// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The accounts VIEW + its data hook, driven by a stubbed authenticated fetch
// (the auth seam). Proves the view renders a real finance ledger (parsed by the
// data layer) as accounts-with-balances, opens an account into its
// transactions (date / payee / amount) and back, and renders the empty /
// loading / error / access-denied states — all with NO real pod and NO login.

import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsView } from "../../src/ui/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const LEDGER = "https://pod.example/finance/ledger.ttl";

const FULL = `
@prefix fin: <https://w3id.org/jeswr/sectors/finance#> .
@prefix pm: <https://w3id.org/jeswr/pod-money#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${LEDGER}#everyday> a fin:FinancialAccount, fin:CurrentAccount, fin:ActiveFinancialAccount ;
  skos:prefLabel "Everyday" .
<${LEDGER}#bal> a fin:Balance ; pm:ofAccount <${LEDGER}#everyday> ;
  fin:hasMonetaryAmount <${LEDGER}#mbal> ; pm:asOf "2026-06-01T00:00:00Z"^^xsd:dateTime .
<${LEDGER}#mbal> a fin:MonetaryAmount ; fin:amount 250.5 ; fin:currency "GBP" .
<${LEDGER}#savings> a fin:FinancialAccount, fin:SavingsAccount .
<${LEDGER}#t1> a fin:Transaction, fin:CardPayment ; pm:account <${LEDGER}#everyday> ;
  fin:hasMonetaryAmount <${LEDGER}#mt1> ; fin:hasCounterparty <https://shop.example/acme> ;
  fin:postingTime "2026-06-10T09:00:00Z"^^xsd:dateTime .
<${LEDGER}#mt1> a fin:MonetaryAmount ; fin:amount -19.99 ; fin:currency "GBP" .
`;

const EMPTY = `
@prefix fin: <https://w3id.org/jeswr/sectors/finance#> .
`;

// An account whose transactions exercise the defensive paths: one with NO payee
// and NO posting time, and one with an INVALID posting time + missing amount.
const DEFENSIVE = `
@prefix fin: <https://w3id.org/jeswr/sectors/finance#> .
@prefix pm: <https://w3id.org/jeswr/pod-money#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${LEDGER}#a> a fin:FinancialAccount .
<${LEDGER}#tx-bare> a fin:Transaction ; pm:account <${LEDGER}#a> .
<${LEDGER}#tx-bad> a fin:Transaction ; pm:account <${LEDGER}#a> ;
  fin:postingTime "not-a-date"^^xsd:dateTime .
`;

/** A fetch returning a canned body for the ledger URL; everything else 404s. */
function bodyFetch(map: Record<string, string>): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = map[url];
    if (body === undefined) {
      const res = new Response(null, { status: 404 });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }
    const res = new Response(body, {
      status: 200,
      headers: { "content-type": "text/turtle", etag: '"v1"' },
    });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as unknown as typeof globalThis.fetch;
}

function statusFetch(status: number): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = new Response(null, { status });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as unknown as typeof globalThis.fetch;
}

describe("AccountsView", () => {
  it("lists accounts with their balances, then opens an account into its transactions and back", async () => {
    render(
      <AccountsView ledgerUrl={LEDGER} fetch={bodyFetch({ [LEDGER]: FULL })} title="My Money" />,
    );

    expect(screen.getByRole("heading", { name: "My Money" })).toBeInTheDocument();

    // Accounts list: Everyday (Current/Active) with a formatted GBP balance, and
    // the bare savings account showing its kind + placeholder balance.
    const everyday = await screen.findByRole("button", { name: "Everyday" });
    expect(everyday).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // rows[0] header; one row per account.
    expect(rows[1]).toHaveTextContent("Everyday");
    expect(rows[1]).toHaveTextContent("Current");
    expect(rows[1]).toHaveTextContent("Active");
    // £250.50 — asserted via the code-point to keep the source ASCII.
    expect(rows[1]).toHaveTextContent(`£250.50`);
    // The savings account has no label → its IRI leaf, kind Savings, no balance.
    expect(screen.getByRole("button", { name: "savings" })).toBeInTheDocument();

    // Open Everyday → its transactions (date / payee / amount).
    await act(async () => {
      everyday.click();
    });
    expect(await screen.findByRole("heading", { name: "Everyday" })).toBeInTheDocument();
    const txnRows = screen.getAllByRole("row");
    expect(txnRows[1]).toHaveTextContent("2026-06-10");
    expect(txnRows[1]).toHaveTextContent("acme"); // payee = counterparty IRI leaf
    expect(txnRows[1]).toHaveTextContent("CardPayment");
    expect(txnRows[1]).toHaveTextContent(`-£19.99`);

    // Back to the accounts list.
    const back = screen.getByRole("button", { name: /Accounts/ });
    await act(async () => {
      back.click();
    });
    expect(await screen.findByRole("button", { name: "Everyday" })).toBeInTheDocument();
  });

  it("shows the no-transactions state for an account with none", async () => {
    render(<AccountsView ledgerUrl={LEDGER} fetch={bodyFetch({ [LEDGER]: FULL })} />);
    const savings = await screen.findByRole("button", { name: "savings" });
    await act(async () => {
      savings.click();
    });
    expect(await screen.findByText("No transactions for this account.")).toBeInTheDocument();
  });

  it("renders defensively for transactions with no payee / missing or invalid date / no amount", async () => {
    render(<AccountsView ledgerUrl={LEDGER} fetch={bodyFetch({ [LEDGER]: DEFENSIVE })} />);
    const account = await screen.findByRole("button", { name: "a" });
    await act(async () => {
      account.click();
    });
    // Both transactions render (no crash); date / payee / amount degrade to "—".
    const rows = await screen.findAllByRole("row");
    // Header + two transaction rows.
    expect(rows).toHaveLength(3);
    const placeholders = screen.getAllByText("—");
    // At least: 2 payees + 2 amounts + the bare txn's date all degrade.
    expect(placeholders.length).toBeGreaterThanOrEqual(5);
  });

  it("shows the empty state when the ledger has no accounts", async () => {
    render(<AccountsView ledgerUrl={LEDGER} fetch={bodyFetch({ [LEDGER]: EMPTY })} />);
    expect(await screen.findByText("No accounts yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("treats an absent ledger (404) as empty, not an error", async () => {
    render(<AccountsView ledgerUrl={LEDGER} fetch={bodyFetch({})} />);
    expect(await screen.findByText("No accounts yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a login-flavoured access error (401) with NO retry button", async () => {
    render(<AccountsView ledgerUrl={LEDGER} fetch={statusFetch(401)} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("You need to log in");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a permission access error (403) with NO retry button", async () => {
    render(<AccountsView ledgerUrl={LEDGER} fetch={statusFetch(403)} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("don't have permission");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a generic error WITH a working retry that re-fetches", async () => {
    let ok = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!ok) {
        const res = new Response(null, { status: 500 });
        Object.defineProperty(res, "url", { value: url });
        return res;
      }
      const res = new Response(FULL, { status: 200, headers: { "content-type": "text/turtle" } });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;

    render(<AccountsView ledgerUrl={LEDGER} fetch={fetch} />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    ok = true;
    await act(async () => {
      retry.click();
    });
    expect(await screen.findByRole("button", { name: "Everyday" })).toBeInTheDocument();
  });

  it("shows a loading status while the first request is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = (async (input: string | URL | Request) => {
      await gate;
      const url = typeof input === "string" ? input : input.toString();
      const res = new Response(FULL, { status: 200, headers: { "content-type": "text/turtle" } });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;

    render(<AccountsView ledgerUrl={LEDGER} fetch={fetch} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: "Everyday" })).toBeInTheDocument();
  });

  it("falls back to the global fetch when no fetch prop is given", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const res = new Response(FULL, { status: 200, headers: { "content-type": "text/turtle" } });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as typeof fetch);
    render(<AccountsView ledgerUrl={LEDGER} />);
    expect(await screen.findByRole("button", { name: "Everyday" })).toBeInTheDocument();
  });

  it("renders without a title heading when none is given", async () => {
    render(<AccountsView ledgerUrl={LEDGER} fetch={bodyFetch({ [LEDGER]: FULL })} />);
    await screen.findByRole("button", { name: "Everyday" });
    // The only headings are per-account (h3, shown after selecting); none at list level.
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });
});
