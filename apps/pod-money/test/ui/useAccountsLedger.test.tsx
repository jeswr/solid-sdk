// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Focused tests for the data hook's race + lifecycle + selection handling that
// the component test can't deterministically force: a slow load superseded by a
// newer prop change must NOT overwrite the newer state, an aborted request must
// not surface an error, the prop-change reset clears ALL state (incl. loading +
// selection), and transactions sort newest-first.

import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAccountsLedger } from "../../src/ui/useAccountsLedger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const PREFIXES = `
@prefix fin: <https://w3id.org/jeswr/sectors/finance#> .
@prefix pm: <https://w3id.org/jeswr/pod-money#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

/** Turtle for a one-account, two-transaction ledger keyed by the resource URL. */
function ledgerTtl(url: string): string {
  return `${PREFIXES}
    <${url}#everyday> a fin:FinancialAccount, fin:CurrentAccount ; skos:prefLabel "Everyday" .
    <${url}#t-old> a fin:Transaction ; pm:account <${url}#everyday> ;
      fin:hasMonetaryAmount <${url}#m-old> ; fin:postingTime "2026-01-01T00:00:00Z"^^xsd:dateTime .
    <${url}#m-old> a fin:MonetaryAmount ; fin:amount -1.0 ; fin:currency "GBP" .
    <${url}#t-new> a fin:Transaction ; pm:account <${url}#everyday> ;
      fin:hasMonetaryAmount <${url}#m-new> ; fin:postingTime "2026-06-01T00:00:00Z"^^xsd:dateTime .
    <${url}#m-new> a fin:MonetaryAmount ; fin:amount -2.0 ; fin:currency "GBP" .
  `;
}

function ttlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
}

/** A fetch that returns the canned ledger for any URL it is asked for. */
function okFetch(): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = ttlResponse(ledgerTtl(url));
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as unknown as typeof globalThis.fetch;
}

