// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { confinementDifferences } from "../../src/engine/confinement.js";
import { loadCase } from "../../src/engine/load.js";
import { runScenario } from "../../src/engine/run.js";
import { HTTP_STAND_IN } from "../../src/settlement/adapter.js";
import type { TraceFile } from "../../src/trace/types.js";

let baseline: Promise<TraceFile> | undefined;
function baselineTrace() {
  if (!baseline) {
    const { profile, scenario } = loadCase(join(import.meta.dirname, "../.."), "mortgage-main");
    scenario.branches = [];
    baseline = runScenario(profile, scenario).then((paths) => paths[0]!.trace!);
  }
  return baseline;
}
it.each([
  "x402",
  "mpp",
  "ap2",
  "acp",
])("runs mortgage-main and both native %s refusals", async (suite) => {
  const { profile, scenario } = loadCase(join(import.meta.dirname, "../.."), "mortgage-main");
  const paths = await runScenario(profile, scenario, { configuration: `settlement-${suite}` });
  expect(paths).toHaveLength(3);
  const main = paths[0]!;
  expect(confinementDifferences(await baselineTrace(), main.trace!, "settlement")).toEqual([]);
  const paymentVerdicts = (trace: TraceFile) =>
    trace.events
      .filter((e) => /^P[1-8]$/.test(e.check ?? "") || e.check === "receipt")
      .map((e) => ({ agent: e.agent, check: e.check, verdict: e.verdict, reason: e.reason }));
  expect(paymentVerdicts(main.trace!)).toEqual(paymentVerdicts(await baselineTrace()));
  expect(main.blocked).toBeUndefined();
  expect(
    main.trace?.events.filter((e) => e.check === "receipt" && e.verdict === "pass"),
  ).toHaveLength(2);
  expect(main.trace?.events.some((e) => e.settlement?.suite === suite)).toBe(true);
  const packets = main
    .trace!.events.filter((e) => e.kind === "message-in")
    .flatMap((e) => {
      const body = e.packet?.layers.content.raw as
        | { observed?: { suite?: string; objects?: { name: string; raw?: unknown }[] } }
        | undefined;
      return body?.observed?.suite === suite
        ? [{ packet: e.packet!, objects: body.observed.objects! }]
        : [];
    });
  const inspectCarried = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const object = value as { suite?: string; objects?: unknown[] };
    if (object.suite === suite && Array.isArray(object.objects))
      expect(object.objects).toHaveLength(1);
    for (const child of Object.values(value)) inspectCarried(child);
  };
  for (const event of main.trace!.events) if (event.packet) inspectCarried(event.packet.layers);
  expect(packets.length).toBeGreaterThan(0);
  expect(packets.every((p) => p.objects.length === 1)).toBe(true);
  if (suite === "ap2") {
    const recipient = (name: string) => {
      const packet = packets.find((p) => p.objects[0]?.name === name)?.packet;
      if (!packet) throw new Error("Missing native mandate packet");
      return (packet.layers.header.raw as { to: { party: string } }).to.party;
    };
    expect(recipient("Checkout Mandate")).toBe("urn:fictional:bracken-lantern-valuations");
    expect(recipient("Payment Mandate")).toBe("urn:fictional:mossbridge-payment-desk");
  }
  expect(main.trace?.standIns?.some((s) => s.replacedBy === HTTP_STAND_IN)).toBe(true);
  for (const [path, check, reason] of [
    [`${suite}-object-tampered`, "evidence", "evidence-invalid"],
    [`${suite}-fee-amount-differs`, "P2", "amount-differs"],
  ]) {
    const refusal = paths.find((p) => p.path === path)!;
    expect(refusal.actual).toEqual({ outcome: "stop", check, reason });
    expect(refusal.disagrees).toBe(false);
    expect(
      refusal.trace?.events.some((e) => e.caption.includes("records the ledger transfer")),
    ).toBe(false);
    expect(
      refusal.trace?.events.some(
        (e) =>
          e.packet?.kind === "invoke" &&
          (e.packet.layers.content.raw as { operation?: { id?: string } })?.operation?.id ===
            "urn:op:payment",
      ),
    ).toBe(false);
  }
}, 240_000);
