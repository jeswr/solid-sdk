// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { convertMoney, type Money, type UnitAmount } from "../money.js";

export const ACP_VERSION = "2026-04-17";
const id = z.string().min(1).max(1024);
const currency = z.string().regex(/^[a-z]{3}$/);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const object = z.record(z.string(), z.json());
const items = z
  .array(z.strictObject({ id, quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }))
  .min(1)
  .max(256);
export const createSessionSchema = z.strictObject({
  items,
  buyer: object.optional(),
  fulfillment_details: object.optional(),
});
export const orderSchema = z.strictObject({ id, checkout_session_id: id, permalink_url: z.url() });
export const checkoutSessionSchema = z
  .strictObject({
    id,
    merchant_id: id,
    status: z.enum([
      "not_ready_for_payment",
      "ready_for_payment",
      "completed",
      "canceled",
      "in_progress",
      "authentication_required",
    ]),
    currency,
    items,
    totals: z.tuple([z.strictObject({ type: z.literal("total"), amount: minor })]),
    order: orderSchema.optional(),
  })
  .refine(
    (session) => session.status !== "ready_for_payment" || (session.totals[0]?.amount ?? 0) > 0,
    { message: "ready session requires positive total" },
  )
  .refine(
    (session) =>
      session.status !== "completed" || session.order?.checkout_session_id === session.id,
    { message: "completed session requires its order" },
  );
export const allowanceSchema = z.strictObject({
  reason: z.literal("one_time"),
  max_amount: minor.refine((value) => value > 0),
  currency,
  checkout_session_id: id,
  merchant_id: id,
  expires_at: z.iso.datetime({ offset: true }),
});
export const delegatePaymentSchema = z.strictObject({
  // Local stand-in: the provider's own account reference replaces card details.
  payment_method: z.strictObject({ type: z.literal("account"), account_id: id }),
  allowance: allowanceSchema,
  risk_signals: z.array(z.json()).max(64),
  metadata: object,
  billing_address: object.optional(),
});
export const delegatedPaymentSchema = z.strictObject({
  id: z.string().regex(/^vt_[A-Za-z0-9_-]+$/),
  created: z.number().int().nonnegative(),
  metadata: object,
});
export const completeSchema = z
  .strictObject({
    payment_data: z.strictObject({
      handler_id: id,
      instrument: z.strictObject({
        id,
        handler_id: id,
        type: id,
        credential: z.strictObject({
          type: z.literal("spt"),
          token: z.string().regex(/^vt_[A-Za-z0-9_-]+$/),
        }),
      }),
      billing_address: object.optional(),
    }),
  })
  .refine((value) => value.payment_data.handler_id === value.payment_data.instrument.handler_id, {
    message: "payment handlers differ",
  });
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>;
export type DelegatePayment = z.infer<typeof delegatePaymentSchema>;
export type DelegatedPayment = z.infer<typeof delegatedPaymentSchema>;
export type Complete = z.infer<typeof completeSchema>;

export function convertAcpAmount(value: Money, decimals: number): UnitAmount;
export function convertAcpAmount(value: UnitAmount, decimals: number): Money;
export function convertAcpAmount(value: Money | UnitAmount, decimals: number): Money | UnitAmount {
  return "amount" in value ? convertMoney(value, decimals) : convertMoney(value, decimals);
}
