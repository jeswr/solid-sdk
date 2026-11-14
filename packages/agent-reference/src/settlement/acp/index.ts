// AUTHORED-BY Codex GPT-6
import { digestOf } from "../../core/canonical.js";
import type { SigningKey } from "../../mechanisms/jws.js";
import type { PaymentFacts } from "../../model/payment.js";
import { paymentOnceKey } from "../../model/payment.js";
import {
  type AdapterProfile,
  bundle,
  checkedRequest,
  checkProvider,
  httpObject,
  invalid,
  LiftStore,
  liftProviderReceipt,
  nonceOf,
  OnceAssociation,
  type RequestAssociation,
  rawExchange,
  requireValue,
  SettlementError,
  seconds,
  signProviderReceipt,
  snapshotChecked,
  snapshotDue,
  verifySigningHandle,
} from "../adapter.js";
import { type HttpExchange, header } from "../http.js";
import type {
  AmountDue,
  CheckedPayment,
  PayeeContext,
  PayerContext,
  ProtocolObjects,
  ProviderContext,
  SettlementSuite,
} from "../types.js";
import { AcpError } from "./errors.js";
import { IdempotencyStore } from "./idempotency.js";
import {
  acpFailure,
  liftOrder,
  liftReceipt,
  liftRequest,
  verifyComplete,
  verifyExchange,
} from "./lift.js";
import {
  ACP_VERSION,
  type CheckoutSession,
  checkoutSessionSchema,
  completeSchema,
  convertAcpAmount,
  createSessionSchema,
  delegatePaymentSchema,
} from "./objects.js";
import { AcpPaymentProvider } from "./provider.js";
import { signAcpExchange } from "./signing.js";

