// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Typed RDF model — TermWrapper / DatasetWrapper accessors over the finance
// sector ontology (FIBO-slim) + the thin Pod Money app namespace.
//
// House rule (never hand-build triples): every read/write goes through the
// @rdfjs/wrapper mapping helpers. No `dataset.add(factory.quad(...))` and no
// string-concatenated Turtle anywhere in this file.

import {
  DatasetWrapper,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { FinClass, FinProp, PmClass, PmProp, RDF_TYPE } from "./vocab.js";

/** The account-status phases, as a closed string union over the sector Phase partition. */
export type AccountStatus = "Active" | "Frozen" | "Closed";

const STATUS_CLASS: Record<AccountStatus, string> = {
  Active: FinClass.ActiveFinancialAccount,
  Frozen: FinClass.FrozenFinancialAccount,
  Closed: FinClass.ClosedFinancialAccount,
};
const STATUS_OF_CLASS: ReadonlyMap<string, AccountStatus> = new Map([
  [FinClass.ActiveFinancialAccount, "Active"],
  [FinClass.FrozenFinancialAccount, "Frozen"],
  [FinClass.ClosedFinancialAccount, "Closed"],
]);

/** The account sub-kinds, as a closed string union. */
export type AccountKind = "Current" | "Savings" | "Credit" | "Investment";

const KIND_CLASS: Record<AccountKind, string> = {
  Current: FinClass.CurrentAccount,
  Savings: FinClass.SavingsAccount,
  Credit: FinClass.CreditAccount,
  Investment: FinClass.InvestmentAccount,
};
const KIND_OF_CLASS: ReadonlyMap<string, AccountKind> = new Map([
  [FinClass.CurrentAccount, "Current"],
  [FinClass.SavingsAccount, "Savings"],
  [FinClass.CreditAccount, "Credit"],
  [FinClass.InvestmentAccount, "Investment"],
]);

/** The concrete transaction kinds, as a closed string union over the sector EventTypes. */
export type TransactionKind = "Transaction" | "Payment" | "CardPayment" | "Transfer";

const TXN_CLASS: Record<TransactionKind, string> = {
  Transaction: FinClass.Transaction,
  Payment: FinClass.Payment,
  CardPayment: FinClass.CardPayment,
  Transfer: FinClass.Transfer,
};
const TXN_OF_CLASS: ReadonlyMap<string, TransactionKind> = new Map([
  [FinClass.Payment, "Payment"],
  [FinClass.CardPayment, "CardPayment"],
  [FinClass.Transfer, "Transfer"],
  [FinClass.Transaction, "Transaction"],
]);

/**
 * `fin:MonetaryAmount` — a decimal value + an ISO 4217 currency code.
 * The value object reused by transactions, balances and holdings.
 */
export class MonetaryAmount extends TermWrapper {
  /** The numeric value (`fin:amount`). */
  get amount(): number | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.amount, LiteralAs.number);
  }
  set amount(value: number | undefined) {
    OptionalAs.object(this, FinProp.amount, value, LiteralFrom.double);
  }

  /** The ISO 4217 alphabetic currency code (`fin:currency`), e.g. "GBP". */
  get currency(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.currency, LiteralAs.string);
  }
  set currency(value: string | undefined) {
    OptionalAs.object(this, FinProp.currency, value, LiteralFrom.string);
  }

  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this node as a `fin:MonetaryAmount`. */
  markMonetaryAmount(): void {
    this.types.add(FinClass.MonetaryAmount);
  }
}

/**
 * `fin:FinancialAccount` (and its CurrentAccount / SavingsAccount /
 * CreditAccount / InvestmentAccount sub-kinds). A reified relator: holder +
 * provider live in the profile, the account here carries kind, status and label.
 */
export class FinancialAccount extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Human-readable account label (`skos:prefLabel`). */
  get label(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PmProp.label, LiteralAs.string);
  }
  set label(value: string | undefined) {
    OptionalAs.object(this, PmProp.label, value, LiteralFrom.string);
  }

  /**
   * The account sub-kind, derived from the rdf:type set. `undefined` for a
   * bare `fin:FinancialAccount` with no sub-kind type. Setting it adds the
   * sub-kind class (and `fin:FinancialAccount`); it does NOT remove a previously
   * set sub-kind — call `clearKind()` first to change kinds.
   */
  get kind(): AccountKind | undefined {
    for (const t of this.types) {
      const k = KIND_OF_CLASS.get(t);
      if (k) return k;
    }
    return undefined;
  }
  set kind(value: AccountKind) {
    this.types.add(FinClass.FinancialAccount);
    this.types.add(KIND_CLASS[value]);
  }

  /** Remove every account sub-kind type (keeps `fin:FinancialAccount`). */
  clearKind(): void {
    for (const c of Object.values(KIND_CLASS)) this.types.delete(c);
  }

  /**
   * The account status phase, derived from the rdf:type set. The sector models
   * status as a disjoint Phase partition, so an account is in EXACTLY one phase;
   * setting status clears the other two phases to preserve that invariant.
   */
  get status(): AccountStatus | undefined {
    for (const t of this.types) {
      const s = STATUS_OF_CLASS.get(t);
      if (s) return s;
    }
    return undefined;
  }
  set status(value: AccountStatus) {
    for (const c of Object.values(STATUS_CLASS)) this.types.delete(c);
    this.types.add(STATUS_CLASS[value]);
  }

  /** Stamp this node as a `fin:FinancialAccount` (call once when minting). */
  markAccount(): void {
    this.types.add(FinClass.FinancialAccount);
  }
}

