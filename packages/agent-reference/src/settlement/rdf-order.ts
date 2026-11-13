// AUTHORED-BY Codex GPT-6
import { paymentDigest } from "../gates/payment.js";
import { PaymentFacts, paymentOnceKey } from "../model/payment.js";
import { liftPaymentObjects, paymentObjects } from "../wire/payment.js";
import type {
  AmountDue,
  CheckedPayment,
  PayeeContext,
  PayerContext,
  ProtocolObjects,
  ProviderContext,
  SettlementSuite,
} from "./types.js";
export class RdfOrderSuite implements SettlementSuite {
  readonly id = "rdf-order";
  async request(due: AmountDue, payee: PayeeContext): Promise<ProtocolObjects> {
    const duty = due.agreement.duty;
    if (
      duty?.payee !== payee.party ||
      !duty.constraint?.amount ||
      !duty.constraint.currency ||
      !due.agreement.digest
    )
      throw new TypeError("Incomplete amount due");
    return paymentObjects(
      PaymentFacts.invoiceFor({
        id: due.invoice,
        agreement: due.agreement.digest,
        payee: payee.party,
        account: due.account,
        amount: duty.constraint.amount,
        currency: duty.constraint.currency,
        dueDate: due.dueDate,
      }),
      "Invoice",
    );
  }
  async order(checked: CheckedPayment, payer: PayerContext): Promise<ProtocolObjects> {
    if (checked.facts.payer !== payer.party || checked.digest !== paymentDigest(checked.facts))
      throw new TypeError("Order differs from checked payment");
    return paymentObjects(checked.facts, "Payment order");
  }
  async settle(objects: ProtocolObjects, provider: ProviderContext): Promise<ProtocolObjects> {
    const order = this.lift(objects);
    if (
      !order.payer ||
      !order.payee ||
      !order.account ||
      !order.amount ||
      !order.currency ||
      !order.agreement ||
      !order.validUntil ||
      Date.parse(order.validUntil) <= Date.parse(provider.now) ||
      !order.onceKey ||
      order.onceKey !== paymentOnceKey(order.agreement, order.instalment)
    )
      throw new TypeError("Invalid or expired payment order");
    // The provider authenticates payer/account association before supplying this context.
    const entry = provider.ledger.transfer(
      provider.payerAccount,
      order.account,
      order.amount,
      order.currency,
      order.onceKey,
    );
    return paymentObjects(
      PaymentFacts.receipt(order, provider.party, entry.digest),
      "Payment receipt",
    );
  }
  lift(objects: ProtocolObjects): PaymentFacts {
    return liftPaymentObjects(objects);
  }
}
