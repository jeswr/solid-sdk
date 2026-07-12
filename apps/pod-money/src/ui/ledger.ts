// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The accounts view's READ seam — an abortable, typed-access-aware load of the
// finance ledger into a plain snapshot the view renders. It is the SINGLE place
// the view layer touches a pod read.
//
// It composes the EXISTING data layer (the `FinanceDocument` typed wrappers +
// `resolveAmount`) and `@jeswr/fetch-rdf` — it does NOT re-implement RDF parsing
// or hand-build triples. It is deliberately separate from `MoneyStore` because:
//   - the view needs an `AbortSignal` (cancel a superseded load), which the
//     store's write-oriented `load` does not thread; and
//   - the view needs 401/403 surfaced as a TYPED access error (distinct from an
//     empty/absent ledger), where the store collapses 404 → empty and re-throws
//     the rest untyped.
//
// ── AUTH SEAM ────────────────────────────────────────────────────────────────
// The authenticated `fetch` is INJECTED, not imported. Pass the session's fetch
// via `options.fetch`; omit it and `@jeswr/fetch-rdf` falls back to the global
// `fetch`. In production that global is the one
// @solid/reactive-authentication's ReactiveFetchManager.registerGlobally()
// patches (a plain fetch transparently upgrades on a 401 with a DPoP token),
// wired ONCE in the create-solid-app shell. That wiring is #18-gated
// (create-solid-app S2 — interactive auth-code login;
// https://github.com/solid-contrib/reactive-authentication/issues/18). This
// reader is DELIBERATELY unaware of any of that: it works today against a
// stubbed fetch in unit tests and later against the real session with NO code
// change. Do NOT hard-wire a login flow here.

import { fetchRdf as defaultFetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import {
  type AccountKind,
  type AccountStatus,
  FinanceDocument,
  type TransactionKind,
} from "../model.js";
import { DataFactory } from "../serialise.js";

/** A 401/403 on a ledger read — surfaced typed so the view can distinguish it. */
export class MoneyAccessError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string) {
    super(`Access denied (${status}) reading ${url}.`);
    this.name = "MoneyAccessError";
    this.status = status;
    this.url = url;
  }
}

/** One account projected for the list, with its resolved latest balance. */
export interface AccountRow {
  /** The account IRI (stable key). */
  id: string;
  kind: AccountKind | undefined;
  status: AccountStatus | undefined;
  label: string | undefined;
  /** The most recent balance amount for the account, or `undefined` if none. */
  balance: number | undefined;
  /** The currency of the latest balance (or `undefined`). */
  balanceCurrency: string | undefined;
}

/** One transaction projected for an account's transaction list. */
export interface TransactionRow {
  /** The transaction IRI (stable key). */
  id: string;
  kind: TransactionKind | undefined;
  /** The owning account IRI (`pm:account`). */
  account: string | undefined;
  /** The counterparty IRI (`fin:hasCounterparty`), the closest to a "payee". */
  payee: string | undefined;
  /** The spending category IRI (`pm:category`). */
  category: string | undefined;
  postingTime: Date | undefined;
  amount: number | undefined;
  currency: string | undefined;
}

/** The whole ledger snapshot the accounts view renders. */
export interface LedgerSnapshot {
  accounts: AccountRow[];
  transactions: TransactionRow[];
}

/** Options for {@link readLedger}. */
export interface ReadLedgerOptions {
  /** The authenticated fetch (the auth seam). Omit → ambient global fetch. */
  fetch?: typeof fetch;
  /** Cancellation signal — abort a superseded load. */
  signal?: AbortSignal;
  /** Override the RDF reader (tests). Defaults to `@jeswr/fetch-rdf`. */
  fetchRdf?: typeof defaultFetchRdf;
}

/**
 * Read the finance ledger at `ledgerUrl` into a plain {@link LedgerSnapshot}.
 *
 *   - A 404 yields an EMPTY snapshot (`{ accounts: [], transactions: [] }`) —
 *     an absent ledger is the new-pod case, not an error.
 *   - A 401/403 throws {@link MoneyAccessError} (typed, so the view shows a
 *     login-/permission-flavoured message rather than a generic failure).
 *   - Any other failure re-throws (the view renders it generically + a retry).
 *
 * Balances are resolved per account by walking every `fin:Balance` for the
 * account and keeping the one with the latest `pm:asOf` (a balance without an
 * `asOf` loses to any dated one, and to a later-iterated undated one only as a
 * last resort). All amount resolution goes through the model's `resolveAmount`.
 */
export async function readLedger(
  ledgerUrl: string,
  options: ReadLedgerOptions = {},
): Promise<LedgerSnapshot> {
  const read = options.fetchRdf ?? defaultFetchRdf;
  try {
    const { dataset } = await read(ledgerUrl, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const document = new FinanceDocument(dataset, DataFactory);
    return projectLedger(document);
  } catch (error) {
    if (error instanceof RdfFetchError) {
      if (error.status === 404) {
        return { accounts: [], transactions: [] };
      }
      if (error.status === 401 || error.status === 403) {
        throw new MoneyAccessError(error.status, ledgerUrl);
      }
    }
    throw error;
  }
}

/** Project a parsed FinanceDocument into the plain snapshot the view renders. */
function projectLedger(document: FinanceDocument): LedgerSnapshot {
  // Best (latest) balance per account IRI, chosen by `asOf` (newest wins).
  interface BalanceEntry {
    amount: number | undefined;
    currency: string | undefined;
    asOf: Date | undefined;
  }
  const latestBalance = new Map<string, BalanceEntry>();
  for (const bal of document.balances) {
    const account = bal.account;
    if (account === undefined) continue;
    const money = document.resolveAmount(bal.monetaryAmount);
    const asOf = bal.asOf;
    const current = latestBalance.get(account);
    if (current === undefined || isNewer(asOf, current.asOf)) {
      latestBalance.set(account, {
        amount: money?.amount,
        currency: money?.currency,
        asOf,
      });
    }
  }

  const accounts: AccountRow[] = [];
  for (const acc of document.accounts) {
    const bal = latestBalance.get(acc.value);
    accounts.push({
      id: acc.value,
      kind: acc.kind,
      status: acc.status,
      label: acc.label,
      balance: bal?.amount,
      balanceCurrency: bal?.currency,
    });
  }

  const transactions: TransactionRow[] = [];
  for (const txn of document.transactions) {
    const money = document.resolveAmount(txn.monetaryAmount);
    transactions.push({
      id: txn.value,
      kind: txn.kind,
      account: txn.account,
      payee: txn.counterparty,
      category: txn.category,
      postingTime: txn.postingTime,
      amount: money?.amount,
      currency: money?.currency,
    });
  }

  return { accounts, transactions };
}

/**
 * Is balance time `a` newer than the currently-kept `b`? A dated balance always
 * beats an undated one; between two dated balances the later instant wins; an
 * invalid Date is treated as undated. Undated-vs-undated keeps the incumbent
 * (returns false) so iteration order is not relied upon for a tie.
 */
function isNewer(a: Date | undefined, b: Date | undefined): boolean {
  const ta = a && !Number.isNaN(a.getTime()) ? a.getTime() : undefined;
  const tb = b && !Number.isNaN(b.getTime()) ? b.getTime() : undefined;
  if (ta === undefined) return false;
  if (tb === undefined) return true;
  return ta > tb;
}
