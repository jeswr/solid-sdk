// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
export interface Money {
  readonly amount: string;
  readonly currency: string;
}
export interface Account {
  readonly id: string;
  readonly label: string;
}
export interface Balance extends Money {
  readonly id: string;
  readonly account: string;
  readonly asOf?: string;
}
/** The optional links of a transaction; each holds at most one IRI. */
export type TransactionLink =
  | "category"
  | "payee"
  | "derivedFrom"
  | "debitAccount"
  | "creditAccount";
export interface Transaction extends Money {
  readonly id: string;
  readonly account: string;
  readonly postingTime: string;
  readonly description: string;
  readonly category?: string;
  readonly payee?: string;
  readonly derivedFrom?: string;
  readonly debitAccount?: string;
  readonly creditAccount?: string;
  /**
   * Set by reads, only when non-empty: optional links the stored record holds but that
   * did not project (a literal, an unsafe IRI or several values). The record lists
   * without them and cannot be saved, moved or categorised until they are repaired.
   * Writers ignore this field; a snapshot that carries it is refused.
   */
  readonly unreadableLinks?: readonly TransactionLink[];
}
export interface Category {
  readonly id: string;
  readonly label: string;
  readonly parent?: string;
}
/** Inclusive UTC instants; a date-only bound denotes midnight UTC. */
export interface Range {
  readonly start: string;
  readonly end: string;
}
