// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { checkReceipt } from "../../src/gates/payment.js";
import { generateSigningKey, signCompact } from "../../src/mechanisms/jws.js";
import {
  bundle,
  jwtShown,
  liftProviderReceipt,
  rawExchange,
  rawToken,
  seconds,
} from "../../src/settlement/adapter.js";
import { signAp2Jwt } from "../../src/settlement/ap2/jwt.js";
import { liftReceipt as liftAp2Receipt } from "../../src/settlement/ap2/lift.js";
import { checkoutHash } from "../../src/settlement/ap2/objects.js";
import type { ProtocolObjects } from "../../src/settlement/types.js";
import { liftReceipt as liftX402Receipt } from "../../src/settlement/x402/lift.js";
import { encodePaymentResponse, parsePaymentResponse } from "../../src/settlement/x402/objects.js";
import { ap2Fixture, checkedOrder, x402Fixture } from "./adapter-fixtures.js";

function payload(raw: string): Record<string, unknown> {
  return (jwtShown(raw) as { payload: Record<string, unknown> }).payload;
}
function replace(objects: ProtocolObjects, name: string, raw: string): ProtocolObjects {
  const changed = structuredClone(objects);
  const entry = changed.objects.find((o) => o.name === name);
  if (!entry) throw new Error("missing receipt object");
  entry.raw = raw;
  entry.shown = jwtShown(raw);
  return changed;
}
it("the unsigned x402 response cannot borrow the original facilitator statement after tampering", async () => {
  const f = await x402Fixture();
  const { order, facts } = await checkedOrder(f);
  const result = await f.suite.settle(order, f.provider);
  const exchange = rawExchange(result, "SettlementResponse");
  const response = parsePaymentResponse(exchange.headers["PAYMENT-RESPONSE"] ?? "");
  if (!response.success) throw new Error("expected success");
  response.transaction = "invented-entry";
  exchange.headers["PAYMENT-RESPONSE"] = encodePaymentResponse(response);
  const changed = structuredClone(result);
  const entry = changed.objects.find((o) => o.name === "SettlementResponse");
  if (!entry) throw new Error("missing settlement response");
  entry.raw = exchange;
  const protocol = bundle(
    "x402",
    changed.objects.filter((o) => o.name !== "payment-receipt"),
  );
  const lifted = liftX402Receipt(changed, f.profile, facts);
  await expect(
    liftProviderReceipt(f.profile, changed, facts, protocol, lifted.receipt.transaction),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
});
it("the facilitator receipt requires the pinned identity signature, beyond the carrier's signature", async () => {
  const f = await x402Fixture();
  const { order, facts } = await checkedOrder(f);
  const result = await f.suite.settle(order, f.provider);
  const original = rawToken(result, "payment-receipt");
  const attacker = await generateSigningKey();
  const forged = await signCompact(attacker.key, "awp-payment-receipt+jws", payload(original));
  const changed = replace(result, "payment-receipt", forged);
  const protocol = bundle(
    "x402",
    result.objects.filter((o) => o.name !== "payment-receipt"),
  );
  await expect(
    liftProviderReceipt(
      f.profile,
      changed,
      facts,
      protocol,
      f.profile.ledger.entries[0]?.digest ?? "",
    ),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
});
it("a genuinely provider-signed wrong amount reaches the unchanged receipt-mismatch check", async () => {
  const f = await x402Fixture();
  const { order, facts } = await checkedOrder(f);
  const result = await f.suite.settle(order, f.provider);
  const claim = payload(rawToken(result, "payment-receipt"));
  (claim.payment as Record<string, unknown>).amount = "495.00";
  const signed = await signCompact(f.profile.provider.signingKey, "awp-payment-receipt+jws", claim);
  const changed = replace(result, "payment-receipt", signed);
  const protocol = bundle(
    "x402",
    result.objects.filter((o) => o.name !== "payment-receipt"),
  );
  const lifted = await liftProviderReceipt(
    f.profile,
    changed,
    facts,
    protocol,
    f.profile.ledger.entries[0]?.digest ?? "",
  );
  expect(checkReceipt(lifted, facts, f.profile.provider.party).reason).toBe("receipt-mismatch");
});
it("AP2 authenticates each receipt with its own signer and refuses a processor-signed merchant receipt", async () => {
  const f = await ap2Fixture();
  const { order, facts } = await checkedOrder(f);
  const result = await f.suite.settle(order, f.provider);
  const forged = await signAp2Jwt(
    payload(rawToken(result, "Checkout Receipt")),
    f.options.processor.key.privateKey,
    "ap2-checkout-receipt+jwt",
  );
  const changed = replace(result, "Checkout Receipt", forged);
  await expect(
    liftAp2Receipt(
      changed,
      rawToken(order, "checkout_jwt"),
      facts,
      f.profile,
      f.options.merchantKey.key,
      f.options.processor.party,
      f.options.processor.key,
      seconds(f.profile),
    ),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
});
it("AP2 rejects a genuine pair of receipt signatures for another transaction", async () => {
  const f = await ap2Fixture();
  const { order, facts } = await checkedOrder(f);
  let result = await f.suite.settle(order, f.provider);
  const payment = payload(rawToken(result, "Payment Receipt"));
  payment.transaction_id = "A".repeat(43);
  const paymentJwt = await signAp2Jwt(
    payment,
    f.options.processor.key.privateKey,
    "ap2-payment-receipt+jwt",
  );
  result = replace(result, "Payment Receipt", paymentJwt);
  const checkout = payload(rawToken(result, "Checkout Receipt"));
  checkout.payment_receipt_hash = checkoutHash(paymentJwt);
  result = replace(
    result,
    "Checkout Receipt",
    await signAp2Jwt(checkout, f.options.merchantKey.key.privateKey, "ap2-checkout-receipt+jwt"),
  );
  await expect(
    liftAp2Receipt(
      result,
      rawToken(order, "checkout_jwt"),
      facts,
      f.profile,
      f.options.merchantKey.key,
      f.options.processor.party,
      f.options.processor.key,
      seconds(f.profile),
    ),
  ).rejects.toMatchObject({ reason: "evidence-invalid" });
});
it("AP2 leaves a processor-signed receipt amount difference to the receipt check", async () => {
  const f = await ap2Fixture();
  const { order, facts } = await checkedOrder(f);
  let result = await f.suite.settle(order, f.provider);
  const payment = payload(rawToken(result, "Payment Receipt"));
  (payment.payment as Record<string, unknown>).amount = "495.00";
  const paymentJwt = await signAp2Jwt(
    payment,
    f.options.processor.key.privateKey,
    "ap2-payment-receipt+jwt",
  );
  result = replace(result, "Payment Receipt", paymentJwt);
  const checkout = payload(rawToken(result, "Checkout Receipt"));
  checkout.payment_receipt_hash = checkoutHash(paymentJwt);
  result = replace(
    result,
    "Checkout Receipt",
    await signAp2Jwt(checkout, f.options.merchantKey.key.privateKey, "ap2-checkout-receipt+jwt"),
  );
  const lifted = await liftAp2Receipt(
    result,
    rawToken(order, "checkout_jwt"),
    facts,
    f.profile,
    f.options.merchantKey.key,
    f.options.processor.party,
    f.options.processor.key,
    seconds(f.profile),
  );
  expect(checkReceipt(lifted, facts, f.options.processor.party).reason).toBe("receipt-mismatch");
});
