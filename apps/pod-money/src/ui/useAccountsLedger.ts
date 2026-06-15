// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The accounts view's data hook — the SINGLE place the view owns "which ledger
// am I reading + its loading/error/selection state". It delegates the actual
// GET+parse to `readLedger` (src/ui/ledger.ts → the data-layer model); it never
// re-implements LDP/RDF reading.
//
// ── AUTH SEAM ────────────────────────────────────────────────────────────────
// The authenticated `fetch` is INJECTED, not imported — threaded straight to
// `readLedger`. Omit it and the data layer falls back to the global `fetch`
// (patched by @solid/reactive-authentication in a real session). The wiring is
// #18-gated (create-solid-app S2). See ledger.ts for the full note. Do NOT
// hard-wire a login flow here.

import { useCallback, useEffect, useRef, useState } from "react";
import { accountDisplayLabel, errorMessage } from "./format.js";
import {
  type AccountRow,
  type LedgerSnapshot,
  MoneyAccessError,
  readLedger,
  type TransactionRow,
} from "./ledger.js";

/** What the view needs to render the accounts list, a selected account, + states. */
export interface AccountsLedgerState {
  /** Every account in the ledger (with resolved balances); `[]` until loaded. */
  accounts: AccountRow[];
  /** The currently-selected account IRI, or `null` for the accounts list. */
  selectedAccount: string | null;
  /** The selected account's row (or `null` when none / not found). */
  selected: AccountRow | null;
  /**
   * The display label for the selected account, or `null` when none is
   * selected. When an account is selected but is no longer present in the
   * ledger (e.g. it vanished across a reload), this falls back to the account
   * IRI so the view always has a non-empty heading without its own branching.
   */
  selectedLabel: string | null;
  /** The selected account's transactions, newest first; `[]` when none selected. */
  transactions: TransactionRow[];
  /** True while a ledger GET is in flight. */
  loading: boolean;
  /**
   * A user-facing error message, or `null`. A 401/403 is reported as a distinct
   * login-/permission-flavoured message; any other failure (network, parse) is
   * reported generically.
   */
  error: string | null;
  /** True when the current error is an authentication/authorization failure. */
  isAccessError: boolean;
  /** Open an account's transaction list. */
  openAccount: (id: string) => void;
  /** Return to the accounts list. */
  closeAccount: () => void;
  /** Re-fetch the ledger (e.g. a manual "retry" after a generic error). */
  refresh: () => void;
}

/** Options for {@link useAccountsLedger}. */
export interface UseAccountsLedgerOptions {
  /**
   * The authenticated fetch. Omit to use the ambient global fetch (which
   * @solid/reactive-authentication patches in a real session). The injectable
   * auth seam — see the file header.
   */
  fetch?: typeof fetch;
}

const EMPTY: LedgerSnapshot = { accounts: [], transactions: [] };

/**
 * React state for browsing accounts + their transactions from one finance
 * ledger. The hook loads `ledgerUrl` on mount, again whenever the caller
 * refreshes, and re-loads + RESETS selection whenever the `ledgerUrl` (or the
 * injected `fetch`) prop changes — a new ledger never strands the view on the
 * previous one's selection or stale data. It cancels an in-flight load on
 * prop change / unmount so a slow earlier request can never overwrite a newer
 * one (the classic stale race).
 */
