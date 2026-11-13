// AUTHORED-BY Codex GPT-6
import { CompactSign, generateKeyPair } from "jose";
import { expect, it } from "vitest";
import { canonicalJson } from "../../src/core/canonical.js";
import { IdempotencyStore } from "../../src/settlement/acp/idempotency.js";
import {
  ACP_VERSION,
  type CheckoutSession,
  type Complete,
  checkoutSessionSchema,
  completeSchema,
  convertAcpAmount,
  createSessionSchema,
  type DelegatePayment,
  delegatedPaymentSchema,
  delegatePaymentSchema,
} from "../../src/settlement/acp/objects.js";
import { AcpPaymentProvider } from "../../src/settlement/acp/provider.js";
import {
  checkAcpRequestHeaders,
  signAcpExchange,
  verifyAcpExchange,
} from "../../src/settlement/acp/signing.js";
import type { HttpExchange } from "../../src/settlement/http.js";
import { Ledger } from "../../src/settlement/ledger.js";
import { now } from "./fixtures.js";

const session: CheckoutSession = {
  id: "cs_1",
  merchant_id: "valuer",
  status: "ready_for_payment",
  currency: "usd",
  items: [{ id: "valuation", quantity: 1 }],
  totals: [{ type: "total", amount: 125 }],
};
const delegation: DelegatePayment = {
  payment_method: { type: "account", account_id: "sam" },
  allowance: {
    reason: "one_time",
    max_amount: 125,
    currency: "usd",
    checkout_session_id: "cs_1",
    merchant_id: "valuer",
    expires_at: new Date((now + 300) * 1000).toISOString(),
  },
  risk_signals: [],
  metadata: {},
};
const complete: Complete = {
  payment_data: {
    handler_id: "fictional-provider",
    instrument: {
      id: "sam",
      handler_id: "fictional-provider",
      type: "account",
      credential: { type: "spt", token: "vt_example" },
    },
  },
};
function setup(balance = "10.00") {
  const ledger = new Ledger();
  ledger.createAccount("sam", { usd: balance });
  ledger.createAccount("valuer");
  const provider = new AcpPaymentProvider(ledger, "fictional-provider", { usd: 2, jpy: 0 });
  const token = provider.delegate(delegation, now);
  const payment = structuredClone(complete);
  payment.payment_data.instrument.credential.token = token.id;
  return { ledger, provider, token, payment, checkout: structuredClone(session) };
}
function exchange(body: unknown = complete): HttpExchange {
  return {
    method: "POST",
    path: "/checkout_sessions/cs_1/complete",
    headers: {
      Authorization: "Bearer fictional-account",
      "API-Version": ACP_VERSION,
      "Idempotency-Key": "payment-once",
    },
    body,
  };
}
it("admits only the confirmed statuses and a positive integer ready-for-payment total", () => {
  expect(checkoutSessionSchema.parse(session)).toEqual(session);
  expect(createSessionSchema.parse({ items: session.items })).toEqual({ items: session.items });
  expect(delegatePaymentSchema.parse(delegation)).toEqual(delegation);
  expect(completeSchema.parse(complete)).toEqual(complete);
  const completed = {
    ...session,
    status: "completed",
    order: {
      id: "order_1",
      checkout_session_id: session.id,
      permalink_url: "https://valuer.example/orders/1",
    },
  };
  expect(checkoutSessionSchema.parse(completed)).toEqual(completed);
});
it.each([
  { status: "unknown" },
  { totals: [{ type: "total", amount: 1.25 }] },
  { totals: [{ type: "total", amount: 0 }] },
  { totals: [{ type: "total", amount: -1 }] },
  { totals: [{ type: "total", amount: Number.MAX_SAFE_INTEGER + 1 }] },
  { totals: [] },
  { totals: [{ type: "tax", amount: 125 }] },
  {
    totals: [
      { type: "total", amount: 125 },
      { type: "total", amount: 125 },
    ],
  },
  { currency: "USD" },
  { unexpected: true },
  { status: "completed" },
  { items: [{ id: "x", quantity: 0 }] },
])("refuses malformed checkout session %j", (change) => {
  expect(() => checkoutSessionSchema.parse({ ...session, ...change })).toThrow();
});
it("refuses wrong order session binding, incomplete payment data and unconfirmed payment fields", () => {
  expect(() =>
    checkoutSessionSchema.parse({
      ...session,
      status: "completed",
      order: { id: "o", checkout_session_id: "another", permalink_url: "https://example.com" },
    }),
  ).toThrow();
  for (const body of [
    {},
    { payment_data: { token: "vt_example" } },
    { ...complete, extra: true },
    { payment_data: { ...complete.payment_data, handler_id: "other" } },
  ])
    expect(() => completeSchema.parse(body)).toThrow();
  expect(() =>
    delegatePaymentSchema.parse({
      ...delegation,
      payment_method: { type: "card", card_number: "fictional" },
    }),
  ).toThrow();
  expect(() =>
    delegatePaymentSchema.parse({
      ...delegation,
      allowance: { ...delegation.allowance, reason: "recurring" },
    }),
  ).toThrow();
});
it("issues a delegated token and redeems its allowance once on the fictional ledger", () => {
  const { ledger, provider, token, payment, checkout } = setup();
  expect(delegatedPaymentSchema.parse(token)).toEqual(token);
  expect(token.id).toMatch(/^vt_/);
  const entry = provider.redeem(checkout, payment, now);
  expect(entry).toMatchObject({ from: "sam", to: "valuer", amount: "1.25", currency: "usd" });
  expect(ledger.balance("sam", "usd")).toBe("8.75");
  expect(ledger.balance("valuer", "usd")).toBe("1.25");
  expect(() => provider.redeem(checkout, payment, now)).toThrow("invalid_token");
  expect(ledger.entries).toHaveLength(1);
});
it.each([
  "amount",
  "currency",
  "merchant",
  "session",
  "status",
  "handler",
  "instrument",
  "instrument-type",
  "expired",
  "invalid-time",
])("refuses allowance violation %s without a charge", (attack) => {
  const { ledger, provider, payment, checkout } = setup();
  if (attack === "amount") checkout.totals[0] = { type: "total", amount: 126 };
  if (attack === "currency") checkout.currency = "jpy";
  if (attack === "merchant") checkout.merchant_id = "attacker";
  if (attack === "session") checkout.id = "other";
  if (attack === "status") checkout.status = "in_progress";
  if (attack === "handler") {
    payment.payment_data.handler_id = "other";
    payment.payment_data.instrument.handler_id = "other";
  }
  if (attack === "instrument") payment.payment_data.instrument.id = "other";
  if (attack === "instrument-type") payment.payment_data.instrument.type = "card";
  expect(() =>
    provider.redeem(
      checkout,
      payment,
      attack === "expired" ? now + 300 : attack === "invalid-time" ? NaN : now,
    ),
  ).toThrow("invalid_allowance");
  expect(ledger.entries).toHaveLength(0);
  expect(ledger.balance("sam", "usd")).toBe("10.00");
});
it("refuses unknown tokens and invalid/expired delegations", () => {
  const { provider, checkout } = setup();
  expect(() => provider.redeem(checkout, complete, now)).toThrow("invalid_token");
  expect(() =>
    provider.delegate(
      {
        ...delegation,
        allowance: { ...delegation.allowance, expires_at: new Date(now * 1000).toISOString() },
      },
      now,
    ),
  ).toThrow("invalid_allowance");
  expect(() =>
    provider.delegate(
      { ...delegation, allowance: { ...delegation.allowance, currency: "gbp" } },
      now,
    ),
  ).toThrow("invalid_allowance");
  expect(() => provider.delegate(delegation, NaN)).toThrow("invalid_allowance");
  expect(() =>
    provider.delegate(
      { ...delegation, payment_method: { type: "account", account_id: "unknown" } },
      now,
    ),
  ).toThrow("unknown_account");
  expect(() => new AcpPaymentProvider(new Ledger(), "", { usd: 2 })).toThrow("invalid_handler");
});
it("does not consume a token on insufficient funds or unknown recipient", () => {
  const { ledger, provider, checkout, payment } = setup("1.00");
  expect(() => provider.redeem(checkout, payment, now)).toThrow("insufficient_funds");
  ledger.createAccount("topup", { usd: "1.00" });
  ledger.transfer("topup", "sam", "1", "usd", "topup-once");
  expect(provider.redeem(checkout, payment, now)).toBeDefined();
  const another = setup();
  const token = another.provider.delegate(
    { ...delegation, allowance: { ...delegation.allowance, merchant_id: "unknown" } },
    now,
  );
  const next = structuredClone(complete);
  next.payment_data.instrument.credential.token = token.id;
  expect(() => another.provider.redeem({ ...session, merchant_id: "unknown" }, next, now)).toThrow(
    "invalid_allowance",
  );
});
it("isolates token state from mutations of input and returned metadata", () => {
  const { ledger, provider } = setup();
  const input = structuredClone(delegation);
  input.metadata = { note: "original" };
  const token = provider.delegate(input, now);
  input.allowance.max_amount = 1;
  token.metadata.note = "changed";
  const payment = structuredClone(complete);
  payment.payment_data.instrument.credential.token = token.id;
  expect(provider.redeem(session, payment, now)).toBeDefined();
  expect(ledger.entries).toHaveLength(1);
});
it("settles a currency with no minor unit without dividing by 100", () => {
  const ledger = new Ledger();
  ledger.createAccount("sam", { jpy: "500" });
  ledger.createAccount("valuer");
  const provider = new AcpPaymentProvider(ledger, "fictional-provider", { jpy: 0 });
  const token = provider.delegate(
    { ...delegation, allowance: { ...delegation.allowance, currency: "jpy", max_amount: 125 } },
    now,
  );
  const payment = structuredClone(complete);
  payment.payment_data.instrument.credential.token = token.id;
  expect(provider.redeem({ ...session, currency: "jpy" }, payment, now).amount).toBe("125");
  expect(ledger.balance("sam", "jpy")).toBe("375");
  expect(convertAcpAmount({ amount: "125", currency: "jpy" }, 0)).toEqual({
    units: "125",
    currency: "jpy",
  });
  expect(convertAcpAmount({ units: "125", currency: "jpy" }, 0)).toEqual({
    amount: "125",
    currency: "jpy",
  });
  expect(convertAcpAmount({ amount: "1.25", currency: "usd" }, 2)).toEqual({
    units: "125",
    currency: "usd",
  });
  expect(convertAcpAmount({ units: "125", currency: "usd" }, 2)).toEqual({
    amount: "1.25",
    currency: "usd",
  });
});
it("requires signed requests/responses under the local ACP profile and checks canonical body bytes", async () => {
  const keys = await generateKeyPair("EdDSA");
  const request = exchange();
  const signed = await signAcpExchange(request, keys.privateKey, now);
  expect(signed.headers).toHaveProperty("Signature");
  expect(signed.headers.Timestamp).toBe(String(now));
  expect(signed.headers.Signature?.split(".")[1]).toBe("");
  await expect(verifyAcpExchange(signed, keys.publicKey, now)).resolves.toBeUndefined();
  checkAcpRequestHeaders(signed);
  const response = await signAcpExchange(
    {
      ...request,
      status: 200,
      body: {
        order: {
          id: "o",
          checkout_session_id: "cs_1",
          permalink_url: "https://valuer.example/order/o",
        },
      },
    },
    keys.privateKey,
    now,
  );
  await expect(verifyAcpExchange(response, keys.publicKey, now)).resolves.toBeUndefined();
  const reordered = { ...signed, body: JSON.parse(canonicalJson(complete)) };
  await expect(verifyAcpExchange(reordered, keys.publicKey, now)).resolves.toBeUndefined();
});
it("refuses missing signatures/timestamps and altered bodies or verification keys", async () => {
  const keys = await generateKeyPair("EdDSA");
  const other = await generateKeyPair("EdDSA");
  const signed = await signAcpExchange(exchange(), keys.privateKey, now);
  const { Signature: _signature, ...noSignature } = signed.headers;
  const { Timestamp: _timestamp, ...noTimestamp } = signed.headers;
  await expect(
    verifyAcpExchange({ ...signed, headers: noSignature }, keys.publicKey, now),
  ).rejects.toMatchObject({ code: "unsigned-not-allowed" });
  await expect(
    verifyAcpExchange({ ...signed, headers: noTimestamp }, keys.publicKey, now),
  ).rejects.toMatchObject({ code: "unsigned-not-allowed" });
  await expect(
    verifyAcpExchange({ ...signed, body: { ...complete, changed: true } }, keys.publicKey, now),
  ).rejects.toMatchObject({ code: "invalid_signature" });
  await expect(verifyAcpExchange(signed, other.publicKey, now)).rejects.toMatchObject({
    code: "invalid_signature",
  });
});
it.each([
  "0",
  String(now - 301),
  String(now + 301),
  "1.5",
  "01",
  "NaN",
  "9007199254740992",
])("refuses invalid/stale Timestamp %s", async (timestamp) => {
  const keys = await generateKeyPair("EdDSA");
  const signed = await signAcpExchange(exchange(), keys.privateKey, now);
  await expect(
    verifyAcpExchange(
      { ...signed, headers: { ...signed.headers, Timestamp: timestamp } },
      keys.publicKey,
      now,
    ),
  ).rejects.toMatchObject({ code: "invalid_timestamp" });
});
it("refuses malformed/non-detached signatures, header key injection and invalid signing times", async () => {
  const keys = await generateKeyPair("EdDSA");
  const signed = await signAcpExchange(exchange(), keys.privateKey, now);
  for (const Signature of ["x", "x.x.x", "e30..x"])
    await expect(
      verifyAcpExchange(
        { ...signed, headers: { ...signed.headers, Signature } },
        keys.publicKey,
        now,
      ),
    ).rejects.toMatchObject({ code: "invalid_signature" });
  const raw = await new CompactSign(new TextEncoder().encode(canonicalJson(complete)))
    .setProtectedHeader({ alg: "EdDSA", jwk: { kty: "OKP", crv: "Ed25519", x: "attacker" } })
    .sign(keys.privateKey);
  const [first, , last] = raw.split(".");
  await expect(
    verifyAcpExchange(
      { ...signed, headers: { ...signed.headers, Signature: `${first}..${last}` } },
      keys.publicKey,
      now,
    ),
  ).rejects.toMatchObject({ code: "invalid_signature" });
  await expect(signAcpExchange(exchange(), keys.privateKey, NaN)).rejects.toMatchObject({
    code: "invalid_timestamp",
  });
  await expect(verifyAcpExchange(signed, keys.publicKey, NaN)).rejects.toMatchObject({
    code: "invalid_timestamp",
  });
  await expect(verifyAcpExchange(signed, keys.publicKey, now, -1)).rejects.toMatchObject({
    code: "invalid_timestamp",
  });
});
it("documents body-only signature coverage: routing and Timestamp need envelope protection", async () => {
  const keys = await generateKeyPair("EdDSA");
  const signed = await signAcpExchange(exchange(), keys.privateKey, now);
  await expect(
    verifyAcpExchange(
      {
        ...signed,
        path: "/another-path",
        headers: { ...signed.headers, Timestamp: String(now + 1) },
      },
      keys.publicKey,
      now + 1,
    ),
  ).resolves.toBeUndefined();
});
it("requires Authorization, version and POST idempotency headers", () => {
  const original = exchange();
  checkAcpRequestHeaders(original);
  for (const [name, code] of [
    ["Authorization", "authorization_required"],
    ["API-Version", "unsupported_api_version"],
    ["Idempotency-Key", "idempotency_key_required"],
  ]) {
    const changed = { ...original, headers: { ...original.headers } };
    delete changed.headers[name as string];
    try {
      checkAcpRequestHeaders(changed);
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  }
  const { "Idempotency-Key": _once, ...getHeaders } = original.headers;
  expect(() =>
    checkAcpRequestHeaders({ ...original, method: "GET", headers: getHeaders }),
  ).not.toThrow();
});
it("returns the first response on identical idempotent retries and refuses changed complete bodies with 422", async () => {
  const { ledger, provider, payment, checkout } = setup();
  const store = new IdempotencyStore<{ status: number; body: { reference: string } }>();
  let calls = 0;
  const action = () => {
    calls++;
    const entry = provider.redeem(checkout, payment, now);
    return { status: 200, body: { reference: entry.digest } };
  };
  const first = await store.execute("once", payment, action);
  const original = structuredClone(first);
  first.body.reference = "caller-mutation";
  expect(await store.execute("once", JSON.parse(canonicalJson(payment)), action)).toEqual(original);
  await expect(
    store.execute("once", { ...payment, different: true }, action),
  ).rejects.toMatchObject({ code: "idempotency_conflict", status: 422 });
  expect(calls).toBe(1);
  expect(ledger.entries).toHaveLength(1);
});
it("detects concurrent requests before running their actions, with source 409/422 errors", async () => {
  const store = new IdempotencyStore<string>();
  let release: ((value: string) => void) | undefined;
  const pending = store.execute(
    "once",
    { amount: 1 },
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  await expect(store.execute("once", { amount: 1 }, () => "duplicate")).rejects.toMatchObject({
    code: "idempotency_in_flight",
    status: 409,
  });
  await expect(store.execute("once", { amount: 2 }, () => "changed")).rejects.toMatchObject({
    code: "idempotency_conflict",
    status: 422,
  });
  release?.("original");
  expect(await pending).toBe("original");
  expect(await store.execute("once", { amount: 1 }, () => "duplicate")).toBe("original");
});
it("refuses missing idempotency keys, releases failed attempts and stores responses independently of action-owned objects", async () => {
  const store = new IdempotencyStore<{ result: string }>();
  await expect(store.execute(undefined, {}, () => ({ result: "bad" }))).rejects.toMatchObject({
    code: "idempotency_key_required",
    status: 400,
  });
  await expect(
    store.execute("retry", {}, () => {
      throw new Error("failed");
    }),
  ).rejects.toThrow("failed");
  const response = { result: "success" };
  expect(await store.execute("retry", {}, () => response)).toEqual(response);
  response.result = "changed";
  expect(await store.execute("retry", {}, () => response)).toEqual({ result: "success" });
});
