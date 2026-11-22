// AUTHORED-BY Codex GPT-6

import { type CryptoKey, importJWK } from "jose";
import { expect, it } from "vitest";
import { checkReceipt } from "../../src/gates/payment.js";
import { signAcpExchange, verifyAcpExchange } from "../../src/settlement/acp/signing.js";
import { rawExchange, type SettlementError, seconds } from "../../src/settlement/adapter.js";
import { acpFixture, checkedOrder } from "./adapter-fixtures.js";

it("ACP Suite signs all requests and merchant responses, delegates allowance, redeems and lifts receipt", async () => {
  const f = await acpFixture();
  const { order, facts } = await checkedOrder(f);
  const receipt = await f.suite.settle(order, f.provider);
  expect(checkReceipt(f.suite.lift(receipt), facts, f.profile.provider.party).ok).toBe(true);
  expect(f.profile.ledger.entries).toHaveLength(1);
  expect(f.profile.ledger.balance(f.profile.payer.account, "usd")).toBe("1550.00");
  for (const object of [...order.objects, ...receipt.objects]) {
    if (object.form !== "HTTP exchange") continue;
    expect(object.raw).toMatchObject({
      headers: { Signature: expect.any(String), Timestamp: expect.any(String) },
    });
    const exchange = object.raw as { status?: number; headers: Record<string, string> };
    if (exchange.status === undefined) expect(exchange.headers["Idempotency-Key"]).toBeTruthy();
  }
  expect(rawExchange(order, "Delegate payment request").body).toMatchObject({
    payment_method: { type: "account" },
    allowance: { reason: "one_time", max_amount: 45000, currency: "usd" },
  });
});
it("ACP identical completion retries preserve exact response bytes and charge once", async () => {
  const f = await acpFixture();
  const { order } = await checkedOrder(f);
  const first = await f.suite.settle(order, f.provider);
  const second = await f.suite.settle(order, f.provider);
  expect(second).toEqual(first);
  expect(f.profile.ledger.entries).toHaveLength(1);
  expect(f.suite.lift(second).ledgerReference).toBe(f.suite.lift(first).ledgerReference);
});
it("acp-idempotency-conflict is 422 after a validly signed changed body and never charges twice", async () => {
  const f = await acpFixture();
  const { order } = await checkedOrder(f);
  await f.suite.settle(order, f.provider);
  const changed = structuredClone(order);
  const exchange = rawExchange(order, "Complete checkout request");
  const body = exchange.body as { payment_data: Record<string, unknown> };
  body.payment_data.billing_address = { line_one: "Different fictional address" };
  const signed = await signAcpExchange(exchange, f.options.agentKey.privateKey, seconds(f.profile));
  const object = changed.objects.find((o) => o.name === "Complete checkout request");
  if (!object) throw new Error("missing complete");
  object.raw = signed;
  const failure = await f.suite
    .settle(changed, f.provider)
    .catch((error: SettlementError) => error);
  expect(failure).toMatchObject({
    reason: "evidence-invalid",
    protocolCode: "idempotency_conflict",
    exchange: {
      status: 422,
      body: { type: "idempotency_conflict" },
      headers: { Signature: expect.any(String), Timestamp: expect.any(String) },
    },
  });
  if (!(failure instanceof Error) || !failure.exchange)
    throw new Error("Expected signed protocol refusal");
  await verifyAcpExchange(
    failure.exchange,
    (await importJWK(f.profile.merchant.identity.publicJwk, "EdDSA")) as CryptoKey,
    seconds(f.profile),
  );
  expect(f.profile.ledger.entries).toHaveLength(1);
});
it("ACP rejects unsigned merchant responses and agent requests as unsigned-not-allowed", async () => {
  const f = await acpFixture();
  const { request, order } = await checkedOrder(f);
  const unsignedRequest = structuredClone(request);
  const session = rawExchange(request, "Checkout session");
  delete session.headers.Signature;
  const sessionObject = unsignedRequest.objects.find((o) => o.name === "Checkout session");
  if (!sessionObject) throw new Error("missing session");
  sessionObject.raw = session;
  await expect(
    f.suite.admitRequest(unsignedRequest, f.due, { party: f.profile.merchant.party }),
  ).rejects.toMatchObject({ reason: "unsigned-not-allowed" });
  const unsignedOrder = structuredClone(order);
  const complete = rawExchange(order, "Complete checkout request");
  delete complete.headers.Signature;
  const object = unsignedOrder.objects.find((o) => o.name === "Complete checkout request");
  if (!object) throw new Error("missing complete");
  object.raw = complete;
  await expect(f.suite.settle(unsignedOrder, f.provider)).rejects.toMatchObject({
    reason: "unsigned-not-allowed",
  });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it("ACP rejects token substitution even with a new valid signature", async () => {
  const f = await acpFixture();
  const { order } = await checkedOrder(f);
  const changed = structuredClone(order);
  const exchange = rawExchange(order, "Complete checkout request");
  const body = exchange.body as { payment_data: { instrument: { credential: { token: string } } } };
  body.payment_data.instrument.credential.token = "vt_another";
  const object = changed.objects.find((o) => o.name === "Complete checkout request");
  if (!object) throw new Error("missing complete");
  object.raw = await signAcpExchange(exchange, f.options.agentKey.privateKey, seconds(f.profile));
  await expect(f.suite.settle(changed, f.provider)).rejects.toMatchObject({
    reason: "evidence-invalid",
  });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