describe("useAccountsLedger", () => {
  it("loads the ledger on mount and exposes accounts", async () => {
    const fetch = okFetch();
    const { result } = renderHook(() =>
      useAccountsLedger("https://pod.example/finance/ledger.ttl", { fetch }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.accounts).toHaveLength(1);
    expect(result.current.selectedAccount).toBeNull();
    expect(result.current.selected).toBeNull();
    expect(result.current.transactions).toEqual([]);
  });

  it("opens an account and lists its transactions newest-first; closes back to the list", async () => {
    const url = "https://pod.example/finance/ledger.ttl";
    const fetch = okFetch();
    const { result } = renderHook(() => useAccountsLedger(url, { fetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.openAccount(`${url}#everyday`));
    expect(result.current.selectedAccount).toBe(`${url}#everyday`);
    expect(result.current.selected?.label).toBe("Everyday");
    expect(result.current.transactions).toHaveLength(2);
    // Newest (2026-06) first.
    expect(result.current.transactions[0]?.id).toBe(`${url}#t-new`);
    expect(result.current.transactions[1]?.id).toBe(`${url}#t-old`);

    act(() => result.current.closeAccount());
    expect(result.current.selectedAccount).toBeNull();
    expect(result.current.transactions).toEqual([]);
  });

  it("selected is null + selectedLabel falls back to the IRI when the account is not in the ledger", async () => {
    const url = "https://pod.example/finance/ledger.ttl";
    const fetch = okFetch();
    const { result } = renderHook(() => useAccountsLedger(url, { fetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openAccount(`${url}#ghost`));
    expect(result.current.selectedAccount).toBe(`${url}#ghost`);
    expect(result.current.selected).toBeNull();
    // No row for the ghost id → the heading label degrades to the IRI itself.
    expect(result.current.selectedLabel).toBe(`${url}#ghost`);
    expect(result.current.transactions).toEqual([]);
  });

  it("selectedLabel is null when nothing is selected, and the account label when present", async () => {
    const url = "https://pod.example/finance/ledger.ttl";
    const fetch = okFetch();
    const { result } = renderHook(() => useAccountsLedger(url, { fetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedLabel).toBeNull();
    act(() => result.current.openAccount(`${url}#everyday`));
    expect(result.current.selectedLabel).toBe("Everyday");
  });

  it("does not let a slow superseded load overwrite a newer ledger prop", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pod.example/slow.ttl") {
        await slow;
      }
      const res = ttlResponse(ledgerTtl(url));
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ u }: { u: string }) => useAccountsLedger(u, { fetch }),
      { initialProps: { u: "https://pod.example/slow.ttl" } },
    );
    // Swap to a fast ledger before the slow one resolves.
    rerender({ u: "https://pod.example/fast.ttl" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accounts[0]?.id).toBe("https://pod.example/fast.ttl#everyday");

    // Release the stale slow load; it must NOT replace fast.
    await act(async () => {
      releaseSlow();
      await slow;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accounts[0]?.id).toBe("https://pod.example/fast.ttl#everyday");
  });

  it("discards a superseded load that REJECTS after a newer prop change", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pod.example/slow.ttl") {
        await slow;
        throw new TypeError("slow load failed late");
      }
      const res = ttlResponse(ledgerTtl(url));
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ u }: { u: string }) => useAccountsLedger(u, { fetch }),
      { initialProps: { u: "https://pod.example/slow.ttl" } },
    );
    rerender({ u: "https://pod.example/fast.ttl" });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      releaseSlow();
      await slow.catch(() => {});
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.accounts[0]?.id).toBe("https://pod.example/fast.ttl#everyday");
  });

  it("resets ALL state — incl. loading back to true + selection — when the ledger prop changes", async () => {
    const url1 = "https://pod.example/one.ttl";
    const fetch = okFetch();
    const { result, rerender } = renderHook(
      ({ u }: { u: string }) => useAccountsLedger(u, { fetch }),
      { initialProps: { u: url1 } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openAccount(`${url1}#everyday`));
    expect(result.current.selectedAccount).toBe(`${url1}#everyday`);

    // New ledger: selection must clear, loading must flip back to true (no stale
    // empty over the in-flight load), then resolve to the new ledger.
    rerender({ u: "https://pod.example/two.ttl" });
    expect(result.current.selectedAccount).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accounts[0]?.id).toBe("https://pod.example/two.ttl#everyday");
  });

  it("resets when only the injected fetch identity changes", async () => {
    const url = "https://pod.example/finance/ledger.ttl";
    const { result, rerender } = renderHook(
      ({ f }: { f: typeof globalThis.fetch }) => useAccountsLedger(url, { fetch: f }),
      { initialProps: { f: okFetch() } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openAccount(`${url}#everyday`));

    rerender({ f: okFetch() }); // a NEW fetch identity
    expect(result.current.selectedAccount).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accounts).toHaveLength(1);
  });

  it("does NOT reset when the ledger + fetch props are unchanged across a re-render", async () => {
    const url = "https://pod.example/finance/ledger.ttl";
    const fetch = okFetch();
    const { result, rerender } = renderHook(() => useAccountsLedger(url, { fetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openAccount(`${url}#everyday`));

    rerender();
    expect(result.current.selectedAccount).toBe(`${url}#everyday`);
  });

  it("refresh re-fetches the same ledger", async () => {
    const url = "https://pod.example/finance/ledger.ttl";
    const fetch = vi.fn((async (input: string | URL | Request) => {
      const u = typeof input === "string" ? input : input.toString();
      const res = ttlResponse(ledgerTtl(u));
      Object.defineProperty(res, "url", { value: u });
      return res;
    }) as unknown as typeof globalThis.fetch);
    const { result } = renderHook(() => useAccountsLedger(url, { fetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const after = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(after).toBeGreaterThan(before);
  });

  it("surfaces a typed access error (401) flavour", async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const res = new Response(null, { status: 401 });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() =>
      useAccountsLedger("https://pod.example/finance/ledger.ttl", { fetch }),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isAccessError).toBe(true);
    expect(result.current.error).toContain("log in");
  });

  it("surfaces a typed access error (403) flavour", async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const res = new Response(null, { status: 403 });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() =>
      useAccountsLedger("https://pod.example/finance/ledger.ttl", { fetch }),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isAccessError).toBe(true);
    expect(result.current.error).toContain("permission");
  });

  it("surfaces a generic error for a non-access failure", async () => {
    const fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() =>
      useAccountsLedger("https://pod.example/finance/ledger.ttl", { fetch }),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isAccessError).toBe(false);
    expect(result.current.error).toContain("network down");
  });

  it("resets correctly under StrictMode's double render of a prop change", async () => {
    const url1 = "https://pod.example/one.ttl";
    const fetch = okFetch();
    const { result, rerender } = renderHook(
      ({ u }: { u: string }) => useAccountsLedger(u, { fetch }),
      { initialProps: { u: url1 }, wrapper: StrictMode },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openAccount(`${url1}#everyday`));

    rerender({ u: "https://pod.example/two.ttl" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedAccount).toBeNull();
    expect(result.current.accounts[0]?.id).toBe("https://pod.example/two.ttl#everyday");

    // A SECOND change still resets (a leaked render-ref would have desynced this).
    rerender({ u: "https://pod.example/three.ttl" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accounts[0]?.id).toBe("https://pod.example/three.ttl#everyday");
  });
});
