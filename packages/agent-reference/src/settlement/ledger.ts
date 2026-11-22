// AUTHORED-BY Codex GPT-6
import { digestOf } from "../core/canonical.js";
import { decimalParts, decimalText } from "./money.js";

export class LedgerError extends Error {
  constructor(
    public readonly code:
      | "nonce_reused"
      | "insufficient_funds"
      | "unknown_account"
      | "invalid_transfer",
  ) {
    super(code);
  }
}

export interface LedgerEntry {
  sequence: number;
  from: string;
  to: string;
  amount: string;
  currency: string;
  onceKey: string;
  previous: string | null;
  digest: string;
}

export class Ledger {
  private readonly accounts = new Map<string, Map<string, string>>();
  private readonly used = new Set<string>();
  private readonly history: Readonly<LedgerEntry>[] = [];

  /** Fixtures endow accounts explicitly; creating an existing account never resets it. */
  createAccount(id: string, balances: Readonly<Record<string, string>> = {}): void {
    if (!id || this.accounts.has(id)) throw new LedgerError("invalid_transfer");
    const amounts = new Map<string, string>();
    for (const [currency, amount] of Object.entries(balances)) {
      decimalParts(amount);
      if (!currency) throw new LedgerError("invalid_transfer");
      amounts.set(currency, amount);
    }
    this.accounts.set(id, amounts);
  }

  private account(id: string): Map<string, string> {
    const account = this.accounts.get(id);
    if (!account) throw new LedgerError("unknown_account");
    return account;
  }

  balance(id: string, currency: string): string {
    return this.account(id).get(currency) ?? "0";
  }

  hasUsed(onceKey: string): boolean {
    return this.used.has(onceKey);
  }
  get entries(): readonly Readonly<LedgerEntry>[] {
    return [...this.history];
  }

  /** Synchronous check-and-move: a failed transfer consumes neither funds nor nonce. */
  transfer(
    from: string,
    to: string,
    amount: string,
    currency: string,
    onceKey: string,
  ): Readonly<LedgerEntry> {
    if (!onceKey || !currency || from === to) throw new LedgerError("invalid_transfer");
    if (this.used.has(onceKey)) throw new LedgerError("nonce_reused");
    const payer = this.account(from);
    const payee = this.account(to);
    const sent = decimalParts(amount);
    if (sent.value <= 0n) throw new LedgerError("invalid_transfer");
    const before = decimalParts(payer.get(currency) ?? "0");
    const received = decimalParts(payee.get(currency) ?? "0");
    const scale = Math.max(before.scale, received.scale, sent.scale);
    const scaled = (part: { value: bigint; scale: number }) =>
      part.value * 10n ** BigInt(scale - part.scale);
    if (scaled(before) < scaled(sent)) throw new LedgerError("insufficient_funds");
    const fields = {
      sequence: this.history.length + 1,
      from,
      to,
      amount,
      currency,
      onceKey,
      previous: this.history.at(-1)?.digest ?? null,
    };
    const entry = Object.freeze({ ...fields, digest: digestOf(fields) });
    payer.set(currency, decimalText(scaled(before) - scaled(sent), scale));
    payee.set(currency, decimalText(scaled(received) + scaled(sent), scale));
    this.used.add(onceKey);
    this.history.push(entry);
    return entry;
  }
}