/**
 * `fin:Transaction` (and its Payment / CardPayment / Transfer event kinds) —
 * a money movement with a monetary amount, a posting time, an owning account,
 * and an optional category and counterparty.
 */
export class Transaction extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /**
   * The concrete transaction kind, derived from rdf:type (most specific wins:
   * CardPayment > Payment > Transfer > Transaction).
   */
  get kind(): TransactionKind | undefined {
    const t = this.types;
    if (t.has(FinClass.CardPayment)) return "CardPayment";
    if (t.has(FinClass.Payment)) return "Payment";
    if (t.has(FinClass.Transfer)) return "Transfer";
    if (t.has(FinClass.Transaction)) return "Transaction";
    return undefined;
  }
  set kind(value: TransactionKind) {
    for (const c of Object.values(TXN_CLASS)) this.types.delete(c);
    this.types.add(FinClass.Transaction);
    this.types.add(TXN_CLASS[value]);
  }

  /** The IRI of the `fin:MonetaryAmount` node (`fin:hasMonetaryAmount`). */
  get monetaryAmount(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.hasMonetaryAmount, NamedNodeAs.string);
  }
  set monetaryAmount(value: string | undefined) {
    OptionalAs.object(this, FinProp.hasMonetaryAmount, value, NamedNodeFrom.string);
  }

  /** The posting instant (`fin:postingTime`, sub-property of core:timestamp). */
  get postingTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.postingTime, LiteralAs.date);
  }
  set postingTime(value: Date | undefined) {
    OptionalAs.object(this, FinProp.postingTime, value, LiteralFrom.dateTime);
  }

  /** The owning (holder's) account IRI (`pm:account`). */
  get account(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PmProp.account, NamedNodeAs.string);
  }
  set account(value: string | undefined) {
    OptionalAs.object(this, PmProp.account, value, NamedNodeFrom.string);
  }

  /** The spending category IRI (`pm:category`). */
  get category(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PmProp.category, NamedNodeAs.string);
  }
  set category(value: string | undefined) {
    OptionalAs.object(this, PmProp.category, value, NamedNodeFrom.string);
  }

  /** The counterparty IRI (`fin:hasCounterparty`). */
  get counterparty(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.hasCounterparty, NamedNodeAs.string);
  }
  set counterparty(value: string | undefined) {
    OptionalAs.object(this, FinProp.hasCounterparty, value, NamedNodeFrom.string);
  }

  /** Stamp this node as a `fin:Transaction` (call once when minting). */
  markTransaction(): void {
    this.types.add(FinClass.Transaction);
  }
}

/**
 * `fin:Balance` — a point-in-time statement of the amount on an account.
 */
export class Balance extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The account this balance is for (`pm:ofAccount`). */
  get account(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PmProp.ofAccount, NamedNodeAs.string);
  }
  set account(value: string | undefined) {
    OptionalAs.object(this, PmProp.ofAccount, value, NamedNodeFrom.string);
  }

  /** The IRI of the `fin:MonetaryAmount` node (`fin:hasMonetaryAmount`). */
  get monetaryAmount(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.hasMonetaryAmount, NamedNodeAs.string);
  }
  set monetaryAmount(value: string | undefined) {
    OptionalAs.object(this, FinProp.hasMonetaryAmount, value, NamedNodeFrom.string);
  }

  /** The as-of timestamp (`pm:asOf`). */
  get asOf(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, PmProp.asOf, LiteralAs.date);
  }
  set asOf(value: Date | undefined) {
    OptionalAs.object(this, PmProp.asOf, value, LiteralFrom.dateTime);
  }

  /** Stamp this node as a `fin:Balance` (call once when minting). */
  markBalance(): void {
    this.types.add(FinClass.Balance);
  }
}

/**
 * `fin:Holding` — a held position: a quantity of a financial instrument owned
 * within an investment account.
 */
