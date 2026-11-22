// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { checkPayment } from "../../src/gates/payment.js";
import { PaymentAccountNode } from "../../src/model/payment.js";
import { HTTP_STAND_IN } from "../../src/settlement/adapter.js";
import {
  SETTLEMENT_CONFIGURATIONS,
  selectedSettlement,
} from "../../src/settlement/configurations.js";
import { SETTLEMENT_PROFILES } from "../../src/settlement/profiles.js";
import { RdfOrderSuite } from "../../src/settlement/rdf-order.js";
import { BASELINE } from "../../src/suites/baseline.js";
import { scenarioRegistry } from "../../src/suites/scenario.js";
import {
  acpFixture,
  agreement,
  ap2Fixture,
  hostFixture,
  mppFixture,
  paymentFromInvoice,
  paymentRecord,
  x402Fixture,
} from "./adapter-fixtures.js";

async function rdfFixture() {
  const host = await hostFixture();
  host.due.account = "urn:account:valuer";
  return { ...host, suite: new RdfOrderSuite() };
}
const factories = [rdfFixture, x402Fixture, mppFixture, ap2Fixture, acpFixture];
it.each([
  ["fee-amount-differs", "P2", "amount-differs"],
  ["fee-payee-differs", "P3", "payee-differs"],
  ["fee-no-offer", "P1", "no-agreement"],
])("isolated %s stops at exactly the same check and reason across all five suites", async (path, check, reason) => {
  const actual = [];
  for (const factory of factories) {
    const f = await factory();
    if (path === "fee-amount-differs") f.due.agreement = agreement("495.00");
    const objects = await f.suite.request(f.due, { party: f.profile.merchant.party });
    const invoice = f.suite.lift(objects);
    const record = paymentRecord(f.profile);
    if (path === "fee-no-offer") record.agreement = undefined;
    if (path === "fee-payee-differs")
      record.accountBindings = [
        PaymentAccountNode.create("urn:fictional:other-valuer", invoice.account ?? ""),
      ];
    const result = checkPayment(paymentFromInvoice(invoice, f.profile), record);
    actual.push({ suite: f.suite.id, check: result.verdicts.at(-1)?.check, reason: result.reason });
    expect(f.profile.ledger.entries).toHaveLength(0);
    expect(result.ok).toBe(false);
  }
  expect(actual.map(({ suite: _suite, ...result }) => result)).toEqual(
    factories.map(() => ({ check, reason })),
  );
});
it("declares four complete configurations with only settlement changed and exact stand-ins", () => {
  for (const { configuration, runtime } of SETTLEMENT_CONFIGURATIONS) {
    expect(runtime).toBe("executable");
    expect(configuration.id).toBe(`settlement-${configuration.layers.settlement}`);
    expect(scenarioRegistry().check(configuration)).toEqual([]);
    expect(
      Object.keys(BASELINE.layers).filter(
        (l) =>
          BASELINE.layers[l as keyof typeof BASELINE.layers] !==
          configuration.layers[l as keyof typeof BASELINE.layers],
      ),
    ).toEqual(["settlement"]);
  }
  for (const profile of Object.values(SETTLEMENT_PROFILES))
    expect(profile.standIns).toContain(HTTP_STAND_IN);
});
it("refuses an unavailable selected adapter instead of silently running RDF", () => {
  expect(selectedSettlement().id).toBe("rdf-order");
  for (const { configuration } of SETTLEMENT_CONFIGURATIONS)
    expect(() => selectedSettlement(configuration.layers.settlement)).toThrow(
      "No settlement adapter installed",
    );
});
