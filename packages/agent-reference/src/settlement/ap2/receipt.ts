// AUTHORED-BY Codex GPT-6
/** Local receipt claim profile. Research confirms the JWT forms and signers, not fields. */
import { z } from "zod";

const payment = z.strictObject({
  id: z.string(),
  agreement: z.string(),
  payer: z.string(),
  payee: z.string(),
  account: z.string(),
  amount: z.string(),
  currency: z.string(),
  invoice: z.string(),
  onceKey: z.string(),
  validUntil: z.string(),
  instalment: z.number().int().positive(),
});
export const paymentReceiptSchema = z.strictObject({
  type: z.literal("PaymentReceipt"),
  transaction_id: z.string(),
  processor: z.string(),
  reference: z.string().min(1),
  order_digest: z.string(),
  payment,
});
export const checkoutReceiptSchema = z.strictObject({
  type: z.literal("CheckoutReceipt"),
  checkout_hash: z.string(),
  order_id: z.string(),
  merchant: z.string(),
  payment_receipt_hash: z.string(),
});
