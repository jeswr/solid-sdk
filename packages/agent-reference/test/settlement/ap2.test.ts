// AUTHORED-BY Codex GPT-6
import { type CryptoKey, exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, expect, it } from "vitest";
import {
  type Checkout,
  type ClosedPaymentMandate,
  checkoutHash,
  checkoutSchema,
  closedPaymentMandateSchema,
  convertAp2Amount,
  issueCheckoutMandate,
  issueOpenPaymentMandate,
  issuePaymentMandate,
  type OpenPaymentMandate,
  openPaymentMandateSchema,
  signCheckout,
  verifyCheckout,
} from "../../src/settlement/ap2/objects.js";
import {
  checkCheckoutMandate,
  checkOpenPaymentMandate,
  checkPaymentMandate,
} from "../../src/settlement/ap2/provider.js";
import { presentSdJwt } from "../../src/settlement/ap2/sdjwt.js";
import { now } from "./fixtures.js";

let merchant: { publicKey: CryptoKey; privateKey: CryptoKey };
let person: typeof merchant;
let agent: typeof merchant;
let agentJwk: JWK;
beforeAll(async () => {
  merchant = await generateKeyPair("ES256");
  person = await generateKeyPair("ES256");
  agent = await generateKeyPair("ES256", { extractable: true });
  agentJwk = await exportJWK(agent.publicKey);
});
const checkout: Checkout = {
  order_id: "order-1",
  merchant: { id: "valuer", name: "Fictional Valuer", website: "https://valuer.example" },
  line_items: [
    {
      id: "valuation",
      product: { id: "booking", title: "Valuation booking", price: "1.25", currency: "USD" },
      quantity: 1,
    },
  ],
  total_price: "1.25",
  currency: "USD",
};
const binding = { audience: "credential-provider", nonce: "payment-once", issuedAt: now };
const options = () => ({
  issuerKey: person.publicKey,
  audience: "credential-provider",
  nonce: "payment-once",
  now,
});
async function fixture() {
  const checkoutJwt = await signCheckout(checkout, merchant.privateKey);
  const mandate: ClosedPaymentMandate = {
    vct: "mandate.payment.1",
    transaction_id: checkoutHash(checkoutJwt),
    payee: structuredClone(checkout.merchant),
    payment_amount: { amount: 125, currency: "USD" },
    payment_instrument: {
      id: "provider-account",
      type: "account",
      description: "Fictional provider",
    },
  };
  const issued = await issuePaymentMandate(mandate, person.privateKey, agentJwk);
  return {
    checkoutJwt,
    mandate,
    issued,
    presentation: await presentSdJwt(issued, agent.privateKey, binding),
  };
}
it("signs merchant checkout and verifies both closed mandate forms", async () => {
  const { checkoutJwt, mandate, presentation } = await fixture();
  expect(await verifyCheckout(checkoutJwt, merchant.publicKey, now)).toEqual(checkout);
  expect(
    await checkPaymentMandate(presentation, checkoutJwt, merchant.publicKey, 2, options()),
  ).toEqual(mandate);
  const issued = await issueCheckoutMandate(checkoutJwt, person.privateKey, agentJwk);
  const closedCheckout = await presentSdJwt(issued, agent.privateKey, {
    ...binding,
    audience: "merchant",
  });
  expect(
    await checkCheckoutMandate(closedCheckout, checkoutJwt, merchant.publicKey, {
      ...options(),
      audience: "merchant",
    }),
  ).toEqual({ vct: "mandate.checkout.1", checkout_hash: checkoutHash(checkoutJwt) });
});
it("refuses a legitimately signed payment mandate for another checkout", async () => {
  const { checkoutJwt, mandate } = await fixture();
  const wrong = await issuePaymentMandate(
    { ...mandate, transaction_id: "a".repeat(43) },
    person.privateKey,
    agentJwk,
  );
  await expect(
    checkPaymentMandate(
      await presentSdJwt(wrong, agent.privateKey, binding),
      checkoutJwt,
      merchant.publicKey,
      2,
      options(),
    ),
  ).rejects.toMatchObject({ code: "terms-digest-mismatch" });
});
it("refuses a checkout mandate for another merchant checkout", async () => {
  const { checkoutJwt } = await fixture();
  const another = await signCheckout({ ...checkout, order_id: "order-2" }, merchant.privateKey);
  const issued = await issueCheckoutMandate(another, person.privateKey, agentJwk);
  await expect(
    checkCheckoutMandate(
      await presentSdJwt(issued, agent.privateKey, binding),
      checkoutJwt,
      merchant.publicKey,
      options(),
    ),
  ).rejects.toMatchObject({ code: "terms-digest-mismatch" });
});
it.each([
  "payee",
  "currency",
  "amount",
])("refuses a signed %s mismatch against merchant checkout", async (field) => {
  const { checkoutJwt, mandate } = await fixture();
  if (field === "payee") mandate.payee.id = "someone-else";
  if (field === "currency") mandate.payment_amount.currency = "GBP";
  if (field === "amount") mandate.payment_amount.amount = 124;
  const issued = await issuePaymentMandate(mandate, person.privateKey, agentJwk);
  await expect(
    checkPaymentMandate(
      await presentSdJwt(issued, agent.privateKey, binding),
      checkoutJwt,
      merchant.publicKey,
      2,
      options(),
    ),
  ).rejects.toMatchObject({ code: "invalid-payment-mandate" });
});
it("refuses a tampered checkout and a wrong merchant verification key", async () => {
  const { checkoutJwt, presentation } = await fixture();
  const parts = checkoutJwt.split(".");
  parts[1] = Buffer.from(JSON.stringify({ ...checkout, total_price: "0.01" })).toString(
    "base64url",
  );
  await expect(
    checkPaymentMandate(presentation, parts.join("."), merchant.publicKey, 2, options()),
  ).rejects.toThrow();
  await expect(
    checkPaymentMandate(presentation, checkoutJwt, person.publicKey, 2, options()),
  ).rejects.toThrow();
});
async function openFixture() {
  const { mandate } = await fixture();
  const open: OpenPaymentMandate = {
    vct: "mandate.payment.open.1",
    constraints: [
      { type: "payment.amount_range", currency: "USD", min: 100, max: 200 },
      { type: "payment.allowed_payees", payees: ["valuer"] },
    ],
    cnf: { jwk: agentJwk as OpenPaymentMandate["cnf"]["jwk"] },
    iat: now,
    exp: now + 300,
  };
  return { mandate, open };
}
it("issues the person's open mandate to the agent key and checks amount/payee constraints", async () => {
  const { mandate, open } = await openFixture();
  const issued = await issueOpenPaymentMandate(open, person.privateKey);
  const presentation = await presentSdJwt(issued, agent.privateKey, binding);
  expect(await checkOpenPaymentMandate(presentation, mandate, options())).toEqual(open);
});
it("refuses malformed proposed payment amounts before applying open constraints", async () => {
  const { mandate, open } = await openFixture();
  const issued = await issueOpenPaymentMandate(open, person.privateKey);
  const presentation = await presentSdJwt(issued, agent.privateKey, binding);
  await expect(
    checkOpenPaymentMandate(
      presentation,
      { ...mandate, payment_amount: { amount: NaN, currency: "USD" } },
      options(),
    ),
  ).rejects.toThrow();
});
it.each([
  "high",
  "low",
  "currency",
  "payee",
  "no-payees",
  "no-range",
  "future",
])("refuses open mandate violation %s", async (attack) => {
  const { mandate, open } = await openFixture();
  if (attack === "high") mandate.payment_amount.amount = 201;
  if (attack === "low") mandate.payment_amount.amount = 99;
  if (attack === "currency") mandate.payment_amount.currency = "GBP";
  if (attack === "payee") mandate.payee.id = "someone-else";
  if (attack === "no-payees")
    open.constraints = open.constraints.filter((c) => c.type !== "payment.allowed_payees");
  if (attack === "no-range")
    open.constraints = open.constraints.filter((c) => c.type !== "payment.amount_range");
  if (attack === "future") {
    open.iat = now + 1;
    open.exp = now + 301;
  }
  const issued = await issueOpenPaymentMandate(open, person.privateKey);
  await expect(
    checkOpenPaymentMandate(
      await presentSdJwt(issued, agent.privateKey, binding),
      mandate,
      options(),
    ),
  ).rejects.toMatchObject({ code: "open-mandate-exceeded" });
});
it("refuses expired/open-ended mandates and unknown constraints instead of widening them", async () => {
  const { mandate, open } = await openFixture();
  expect(() => openPaymentMandateSchema.parse({ ...open, exp: now + 901 })).toThrow();
  expect(() => openPaymentMandateSchema.parse({ ...open, exp: now })).toThrow();
  expect(() =>
    openPaymentMandateSchema.parse({
      ...open,
      constraints: [{ type: "payment.budget", amount: 1000 }],
    }),
  ).toThrow();
  expect(() =>
    openPaymentMandateSchema.parse({
      ...open,
      constraints: [{ type: "payment.amount_range", currency: "USD", min: 200, max: 100 }],
    }),
  ).toThrow();
  const expired = await issueOpenPaymentMandate(
    { ...open, iat: now - 300, exp: now },
    person.privateKey,
  );
  await expect(
    checkOpenPaymentMandate(
      await presentSdJwt(expired, agent.privateKey, binding),
      mandate,
      options(),
    ),
  ).rejects.toThrow();
});
it("uses strict research claim names and refuses unsafe integer payment amounts", async () => {
  const { mandate } = await fixture();
  for (const change of [
    { payment_amount: { amount: 1.25, currency: "USD" } },
    { payment_amount: { amount: Number.MAX_SAFE_INTEGER + 1, currency: "USD" } },
    { payment_amount: { amount: 0, currency: "USD" } },
    { vct: "mandate.cart.1" },
    { unexpected: true },
  ])
    expect(() => closedPaymentMandateSchema.parse({ ...mandate, ...change })).toThrow();
  expect(() => checkoutSchema.parse({ ...checkout, total_price: 125 })).toThrow();
  expect(() => checkoutSchema.parse({ ...checkout, line_items: [] })).toThrow();
});
it("converts AP2 integer payment units explicitly, including a zero-minor-unit currency", () => {
  expect(convertAp2Amount({ amount: "1.25", currency: "USD" }, 2)).toEqual({
    units: "125",
    currency: "USD",
  });
  expect(convertAp2Amount({ units: "125", currency: "USD" }, 2)).toEqual({
    amount: "1.25",
    currency: "USD",
  });
  expect(convertAp2Amount({ amount: "500", currency: "JPY" }, 0)).toEqual({
    units: "500",
    currency: "JPY",
  });
  expect(convertAp2Amount({ units: "500", currency: "JPY" }, 0)).toEqual({
    amount: "500",
    currency: "JPY",
  });
});
