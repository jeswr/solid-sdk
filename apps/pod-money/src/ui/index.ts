// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public barrel for the Pod Money React view layer (`pod-money/ui`).
//
// This is the OPTIONAL, React-only surface: a framework-agnostic accounts +
// transactions view + its data hook + read seam, sitting on top of the
// React-free data-layer core (`pod-money`). React is a *peer* dependency so a
// data-layer-only consumer never pulls it in. The view never touches RDF/fetch
// directly — it drives the data layer through `useAccountsLedger`, and takes the
// authenticated fetch as an injected seam (post-#18 the create-solid-app shell
// patches the global fetch; until then a stub fetch makes it unit-testable).

export { AccountsView, type AccountsViewProps } from "./AccountsView.js";
export {
  accountDisplayLabel,
  errorMessage,
  formatAccountKind,
  formatAccountStatus,
  formatDate,
  formatMoney,
  formatTransactionKind,
  iriLeaf,
  PLACEHOLDER,
} from "./format.js";
export {
  type AccountRow,
  type LedgerSnapshot,
  MoneyAccessError,
  type ReadLedgerOptions,
  readLedger,
  type TransactionRow,
} from "./ledger.js";
export {
  type AccountsLedgerState,
  type UseAccountsLedgerOptions,
  useAccountsLedger,
} from "./useAccountsLedger.js";
