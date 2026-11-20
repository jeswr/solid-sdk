// AUTHORED-BY Codex GPT-6
import { canonicalJson } from "../../core/canonical.js";
import type { PaymentFacts } from "../../model/payment.js";
import {
  type AdapterProfile,
  invalid,
  invoiceFacts,
  protocolFailure,
  rawExchange,
  requireValue,
} from "../adapter.js";
import { recoverAuthorization } from "../eip3009.js";
import { type HttpExchange, header } from "../http.js";
import type { AmountDue, PayeeContext, ProtocolObjects } from "../types.js";
import { requirementsDomain, X402Facilitator } from "./facilitator.js";
import {
  convertX402Amount,
  type PaymentRequirements,
  parsePaymentRequired,
  parsePaymentResponse,
  parsePaymentSignature,
} from "./objects.js";

export function accountIri(address: string, network: string): string {
  return `did:pkh:${network}:${address.toLowerCase()}`;
}
export function liftRequest(
  exchange: HttpExchange,
  due: AmountDue,
  payee: PayeeContext,
  profile: AdapterProfile,
  template: PaymentRequirements,
) {
  try {
    if (
      exchange.status !== 402 ||
      exchange.method !== "GET" ||
      exchange.path !== "/valuation-booking"
    )
      return invalid();
    const required = parsePaymentRequired(
      requireValue(header(exchange.headers, "PAYMENT-REQUIRED")),
    );
    if (required.accepts.length !== 1) return invalid();
    const request = requireValue(required.accepts[0]);
    if (
      canonicalJson(requirementsDomain(request)) !== canonicalJson(requirementsDomain(template)) ||
      required.resource.url !== "https://valuer.example/valuation-booking" ||
      payee.party !== profile.merchant.party
    )
      return invalid();
    const amount = convertX402Amount(
      { units: request.amount, currency: profile.currency },
      profile.decimals,
    );
    return {
      request,
      required,
      facts: invoiceFacts(
        due,
        payee.party,
        accountIri(request.payTo, request.network),
        amount.amount,
        amount.currency,
      ),
    };
  } catch (error) {
    return protocolFailure(error);
  }
}
export function liftOrder(
  objects: ProtocolObjects,
  profile: AdapterProfile,
  requirements: PaymentRequirements,
) {
  try {
    const exchange = rawExchange(objects, "PaymentPayload");
    if (
      exchange.method !== "GET" ||
      exchange.path !== "/valuation-booking" ||
      exchange.status !== undefined
    )
      return invalid();
    const payload = parsePaymentSignature(
      requireValue(header(exchange.headers, "PAYMENT-SIGNATURE")),
    );
    const verified = new X402Facilitator(
      profile.ledger,
      requirements,
      profile.currency,
      profile.decimals,
    ).verify(payload, Math.floor(Date.parse(profile.now()) / 1000));
    if (!verified.isValid)
      return invalid(verified.invalidReason, {
        method: "POST",
        path: "/verify",
        status: 200,
        headers: {},
        body: verified,
      });
    const auth = payload.payload.authorization;
    if (
      canonicalJson(payload.accepted) !== canonicalJson(requirements) ||
      auth.value !== requirements.amount ||
      recoverAuthorization(requirementsDomain(requirements), auth, payload.payload.signature) !==
        profile.payer.account.toLowerCase() ||
      auth.from.toLowerCase() !== profile.payer.account.toLowerCase()
    )
      return invalid();
    return { payload, exchange };
  } catch (error) {
    return protocolFailure(error);
  }
}
export function liftReceipt(
  objects: ProtocolObjects,
  profile: AdapterProfile,
  order: PaymentFacts,
) {
  try {
    const exchange = rawExchange(objects, "SettlementResponse");
    if (
      exchange.method !== "GET" ||
      exchange.path !== "/valuation-booking" ||
      exchange.status !== 200
    )
      return invalid();
    const receipt = parsePaymentResponse(
      requireValue(header(exchange.headers, "PAYMENT-RESPONSE")),
    );
    if (
      !receipt.success ||
      receipt.payer.toLowerCase() !== profile.payer.account.toLowerCase() ||
      accountIri(profile.merchant.account, receipt.network) !== order.account
    )
      return invalid();
    return { receipt, exchange };
  } catch (error) {
    return protocolFailure(error);
  }
}
