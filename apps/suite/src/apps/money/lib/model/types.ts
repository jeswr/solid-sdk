// AUTHORED-BY Codex GPT-6.1-Sol
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
