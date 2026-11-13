// AUTHORED-BY GPT-6.1 Sol
// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { type LedgerSnapshot, readLedger } from "../../src/ui/ledger.js";
import { useAccountsLedger } from "../../src/ui/useAccountsLedger.js";

vi.mock("../../src/ui/ledger.js", async (original) => ({
  ...(await original<typeof import("../../src/ui/ledger.js")>()),
  readLedger: vi.fn(),
}));

function snapshot(label: string): LedgerSnapshot {
  return {
    accounts: [
      {
        id: `https://pod.example/ledger.ttl#${label}`,
        label,
        kind: undefined,
        status: undefined,
        balance: undefined,
        balanceCurrency: undefined,
      },
    ],
    transactions: [],
  };
}

it("discards a successful old-session read that completes after fetch changes, even if it ignores abort", async () => {
  let finishOld!: (value: LedgerSnapshot) => void;
  const oldRead = new Promise<LedgerSnapshot>((resolve) => {
    finishOld = resolve;
  });
  const currentSnapshot = snapshot("current-account");
  vi.mocked(readLedger).mockReturnValueOnce(oldRead).mockResolvedValueOnce(currentSnapshot);
  const oldFetch = vi.fn<typeof fetch>();
  const currentFetch = vi.fn<typeof fetch>();
  const url = "https://pod.example/ledger.ttl";
  const { result, rerender } = renderHook(({ fetch }) => useAccountsLedger(url, { fetch }), {
    initialProps: { fetch: oldFetch },
  });
  const oldSignal = vi.mocked(readLedger).mock.calls[0]?.[1]?.signal;
  expect(oldSignal?.aborted).toBe(false);
  rerender({ fetch: currentFetch });
  await waitFor(() => expect(result.current.accounts).toEqual(currentSnapshot.accounts));
  expect(oldSignal?.aborted).toBe(true);
  expect(readLedger).toHaveBeenLastCalledWith(url, {
    fetch: currentFetch,
    signal: expect.any(AbortSignal),
  });

  // Model a data read already completing when cancellation arrives.
  await act(async () => finishOld(snapshot("previous-account")));
  expect(result.current.accounts).toEqual(currentSnapshot.accounts);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeNull();
});
