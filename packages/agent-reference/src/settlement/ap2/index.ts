// AUTHORED-BY Codex GPT-6
import { paymentDigest } from "../../gates/payment.js";
import type { SigningKey } from "../../mechanisms/jws.js";
import type { PaymentFacts } from "../../model/payment.js";
import {
  type AdapterProfile,
  bundle,
  checkedRequest,
  checkProtocolKey,
  checkProvider,
  invalid,
  jwtShown,
  keyObject,
  LiftStore,
  OnceAssociation,
  type PartyProfile,
  type RequestAssociation,
  rawToken,
  requireValue,
  seconds,
  snapshotChecked,
  snapshotDue,
  verifySigningHandle,
} from "../adapter.js";
import type {
  AmountDue,
  CheckedPayment,
  PayeeContext,
  PayerContext,
  ProtocolObjects,
  ProviderContext,
  SettlementSuite,
} from "../types.js";
import { signAp2Jwt } from "./jwt.js";
import { liftOrder, liftReceipt, liftRequest, sdShown } from "./lift.js";
import {
  type Checkout,
  checkoutHash,
  convertAp2Amount,
  issueCheckoutMandate,
  issuePaymentMandate,
  signCheckout,
} from "./objects.js";
import { checkoutReceiptSchema, paymentReceiptSchema } from "./receipt.js";
import { presentSdJwt } from "./sdjwt.js";

