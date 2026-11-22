// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { checkReceipt } from "../../src/gates/payment.js";
import { rawToken, seconds } from "../../src/settlement/adapter.js";
import { Ap2Suite } from "../../src/settlement/ap2/index.js";
import { issuePaymentMandate } from "../../src/settlement/ap2/objects.js";
import { presentSdJwt } from "../../src/settlement/ap2/sdjwt.js";
import { ap2Fixture, checkedOrder } from "./adapter-fixtures.js";

it("AP2 Suite signs checkout and holder-bound mandates, then lifts two independently signed receipts", async () => {
  const f = await ap2Fixture();
  const { order, facts } = await checkedOrder(f);
  const result = await f.suite.settle(order, f.provider);
  const receipt = f.suite.lift(result);
  expect(checkReceipt(receipt, facts, f.options.processor.party).ok).toBe(true);
  expect(receipt.provider).not.toBe(f.profile.provider.party);
  expect(f.profile.ledger.entries).toHaveLength(1);
  const trace = await f.suite.trace(order);
  expect(trace.objects.find((o) => o.name === "Payment Mandate")?.shown).toMatchObject({
    issuer: { header: { alg: "ES256" } },
    keyBinding: { header: { typ: "kb+sd-jwt" }, payload: { aud: "credential-provider" } },
  });
  expect(trace.from?.amount).toBe("Payment Mandate.payment_amount.amount");
  expect(result.objects.map((o) => o.name)).toEqual([
    "SettlementKey (processor)",
    "SettlementKey (merchant)",
    "Payment Receipt",
    "Checkout Receipt",
  ]);
});
it("ap2-mandate-for-another-checkout is refused after a valid person signature, with terms-digest-mismatch", async () => {
  const f = await ap2Fixture();
  const { order, facts } = await checkedOrder(f);
  const key = f.options.personKey.key;
  const payment = await presentSdJwt(
    await issuePaymentMandate(
      {
        vct: "mandate.payment.1",
        transaction_id: "A".repeat(43),
        payee: {
          id: f.profile.merchant.party,
          name: "Bracken Lantern Valuations",
          website: "https://valuer.example/",
        },
        payment_amount: { amount: 45000, currency: "USD" },
        payment_instrument: {
          id: f.profile.payer.account,
          type: "account",
          description: "Fictional provider account",
        },
      },
      key.privateKey,
      key.publicJwk,
    ),
    key.privateKey,
    { audience: "credential-provider", nonce: facts.onceKey ?? "", issuedAt: seconds(f.profile) },
  );
  const changed = structuredClone(order);
  const mandate = changed.objects.find((o) => o.name === "Payment Mandate");
  if (!mandate) throw new Error("missing payment mandate");
  mandate.raw = payment;
  await expect(f.suite.settle(changed, f.provider)).rejects.toMatchObject({
    reason: "terms-digest-mismatch",
    protocolCode: "terms-digest-mismatch",
  });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it("AP2 refuses missing person/processor key statements and never treats identity Ed25519 as ES256", async () => {
  const f = await ap2Fixture();
  const suite = new Ap2Suite({
    ...f.options,
    personKey: { ...f.options.personKey, statement: undefined },
  });
  await expect(checkedOrder({ ...f, suite })).rejects.toMatchObject({
    reason: "source-not-authoritative",
  });
  const processorMissing = new Ap2Suite({
    ...f.options,
    processor: { ...f.options.processor, statement: undefined },
  });
  const { order } = await checkedOrder({ ...f, suite: processorMissing });
  await expect(processorMissing.settle(order, f.provider)).rejects.toMatchObject({
    reason: "source-not-authoritative",
  });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it("AP2 rejects a tampered disclosure before a ledger effect and does not lift a changed receipt", async () => {
  const f = await ap2Fixture();
  const { order } = await checkedOrder(f);
  const changed = structuredClone(order);
  const mandate = changed.objects.find((o) => o.name === "Payment Mandate");
  if (!mandate) throw new Error("missing payment mandate");
  const parts = rawToken(order, "Payment Mandate").split("~");
  parts[1] = Buffer.from(
    JSON.stringify(["tampered-disclosure-salt", "transaction_id", "B".repeat(43)]),
  ).toString("base64url");
  mandate.raw = parts.join("~");
  await expect(f.suite.settle(changed, f.provider)).rejects.toMatchObject({
    reason: "evidence-invalid",
  });
  expect(f.profile.ledger.entries).toHaveLength(0);
  const receipt = await f.suite.settle(order, f.provider);
  const first = receipt.objects.find((o) => o.name === "Payment Receipt");
  if (!first) throw new Error("missing receipt");
  first.raw = `${String(first.raw).slice(0, -8)}AAAAAAAA`;
  expect(() => f.suite.lift(receipt)).toThrow("evidence-invalid");
});
it("AP2 serial and concurrent replay settles only once", async () => {
  const f = await ap2Fixture();
  const { order } = await checkedOrder(f);
  const results = await Promise.allSettled([
    f.suite.settle(order, f.provider),
    f.suite.settle(order, f.provider),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.profile.ledger.entries).toHaveLength(1);
  await expect(f.suite.settle(order, f.provider)).rejects.toMatchObject({
    reason: "evidence-invalid",
  });
});
