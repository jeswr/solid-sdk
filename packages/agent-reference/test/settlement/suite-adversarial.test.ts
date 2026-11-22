// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { paymentDigest } from "../../src/gates/payment.js";
import { generateSigningKey } from "../../src/mechanisms/jws.js";
import { PaymentFacts } from "../../src/model/payment.js";
import { rawExchange } from "../../src/settlement/adapter.js";
import { signAuthorization } from "../../src/settlement/eip3009.js";
import { buildCredential, parseCredential } from "../../src/settlement/mpp/objects.js";
import { requirementsDomain } from "../../src/settlement/x402/facilitator.js";
import {
  encodePaymentSignature,
  parsePaymentSignature,
} from "../../src/settlement/x402/objects.js";
import {
  acpFixture,
  ap2Fixture,
  checkedOrder,
  mppFixture,
  paymentFromInvoice,
  x402Fixture,
} from "./adapter-fixtures.js";
import { domain, secretKey } from "./fixtures.js";

const factories = [
  ["x402", x402Fixture],
  ["mpp", mppFixture],
  ["ap2", ap2Fixture],
  ["acp", acpFixture],
] as const;
it.each(
  factories,
)("%s refuses forged check digests, wrong payer and facts differing from the native request", async (_id, factory) => {
  const f = await factory();
  const request = await f.suite.request(f.due, { party: f.profile.merchant.party });
  const facts = paymentFromInvoice(f.suite.lift(request), f.profile);
  await expect(
    f.suite.order({ facts, digest: "forged" }, { party: f.profile.payer.party }),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
  await expect(
    f.suite.order({ facts, digest: paymentDigest(facts) }, { party: "urn:another-payer" }),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
  const changed = PaymentFacts.create({ ...facts.data(), amount: "495.00" });
  await expect(
    f.suite.order(
      { facts: changed, digest: paymentDigest(changed) },
      { party: f.profile.payer.party },
    ),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it.each(
  factories,
)("%s rechecks expiry after asynchronous source admission before releasing an order", async (_id, factory) => {
  const f = await factory();
  const request = await f.suite.request(f.due, { party: f.profile.merchant.party });
  const original = paymentFromInvoice(f.suite.lift(request), f.profile);
  const facts = PaymentFacts.create({ ...original.data(), validUntil: "2026-11-13T09:01:00.000Z" });
  const admit = f.options.admit;
  f.options.admit = async (source, step, objects) => {
    await admit(source, step, objects);
    if (step === "payment") f.options.now = () => "2026-11-13T09:02:00.000Z";
  };
  await expect(
    f.suite.order({ facts, digest: paymentDigest(facts) }, { party: f.profile.payer.party }),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it.each(
  factories,
)("%s refuses cross-suite input and unbound provider context before an effect", async (_id, factory) => {
  const f = await factory();
  const { order } = await checkedOrder(f);
  await expect(
    f.suite.settle({ ...order, suite: "some-other-suite" }, f.provider),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
  await expect(
    f.suite.settle(order, { ...f.provider, payerAccount: "urn:another-account" }),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it.each(
  factories,
)("%s has no authority in native metadata and returns independent fact datasets", async (_id, factory) => {
  const f = await factory();
  const { order, facts } = await checkedOrder(f);
  expect(() => f.suite.lift({ suite: f.suite.id, objects: [], native: { facts } })).toThrow(
    "evidence-invalid",
  );
  const lifted = f.suite.lift(order);
  lifted.dataset.removeQuads([...lifted.dataset]);
  expect(lifted.dataset.size).toBe(0);
  expect(f.suite.lift(order).amount).toBe("450.00");
  const document = await f.suite.trace(order);
  for (const field of Object.keys(facts.data())) expect(document.from?.[field], field).toBeTruthy();
  const raw = JSON.stringify(document.objects);
  expect(raw).not.toContain('"privateKey"');
  expect(raw).not.toContain('"d":');
});
it.each(
  factories,
)("%s refuses changed raw order evidence as evidence-invalid", async (id, factory) => {
  const f = await factory();
  const { order } = await checkedOrder(f);
  const changed = structuredClone(order);
  const name = {
    x402: "PaymentPayload",
    mpp: "Credential",
    ap2: "Payment Mandate",
    acp: "Complete checkout request",
  }[id];
  const object = changed.objects.find((o) => o.name === name);
  if (!object) throw new Error("missing native order");
  if (id === "ap2") object.raw = "malformed.SD-JWT";
  else {
    const exchange = rawExchange(order, name);
    exchange.headers = {};
    object.raw = exchange;
  }
  await expect(f.suite.settle(changed, f.provider)).rejects.toMatchObject({
    reason: id === "acp" ? "unsigned-not-allowed" : "evidence-invalid",
  });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it("MPP cannot issue a different challenge-backed instruction for an already ordered once-key", async () => {
  const f = await mppFixture();
  await checkedOrder(f);
  const second = await f.suite.request(
    { ...f.due, invoice: "urn:invoice:another-reference" },
    { party: f.profile.merchant.party },
  );
  const facts = paymentFromInvoice(f.suite.lift(second), f.profile);
  await expect(
    f.suite.order({ facts, digest: paymentDigest(facts) }, { party: f.profile.payer.party }),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it.each(
  factories,
)("%s preserves zero-decimal JPY across native units, lifted facts and ledger", async (id, factory) => {
  const f = await factory("JPY", 0);
  const { order, facts } = await checkedOrder(f);
  expect(facts.currency).toBe("JPY");
  expect(Number(facts.amount)).toBe(450);
  const result = await f.suite.settle(order, f.provider);
  expect(Number(f.suite.lift(result).amount)).toBe(450);
  expect(f.profile.ledger.entries).toHaveLength(1);
  expect(f.profile.ledger.entries[0]?.currency).toBe(id === "acp" ? "jpy" : "JPY");
  expect(f.profile.ledger.balance(f.profile.payer.account, id === "acp" ? "jpy" : "JPY")).toBe(
    "1550",
  );
});
it.each([
  ["x402", x402Fixture],
  ["mpp", mppFixture],
  ["acp", acpFixture],
] as const)("%s refuses a misbound provider signing handle before debiting", async (_id, factory) => {
  const f = await factory();
  const { order } = await checkedOrder(f);
  const wrong = await generateSigningKey();
  f.profile.provider.signingKey = {
    ...f.profile.provider.signingKey,
    privateKey: wrong.key.privateKey,
  };
  await expect(f.suite.settle(order, f.provider)).rejects.toMatchObject({
    reason: "evidence-invalid",
  });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it.each([
  ["x402", x402Fixture],
  ["mpp", mppFixture],
] as const)("%s rejects a validly signed authorization whose expiry exceeds the approved order", async (id, factory) => {
  const f = await factory();
  const request = await f.suite.request(f.due, { party: f.profile.merchant.party });
  const original = paymentFromInvoice(f.suite.lift(request), f.profile);
  const facts = PaymentFacts.create({ ...original.data(), validUntil: "2026-11-13T09:04:00.000Z" });
  const order = await f.suite.order(
    { facts, digest: paymentDigest(facts) },
    { party: f.profile.payer.party },
  );
  const name = id === "x402" ? "PaymentPayload" : "Credential";
  const exchange = rawExchange(order, name);
  if (id === "x402") {
    const payload = parsePaymentSignature(exchange.headers["PAYMENT-SIGNATURE"] ?? "");
    payload.payload.authorization.validBefore = String(
      BigInt(payload.payload.authorization.validBefore) + 1n,
    );
    payload.payload.signature = signAuthorization(
      requirementsDomain(payload.accepted),
      payload.payload.authorization,
      secretKey,
    );
    exchange.headers["PAYMENT-SIGNATURE"] = encodePaymentSignature(payload);
  } else {
    const credential = parseCredential(exchange.headers.Authorization ?? "");
    credential.payload.validBefore = String(BigInt(credential.payload.validBefore) + 1n);
    const { type: _type, signature: _signature, ...auth } = credential.payload;
    credential.payload.signature = signAuthorization(domain, auth, secretKey);
    exchange.headers.Authorization = buildCredential(credential);
  }
  const changed = structuredClone(order);
  const entry = changed.objects.find((o) => o.name === name);
  if (!entry) throw new Error("missing native order");
  entry.raw = exchange;
  await expect(f.suite.settle(changed, f.provider)).rejects.toMatchObject({
    reason: "evidence-invalid",
  });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it("AP2 refuses a misbound processor signing handle before debiting", async () => {
  const f = await ap2Fixture();
  const { order } = await checkedOrder(f);
  const wrong = await generateSigningKey("ES256");
  f.options.processor.key = { ...f.options.processor.key, privateKey: wrong.key.privateKey };
  await expect(f.suite.settle(order, f.provider)).rejects.toMatchObject({
    reason: "evidence-invalid",
  });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
it.each([
  ["x402", x402Fixture],
  ["mpp", mppFixture],
] as const)("%s rejects an approved expiry that EIP-3009 seconds cannot represent exactly", async (_id, factory) => {
  const f = await factory();
  const request = await f.suite.request(f.due, { party: f.profile.merchant.party });
  const original = paymentFromInvoice(f.suite.lift(request), f.profile);
  const facts = PaymentFacts.create({ ...original.data(), validUntil: "2026-11-13T09:04:59.123Z" });
  await expect(
    f.suite.order({ facts, digest: paymentDigest(facts) }, { party: f.profile.payer.party }),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
  expect(f.profile.ledger.entries).toHaveLength(0);
});
