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
  OnceAssociation,
  type RequestAssociation,
  rawExchange,
  requireValue,
  seconds,
  signProviderReceipt,
  snapshotChecked,
  snapshotDue,
  verifySigningHandle,
} from "../adapter.js";
import { addressFromKey, domainSchema, type Eip712Domain } from "../eip3009.js";
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
import { liftOrder, liftReceipt, liftRequest } from "./lift.js";
import {
  buildCredential,
  type Challenge,
  challengeExchange,
  chargeRequest,
  convertMppAmount,
  createChallenge,
  createCredential,
  MppError,
} from "./objects.js";
import { MppServer } from "./server.js";

export interface MppProfile extends AdapterProfile {
  domain: Eip712Domain;
  challengeSecret: Uint8Array;
  settlementKey: Uint8Array;
  keyStatement?: string;
}
export class MppSuite implements SettlementSuite {
  readonly id = "mpp";
  private readonly store = new LiftStore(this.id);
  private readonly once = new OnceAssociation();
  private readonly requests = new Map<string, RequestAssociation<Challenge>>();
  private readonly orders = new Map<string, PaymentFacts>();
  private readonly server: MppServer;
  private readonly key: Uint8Array;
  private readonly secret: Uint8Array;
  private readonly domain: Eip712Domain;
  private sequence = 0;
  constructor(private readonly profile: MppProfile) {
    this.key = Uint8Array.from(profile.settlementKey);
    this.secret = Uint8Array.from(profile.challengeSecret);
    this.domain = domainSchema.parse(profile.domain);
    if (
      this.domain.chainId !== "84532" ||
      addressFromKey(this.key) !== profile.payer.account.toLowerCase()
    )
      invalid();
    this.server = new MppServer(
      profile.ledger,
      this.secret,
      this.domain,
      profile.currency,
      profile.decimals,
    );
  }
  async request(due: AmountDue, payee: PayeeContext): Promise<ProtocolObjects> {
    due = snapshotDue(due);

    const amount = convertMppAmount(
      {
        amount: due.amount ?? requireValue(due.agreement.duty?.constraint?.amount),
        currency: this.profile.currency,
      },
      this.profile.decimals,
    );
    const challenge = createChallenge(
      {
        amount: amount.units,
        currency: amount.currency,
        recipient: this.profile.merchant.account,
        externalId: requireValue(due.agreement.digest),
        methodDetails: { type: "authorization", chainId: this.domain.chainId },
      },
      {
        realm: "valuer.example",
        method: "evm",
        intent: "charge",
        expires: new Date(
          Math.min(
            Date.parse(requireValue(due.agreement.validUntil)),
            (seconds(this.profile) + 300) * 1000,
          ),
        ).toISOString(),
        opaque: `${digestOf(due.invoice)}-${++this.sequence}`,
      },
      this.secret,
    );
    return this.admitRequest(challengeExchange("GET", "/valuation-booking", challenge), due, payee);
  }
  async admitRequest(
    exchange: HttpExchange,
    due: AmountDue,
    payee: PayeeContext,
  ): Promise<ProtocolObjects> {
    due = snapshotDue(due);
    exchange = structuredClone(exchange);

    const objects = bundle(this.id, [httpObject("Challenge", exchange, null)]);
    await this.profile.admit(payee.party, "payment-request", objects);
    const lifted = liftRequest(
      rawExchange(objects, "Challenge"),
      due,
      payee,
      this.profile,
      this.secret,
    );
    const result = bundle(this.id, [
      httpObject("Challenge", exchange, { ...lifted.challenge, decodedRequest: lifted.charge }),
    ]);
    this.requests.set(due.invoice, {
      due,
      objects: bundle(this.id, result.objects),
      facts: lifted.facts.snapshot(),
      request: lifted.challenge,
    });
    return this.store.remember(result, lifted.facts, {
      amount: "Challenge.request.amount",
      currency: "Challenge.request.currency",
      account: "Challenge.request.recipient",
      agreement: "Challenge.request.externalId",
      payee: "authenticated merchant and P4 account binding",
    });
  }
  async order(checked: CheckedPayment, payer: PayerContext): Promise<ProtocolObjects> {
    checked = snapshotChecked(checked);

    if (payer.party !== this.profile.payer.party) return invalid();
    const request = checkedRequest(checked, this.profile, this.requests);
    this.once.check(requireValue(checked.facts.onceKey), request.request.id + checked.digest);
    await checkProtocolKey(
      this.profile,
      this.id,
      this.profile.payer,
      "secp256k1",
      this.profile.payer.account.toLowerCase(),
      this.profile.keyStatement,
    );
    const validBefore = Math.floor(Date.parse(requireValue(checked.facts.validUntil)) / 1000);
    if (validBefore * 1000 !== Date.parse(requireValue(checked.facts.validUntil))) return invalid();
    if (validBefore * 1000 > Date.parse(requireValue(request.request.expires))) return invalid();
    const credential = createCredential(
      request.request,
      this.domain,
      this.profile.payer.account,
      String(seconds(this.profile) - 1),
      String(validBefore),
      this.key,
    );
    const exchange = {
      method: "GET",
      path: "/valuation-booking",
      headers: { [request.request.header ?? "Authorization"]: buildCredential(credential) },
      body: null,
    };
    const objects = bundle(this.id, [
      ...request.objects.objects,
      keyObject("payer", this.profile.keyStatement),
      httpObject("Credential", exchange, credential),
    ]);
    await this.profile.admit(payer.party, "payment", objects);
    liftOrder(objects, this.profile, this.domain, request.request);
    try {
      this.server.verify(credential, request.request, seconds(this.profile));
    } catch (error) {
      return invalid(error instanceof MppError ? error.type : undefined);
    }
    checkedRequest(checked, this.profile, this.requests);
    this.once.claim(requireValue(checked.facts.onceKey), request.request.id + checked.digest);
    this.orders.set(request.request.id, checked.facts.snapshot());
    return this.store.remember(objects, checked.facts, {
      amount: "Credential.payload.value",
      account: "Credential.payload.to",
      currency: "Credential.challenge.request.currency",
      agreement: "Credential.challenge.request.externalId",
      onceKey:
        "host awp:onceKey-to-Challenge.id association; Credential.payload.nonce = challenge hash",
      validUntil: "Credential.payload.validBefore",
      payer: "Credential.source, recovered signer and identity-signed SettlementKey",
      payee: "authenticated merchant and P4 account binding",
    });
  }
  async settle(objects: ProtocolObjects, provider: ProviderContext): Promise<ProtocolObjects> {
    if (objects.suite !== this.id) return invalid();
    objects = bundle(this.id, objects.objects);

    checkProvider(this.profile, provider);
    await verifySigningHandle(this.profile.provider.signingKey, this.profile.provider.identity);
    await this.profile.admit(this.profile.payer.party, "payment", objects);
    const challengeExchangeRaw = rawExchange(objects, "Challenge");
    const request = requireValue(
      [...this.requests.values()].find(
        (r) => digestOf(rawExchange(r.objects, "Challenge")) === digestOf(challengeExchangeRaw),
      ),
    );
    const order = requireValue(this.orders.get(request.request.id));
    await checkProtocolKey(
      this.profile,
      this.id,
      this.profile.payer,
      "secp256k1",
      this.profile.payer.account.toLowerCase(),
      this.profile.keyStatement,
    );
    const { exchange, credential } = liftOrder(objects, this.profile, this.domain, request.request);
    if (
      Number(credential.payload.validBefore) * 1000 !==
      Date.parse(requireValue(order.validUntil))
    )
      return invalid();
    const response = this.server.handle(exchange, request.request, seconds(this.profile), () =>
      createChallenge(
        chargeRequest(request.request),
        {
          realm: request.request.realm,
          method: "evm",
          intent: "charge",
          expires: new Date((seconds(this.profile) + 300) * 1000).toISOString(),
          opaque: `retry-${++this.sequence}`,
        },
        this.secret,
      ),
    );
    let receipt: ReturnType<typeof liftReceipt>;
    try {
      receipt = liftReceipt(response, request.request, this.domain);
    } catch (error) {
      if (error instanceof MppError) return invalid(error.type, response);
      throw error;
    }
    const protocol = bundle(this.id, [httpObject("Payment-Receipt", response, receipt)]);
    const result = bundle(this.id, [
      ...protocol.objects,
      await signProviderReceipt(this.profile, order, receipt.reference, protocol),
    ]);
    const facts = await liftProviderReceipt(
      this.profile,
      result,
      order,
      protocol,
      receipt.reference,
    );
    return this.store.remember(result, facts, {
      status: "Payment-Receipt.status",
      ledgerReference: "Payment-Receipt.reference",
      provider:
        "payment-receipt.provider (identity-signed provider statement; MPP receipt is unsigned)",
      amount: "payment-receipt.payment.amount",
      currency: "payment-receipt.payment.currency",
      payee: "payment-receipt.payment.payee",
      agreement: "payment-receipt.payment.agreement",
      order: "payment-receipt.payment.id",
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