export interface AcpProfile extends AdapterProfile {
  agentKey: SigningKey;
  merchantKey: SigningKey;
  bearerToken: string;
  handlerId: string;
}
export class AcpSuite implements SettlementSuite {
  readonly id = "acp";
  private readonly store = new LiftStore(this.id);
  private readonly once = new OnceAssociation();
  private readonly requests = new Map<string, RequestAssociation<CheckoutSession>>();
  private readonly orders = new Map<string, PaymentFacts>();
  private readonly endpoints = new Map<string, IdempotencyStore<HttpExchange>>();
  private readonly completion = new Map<string, IdempotencyStore<ProtocolObjects>>();
  private readonly provider: AcpPaymentProvider;
  constructor(private readonly profile: AcpProfile) {
    if (
      profile.agentKey.kid !== profile.payer.identity.kid ||
      profile.merchantKey.kid !== profile.merchant.identity.kid ||
      profile.agentKey.alg !== "EdDSA" ||
      profile.merchantKey.alg !== "EdDSA" ||
      profile.provider.signingKey.alg !== "EdDSA"
    )
      invalid();
    this.provider = new AcpPaymentProvider(profile.ledger, profile.handlerId, {
      [profile.currency.toLowerCase()]: profile.decimals,
    });
  }
  private endpoint(path: string) {
    let store = this.endpoints.get(path);
    if (!store) {
      store = new IdempotencyStore<HttpExchange>();
      this.endpoints.set(path, store);
    }
    return store;
  }
  private async post(path: string, body: unknown, onceKey: string): Promise<HttpExchange> {
    return signAcpExchange(
      {
        method: "POST",
        path,
        headers: {
          Authorization: `Bearer ${this.profile.bearerToken}`,
          "API-Version": ACP_VERSION,
          "Idempotency-Key": nonceOf(onceKey),
        },
        body,
      },
      this.profile.agentKey.privateKey,
      seconds(this.profile),
    );
  }
  async request(due: AmountDue, payee: PayeeContext): Promise<ProtocolObjects> {
    due = snapshotDue(due);

    const onceKey = paymentOnceKey(requireValue(due.agreement.digest), due.agreement.instalment);
    const body = createSessionSchema.parse({ items: [{ id: "home-valuation", quantity: 1 }] });
    const creation = await this.post("/checkout_sessions", body, onceKey);
    await verifyExchange(
      creation,
      this.profile.payer.identity,
      this.profile,
      this.profile.bearerToken,
    );
    const units = convertAcpAmount(
      {
        amount: requireValue(due.agreement.duty?.constraint?.amount),
        currency: this.profile.currency,
      },
      this.profile.decimals,
    ).units;
    if (BigInt(units) > BigInt(Number.MAX_SAFE_INTEGER)) return invalid();
    const response = await this.endpoint(creation.path).execute(
      header(creation.headers, "Idempotency-Key"),
      body,
      async () => {
        const session = checkoutSessionSchema.parse({
          id: `cs_${digestOf(due.invoice).slice(8)}`,
          merchant_id: this.profile.merchant.account,
          status: "ready_for_payment",
          currency: this.profile.currency.toLowerCase(),
          items: body.items,
          totals: [{ type: "total", amount: Number(units) }],
        });
        return signAcpExchange(
          { method: "POST", path: creation.path, status: 201, headers: {}, body: session },
          this.profile.merchantKey.privateKey,
          seconds(this.profile),
        );
      },
    );
    return this.admitRequest(
      bundle(this.id, [
        httpObject("Create checkout request", creation, creation.body),
        httpObject("Checkout session", response, response.body),
      ]),
      due,
      payee,
    );
  }
  async admitRequest(
    objects: ProtocolObjects,
    due: AmountDue,
    payee: PayeeContext,
  ): Promise<ProtocolObjects> {
    due = snapshotDue(due);

    if (objects.suite !== this.id) return invalid();
    const admitted = bundle(this.id, objects.objects);
    await this.profile.admit(payee.party, "payment-request", admitted);
    const lifted = await liftRequest(admitted, due, payee, this.profile, this.profile.bearerToken);
    this.requests.set(due.invoice, {
      due,
      objects: bundle(this.id, admitted.objects),
      facts: lifted.facts.snapshot(),
      request: lifted.session,
    });
    return this.store.remember(admitted, lifted.facts, {
      amount: "Checkout session.totals[0].amount (minor units)",
      currency: "Checkout session.currency",
      account: "Checkout session.merchant_id",
      payee: "not in session: authenticated merchant and accepted account binding",
      agreement: "host session-to-agreement association",
    });
  }
  async order(checked: CheckedPayment, payer: PayerContext): Promise<ProtocolObjects> {
    checked = snapshotChecked(checked);

    if (payer.party !== this.profile.payer.party) return invalid();
    const request = checkedRequest(checked, this.profile, this.requests);
    this.once.check(requireValue(checked.facts.onceKey), request.request.id + checked.digest);
    const session = request.request;
    const body = delegatePaymentSchema.parse({
      payment_method: { type: "account", account_id: this.profile.payer.account },
      allowance: {
        reason: "one_time",
        max_amount: session.totals[0].amount,
        currency: session.currency,
        checkout_session_id: session.id,
        merchant_id: session.merchant_id,
        expires_at: requireValue(checked.facts.validUntil),
      },
      risk_signals: [],
      metadata: {},
    });
    const delegation = await this.post(
      "/agentic_commerce/delegate_payment",
      body,
      requireValue(checked.facts.onceKey),
    );
    await verifyExchange(
      delegation,
      this.profile.payer.identity,
      this.profile,
      this.profile.bearerToken,
    );
    const response = await this.endpoint(delegation.path).execute(
      header(delegation.headers, "Idempotency-Key"),
      body,
      async () =>
        signAcpExchange(
          {
            method: "POST",
            path: delegation.path,
            status: 201,
            headers: {},
            body: this.provider.delegate(body, seconds(this.profile)),
          },
          this.profile.provider.signingKey.privateKey,
          seconds(this.profile),
        ),
    );
    // The signed provider response is parsed in the protocol lift before its token is used.
    await verifyExchange(response, this.profile.provider.identity, this.profile);
    const token = await importToken(response);
    const completeBody = completeSchema.parse({
      payment_data: {
        handler_id: this.profile.handlerId,
        instrument: {
          id: this.profile.payer.account,
          handler_id: this.profile.handlerId,
          type: "account",
          credential: { type: "spt", token },
        },
      },
    });
    const complete = await this.post(
      `/checkout_sessions/${encodeURIComponent(session.id)}/complete`,
      completeBody,
      requireValue(checked.facts.onceKey),
    );
    const objects = bundle(this.id, [
      ...request.objects.objects,
      httpObject("Delegate payment request", delegation, body),
      httpObject("Delegated payment", response, response.body),
      httpObject("Complete checkout request", complete, completeBody),
    ]);
    await this.profile.admit(payer.party, "payment", objects);
    await liftOrder(objects, this.profile, this.profile.bearerToken, session, checked.facts);
    checkedRequest(checked, this.profile, this.requests);
    this.once.claim(requireValue(checked.facts.onceKey), request.request.id + checked.digest);
    this.orders.set(session.id, checked.facts.snapshot());
    return this.store.remember(objects, checked.facts, {
      amount: "Delegate payment request.allowance.max_amount",
      currency: "Delegate payment request.allowance.currency",
      account: "Delegate payment request.allowance.merchant_id",
      payee: "authenticated merchant and accepted host account binding",
      validUntil: "Delegate payment request.allowance.expires_at",
      onceKey: "Complete checkout request.headers.Idempotency-Key (SHA-256 of awp:onceKey)",
      agreement: "allowance.checkout_session_id -> host agreement association",
      payer: "Delegate payment request.payment_method.account_id and authenticated agent",
    });
  }
  async settle(objects: ProtocolObjects, provider: ProviderContext): Promise<ProtocolObjects> {
    if (objects.suite !== this.id) return invalid();
    objects = bundle(this.id, objects.objects);

    checkProvider(this.profile, provider);
    await verifySigningHandle(this.profile.merchantKey, this.profile.merchant.identity);
    await verifySigningHandle(this.profile.provider.signingKey, this.profile.provider.identity);
    await this.profile.admit(this.profile.payer.party, "payment", objects);
    const sessionExchange = rawExchange(objects, "Checkout session");
    const request = requireValue(
      [...this.requests.values()].find(
        (r) => digestOf(rawExchange(r.objects, "Checkout session")) === digestOf(sessionExchange),
      ),
    );
    const session = request.request;
    const order = requireValue(this.orders.get(session.id));
    const completeExchange = await verifyComplete(
      objects,
      this.profile,
      this.profile.bearerToken,
      session,
      order,
    );
    let store = this.completion.get(completeExchange.path);
    if (!store) {
      store = new IdempotencyStore<ProtocolObjects>();
      this.completion.set(completeExchange.path, store);
    }
    try {
      return await store.execute(
        header(completeExchange.headers, "Idempotency-Key"),
        completeExchange.body,
        async () => {
          const lifted = await liftOrder(
            objects,
            this.profile,
            this.profile.bearerToken,
            session,
            order,
          );
          const entry = this.provider.redeem(session, lifted.complete, seconds(this.profile));
          const completed = checkoutSessionSchema.parse({
            ...session,
            status: "completed",
            order: {
              id: `order_${entry.sequence}`,
              checkout_session_id: session.id,
              permalink_url: `https://valuer.example/orders/${entry.sequence}`,
            },
          });
          const response = await signAcpExchange(
            {
              method: "POST",
              path: completeExchange.path,
              status: 200,
              headers: {},
              body: completed,
            },
            this.profile.merchantKey.privateKey,
            seconds(this.profile),
          );
          const protocol = bundle(this.id, [
            httpObject("Completed checkout session", response, completed),
          ]);
          const result = bundle(this.id, [
            ...protocol.objects,
            await signProviderReceipt(this.profile, order, entry.digest, protocol),
          ]);
          await this.profile.admit(this.profile.merchant.party, "payment-receipt", result);
          await liftReceipt(result, this.profile, session);
          const facts = await liftProviderReceipt(
            this.profile,
            result,
            order,
            protocol,
            entry.digest,
          );
          return this.store.remember(result, facts, {
            status: "Completed checkout session.status and order",
            order:
              "payment-receipt.payment.id; completed.order.checkout_session_id -> host order association",
            ledgerReference: "payment-receipt.reference (provider identity-signed local statement)",
            provider: "payment-receipt.provider",
            amount: "payment-receipt.payment.amount",
            currency: "payment-receipt.payment.currency",
            payee: "payment-receipt.payment.payee",
            agreement: "payment-receipt.payment.agreement",
          });
        },
      );
    } catch (error) {
      if (error instanceof AcpError) {
        const response = await signAcpExchange(
          {
            method: completeExchange.method,
            path: completeExchange.path,
            status: error.status,
            headers: {},
            body: { type: error.code },
          },
          this.profile.merchantKey.privateKey,
          seconds(this.profile),
        );
        await verifyExchange(response, this.profile.merchant.identity, this.profile);
        throw new SettlementError("evidence-invalid", error.code, response);
      }
      return acpFailure(error, completeExchange);
    }
  }
  lift(objects: ProtocolObjects): PaymentFacts {
    return this.store.lift(objects);
  }
  trace(objects: ProtocolObjects) {
    return this.store.trace(objects);
  }
}

// Kept in lift.ts: even a provider's signed response must be schema-checked before use.
import { importToken } from "./lift.js";