export class Holding extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The instrument this is a position in (`fin:ofInstrument`). */
  get instrument(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.ofInstrument, NamedNodeAs.string);
  }
  set instrument(value: string | undefined) {
    OptionalAs.object(this, FinProp.ofInstrument, value, NamedNodeFrom.string);
  }

  /** The number of units held (`fin:quantity`). */
  get quantity(): number | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.quantity, LiteralAs.number);
  }
  set quantity(value: number | undefined) {
    OptionalAs.object(this, FinProp.quantity, value, LiteralFrom.double);
  }

  /** The investment account this holding is custodied within (`fin:heldInAccount`). */
  get account(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.heldInAccount, NamedNodeAs.string);
  }
  set account(value: string | undefined) {
    OptionalAs.object(this, FinProp.heldInAccount, value, NamedNodeFrom.string);
  }

  /** The IRI of the `fin:MonetaryAmount` valuation node (`fin:hasMonetaryAmount`). */
  get valuation(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FinProp.hasMonetaryAmount, NamedNodeAs.string);
  }
  set valuation(value: string | undefined) {
    OptionalAs.object(this, FinProp.hasMonetaryAmount, value, NamedNodeFrom.string);
  }

  /** Stamp this node as a `fin:Holding` (call once when minting). */
  markHolding(): void {
    this.types.add(FinClass.Holding);
  }
}

/**
 * `pm:Category` — a user-defined spending category (an app-local concept; the
 * finance sector ontology has no category class). Categories are tagged onto
 * transactions via `pm:category`.
 */
export class Category extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Human-readable category label (`skos:prefLabel`). */
  get label(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PmProp.categoryLabel, LiteralAs.string);
  }
  set label(value: string | undefined) {
    OptionalAs.object(this, PmProp.categoryLabel, value, LiteralFrom.string);
  }

  /** Stamp this node as a `pm:Category` (call once when minting). */
  markCategory(): void {
    this.types.add(PmClass.Category);
  }
}

/**
 * A whole resource document, wrapped so siblings (multiple accounts /
 * transactions / etc. in one container resource) can be listed. Registrations
 * and finance entities are *sibling subjects* in a document, so this must be a
 * DatasetWrapper (not reachable from one root term).
 */
export class FinanceDocument extends DatasetWrapper {
  /** Every `fin:FinancialAccount` subject in the document. */
  get accounts(): Iterable<FinancialAccount> {
    return this.instancesOf(FinClass.FinancialAccount, FinancialAccount);
  }

  /** Every `fin:Transaction` subject in the document. */
  get transactions(): Iterable<Transaction> {
    return this.instancesOf(FinClass.Transaction, Transaction);
  }

  /** Every `fin:Balance` subject in the document. */
  get balances(): Iterable<Balance> {
    return this.instancesOf(FinClass.Balance, Balance);
  }

  /** Every `fin:Holding` subject in the document. */
  get holdings(): Iterable<Holding> {
    return this.instancesOf(FinClass.Holding, Holding);
  }

  /** Every `fin:MonetaryAmount` subject in the document. */
  get monetaryAmounts(): Iterable<MonetaryAmount> {
    return this.instancesOf(FinClass.MonetaryAmount, MonetaryAmount);
  }

  /** Every `pm:Category` subject in the document. */
  get categories(): Iterable<Category> {
    return this.instancesOf(PmClass.Category, Category);
  }

  /**
   * Resolve a node's monetary amount into a plain `{ amount, currency }` value,
   * following `fin:hasMonetaryAmount` to the amount subject and reading it. The
   * amount may be a separate subject (the normal case) or absent.
   */
  resolveAmount(amountIri: string | undefined): { amount?: number; currency?: string } | undefined {
    if (!amountIri) return undefined;
    const ma = new MonetaryAmount(amountIri, this, this.factory);
    const out: { amount?: number; currency?: string } = {};
    const amt = ma.amount;
    const cur = ma.currency;
    if (amt !== undefined) out.amount = amt;
    if (cur !== undefined) out.currency = cur;
    return out;
  }

  // --- minting helpers (write into the same underlying dataset) -----------

  /** Mint a new account subject in this document. */
  mintAccount(iri: string): FinancialAccount {
    const acc = new FinancialAccount(iri, this, this.factory);
    acc.markAccount();
    return acc;
  }

  /** Mint a new monetary-amount subject in this document. */
  mintMonetaryAmount(iri: string): MonetaryAmount {
    const ma = new MonetaryAmount(iri, this, this.factory);
    ma.markMonetaryAmount();
    return ma;
  }

  /** Mint a new transaction subject in this document. */
  mintTransaction(iri: string): Transaction {
    const txn = new Transaction(iri, this, this.factory);
    txn.markTransaction();
    return txn;
  }

  /** Mint a new balance subject in this document. */
  mintBalance(iri: string): Balance {
    const bal = new Balance(iri, this, this.factory);
    bal.markBalance();
    return bal;
  }

  /** Mint a new holding subject in this document. */
  mintHolding(iri: string): Holding {
    const h = new Holding(iri, this, this.factory);
    h.markHolding();
    return h;
  }

  /** Mint a new category subject in this document. */
  mintCategory(iri: string): Category {
    const c = new Category(iri, this, this.factory);
    c.markCategory();
    return c;
  }
}
