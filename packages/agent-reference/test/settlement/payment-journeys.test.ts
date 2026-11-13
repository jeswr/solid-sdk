// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { describe, expect, it } from "vitest";
import { loadCase } from "../../src/engine/load.js";
import { type PathResult, patch, runScenario } from "../../src/engine/run.js";
import { PaymentFacts } from "../../src/model/payment.js";
import { RdfOrderSuite } from "../../src/settlement/rdf-order.js";
import { scenarioRegistry } from "../../src/suites/scenario.js";
import type { TraceFile } from "../../src/trace/types.js";
import { paymentObjects, readPaymentObjects } from "../../src/wire/payment.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing payment fixture value");
  return value;
}

const root = join(import.meta.dirname, "../..");
const runs = new Map<string, Promise<PathResult[]>>();
function traceOf(paths: PathResult[], path = "main"): TraceFile {
  return required(required(paths.find((p) => p.path === path)).trace);
}
function run(id: string) {
  let result = runs.get(id);
  if (!result) {
    const input = loadCase(root, id);
    result = runScenario(input.profile, input.scenario);
    runs.set(id, result);
  }
  return result;
}
it("registers exactly five settlement choices without claiming the four protocol adapters ran", () => {
  const registry = scenarioRegistry();
  expect(registry.suitesFor("settlement").map((s) => [s.id, s.partOf, s.status])).toEqual([
    ["rdf-order", "commitments", "run"],
    ["ap2", "commitments", "not-run"],
    ["acp", "commitments", "not-run"],
    ["x402", "commitments", "not-run"],
    ["mpp", "commitments", "not-run"],
  ]);
  expect(registry.suite("commitments", "payment")).toBeUndefined();
  expect(registry.configuration("baseline")?.layers.settlement).toBe("rdf-order");
});
describe("separately keyed signed payment journeys", () => {
  it.each([
    "pay-an-invoice",
    "shopping-agent",
    "mortgage-main",
  ])("%s reaches the provider ledger and both receipt checks", async (id) => {
    const main = traceOf(await run(id));
    const checks = main.events.filter((e) => /^P[1-8]$/.test(e.check ?? ""));
    expect(new Set(checks.map((e) => e.check))).toEqual(
      new Set(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]),
    );
    expect(checks.every((e) => e.settlement?.suite === "rdf-order")).toBe(true);
    expect(main.events.filter((e) => e.check === "receipt" && e.verdict === "pass")).toHaveLength(
      2,
    );
    expect(
      main.events.filter((e) => e.caption.includes("records the ledger transfer")),
    ).toHaveLength(1);
    expect(
      main.events
        .filter((e) => e.packet?.kind === "propose")
        .some(
          (e) =>
            !!(e.packet?.layers.content.raw as { terms?: { payment?: unknown } })?.terms?.payment,
        ),
    ).toBe(true);
    expect(
      main.standIns?.filter(
        (s) =>
          s.replacedBy ===
          "No money moves. The payment provider is a fictional party with its own keys that keeps a ledger.",
      ),
    ).toHaveLength(1);
    for (const event of main.events) {
      expect(event.caption).not.toMatch(/https?:\/\/|urn:/);
      expect(event.rule?.text ?? "").not.toMatch(/https?:\/\/|urn:/);
      expect(event.chat?.text ?? "").not.toMatch(/https?:\/\/|urn:/);
      if (event.packet)
        for (const view of Object.values(event.packet.layers))
          expect(view.summary).not.toMatch(/https?:\/\/|urn:/);
    }
  }, 120_000);
  it.each([
    ["fee-amount-differs", "P2", "amount-differs"],
    ["fee-payee-differs", "P3", "payee-differs"],
    ["fee-no-offer", "P1", "no-agreement"],
  ])("%s stops before any provider order", async (path, check, reason) => {
    const trace = traceOf(await run("mortgage-main"), path);
    expect(trace.events.find((e) => e.check === check && e.verdict === "fail")?.reason).toBe(
      reason,
    );
    expect(
      trace.events.some(
        (e) =>
          e.kind === "message-out" &&
          (e.packet?.layers.header.raw as { to?: { party: string } })?.to?.party ===
            "urn:fictional:mossbridge-payment-desk",
      ),
    ).toBe(false);
    expect(trace.events.filter((e) => e.segment === "payment")).toHaveLength(1);
    expect(trace.events.at(-1)?.segmentEnd).toBe("payment");
    if (path === "fee-amount-differs")
      expect(
        trace.events.some(
          (e) =>
            e.chat?.who === "agent" &&
            e.chat.text.includes("450.00") &&
            e.chat.text.includes("495.00"),
        ),
      ).toBe(true);
  });
  it("answers the price question after P5 refuses buying", async () => {
    const trace = traceOf(await run("shopping-agent"), "asked-to-look-not-to-buy");
    expect(trace.events.find((e) => e.check === "P5" && e.verdict === "fail")?.reason).toBe(
      "not-authorised",
    );
    expect(trace.events.at(-1)?.chat).toEqual({
      who: "agent",
      text: "The cheapest available price is 300.00 GBP.",
    });
    expect(trace.events.some((e) => e.agent === "bank-agent" && e.kind === "message-in")).toBe(
      false,
    );
  });
  it("binds both displayed approval questions to the registered valuer and the fee limit", async () => {
    const trace = traceOf(await run("mortgage-main"));
    const questions = trace.events.filter(
      (e) => e.kind === "ask-principal" && e.chat?.text.includes("Home valuation"),
    );
    expect(questions).toHaveLength(2);
    for (const e of questions) {
      expect(e.chat?.text).toContain("Bracken Lantern Valuations");
      expect(e.chat?.text).toContain("450.00 USD");
      expect(e.chat?.text).toContain("600 USD");
    }
  });
});
it("runs the five inbound checks before refusing a genuinely provider-signed mismatching receipt", async () => {
  const { profile, scenario } = loadCase(root, "pay-an-invoice");
  const main = traceOf(await run("pay-an-invoice"));
  const sent = required(
    required(
      main.events.find((e) => e.caption === "The gate builds the checked payment order in RDF."),
    ).settlement,
  ).facts;
  const suite = new RdfOrderSuite();
  const original = suite.lift(await readPaymentObjects(sent));
  const wrong = PaymentFacts.receipt(
    PaymentFacts.create({ ...original.data(), amount: "301.00" }),
    "urn:fictional:bank",
    "fictional-entry",
  );
  const document = required(
    (await paymentObjects(wrong, "Provider-signed wrong receipt")).objects[0],
  ).shown;
  const world = patch(scenario, {
    branches: [],
    script: scenario.script.slice(
      0,
      scenario.script.findIndex((s) => s.id === "provider-receipt-arrives") + 1,
    ),
  });
  const issue = world.script.find((s) => s.id === "provider-receipt-statement");
  if (issue?.type !== "issue") throw new Error("Missing real provider receipt producer");
  issue.value.payment = document as NonNullable<typeof issue.value.payment>;
  const trace = traceOf(await runScenario(profile, world, { compare: false }));
  const failed = trace.events.findIndex(
    (e) => e.check === "receipt" && e.reason === "receipt-mismatch",
  );
  expect(failed).toBeGreaterThan(0);
  const before = trace.events
    .slice(0, failed)
    .filter((e) => e.agent === "business-agent" && e.part === "inbound-gate" && e.kind === "check")
    .slice(-5);
  expect(before.map((e) => e.check)).toEqual([
    "integrity",
    "source",
    "authority",
    "terms",
    "fitness",
  ]);
  expect(before.every((e) => ["pass", "not-applicable"].includes(e.verdict ?? ""))).toBe(true);
  expect(trace.events.slice(failed).some((e) => e.kind === "store")).toBe(false);
}, 120_000);
