// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { checkPayment, checkReceipt } from "../../src/gates/payment.js";
import { rawExchange, SettlementError } from "../../src/settlement/adapter.js";
import { X402Suite } from "../../src/settlement/x402/index.js";
import {
  encodePaymentSignature,
  parsePaymentSignature,
} from "../../src/settlement/x402/objects.js";
import {
  agreement,
  checkedOrder,
  paymentFromInvoice,
  paymentRecord,
  x402Fixture,
} from "./adapter-fixtures.js";

it("x402 Suite runs request, all eight checks, signed authorization, ledger and authenticated receipt", async () => {
  const f = await x402Fixture();
  const { order, facts } = await checkedOrder(f);
  const result = await f.suite.settle(order, f.provider);
  expect(checkReceipt(f.suite.lift(result), facts, f.profile.provider.party).ok).toBe(true);
  expect(f.profile.ledger.entries).toHaveLength(1);
  expect(f.profile.ledger.balance(f.profile.payer.account, "USD")).toBe("1550.00");
  expect(f.admission.map((x) => x.step)).toContain("protocol-key");
  const trace = await f.suite.trace(result);
  expect(trace.objects.find((x) => x.name === "SettlementResponse")?.raw).toMatchObject({
    status: 200,
    headers: { "PAYMENT-RESPONSE": expect.any(String) },
  });
  expect(trace.from?.ledgerReference).toBe("SettlementResponse.transaction");
  expect(trace.facts).toBeTruthy();
});
it.each([
  ["fee-amount-differs", "P2", "amount-differs"],
  ["fee-no-offer", "P1", "no-agreement"],
])("x402 isolated %s remains the ordinary gate refusal", async (path, check, reason) => {
  const f = await x402Fixture();
  if (path === "fee-amount-differs") f.due.agreement = agreement("495.00");
  const request = await f.suite.request(f.due, { party: f.profile.merchant.party });
  const record = paymentRecord(f.profile);
  if (path === "fee-no-offer") record.agreement = undefined;
  const result = checkPayment(paymentFromInvoice(f.suite.lift(request), f.profile), record);
  expect(result.reason).toBe(reason);
  expect(result.verdicts.at(-1)?.check).toBe(check);
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it("x402-recipient-swapped retains the protocol code and engine reason before any debit", async () => {
  const f = await x402Fixture();
  const { order } = await checkedOrder(f);
  const exchange = rawExchange(order, "PaymentPayload");
  const payload = parsePaymentSignature(exchange.headers["PAYMENT-SIGNATURE"] ?? "");
  payload.accepted.payTo = "0x4444444444444444444444444444444444444444";
  exchange.headers["PAYMENT-SIGNATURE"] = encodePaymentSignature(payload);
  const changed = structuredClone(order);
  const object = changed.objects.find((o) => o.name === "PaymentPayload");
  if (!object) throw new Error("missing payload");
  object.raw = exchange;
  await expect(f.suite.settle(changed, f.provider)).rejects.toMatchObject({
    reason: "evidence-invalid",
    protocolCode: "invalid_exact_evm_payload_recipient_mismatch",
    exchange: { path: "/verify", body: { isValid: false } },
  });
  expect(() => f.suite.lift(changed)).toThrow(SettlementError);
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it("x402 requires an identity-signed settlement key and source admission", async () => {
  const f = await x402Fixture();
  const suite = new X402Suite({ ...f.options, keyStatement: undefined });
  await expect(checkedOrder({ ...f, suite })).rejects.toMatchObject({
    reason: "source-not-authoritative",
  });
  const refused = new X402Suite({
    ...f.options,
    admit: async () => {
      throw new SettlementError("source-not-authoritative");
    },
  });
  await expect(refused.request(f.due, { party: f.profile.merchant.party })).rejects.toMatchObject({
    reason: "source-not-authoritative",
  });
});
it("x402 cannot settle twice or lift caller-invented native facts", async () => {
  const f = await x402Fixture();
  const { order, facts } = await checkedOrder(f);
  await f.suite.settle(order, f.provider);
  await expect(f.suite.settle(order, f.provider)).rejects.toMatchObject({
    reason: "evidence-invalid",
  });
  expect(f.profile.ledger.entries).toHaveLength(1);
  expect(() => f.suite.lift({ suite: "x402", objects: [], native: { facts } })).toThrow(
    SettlementError,
  );
});
it("x402 lifts fresh dataset snapshots and pins shown as well as raw objects", async () => {
  const f = await x402Fixture();
  const { request } = await checkedOrder(f);
  const lifted = f.suite.lift(request);
  lifted.dataset.removeQuads([...lifted.dataset]);
  expect(lifted.dataset.size).toBe(0);
  expect(f.suite.lift(request).amount).toBe("450.00");
  const changed = structuredClone(request);
  const object = changed.objects[0];
  if (!object) throw new Error("missing request");
  object.shown = { unverified: true };
  expect(() => f.suite.lift(changed)).toThrow(SettlementError);
});
