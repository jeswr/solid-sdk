// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { recoverAuthorization, signAuthorization } from "../../src/settlement/eip3009.js";
import { base64, base64url, decodeBase64, header } from "../../src/settlement/http.js";
import { Ledger, LedgerError } from "../../src/settlement/ledger.js";
import { requirementsDomain, X402Facilitator } from "../../src/settlement/x402/facilitator.js";
import {
  convertX402Amount,
  encodePaymentRequired,
  encodePaymentResponse,
  encodePaymentSignature,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  parsePaymentRequired,
  parsePaymentResponse,
  parsePaymentSignature,
  paymentRequiredExchange,
} from "../../src/settlement/x402/objects.js";
import { authorization, domain, now, payee, payer, secretKey } from "./fixtures.js";

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "1250000",
  asset: domain.verifyingContract,
  payTo: payee,
  maxTimeoutSeconds: 300,
  extra: { name: domain.name, version: domain.version },
};
const required: PaymentRequired = {
  x402Version: 2,
  resource: { url: "https://valuer.example/booking" },
  accepts: [requirements],
};
function setup(balance = "10.00") {
  const ledger = new Ledger();
  ledger.createAccount(payer, { USD: balance });
  ledger.createAccount(payee);
  const auth = { ...authorization, validBefore: String(now + 300) };
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: structuredClone(requirements),
    payload: { authorization: auth, signature: signAuthorization(domain, auth, secretKey) },
  };
  return { ledger, payload, facilitator: new X402Facilitator(ledger, requirements, "USD", 6) };
}
it("round trips all three x402 v2 base64 JSON headers and produces a 402 exchange", () => {
  const { payload, facilitator } = setup();
  expect(parsePaymentRequired(encodePaymentRequired(required))).toEqual(required);
  expect(parsePaymentSignature(encodePaymentSignature(payload))).toEqual(payload);
  const response = facilitator.settle(payload, now);
  expect(parsePaymentResponse(encodePaymentResponse(response))).toEqual(response);
  expect(JSON.parse(Buffer.from(decodeBase64(encodePaymentRequired(required))).toString())).toEqual(
    required,
  );
  const exchange = paymentRequiredExchange("GET", "/booking", required);
  expect(exchange.status).toBe(402);
  expect(parsePaymentRequired(header(exchange.headers, "payment-required") as string)).toEqual(
    required,
  );
});
it("verifies without consuming the nonce, then settles once with the entry digest as transaction", () => {
  const { ledger, payload, facilitator } = setup();
  expect(requirementsDomain(requirements)).toEqual(domain);
  expect(facilitator.verify(payload, now)).toEqual({ isValid: true, payer });
  expect(facilitator.verify(payload, now)).toEqual({ isValid: true, payer });
  expect(ledger.entries).toHaveLength(0);
  const settled = facilitator.settle(payload, now);
  expect(settled).toEqual({
    success: true,
    payer,
    network: requirements.network,
    transaction: ledger.entries[0]?.digest,
  });
  expect(ledger.balance(payer, "USD")).toBe("8.750000");
  expect(ledger.balance(payee, "USD")).toBe("1.250000");
  expect(facilitator.verify(payload, now)).toMatchObject({
    isValid: false,
    invalidReason: "invalid_payload",
  });
  expect(facilitator.settle(payload, now)).toMatchObject({
    success: false,
    errorReason: "invalid_payload",
  });
  expect(ledger.entries).toHaveLength(1);
});
it.each([
  "accepted",
  "authorization",
  "both",
])("refuses swapped %s recipient with the source's exact code", (target) => {
  const { ledger, payload, facilitator } = setup();
  const changed = "0x4444444444444444444444444444444444444444";
  if (target !== "authorization") payload.accepted.payTo = changed;
  if (target !== "accepted") payload.payload.authorization.to = changed;
  expect(facilitator.settle(payload, now)).toMatchObject({
    success: false,
    errorReason: "invalid_exact_evm_payload_recipient_mismatch",
  });
  expect(ledger.entries).toHaveLength(0);
});
it.each(["accepted", "authorization", "both"])("refuses changed %s amount", (target) => {
  const { ledger, payload, facilitator } = setup();
  if (target !== "authorization") payload.accepted.amount = "1250001";
  if (target !== "accepted") payload.payload.authorization.value = "1250001";
  expect(facilitator.settle(payload, now)).toMatchObject({
    success: false,
    errorReason: "invalid_exact_evm_payload_authorization_value_mismatch",
  });
  expect(ledger.entries).toHaveLength(0);
});
it("refuses insufficient funds without consuming state", () => {
  const { ledger, payload, facilitator } = setup("1.00");
  expect(facilitator.verify(payload, now)).toMatchObject({
    isValid: false,
    invalidReason: "insufficient_funds",
  });
  expect(facilitator.settle(payload, now)).toMatchObject({
    success: false,
    errorReason: "insufficient_funds",
  });
  expect(ledger.balance(payer, "USD")).toBe("1.00");
  expect(ledger.entries).toHaveLength(0);
});
it("preserves insufficient_funds when the ledger refuses after verification", () => {
  const { ledger, payload, facilitator } = setup();
  const transfer = vi.spyOn(ledger, "transfer").mockImplementation(() => {
    throw new LedgerError("insufficient_funds");
  });
  try {
    expect(facilitator.settle(payload, now)).toMatchObject({
      success: false,
      errorReason: "insufficient_funds",
    });
  } finally {
    transfer.mockRestore();
  }
  expect(ledger.entries).toHaveLength(0);
});
it("refuses a signer mismatch even when the recovered address has sufficient funds", () => {
  const { ledger, payload, facilitator } = setup();
  payload.payload.authorization.from = payee;
  const recovered = recoverAuthorization(
    domain,
    payload.payload.authorization,
    payload.payload.signature,
  );
  ledger.createAccount(recovered, { USD: "10.00" });
  expect(facilitator.verify(payload, now)).toMatchObject({
    isValid: false,
    invalidReason: "invalid_payload",
  });
  expect(ledger.entries).toHaveLength(0);
});
it.each([
  { validAfter: String(now) },
  { validAfter: String(now + 1) },
  { validBefore: String(now) },
  { validBefore: String(now - 1) },
  { validBefore: String(now + 301) },
])("refuses out-of-window authorization %j even with a real signature", (change) => {
  const { payload, ledger, facilitator } = setup();
  Object.assign(payload.payload.authorization, change);
  payload.payload.signature = signAuthorization(domain, payload.payload.authorization, secretKey);
  expect(facilitator.settle(payload, now)).toMatchObject({
    success: false,
    errorReason: "invalid_payload",
  });
  expect(ledger.entries).toHaveLength(0);
});
it.each([
  "network",
  "asset",
  "extra",
  "maxTimeoutSeconds",
])("binds accepted %s to server configuration", (field) => {
  const { payload, facilitator } = setup();
  if (field === "network") payload.accepted.network = "eip155:1";
  if (field === "asset") payload.accepted.asset = payee;
  if (field === "extra") payload.accepted.extra.name = "Other";
  if (field === "maxTimeoutSeconds") payload.accepted.maxTimeoutSeconds = 400;
  expect(facilitator.verify(payload, now)).toMatchObject({
    isValid: false,
    invalidReason: "invalid_payload",
  });
});
it("refuses unsupported schemes and malformed payloads using the protocol codes", () => {
  const { payload, facilitator } = setup();
  expect(
    facilitator.verify({ ...payload, accepted: { ...requirements, scheme: "upto" } }, now),
  ).toMatchObject({ isValid: false, invalidReason: "invalid_scheme" });
  for (const input of [null, {}, { ...payload, x402Version: 1 }, { ...payload, unknown: true }])
    expect(facilitator.verify(input, now)).toMatchObject({
      isValid: false,
      invalidReason: "invalid_payload",
    });
  for (const time of [NaN, -1, 0.1])
    expect(facilitator.verify(payload, time)).toMatchObject({
      isValid: false,
      invalidReason: "invalid_payload",
    });
});
it.each([
  "",
  "x",
  "1.5",
  "-1",
  "1e2",
  (2n ** 256n).toString(),
])("maps malformed uint256 %s to invalid_payload without throwing", (value) => {
  const { payload, facilitator } = setup();
  expect(
    facilitator.verify(
      {
        ...payload,
        payload: { ...payload.payload, authorization: { ...payload.payload.authorization, value } },
      },
      now,
    ),
  ).toMatchObject({ isValid: false, invalidReason: "invalid_payload" });
  expect(
    facilitator.verify({ ...payload, accepted: { ...payload.accepted, amount: value } }, now),
  ).toMatchObject({ isValid: false, invalidReason: "invalid_payload" });
});
it("maps a ledger-refused self transfer to invalid_payload", () => {
  const ledger = new Ledger();
  ledger.createAccount(payer, { USD: "10.00" });
  const req = { ...requirements, payTo: payer };
  const auth = { ...authorization, to: payer, validBefore: String(now + 300) };
  const payload = {
    x402Version: 2,
    accepted: req,
    payload: { authorization: auth, signature: signAuthorization(domain, auth, secretKey) },
  };
  const facilitator = new X402Facilitator(ledger, req, "USD", 6);
  expect(facilitator.settle(payload, now)).toMatchObject({
    success: false,
    errorReason: "invalid_payload",
  });
  expect(ledger.entries).toHaveLength(0);
});
it("refuses a signature from another domain, altered signer/nonce, malformed signature and unknown accounts", () => {
  for (const attack of ["domain", "from", "nonce", "signature", "account"] as const) {
    const { payload, facilitator, ledger } = setup();
    if (attack === "domain")
      payload.payload.signature = signAuthorization(
        { ...domain, chainId: "1" },
        payload.payload.authorization,
        secretKey,
      );
    if (attack === "from") payload.payload.authorization.from = payee;
    if (attack === "nonce") payload.payload.authorization.nonce = `0x${"aa".repeat(32)}`;
    if (attack === "signature") payload.payload.signature = `0x${"00".repeat(64)}1b`;
    const server =
      attack === "account"
        ? new X402Facilitator(new Ledger(), requirements, "USD", 6)
        : facilitator;
    expect(server.verify(payload, now), attack).toMatchObject({
      isValid: false,
      invalidReason: "invalid_payload",
    });
    expect(ledger.entries).toHaveLength(0);
  }
});
it.each([
  { x402Version: 1 },
  { accepts: [] },
  { unknown: true },
  { accepts: [{ ...requirements, extra: {} }] },
  { accepts: [{ ...requirements, amount: "01" }] },
  { accepts: [{ ...requirements, amount: "0" }] },
  { accepts: [{ ...requirements, maxTimeoutSeconds: 0 }] },
])("strictly rejects malformed requirements %j", (change) => {
  expect(() => parsePaymentRequired(base64(JSON.stringify({ ...required, ...change })))).toThrow();
});
it("refuses wrong header encoding, duplicate keys and malformed signature/response schemas", () => {
  expect(() => parsePaymentRequired(base64url('{"x402Version":2}'))).toThrow();
  expect(() => parsePaymentRequired(base64('{"x402Version":2,"x402Version":2}'))).toThrow();
  expect(() =>
    parsePaymentSignature(base64(JSON.stringify({ ...setup().payload, unexpected: true }))),
  ).toThrow();
  expect(() => parsePaymentResponse(base64('{"success":true}'))).toThrow();
});
it("converts exact atomic values in both directions, including JPY with no minor unit", () => {
  expect(convertX402Amount({ amount: "1.25", currency: "USD" }, 6)).toEqual({
    units: "1250000",
    currency: "USD",
  });
  expect(convertX402Amount({ units: "1250000", currency: "USD" }, 6)).toEqual({
    amount: "1.250000",
    currency: "USD",
  });
  expect(convertX402Amount({ amount: "500", currency: "JPY" }, 0)).toEqual({
    units: "500",
    currency: "JPY",
  });
  expect(convertX402Amount({ units: "500", currency: "JPY" }, 0)).toEqual({
    amount: "500",
    currency: "JPY",
  });
});
