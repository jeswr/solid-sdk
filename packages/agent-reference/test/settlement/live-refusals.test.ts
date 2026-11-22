// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { tamperSettlementOrder } from "../../src/engine/settlement-faults.js";
import { checkPayment } from "../../src/gates/payment.js";
import {
  acpFixture,
  ap2Fixture,
  checkedOrder,
  mppFixture,
  paymentFromInvoice,
  paymentRecord,
  x402Fixture,
} from "./adapter-fixtures.js";

const factories = [
  { suite: "x402", make: x402Fixture },
  { suite: "mpp", make: mppFixture },
  { suite: "ap2", make: ap2Fixture },
  { suite: "acp", make: acpFixture },
];
it.each(factories)("the live $suite attack reaches its native verifier", async ({ make }) => {
  const fixture = await make();
  const admit = fixture.options.admit;
  let attacked = false;
  fixture.options.admit = async (source, step, objects) => {
    if (step === "payment" && !attacked) attacked = tamperSettlementOrder(objects);
    await admit(source, step, objects);
  };
  await expect(checkedOrder(fixture)).rejects.toMatchObject({ reason: "evidence-invalid" });
  expect(attacked).toBe(true);
  expect(fixture.profile.ledger.entries).toHaveLength(0);
});
it.each(factories)("the source-signed $suite amount variation is refused by unchanged P2", async ({
  make,
}) => {
  const fixture = await make();
  fixture.due.amount = "495.00";
  const invoice = await fixture.suite.request(fixture.due, {
    party: fixture.profile.merchant.party,
  });
  const facts = paymentFromInvoice(fixture.suite.lift(invoice), fixture.profile);
  expect(checkPayment(facts, paymentRecord(fixture.profile))).toMatchObject({
    ok: false,
    reason: "amount-differs",
    verdicts: [
      { check: "P1", ok: true },
      { check: "P2", ok: false, reason: "amount-differs" },
    ],
  });
  expect(fixture.profile.ledger.entries).toHaveLength(0);
});
