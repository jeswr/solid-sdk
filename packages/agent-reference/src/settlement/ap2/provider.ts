// AUTHORED-BY Codex GPT-6
import type { CryptoKey } from "jose";
import {
  type ClosedPaymentMandate,
  checkoutHash,
  closedCheckoutMandateSchema,
  closedPaymentMandateSchema,
  convertAp2Amount,
  openPaymentMandateSchema,
  verifyCheckout,
} from "./objects.js";
import { type SdJwtVerifier, verifySdJwt } from "./sdjwt.js";

export class Ap2Error extends Error {
  constructor(
    public readonly code:
      | "terms-digest-mismatch"
      | "invalid-payment-mandate"
      | "open-mandate-exceeded",
  ) {
    super(code);
  }
}

export async function checkCheckoutMandate(
  presentation: string,
  checkoutJwt: string,
  merchantKey: CryptoKey,
  options: Omit<SdJwtVerifier, "requiredClaims">,
) {
  await verifyCheckout(checkoutJwt, merchantKey, options.now);
  const { cnf: _cnf, ...claims } = await verifySdJwt(presentation, {
    ...options,
    requiredClaims: ["vct", "checkout_hash"],
  });
  const mandate = closedCheckoutMandateSchema.parse(claims);
  if (mandate.checkout_hash !== checkoutHash(checkoutJwt))
    throw new Ap2Error("terms-digest-mismatch");
  return mandate;
}

/** Cryptographic verification precedes every use of the Payment Mandate as authority. */
export async function checkPaymentMandate(
  presentation: string,
  checkoutJwt: string,
  merchantKey: CryptoKey,
  decimals: number,
  options: Omit<SdJwtVerifier, "requiredClaims">,
): Promise<ClosedPaymentMandate> {
  const checkout = await verifyCheckout(checkoutJwt, merchantKey, options.now);
  const { cnf: _cnf, ...claims } = await verifySdJwt(presentation, {
    ...options,
    requiredClaims: ["vct", "transaction_id", "payee", "payment_amount", "payment_instrument"],
  });
  const mandate = closedPaymentMandateSchema.parse(claims);
  if (mandate.transaction_id !== checkoutHash(checkoutJwt))
    throw new Ap2Error("terms-digest-mismatch");
  const total = convertAp2Amount(
    { amount: checkout.total_price, currency: checkout.currency },
    decimals,
  );
  if (
    mandate.payee.id !== checkout.merchant.id ||
    mandate.payment_amount.currency !== checkout.currency ||
    BigInt(mandate.payment_amount.amount) !== BigInt(total.units)
  )
    throw new Ap2Error("invalid-payment-mandate");
  return mandate;
}

/** This profile supports the two constraint kinds used by Brief 25's autonomous form. */
export async function checkOpenPaymentMandate(
  presentation: string,
  payment: ClosedPaymentMandate,
  options: Omit<SdJwtVerifier, "requiredClaims">,
) {
  payment = closedPaymentMandateSchema.parse(payment);
  const mandate = openPaymentMandateSchema.parse(
    await verifySdJwt(presentation, {
      ...options,
      requiredClaims: ["vct", "constraints", "cnf", "iat", "exp"],
    }),
  );
  if (mandate.iat > options.now) throw new Ap2Error("open-mandate-exceeded");
  const constraints = mandate.constraints;
  if (
    !constraints.some((c) => c.type === "payment.amount_range") ||
    !constraints.some((c) => c.type === "payment.allowed_payees")
  )
    throw new Ap2Error("open-mandate-exceeded");
  for (const constraint of constraints) {
    if (
      constraint.type === "payment.amount_range" &&
      (constraint.currency !== payment.payment_amount.currency ||
        payment.payment_amount.amount < constraint.min ||
        payment.payment_amount.amount > constraint.max)
    )
      throw new Ap2Error("open-mandate-exceeded");
    if (
      constraint.type === "payment.allowed_payees" &&
      !constraint.payees.includes(payment.payee.id)
    )
      throw new Ap2Error("open-mandate-exceeded");
  }
  return mandate;
}
