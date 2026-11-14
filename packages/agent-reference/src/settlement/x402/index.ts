// AUTHORED-BY Codex GPT-6
import { digestOf } from "../../core/canonical.js";
import type { PaymentFacts } from "../../model/payment.js";
import {
  type AdapterProfile,
  bundle,
  checkedRequest,
  checkProtocolKey,
  checkProvider,
  httpObject,
  invalid,
  keyObject,
  LiftStore,
  liftProviderReceipt,
  nonceOf,
  type RequestAssociation,
  rawExchange,
  requireValue,
  seconds,
  signProviderReceipt,
  snapshotChecked,
  snapshotDue,
  verifySigningHandle,
} from "../adapter.js";
import { addressFromKey, signAuthorization } from "../eip3009.js";
import type { HttpExchange } from "../http.js";
import type {
  AmountDue,
  CheckedPayment,
  PayeeContext,
  PayerContext,
  ProtocolObjects,
  ProviderContext,
  SettlementSuite,
} from "../types.js";
import { requirementsDomain, X402Facilitator } from "./facilitator.js";
import { liftOrder, liftReceipt, liftRequest } from "./lift.js";
import {
  convertX402Amount,
  encodePaymentResponse,
  encodePaymentSignature,
  type PaymentPayload,
  type PaymentRequirements,
  paymentRequiredExchange,
  paymentRequirementsSchema,
} from "./objects.js";

