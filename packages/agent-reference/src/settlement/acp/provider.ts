// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { randomUUID } from "crypto";
import { type Ledger, type LedgerEntry, LedgerError } from "../ledger.js";
import { AcpError } from "./errors.js";
import {
  type CheckoutSession,
  type Complete,
  checkoutSessionSchema,
  completeSchema,
  convertAcpAmount,
  type DelegatedPayment,
  type DelegatePayment,
  delegatePaymentSchema,
} from "./objects.js";

interface Token {
  delegation: DelegatePayment;
  decimals: number;
  used: boolean;
}
export class AcpPaymentProvider {
  private readonly tokens = new Map<string, Token>();
  private readonly precision: Readonly<Record<string, number>>;
  constructor(
    private readonly ledger: Ledger,
    private readonly handlerId: string,
    precision: Readonly<Record<string, number>>,
  ) {
    if (!handlerId) throw new AcpError("invalid_handler", 400);
    for (const [currency, decimals] of Object.entries(precision))
      convertAcpAmount({ units: "0", currency }, decimals);
    this.precision = { ...precision };
  }

  delegate(input: DelegatePayment, now: number): DelegatedPayment {
    const delegation = delegatePaymentSchema.parse(input);
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      Date.parse(delegation.allowance.expires_at) <= now * 1000 ||
      !Object.hasOwn(this.precision, delegation.allowance.currency)
    )
      throw new AcpError("invalid_allowance", 422);
    this.ledger.balance(delegation.payment_method.account_id, delegation.allowance.currency);
    const id = `vt_${randomUUID()}`;
    this.tokens.set(id, {
      delegation,
      decimals: this.precision[delegation.allowance.currency] as number,
      used: false,
    });
    return { id, created: now, metadata: structuredClone(delegation.metadata) };
  }

  /** The merchant session must already be authenticated by the caller's ACP signature check. */
  redeem(
    sessionInput: CheckoutSession,
    completeInput: Complete,
    now: number,
  ): Readonly<LedgerEntry> {
    const session = checkoutSessionSchema.parse(sessionInput);
    const complete = completeSchema.parse(completeInput);
    const data = complete.payment_data;
    const tokenId = data.instrument.credential.token;
    const token = this.tokens.get(tokenId);
    if (!token || token.used) throw new AcpError("invalid_token", 422);
    const allowance = token.delegation.allowance;
    const amount = session.totals[0].amount;
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      session.status !== "ready_for_payment" ||
      data.handler_id !== this.handlerId ||
      data.instrument.type !== "account" ||
      data.instrument.id !== token.delegation.payment_method.account_id ||
      allowance.checkout_session_id !== session.id ||
      allowance.merchant_id !== session.merchant_id ||
      allowance.currency !== session.currency ||
      amount > allowance.max_amount ||
      Date.parse(allowance.expires_at) <= now * 1000
    )
      throw new AcpError("invalid_allowance", 422);
    const money = convertAcpAmount(
      { units: String(amount), currency: session.currency },
      token.decimals,
    );
    try {
      const entry = this.ledger.transfer(
        token.delegation.payment_method.account_id,
        session.merchant_id,
        money.amount,
        money.currency,
        `acp:${tokenId}`,
      );
      token.used = true;
      return entry;
    } catch (error) {
      throw new AcpError(
        error instanceof LedgerError && error.code === "insufficient_funds"
          ? "insufficient_funds"
          : "invalid_allowance",
        422,
      );
    }
  }
}
