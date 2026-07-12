// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Pod Money accounts VIEW — the app's primary view: a list of the holder's
// financial accounts with their balances; click an account to open its
// transactions (date / payee / amount), a back button to return to the list.
//
// This component is FRAMEWORK-AGNOSTIC React (no Next.js import, no "use client"
// pragma): it drops straight into the create-solid-app Next.js shell's
// `components/` or any React app. It renders ONLY — it never touches RDF or
// fetch directly; all data flows through `useAccountsLedger`, which calls the
// data layer. Styling is plain class names (`pod-money-*`) so the host app's
// CSS owns the look; the component ships no styles of its own.
//
// FINANCIAL DATA IS SENSITIVE: every amount/date goes through the defensive
// formatters (never throw on missing/NaN/invalid), and NOTHING is logged. React
// escapes all rendered text by default; no value is ever placed in a URL or
// dangerouslySetInnerHTML.
//
// AUTH SEAM: the `fetch` prop is the injected authenticated fetch, threaded to
// `useAccountsLedger` → the data layer. See ledger.ts for the full note.

import {
  accountDisplayLabel,
  formatAccountKind,
  formatAccountStatus,
  formatDate,
  formatMoney,
  formatTransactionKind,
  iriLeaf,
  PLACEHOLDER,
} from "./format.js";
import { useAccountsLedger } from "./useAccountsLedger.js";

/** Props for {@link AccountsView}. */
export interface AccountsViewProps {
  /**
   * The finance ledger resource URL to read, e.g.
   * `https://alice.pod.example/finance/ledger.ttl` (from `MoneyStore.ledgerUrl`).
   */
  ledgerUrl: string;
  /**
   * The authenticated fetch for pod reads. Omit to use the ambient global fetch
   * (patched by @solid/reactive-authentication in a real session). The
   * injectable auth seam — unit tests pass a stub here.
   */
  fetch?: typeof fetch;
  /** Optional heading rendered above the view. */
  title?: string;
}

/**
 * Render a Solid pod's finance ledger as accounts + transactions. Top level is
 * a list of accounts with balances; selecting one shows that account's
 * transactions. Renders distinct loading / empty / error / access-denied states.
 */
export function AccountsView({ ledgerUrl, fetch, title }: AccountsViewProps) {
  const {
    accounts,
    selectedLabel,
    transactions,
    loading,
    error,
    isAccessError,
    openAccount,
    closeAccount,
    refresh,
  } = useAccountsLedger(ledgerUrl, fetch ? { fetch } : {});

  return (
    <section className="pod-money-accounts" aria-label={title ?? "Pod Money accounts"}>
      {title ? <h2 className="pod-money-title">{title}</h2> : null}

      {loading ? (
        <p className="pod-money-loading" role="status">
          Loading…
        </p>
      ) : null}

      {error ? (
        <div className="pod-money-error" role="alert">
          <p>{error}</p>
          {!isAccessError ? (
            <button type="button" onClick={refresh}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {/* `selectedLabel` is non-null exactly when an account is selected, so it
          doubles as the "show the transactions view" flag AND narrows to a
          non-null heading — no separate ternary on a possibly-missing row. */}
      {!loading && !error && selectedLabel === null ? (
        <AccountsList accounts={accounts} onOpen={openAccount} />
      ) : null}

      {!loading && !error && selectedLabel !== null ? (
        <AccountTransactions
          accountLabel={selectedLabel}
          transactions={transactions}
          onBack={closeAccount}
        />
      ) : null}
    </section>
  );
}

/** The accounts list: one row per account with kind / status / balance. */
function AccountsList({
  accounts,
  onOpen,
}: {
  accounts: ReturnType<typeof useAccountsLedger>["accounts"];
  onOpen: (id: string) => void;
}) {
  if (accounts.length === 0) {
    return <p className="pod-money-empty">No accounts yet.</p>;
  }
  return (
    <table className="pod-money-table pod-money-accounts-table">
      <thead>
        <tr>
          <th scope="col">Account</th>
          <th scope="col">Kind</th>
          <th scope="col">Status</th>
          <th scope="col">Balance</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => (
          <tr key={account.id} className="pod-money-account-row">
            <td>
              <button
                type="button"
                className="pod-money-account-link"
                onClick={() => onOpen(account.id)}
              >
                {accountDisplayLabel(account.label, account.id)}
              </button>
            </td>
            <td>{formatAccountKind(account.kind)}</td>
            <td>{formatAccountStatus(account.status)}</td>
            <td className="pod-money-amount">
              {formatMoney(account.balance, account.balanceCurrency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A selected account's transaction list: date / payee / kind / amount. */
function AccountTransactions({
  accountLabel,
  transactions,
  onBack,
}: {
  accountLabel: string;
  transactions: ReturnType<typeof useAccountsLedger>["transactions"];
  onBack: () => void;
}) {
  return (
    <div className="pod-money-transactions">
      <nav className="pod-money-back" aria-label="Breadcrumb">
        <button type="button" className="pod-money-back-link" onClick={onBack}>
          ← Accounts
        </button>
      </nav>
      <h3 className="pod-money-account-heading">{accountLabel}</h3>

      {transactions.length === 0 ? (
        <p className="pod-money-empty">No transactions for this account.</p>
      ) : (
        <table className="pod-money-table pod-money-transactions-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Payee</th>
              <th scope="col">Kind</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn) => (
              <tr key={txn.id} className="pod-money-transaction-row">
                <td>{formatDate(txn.postingTime)}</td>
                <td>{txn.payee ? iriLeaf(txn.payee) : PLACEHOLDER}</td>
                <td>{formatTransactionKind(txn.kind)}</td>
                <td className="pod-money-amount">{formatMoney(txn.amount, txn.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