export function useAccountsLedger(
  ledgerUrl: string,
  options: UseAccountsLedgerOptions = {},
): AccountsLedgerState {
  const { fetch: authedFetch } = options;

  const [snapshot, setSnapshot] = useState<LedgerSnapshot>(EMPTY);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAccessError, setIsAccessError] = useState(false);
  // Bumped to force a re-fetch of the same ledger (refresh) without a prop change.
  const [reloadToken, setReloadToken] = useState(0);
  // Guards against a resolved-but-stale response overwriting newer state.
  const requestIdRef = useRef(0);

  // Track the (url, fetch) the current state belongs to, kept in STATE (not a
  // ref) so the prop-change reset is concurrent-rendering safe: a ref written
  // during render can leak from an ABANDONED render and make a later committed
  // render with the same inputs skip the reset, stranding the view on stale
  // data / a stale selection. State set during render is applied by React only
  // when the render commits, so the comparison is always against the committed
  // value. (React's documented "adjusting state when a prop changes" pattern.)
  const [prevUrl, setPrevUrl] = useState(ledgerUrl);
  // The tracked fetch is a FUNCTION, so it must be stored via the lazy-init and
  // functional-update forms — `useState(fn)` would CALL `fn` as a lazy
  // initializer and `setState(fn)` would CALL it as an updater. Wrapping in
  // `() => authedFetch` stores the reference itself (and never invokes it).
  const [prevFetch, setPrevFetch] = useState<typeof fetch | undefined>(() => authedFetch);

  // Reset ALL state DURING render when the ledger url OR the injected fetch
  // changes (the mount case is excluded because prev* is seeded with the
  // initial values). EVERY flag is reset — crucially `loading` back to TRUE so
  // the view never flashes a stale "empty ledger" over a load that is about to
  // start, and the selection back to null so the new ledger opens at its list.
  if (prevUrl !== ledgerUrl || prevFetch !== authedFetch) {
    setPrevUrl(ledgerUrl);
    setPrevFetch(() => authedFetch);
    setSnapshot(EMPTY);
    setSelectedAccount(null);
    setLoading(true);
    setError(null);
    setIsAccessError(false);
  }

  // `reloadToken` is a deliberate re-fetch TRIGGER (bumped by refresh()): it is
  // not read in the body, but its change must re-run the effect to GET the same
  // ledger again. The static analyzer can't infer that intent — hence the
  // explicit dependency plus this suppression.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is an intentional refetch trigger
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setIsAccessError(false);

    readLedger(ledgerUrl, {
      ...(authedFetch ? { fetch: authedFetch } : {}),
      signal: controller.signal,
    })
      .then((result) => {
        if (requestId !== requestIdRef.current) {
          return; // a newer load superseded this one
        }
        setSnapshot(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        // The cleanup below bumps `requestIdRef` before aborting, so a
        // superseded load (incl. an aborted one) is caught by this single
        // staleness check — we never surface state from a no-longer-current
        // request.
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (err instanceof MoneyAccessError) {
          setIsAccessError(true);
          setError(
            err.status === 401
              ? "You need to log in to view your accounts."
              : "You don't have permission to view these accounts.",
          );
        } else {
          setError(errorMessage(err));
        }
        setLoading(false);
      });

    return () => {
      // Mark any in-flight response as stale and abort the underlying GET.
      requestIdRef.current++;
      controller.abort();
    };
  }, [ledgerUrl, authedFetch, reloadToken]);

  const openAccount = useCallback((id: string) => {
    setSelectedAccount(id);
  }, []);

  const closeAccount = useCallback(() => {
    setSelectedAccount(null);
  }, []);

  const refresh = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  const selected =
    selectedAccount === null
      ? null
      : (snapshot.accounts.find((a) => a.id === selectedAccount) ?? null);

  // The heading label for the selected account: its display label when the
  // account is present, else (it vanished across a reload, or was opened by a
  // raw id) the account IRI — so the view never branches and never shows an
  // empty heading. `null` only when nothing is selected.
  const selectedLabel =
    selectedAccount === null
      ? null
      : selected
        ? accountDisplayLabel(selected.label, selected.id)
        : selectedAccount;

  // Transactions for the selected account, newest first. A transaction with no
  // posting time sorts after dated ones (its time is treated as -Infinity).
  const transactions =
    selectedAccount === null
      ? []
      : snapshot.transactions
          .filter((t) => t.account === selectedAccount)
          .slice()
          .sort((a, b) => postingMillis(b.postingTime) - postingMillis(a.postingTime));

  return {
    accounts: snapshot.accounts,
    selectedAccount,
    selected,
    selectedLabel,
    transactions,
    loading,
    error,
    isAccessError,
    openAccount,
    closeAccount,
    refresh,
  };
}

/** A sortable epoch-ms for a posting time; an absent/invalid Date sorts oldest. */
function postingMillis(date: Date | undefined): number {
  if (date === undefined) return Number.NEGATIVE_INFINITY;
  const t = date.getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}
