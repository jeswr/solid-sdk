// AUTHORED-BY Codex GPT-6
import { type CryptoKey, importJWK } from "jose";
import { paymentDigest } from "../../gates/payment.js";
import type { SigningKey } from "../../mechanisms/jws.js";
import { PaymentFacts } from "../../model/payment.js";
import {
  type AdapterProfile,
  invalid,
  invoiceFacts,
  jwtShown,
  protocolFailure,
  rawToken,
  requireValue,
  SettlementError,
} from "../adapter.js";
import { decodeBase64url, strictJson } from "../http.js";
import type { AmountDue, PayeeContext, ProtocolObjects } from "../types.js";
import { verifyAp2Jwt } from "./jwt.js";
import { checkoutHash, verifyCheckout } from "./objects.js";
import { Ap2Error, checkCheckoutMandate, checkPaymentMandate } from "./provider.js";
import { checkoutReceiptSchema, paymentReceiptSchema } from "./receipt.js";
export async function verificationKey(key: SigningKey): Promise<CryptoKey> {
  try {
    if (key.alg !== "ES256") return invalid();
    return (await importJWK(key.publicJwk, "ES256")) as CryptoKey;
  } catch (error) {
    return protocolFailure(error);
  }
}
export function sdShown(presentation: string): unknown {
  try {
    const parts = presentation.split("~");
    return {
      issuer: jwtShown(requireValue(parts[0])),
      disclosures: parts.slice(1, -1).map((d) => strictJson(decodeBase64url(d))),
      keyBinding: jwtShown(requireValue(parts.at(-1))),
    };
  } catch (error) {
    return protocolFailure(error);
  }
}
export async function liftRequest(
  checkoutJwt: string,
  due: AmountDue,
  payee: PayeeContext,
  profile: AdapterProfile,
  key: SigningKey,
  now: number,
) {
  try {
    const checkout = await verifyCheckout(checkoutJwt, await verificationKey(key), now);
    if (payee.party !== profile.merchant.party) return invalid();
    return {
      checkout,
      hash: checkoutHash(checkoutJwt),
      facts: invoiceFacts(
        due,
        checkout.merchant.id,
        profile.merchant.account,
        checkout.total_price,
        checkout.currency,
      ),
    };
  } catch (error) {
    return protocolFailure(error);
  }
}
export async function liftOrder(
  objects: ProtocolObjects,
  checkoutJwt: string,
  profile: AdapterProfile,
  merchantKey: SigningKey,
  personKey: SigningKey,
  onceKey: string,
  now: number,
) {
  try {
    const common = {
      issuerKey: await verificationKey(personKey),
      expectedHolderJwk: personKey.publicJwk,
      nonce: onceKey,
      now,
    };
    try {
      const checkoutMandate = await checkCheckoutMandate(
        rawToken(objects, "Checkout Mandate"),
        checkoutJwt,
        await verificationKey(merchantKey),
        { ...common, audience: "merchant" },
      );
      const paymentMandate = await checkPaymentMandate(
        rawToken(objects, "Payment Mandate"),
        checkoutJwt,
        await verificationKey(merchantKey),
        profile.decimals,
        { ...common, audience: "credential-provider" },
      );
      if (
        paymentMandate.payment_instrument.id !== profile.payer.account ||
        paymentMandate.payment_instrument.type !== "account"
      )
        return invalid("invalid-payment-mandate");
      return { checkoutMandate, paymentMandate };
    } catch (error) {
      if (error instanceof Ap2Error && error.code === "terms-digest-mismatch")
        throw new SettlementError("terms-digest-mismatch", error.code);
      return invalid(error instanceof Ap2Error ? error.code : undefined);
    }
  } catch (error) {
    return protocolFailure(error);
  }
}
export async function liftReceipt(
  objects: ProtocolObjects,
  checkoutJwt: string,
  order: PaymentFacts,
  profile: AdapterProfile,
  merchantKey: SigningKey,
  processor: string,
  processorKey: SigningKey,
  now: number,
): Promise<PaymentFacts> {
  try {
    const paymentJwt = rawToken(objects, "Payment Receipt");
    const payment = paymentReceiptSchema.parse(
      await verifyAp2Jwt(
        paymentJwt,
        await verificationKey(processorKey),
        "ap2-payment-receipt+jwt",
        now,
      ),
    );
    const checkout = checkoutReceiptSchema.parse(
      await verifyAp2Jwt(
        rawToken(objects, "Checkout Receipt"),
        await verificationKey(merchantKey),
        "ap2-checkout-receipt+jwt",
        now,
      ),
    );
    const original = await verifyCheckout(checkoutJwt, await verificationKey(merchantKey), now);
    if (
      payment.transaction_id !== checkoutHash(checkoutJwt) ||
      checkout.checkout_hash !== checkoutHash(checkoutJwt) ||
      payment.order_digest !== paymentDigest(order) ||
      checkout.order_id !== original.order_id ||
      payment.processor !== processor ||
      checkout.merchant !== profile.merchant.party ||
      checkout.payment_receipt_hash !== checkoutHash(paymentJwt)
    )
      return invalid();
    return PaymentFacts.receipt(PaymentFacts.create(payment.payment), processor, payment.reference);
  } catch (error) {
    return protocolFailure(error);
  }
}