export interface Ap2Key {
  key: SigningKey;
  statement?: string;
}
export interface Ap2Profile extends AdapterProfile {
  personKey: Ap2Key;
  merchantKey: Ap2Key;
  processor: PartyProfile & Ap2Key;
}
export class Ap2Suite implements SettlementSuite {
  readonly id = "ap2";
  private readonly store = new LiftStore(this.id);
  private readonly once = new OnceAssociation();
  private readonly requests = new Map<
    string,
    RequestAssociation<{ checkout: Checkout; jwt: string; hash: string }>
  >();
  private readonly orders = new Map<string, PaymentFacts>();
  private readonly settled = new Set<string>();
  constructor(private readonly profile: Ap2Profile) {}
  private async key(party: PartyProfile, key: Ap2Key): Promise<SigningKey> {
    if (key.key.alg !== "ES256") return invalid();
    await checkProtocolKey(this.profile, this.id, party, "ES256", key.key.publicJwk, key.statement);
    await verifySigningHandle(key.key, key.key);
    return key.key;
  }
  async request(due: AmountDue, payee: PayeeContext): Promise<ProtocolObjects> {
    due = snapshotDue(due);

    const key = await this.key(this.profile.merchant, this.profile.merchantKey);
    const amount = due.amount ?? requireValue(due.agreement.duty?.constraint?.amount);
    const checkout: Checkout = {
      order_id: due.invoice,
      merchant: {
        id: payee.party,
        name: "Bracken Lantern Valuations",
        website: "https://valuer.example/",
      },
      line_items: [
        {
          id: "valuation",
          product: {
            id: "home-valuation",
            title: requireValue(due.agreement.service),
            price: amount,
            currency: this.profile.currency,
          },
          quantity: 1,
        },
      ],
      total_price: amount,
      currency: this.profile.currency,
    };
    return this.admitRequest(await signCheckout(checkout, key.privateKey), due, payee);
  }
  async admitRequest(
    checkoutJwt: string,
    due: AmountDue,
    payee: PayeeContext,
  ): Promise<ProtocolObjects> {
    due = snapshotDue(due);

    const objects = bundle(this.id, [
      keyObject("merchant", this.profile.merchantKey.statement),
      { name: "checkout_jwt", form: "JWT, ES256", raw: checkoutJwt, shown: jwtShown(checkoutJwt) },
    ]);
    await this.profile.admit(payee.party, "payment-request", objects);
    const merchantKey = await this.key(this.profile.merchant, this.profile.merchantKey);
    const lifted = await liftRequest(
      checkoutJwt,
      due,
      payee,
      this.profile,
      merchantKey,
      seconds(this.profile),
    );
    this.requests.set(due.invoice, {
      due,
      objects: bundle(this.id, objects.objects),
      facts: lifted.facts.snapshot(),
      request: { checkout: lifted.checkout, jwt: checkoutJwt, hash: lifted.hash },
    });
    return this.store.remember(objects, lifted.facts, {
      amount: "checkout_jwt.total_price",
      currency: "checkout_jwt.currency",
      payee: "checkout_jwt.merchant.id",
      account: "not in AP2 checkout: accepted host account binding",
      agreement: "host checkout-to-agreement association",
    });
  }
  async order(checked: CheckedPayment, payer: PayerContext): Promise<ProtocolObjects> {
    checked = snapshotChecked(checked);

    if (payer.party !== this.profile.payer.party) return invalid();
    const request = checkedRequest(checked, this.profile, this.requests);
    this.once.check(requireValue(checked.facts.onceKey), request.request.hash + checked.digest);
    const key = await this.key(this.profile.payer, this.profile.personKey);
    const amount = convertAp2Amount(
      { amount: request.request.checkout.total_price, currency: request.request.checkout.currency },
      this.profile.decimals,
    );
    if (BigInt(amount.units) > BigInt(Number.MAX_SAFE_INTEGER)) return invalid();
    const nonce = requireValue(checked.facts.onceKey);
    const checkoutMandate = await presentSdJwt(
      await issueCheckoutMandate(request.request.jwt, key.privateKey, key.publicJwk),
      key.privateKey,
      { audience: "merchant", nonce, issuedAt: seconds(this.profile) },
    );
    const paymentMandate = await presentSdJwt(
      await issuePaymentMandate(
        {
          vct: "mandate.payment.1",
          transaction_id: request.request.hash,
          payee: request.request.checkout.merchant,
          payment_amount: { amount: Number(amount.units), currency: amount.currency },
          payment_instrument: {
            id: this.profile.payer.account,
            type: "account",
            description: "Fictional provider account",
          },
        },
        key.privateKey,
        key.publicJwk,
      ),
      key.privateKey,
      { audience: "credential-provider", nonce, issuedAt: seconds(this.profile) },
    );
    const objects = bundle(this.id, [
      ...request.objects.objects,
      keyObject("person", this.profile.personKey.statement),
      {
        name: "Checkout Mandate",
        form: "SD-JWT, ES256, key binding",
        raw: checkoutMandate,
        shown: sdShown(checkoutMandate),
      },
      {
        name: "Payment Mandate",
        form: "SD-JWT, ES256, key binding",
        raw: paymentMandate,
        shown: sdShown(paymentMandate),
      },
    ]);
    await this.profile.admit(payer.party, "payment", objects);
    await liftOrder(
      objects,
      request.request.jwt,
      this.profile,
      this.profile.merchantKey.key,
      key,
      nonce,
      seconds(this.profile),
    );
    checkedRequest(checked, this.profile, this.requests);
    this.once.claim(requireValue(checked.facts.onceKey), request.request.hash + checked.digest);
    this.orders.set(request.request.hash, checked.facts.snapshot());
    return this.store.remember(objects, checked.facts, {
      amount: "Payment Mandate.payment_amount.amount",
      currency: "Payment Mandate.payment_amount.currency",
      payee: "Payment Mandate.payee.id",
      onceKey: "Payment Mandate key-binding nonce",
      agreement:
        "Payment Mandate.transaction_id -> exact checkout hash -> host agreement association",
      account: "not in AP2 Payment Mandate: accepted merchant payee-account binding",
      payer:
        "Payment Mandate.payment_instrument.id and person's identity-bound ES256 issuer/holder",
      validUntil: "not in closed AP2 mandate: host order expiry and maximum key-binding age",
    });
  }
  async settle(objects: ProtocolObjects, provider: ProviderContext): Promise<ProtocolObjects> {
    if (objects.suite !== this.id) return invalid();
    objects = bundle(this.id, objects.objects);

    checkProvider(this.profile, provider);
    await this.profile.admit(this.profile.payer.party, "payment", objects);
    const jwt = rawToken(objects, "checkout_jwt");
    const hash = checkoutHash(jwt);
    const request = requireValue([...this.requests.values()].find((r) => r.request.hash === hash));
    const order = requireValue(this.orders.get(hash));
    const personKey = await this.key(this.profile.payer, this.profile.personKey);
    const merchantKey = await this.key(this.profile.merchant, this.profile.merchantKey);
    const processorKey = await this.key(this.profile.processor, this.profile.processor);
    await liftOrder(
      objects,
      request.request.jwt,
      this.profile,
      merchantKey,
      personKey,
      requireValue(order.onceKey),
      seconds(this.profile),
    );
    if (
      this.settled.has(hash) ||
      Date.parse(requireValue(order.validUntil)) <= Date.parse(provider.now)
    )
      return invalid();
    // Mark the transaction before yielding to a signer, so concurrent retries cannot debit twice.
    const entry = provider.ledger.transfer(
      provider.payerAccount,
      this.profile.merchant.account,
      requireValue(order.amount),
      requireValue(order.currency),
      `ap2:${requireValue(order.onceKey)}`,
    );
    this.settled.add(hash);
    const paymentReceipt = await signAp2Jwt(
      paymentReceiptSchema.parse({
        type: "PaymentReceipt",
        transaction_id: hash,
        processor: this.profile.processor.party,
        reference: entry.digest,
        order_digest: paymentDigest(order),
        payment: order.data(),
      }),
      processorKey.privateKey,
      "ap2-payment-receipt+jwt",
    );
    const checkoutReceipt = await signAp2Jwt(
      checkoutReceiptSchema.parse({
        type: "CheckoutReceipt",
        checkout_hash: hash,
        order_id: request.request.checkout.order_id,
        merchant: this.profile.merchant.party,
        payment_receipt_hash: checkoutHash(paymentReceipt),
      }),
      merchantKey.privateKey,
      "ap2-checkout-receipt+jwt",
    );
    const result = bundle(this.id, [
      keyObject("processor", this.profile.processor.statement),
      keyObject("merchant", this.profile.merchantKey.statement),
      {
        name: "Payment Receipt",
        form: "JWT, ES256 (local claim profile)",
        raw: paymentReceipt,
        shown: jwtShown(paymentReceipt),
      },
      {
        name: "Checkout Receipt",
        form: "JWT, ES256 (local claim profile)",
        raw: checkoutReceipt,
        shown: jwtShown(checkoutReceipt),
      },
    ]);
    await this.profile.admit(this.profile.processor.party, "payment-receipt", result);
    await this.profile.admit(this.profile.merchant.party, "payment-receipt", result);
    const facts = await liftReceipt(
      result,
      jwt,
      order,
      this.profile,
      merchantKey,
      this.profile.processor.party,
      processorKey,
      seconds(this.profile),
    );
    return this.store.remember(result, facts, {
      ledgerReference: "Payment Receipt.reference (local profile)",
      provider: "Payment Receipt.processor (merchant payment processor, not credential provider)",
      amount: "Payment Receipt.payment.amount (local profile)",
      payee: "Payment Receipt.payment.payee (local profile)",
      currency: "Payment Receipt.payment.currency (local profile)",
      agreement: "Payment Receipt.payment.agreement (local profile)",
      order: "Payment Receipt.payment.id (local profile)",
      status: "verified Payment Receipt and matching Checkout Receipt (local profile)",
    });
  }
  restore(objects: ProtocolObjects) {
    return this.store.restore(objects);
  }
  objectsFor(facts: PaymentFacts) {
    return this.store.find(facts);
  }
  lift(objects: ProtocolObjects): PaymentFacts {
    return this.store.lift(objects);
  }
  trace(objects: ProtocolObjects) {
    return this.store.trace(objects);
  }
}
