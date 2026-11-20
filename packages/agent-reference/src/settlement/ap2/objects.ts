// AUTHORED-BY Codex GPT-6
import type { CryptoKey, JWK } from "jose";
import { z } from "zod";
import { convertMoney, type Money, type UnitAmount } from "../money.js";
import { signAp2Jwt, verifyAp2Jwt } from "./jwt.js";
import { confirmationSchema, issueSdJwt, sdHash } from "./sdjwt.js";

const id = z.string().min(1).max(1024);
const currency = z.string().regex(/^[A-Z]{3}$/);
const decimal = z
  .string()
  .regex(/^(0|[1-9]\d*)(?:\.\d+)?$/)
  .max(128);
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const merchantSchema = z.strictObject({ id, name: id, website: z.url() });
export const paymentInstrumentSchema = z.strictObject({ id, type: id, description: z.string() });
export const checkoutSchema = z.strictObject({
  order_id: id,
  merchant: merchantSchema,
  line_items: z
    .array(
      z.strictObject({
        id,
        product: z.strictObject({ id, title: id, price: decimal, currency }),
        quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .min(1)
    .max(256),
  total_price: decimal,
  currency,
  shipping_policy: z.string().optional(),
  return_policy: z.string().optional(),
});
export const closedCheckoutMandateSchema = z.strictObject({
  vct: z.literal("mandate.checkout.1"),
  checkout_hash: hash,
});
export const closedPaymentMandateSchema = z.strictObject({
  vct: z.literal("mandate.payment.1"),
  transaction_id: hash,
  payee: merchantSchema,
  payment_amount: z.strictObject({ amount: minor.refine((n) => n > 0), currency }),
  payment_instrument: paymentInstrumentSchema,
});
export const paymentConstraintSchema = z.discriminatedUnion("type", [
  z
    .strictObject({ type: z.literal("payment.amount_range"), currency, max: minor, min: minor })
    .refine((value) => value.min <= value.max),
  z.strictObject({ type: z.literal("payment.allowed_payees"), payees: z.array(id).min(1).max(64) }),
]);
export const openPaymentMandateSchema = z
  .strictObject({
    vct: z.literal("mandate.payment.open.1"),
    constraints: z.array(paymentConstraintSchema).min(1).max(16),
    cnf: confirmationSchema,
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .refine((value) => value.exp > value.iat && value.exp - value.iat <= 900, {
    message: "open mandate must have a short expiry",
  });
export type Checkout = z.infer<typeof checkoutSchema>;
export type ClosedPaymentMandate = z.infer<typeof closedPaymentMandateSchema>;
export type OpenPaymentMandate = z.infer<typeof openPaymentMandateSchema>;

/** SHA-256 over the exact compact checkout_jwt bytes, not decoded/re-serialized JSON. */
export function checkoutHash(checkoutJwt: string): string {
  return sdHash(checkoutJwt);
}
export async function signCheckout(checkout: Checkout, merchantKey: CryptoKey): Promise<string> {
  return signAp2Jwt(checkoutSchema.parse(checkout), merchantKey, "ap2-checkout+jwt");
}
export async function verifyCheckout(
  checkoutJwt: string,
  merchantKey: CryptoKey,
  now: number,
): Promise<Checkout> {
  return checkoutSchema.parse(
    await verifyAp2Jwt(checkoutJwt, merchantKey, "ap2-checkout+jwt", now),
  );
}
export async function issueCheckoutMandate(
  checkoutJwt: string,
  issuerKey: CryptoKey,
  holderJwk: JWK,
) {
  return issueSdJwt(
    closedCheckoutMandateSchema.parse({
      vct: "mandate.checkout.1",
      checkout_hash: checkoutHash(checkoutJwt),
    }),
    issuerKey,
    holderJwk,
  );
}
export async function issuePaymentMandate(
  mandate: ClosedPaymentMandate,
  issuerKey: CryptoKey,
  holderJwk: JWK,
) {
  return issueSdJwt(closedPaymentMandateSchema.parse(mandate), issuerKey, holderJwk);
}
export async function issueOpenPaymentMandate(mandate: OpenPaymentMandate, issuerKey: CryptoKey) {
  const { cnf, ...claims } = openPaymentMandateSchema.parse(mandate);
  return issueSdJwt(claims, issuerKey, cnf.jwk);
}

export function convertAp2Amount(value: Money, decimals: number): UnitAmount;
export function convertAp2Amount(value: UnitAmount, decimals: number): Money;
export function convertAp2Amount(value: Money | UnitAmount, decimals: number): Money | UnitAmount {
  return "amount" in value ? convertMoney(value, decimals) : convertMoney(value, decimals);
}