export interface X402Profile extends AdapterProfile {
  requirements: PaymentRequirements;
  /** Held by the outbound gate/host, never a core or a protocol object. */
  settlementKey: Uint8Array;
  keyStatement?: string;
}
export class X402Suite implements SettlementSuite {
  readonly id = "x402";
  private readonly store = new LiftStore(this.id);
  private readonly requests = new Map<string, RequestAssociation<PaymentRequirements>>();
  private readonly orders = new Map<
    string,
    { facts: PaymentFacts; request: RequestAssociation<PaymentRequirements> }
  >();
  private readonly key: Uint8Array;
  private readonly template: PaymentRequirements;
  constructor(private readonly profile: X402Profile) {
    this.key = Uint8Array.from(profile.settlementKey);
    this.template = paymentRequirementsSchema.parse(profile.requirements);
    if (this.template.network !== "eip155:84532") invalid();
    if (addressFromKey(this.key) !== profile.payer.account.toLowerCase()) invalid();
  }
  async request(due: AmountDue, payee: PayeeContext): Promise<ProtocolObjects> {
    due = snapshotDue(due);

    const amount = convertX402Amount(
      {
        amount: requireValue(due.agreement.duty?.constraint?.amount),
        currency: this.profile.currency,
      },
      this.profile.decimals,
    );
    const required = {
      x402Version: 2 as const,
      resource: { url: "https://valuer.example/valuation-booking" },
      accepts: [{ ...this.template, amount: amount.units, payTo: this.profile.merchant.account }],
    };
    return this.admitRequest(
      paymentRequiredExchange("GET", "/valuation-booking", required),
      due,
      payee,
    );
  }
  async admitRequest(
    exchange: HttpExchange,
    due: AmountDue,
    payee: PayeeContext,
  ): Promise<ProtocolObjects> {
    due = snapshotDue(due);
    exchange = structuredClone(exchange);

    const objects = bundle(this.id, [httpObject("PaymentRequired", exchange, null)]);
    await this.profile.admit(payee.party, "payment-request", objects);
    const lifted = liftRequest(
      rawExchange(objects, "PaymentRequired"),
      due,
      payee,
      this.profile,
      this.template,
    );
    const result = bundle(this.id, [httpObject("PaymentRequired", exchange, lifted.required)]);
    this.requests.set(due.invoice, {
      due,
      objects: bundle(this.id, result.objects),
      facts: lifted.facts.snapshot(),
      request: lifted.request,
    });
    return this.store.remember(result, lifted.facts, {
      amount: "PaymentRequired.accepts[0].amount",
      currency: "profile.currency (asset precision configured)",
      account: "PaymentRequired.accepts[0].payTo",
      payee: "authenticated resource server; P4 account binding",
      agreement: "host request-to-agreement association",
    });
  }
  async order(checked: CheckedPayment, payer: PayerContext): Promise<ProtocolObjects> {
    checked = snapshotChecked(checked);

    if (payer.party !== this.profile.payer.party) return invalid();
    const request = checkedRequest(checked, this.profile, this.requests);
    await checkProtocolKey(
      this.profile,
      this.id,
      this.profile.payer,
      "secp256k1",
      this.profile.payer.account.toLowerCase(),
      this.profile.keyStatement,
    );
    const now = seconds(this.profile);
    const before = Math.floor(Date.parse(requireValue(checked.facts.validUntil)) / 1000);
    if (before * 1000 !== Date.parse(requireValue(checked.facts.validUntil))) return invalid();
    if (before <= now || before - now > request.request.maxTimeoutSeconds) return invalid();
    const authorization = {
      from: this.profile.payer.account,
      to: request.request.payTo,
      value: request.request.amount,
      validAfter: String(now - 1),
      validBefore: String(before),
      nonce: nonceOf(requireValue(checked.facts.onceKey)),
    };
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: request.request,
      payload: {
        authorization,
        signature: signAuthorization(requirementsDomain(request.request), authorization, this.key),
      },
    };
    const exchange = {
      method: "GET",
      path: "/valuation-booking",
      headers: { "PAYMENT-SIGNATURE": encodePaymentSignature(payload) },
      body: null,
    };
    const objects = bundle(this.id, [
      ...request.objects.objects,
      keyObject("payer", this.profile.keyStatement),
      httpObject("PaymentPayload", exchange, payload),
    ]);
    await this.profile.admit(payer.party, "payment", objects);
    liftOrder(objects, this.profile, request.request);
    checkedRequest(checked, this.profile, this.requests);
    this.orders.set(authorization.nonce, { facts: checked.facts.snapshot(), request });
    return this.store.remember(objects, checked.facts, {
      amount: "PaymentPayload.payload.authorization.value",
      account: "PaymentPayload.payload.authorization.to",
      onceKey: "PaymentPayload.payload.authorization.nonce (SHA-256 of awp:onceKey)",
      validUntil: "PaymentPayload.payload.authorization.validBefore",
      payer: "recovered EIP-712 signer and identity-signed SettlementKey",
      agreement: "host request-to-agreement association",
      payee: "authenticated resource server and P4 account binding",
      currency: "profile.currency",
    });
  }
  async settle(objects: ProtocolObjects, provider: ProviderContext): Promise<ProtocolObjects> {
    if (objects.suite !== this.id) return invalid();
    objects = bundle(this.id, objects.objects);

    checkProvider(this.profile, provider);
    await verifySigningHandle(this.profile.provider.signingKey, this.profile.provider.identity);
    await this.profile.admit(this.profile.payer.party, "payment", objects);
    const requiredObject = rawExchange(objects, "PaymentRequired");
    const request = requireValue(
      [...this.requests.values()].find(
        (r) => digestOf(rawExchange(r.objects, "PaymentRequired")) === digestOf(requiredObject),
      ),
    );
    await checkProtocolKey(
      this.profile,
      this.id,
      this.profile.payer,
      "secp256k1",
      this.profile.payer.account.toLowerCase(),
      this.profile.keyStatement,
    );
    const { payload } = liftOrder(objects, this.profile, request.request);
    const authorized = requireValue(this.orders.get(payload.payload.authorization.nonce));
    if (
      authorized.request !== request ||
      payload.payload.authorization.nonce !== nonceOf(requireValue(authorized.facts.onceKey))
    )
      return invalid();
    if (
      Number(payload.payload.authorization.validBefore) * 1000 !==
      Date.parse(requireValue(authorized.facts.validUntil))
    )
      return invalid();
    const facilitator = new X402Facilitator(
      provider.ledger,
      request.request,
      this.profile.currency,
      this.profile.decimals,
    );
    const verify = facilitator.verify(payload, seconds(this.profile));
    if (!verify.isValid)
      return invalid(verify.invalidReason, {
        method: "POST",
        path: "/verify",
        status: 200,
        headers: {},
        body: verify,
      });
    const receipt = facilitator.settle(payload, seconds(this.profile));
    if (!receipt.success) return invalid(receipt.errorReason);
    const call = { x402Version: 2, paymentPayload: payload, paymentRequirements: request.request };
    const exchange = {
      method: "GET",
      path: "/valuation-booking",
      status: 200,
      headers: { "PAYMENT-RESPONSE": encodePaymentResponse(receipt) },
      body: null,
    };
    const protocol = bundle(this.id, [
      httpObject(
        "/verify request",
        { method: "POST", path: "/verify", headers: {}, body: call },
        call,
      ),
      httpObject(
        "/verify response",
        { method: "POST", path: "/verify", status: 200, headers: {}, body: verify },
        verify,
      ),
      httpObject(
        "/settle request",
        { method: "POST", path: "/settle", headers: {}, body: call },
        call,
      ),
      httpObject(
        "/settle response",
        { method: "POST", path: "/settle", status: 200, headers: {}, body: receipt },
        receipt,
      ),
      httpObject("SettlementResponse", exchange, receipt),
    ]);
    const result = bundle(this.id, [
      ...protocol.objects,
      await signProviderReceipt(this.profile, authorized.facts, receipt.transaction, protocol),
    ]);
    liftReceipt(result, this.profile, authorized.facts);
    const facts = await liftProviderReceipt(
      this.profile,
      result,
      authorized.facts,
      protocol,
      receipt.transaction,
    );
    return this.store.remember(result, facts, {
      ledgerReference: "SettlementResponse.transaction",
      provider:
        "payment-receipt.provider (identity-signed facilitator statement; x402 response has no signature)",
      amount: "payment-receipt.payment.amount",
      currency: "payment-receipt.payment.currency",
      payee: "payment-receipt.payment.payee",
      agreement: "payment-receipt.payment.agreement",
      order: "payment-receipt.payment.id",
      status: "SettlementResponse.success",
    });
  }
  lift(objects: ProtocolObjects): PaymentFacts {
    return this.store.lift(objects);
  }
  trace(objects: ProtocolObjects) {
    return this.store.trace(objects);
  }
}
