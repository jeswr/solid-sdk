// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  checkPayment,
  checkReceipt,
  type PaymentRecord,
  paymentDigest,
} from "../../src/gates/payment.js";
import {
  PaymentAccountNode,
  PaymentAgreementNode,
  type PaymentData,
  PaymentFacts,
  paymentOnceKey,
} from "../../src/model/payment.js";
import { Ledger } from "../../src/settlement/ledger.js";
import { RdfOrderSuite } from "../../src/settlement/rdf-order.js";
import { readPaymentObjects } from "../../src/wire/payment.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing payment fixture value");
  return value;
}

const now = "2026-11-13T09:00:00.000Z";
function fixture(change: Partial<PaymentData> = {}) {
  const agreement = PaymentAgreementNode.create({
    digest: "sha-256:terms",
    service: "Home valuation",
    payee: "urn:valuer",
    amount: "450.00",
    currency: "USD",
    validFrom: now,
    validUntil: "2026-11-20T09:00:00.000Z",
    offerProof: "verified-offer",
    acceptanceProof: "verified-acceptance",
  });
  const facts = PaymentFacts.create({
    id: "urn:order",
    agreement: "sha-256:terms",
    payer: "urn:sam",
    payee: "urn:valuer",
    account: "urn:account:valuer",
    amount: "450.00",
    currency: "USD",
    invoice: "urn:invoice",
    instalment: 1,
    onceKey: paymentOnceKey("sha-256:terms", 1),
    validUntil: "2026-11-13T09:05:00.000Z",
    ...change,
  });
  const record: PaymentRecord = {
    now,
    payer: "urn:sam",
    agreement,
    proofsVerified: true,
    inEffect: true,
    protocolScoped: true,
    binding: () => undefined,
    mandate: () => ({}),
    approval: () => "approved",
    ordered: () => false,
  };
  return { facts, record, agreement };
}
describe("one payment check over live RDF", () => {
  it("passes every ordered check and binds the exact order", () => {
    const f = fixture();
    const result = checkPayment(f.facts, f.record);
    expect(result.ok).toBe(true);
    expect(result.digest).toBe(paymentDigest(f.facts));
    expect([...new Set(result.verdicts.map((v) => v.check))]).toEqual([
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "P6",
      "P7",
      "P8",
    ]);
  });
  it.each([
    ["P1", "no-agreement", { agreement: undefined }],
    ["P1", "no-agreement", { proofsVerified: false }],
    ["P1", "no-agreement", { inEffect: false }],
    ["P1", "expired", { now: "2026-11-21T09:00:00.000Z" }],
    ["P4", "source-not-authoritative", { binding: () => "source-not-authoritative" }],
    ["P5", "not-authorised", { mandate: () => ({ reason: "not-authorised" }) }],
    ["P5", "limit-exceeded", { mandate: () => ({ reason: "limit-exceeded" }) }],
    ["P6", "approval-required", { approval: (): "required" => "required" }],
    ["P6", "approval-denied", { approval: (): "denied" => "denied" }],
    ["P7", "replay-conflict", { ordered: () => true }],
    ["P8", "protocol-violation", { protocolScoped: false }],
  ] as const)("%s independently refuses %s", (check, reason, change) => {
    const f = fixture();
    Object.assign(f.record, change);
    const result = checkPayment(f.facts, f.record);
    expect(result).toMatchObject({ ok: false, reason });
    expect(result.verdicts.at(-1)?.check).toBe(check);
  });
  it.each([
    ["P2", "amount-differs", { amount: "495.00" }],
    ["P2", "amount-differs", { currency: "GBP" }],
    ["P3", "payee-differs", { payee: "urn:other" }],
    ["P7", "replay-conflict", { onceKey: "arbitrary" }],
    ["P7", "replay-conflict", { instalment: 2, onceKey: paymentOnceKey("sha-256:terms", 2) }],
    ["P8", "protocol-violation", { payer: "urn:other" }],
    ["P8", "protocol-violation", { validUntil: now }],
  ])("%s independently reads changed order fields", (check, reason, change) => {
    const f = fixture(change as Partial<PaymentData>);
    const result = checkPayment(f.facts, f.record);
    expect(result).toMatchObject({ ok: false, reason });
    expect(result.verdicts.at(-1)?.check).toBe(check);
  });
  it("P3 rejects an invoice account bound to someone else even when its claimed payee matches", () => {
    const f = fixture();
    f.record.accountBindings = [PaymentAccountNode.create("urn:other", "urn:account:valuer")];
    expect(checkPayment(f.facts, f.record).reason).toBe("payee-differs");
  });
  it("does not cache the compensation amount", () => {
    const f = fixture();
    const changed = fixture({ amount: "495" });
    expect(checkPayment(changed.facts, f.record).reason).toBe("amount-differs");
    expect(checkPayment(f.facts, f.record).ok).toBe(true);
    required(f.agreement.duty?.constraint).initialise({
      digest: "sha-256:terms",
      service: "Home valuation",
      payee: "urn:valuer",
      amount: "495.00",
      currency: "USD",
      validFrom: now,
      validUntil: "2026-11-20T09:00:00.000Z",
      offerProof: "verified-offer",
      acceptanceProof: "verified-acceptance",
    });
    expect(checkPayment(f.facts, f.record).reason).toBe("amount-differs");
    expect(checkPayment(changed.facts, f.record).ok).toBe(true);
  });
  it("refuses each mismatched receipt field", () => {
    const f = fixture();
    const receipt = PaymentFacts.receipt(f.facts, "urn:provider", "entry");
    expect(checkReceipt(receipt, f.facts, "urn:provider").ok).toBe(true);
    for (const changed of [
      { agreement: "other" },
      { payee: "urn:other" },
      { amount: "495.00" },
      { currency: "GBP" },
      { id: "urn:other-order" },
    ]) {
      const other = fixture(changed).facts;
      expect(
        checkReceipt(PaymentFacts.receipt(other, "urn:provider", "entry"), f.facts, "urn:provider")
          .reason,
      ).toBe("receipt-mismatch");
    }
    expect(checkReceipt(receipt, f.facts, "urn:other-provider").reason).toBe("receipt-mismatch");
  });
});
it("rdf-order writes and re-admits the same graph and settles the existing ledger once", async () => {
  const f = fixture(),
    suite = new RdfOrderSuite(),
    ledger = new Ledger();
  ledger.createAccount("urn:account:sam", { USD: "1000" });
  ledger.createAccount("urn:account:valuer");
  const objects = await suite.order(
    { facts: f.facts, digest: paymentDigest(f.facts) },
    { party: "urn:sam" },
  );
  const admitted = await readPaymentObjects(objects.objects[0]?.shown);
  expect(suite.lift(admitted).amount).toBe("450.00");
  const provider = { party: "urn:provider", payerAccount: "urn:account:sam", ledger, now };
  const result = suite.lift(await suite.settle(admitted, provider));
  expect(checkReceipt(result, f.facts, "urn:provider").ok).toBe(true);
  expect(ledger.balance("urn:account:sam", "USD")).toBe("550.00");
  await expect(suite.settle(admitted, provider)).rejects.toThrow("nonce_reused");
  expect(ledger.entries).toHaveLength(1);
});
it("rdf-order refuses changed native objects and stale checked digests", async () => {
  const f = fixture(),
    suite = new RdfOrderSuite();
  const objects = await suite.order(
    { facts: f.facts, digest: paymentDigest(f.facts) },
    { party: "urn:sam" },
  );
  (required(objects.objects[0]).shown as Record<string, unknown>).price = "495.00";
  expect(() => suite.lift(objects)).toThrow("changed");
  await expect(
    suite.order(
      { facts: fixture({ amount: "495.00" }).facts, digest: paymentDigest(f.facts) },
      { party: "urn:sam" },
    ),
  ).rejects.toThrow("differs");
});
it("rdf-order keeps zero-minor-unit JPY as decimal money without converting it", async () => {
  const f = fixture({ amount: "450", currency: "JPY" }),
    suite = new RdfOrderSuite();
  const objects = await suite.order(
    { facts: f.facts, digest: paymentDigest(f.facts) },
    { party: "urn:sam" },
  );
  expect(suite.lift(await readPaymentObjects(objects.objects[0]?.shown)).amount).toBe("450");
});
