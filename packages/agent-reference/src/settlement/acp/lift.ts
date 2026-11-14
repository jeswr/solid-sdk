// AUTHORED-BY Codex GPT-6
import { type CryptoKey, importJWK } from "jose";
import { canonicalJson } from "../../core/canonical.js";
import type { PublicKeyRecord } from "../../mechanisms/jws.js";
import type { PaymentFacts } from "../../model/payment.js";
import {
  type AdapterProfile,
  invalid,
  invoiceFacts,
  nonceOf,
  protocolFailure,
  rawExchange,
  requireValue,
  SettlementError,
  seconds,
} from "../adapter.js";
import { type HttpExchange, header } from "../http.js";
import type { AmountDue, PayeeContext, ProtocolObjects } from "../types.js";
import { AcpError } from "./errors.js";
import {
  type CheckoutSession,
  checkoutSessionSchema,
  completeSchema,
  convertAcpAmount,
  createSessionSchema,
  delegatedPaymentSchema,
  delegatePaymentSchema,
} from "./objects.js";
import { checkAcpRequestHeaders, verifyAcpExchange } from "./signing.js";
export function importToken(exchange: HttpExchange): string {
  try {
    return delegatedPaymentSchema.parse(exchange.body).id;
  } catch (error) {
    return protocolFailure(error);
  }
}

export function acpFailure(error: unknown, exchange?: HttpExchange): never {
  if (error instanceof SettlementError) throw error;
  if (error instanceof AcpError) {
    throw new SettlementError(
      error.code === "unsigned-not-allowed" ? "unsigned-not-allowed" : "evidence-invalid",
      error.code,
      exchange,
    );
  }
  return invalid();
}
export async function verifyExchange(
  exchange: HttpExchange,
  key: PublicKeyRecord,
  profile: AdapterProfile,
  bearer?: string,
): Promise<void> {
  try {
    try {
      if (key.alg !== "EdDSA") return invalid();
      const imported = (await importJWK(key.publicJwk, "EdDSA")) as CryptoKey;
      await verifyAcpExchange(exchange, imported, seconds(profile));
      if (exchange.status === undefined) {
        checkAcpRequestHeaders(exchange);
        if (header(exchange.headers, "Authorization") !== `Bearer ${bearer}`) return invalid();
      }
    } catch (error) {
      acpFailure(error, exchange);
    }
  } catch (error) {
    return protocolFailure(error);
  }
}
export async function liftRequest(
  objects: ProtocolObjects,
  due: AmountDue,
  payee: PayeeContext,
  profile: AdapterProfile,
  bearer: string,
) {
  try {
    const creation = rawExchange(objects, "Create checkout request");
    const exchange = rawExchange(objects, "Checkout session");
    if (
      creation.method !== "POST" ||
      creation.path !== "/checkout_sessions" ||
      creation.status !== undefined ||
      exchange.method !== "POST" ||
      exchange.path !== creation.path ||
      exchange.status !== 201 ||
      payee.party !== profile.merchant.party
    )
      return invalid();
    await verifyExchange(creation, profile.payer.identity, profile, bearer);
    await verifyExchange(exchange, profile.merchant.identity, profile);
    const items = createSessionSchema.parse(creation.body).items;
    const session = checkoutSessionSchema.parse(exchange.body);
    if (
      session.status !== "ready_for_payment" ||
      canonicalJson(items) !== canonicalJson(session.items)
    )
      return invalid();
    const amount = convertAcpAmount(
      { units: String(session.totals[0].amount), currency: session.currency },
      profile.decimals,
    );
    return {
      session,
      facts: invoiceFacts(
        due,
        payee.party,
        session.merchant_id,
        amount.amount,
        amount.currency.toUpperCase(),
      ),
    };
  } catch (error) {
    return protocolFailure(error);
  }
}
export async function verifyComplete(
  objects: ProtocolObjects,
  profile: AdapterProfile,
  bearer: string,
  session: CheckoutSession,
  order: PaymentFacts,
): Promise<HttpExchange> {
  try {
    const exchange = rawExchange(objects, "Complete checkout request");
    await verifyExchange(exchange, profile.payer.identity, profile, bearer);
    if (
      exchange.method !== "POST" ||
      exchange.path !== `/checkout_sessions/${encodeURIComponent(session.id)}/complete` ||
      exchange.status !== undefined ||
      header(exchange.headers, "Idempotency-Key") !== nonceOf(requireValue(order.onceKey))
    )
      return invalid();
    return exchange;
  } catch (error) {
    return protocolFailure(error);
  }
}
export async function liftOrder(
  objects: ProtocolObjects,
  profile: AdapterProfile,
  bearer: string,
  session: CheckoutSession,
  order: PaymentFacts,
) {
  try {
    const delegation = rawExchange(objects, "Delegate payment request");
    const response = rawExchange(objects, "Delegated payment");
    if (
      delegation.method !== "POST" ||
      delegation.path !== "/agentic_commerce/delegate_payment" ||
      delegation.status !== undefined ||
      response.method !== "POST" ||
      response.path !== delegation.path ||
      response.status !== 201 ||
      header(delegation.headers, "Idempotency-Key") !== nonceOf(requireValue(order.onceKey))
    )
      return invalid();
    await verifyExchange(delegation, profile.payer.identity, profile, bearer);
    await verifyExchange(response, profile.provider.identity, profile);
    const request = delegatePaymentSchema.parse(delegation.body);
    const token = delegatedPaymentSchema.parse(response.body);
    const complete = completeSchema.parse(
      (await verifyComplete(objects, profile, bearer, session, order)).body,
    );
    const allowance = request.allowance;
    if (
      allowance.max_amount !== session.totals[0].amount ||
      allowance.currency !== session.currency ||
      allowance.checkout_session_id !== session.id ||
      allowance.merchant_id !== session.merchant_id ||
      allowance.expires_at !== order.validUntil ||
      request.payment_method.account_id !== profile.payer.account ||
      complete.payment_data.instrument.credential.token !== token.id
    )
      return invalid();
    return { request, token, complete };
  } catch (error) {
    return protocolFailure(error);
  }
}
export async function liftReceipt(
  objects: ProtocolObjects,
  profile: AdapterProfile,
  session: CheckoutSession,
) {
  try {
    const exchange = rawExchange(objects, "Completed checkout session");
    if (
      exchange.method !== "POST" ||
      exchange.path !== `/checkout_sessions/${encodeURIComponent(session.id)}/complete` ||
      exchange.status !== 200
    )
      return invalid();
    await verifyExchange(exchange, profile.merchant.identity, profile);
    const completed = checkoutSessionSchema.parse(exchange.body);
    if (
      completed.status !== "completed" ||
      !completed.order ||
      completed.id !== session.id ||
      completed.merchant_id !== session.merchant_id ||
      completed.currency !== session.currency ||
      canonicalJson(completed.totals) !== canonicalJson(session.totals) ||
      canonicalJson(completed.items) !== canonicalJson(session.items)
    )
      return invalid();
    return completed;
  } catch (error) {
    return protocolFailure(error);
  }
}
