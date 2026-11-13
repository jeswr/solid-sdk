// AUTHORED-BY Claude Opus 5.5
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { describe, expect, it } from "vitest";
import { runReference, SCENARIOS, type ScenarioId } from "../src/reference/mortgage.js";
import { BASELINE } from "../src/suites/baseline.js";
import { INBOUND_CHECKS, OUTBOUND_CHECKS, outlineOf, type TraceFile } from "../src/trace/types.js";

const root = join(import.meta.dirname, "..");
const model = JSON.parse(readFileSync(join(root, "test/fixtures/model.json"), "utf8")) as {
  parts: { id: string }[];
  parties: { id: string }[];
  inboundChecks: { id: string }[];
  outboundChecks: { id: string }[];
  layers: { id: string; suites: { id: string; baseline?: boolean }[] }[];
};
const scenarios = Object.keys(SCENARIOS) as ScenarioId[];
const runs = new Map<ScenarioId, Promise<TraceFile>>();
const run = (s: ScenarioId) => {
  let p = runs.get(s);
  if (!p) {
    p = runReference(s);
    runs.set(s, p);
  }
  return p;
};

describe("reference traces follow their committed outlines", () => {
  for (const scenario of scenarios) {
    it(`${scenario}--${BASELINE.id}`, async () => {
      const expected = JSON.parse(
        readFileSync(join(root, "outlines", `${scenario}--${BASELINE.id}.json`), "utf8"),
      );
      expect(outlineOf(await run(scenario))).toEqual(expected);
    });
  }
});

describe("reference traces are reproducible and use the model's ids", () => {
  it("a second run of the core flow is identical, event for event", async () => {
    const again = await runReference("mortgage-core");
    expect(again).toEqual(await run("mortgage-core"));
  });

  it("every part, check, agent, layer and suite id is one the model defines", async () => {
    const parts = new Set(model.parts.map((p) => p.id));
    const parties = new Set(model.parties.map((p) => p.id));
    const checks = new Set([...model.inboundChecks, ...model.outboundChecks].map((c) => c.id));
    const suites = new Map(model.layers.map((l) => [l.id, new Set(l.suites.map((s) => s.id))]));
    for (const scenario of scenarios) {
      const trace = await run(scenario);
      for (const a of trace.agents) expect(parties.has(a.id)).toBe(true);
      for (const [layer, suite] of Object.entries(trace.configuration.layers))
        expect(suites.get(layer)?.has(suite)).toBe(true);
      for (const e of trace.events) {
        expect(parts.has(e.part)).toBe(true);
        expect(parties.has(e.agent)).toBe(true);
        if (e.check) expect(checks.has(e.check)).toBe(true);
        for (const r of e.refs ?? []) expect(suites.get(r.layer)?.has(r.suite)).toBe(true);
      }
      expect(trace.events.map((e) => e.seq)).toEqual(trace.events.map((_, i) => i + 1));
    }
  });

  it("the check lists match the model's, in order", () => {
    expect([...INBOUND_CHECKS]).toEqual(model.inboundChecks.map((c) => c.id));
    expect([...OUTBOUND_CHECKS]).toEqual(model.outboundChecks.map((c) => c.id));
  });

  it("inbound checks run in order for every admitted message", async () => {
    const trace = await run("mortgage-core");
    let seen: string[] = [];
    for (const e of trace.events) {
      if (e.part === "inbound-gate" && e.kind === "check" && e.check) {
        if (e.check === "integrity") seen = [];
        if (seen.at(-1) !== e.check) seen.push(e.check);
      }
      if (e.part === "inbound-gate" && e.kind === "decision" && e.outcome === "admit")
        expect(seen).toEqual([...INBOUND_CHECKS]);
    }
  });

  it("the branches end where the architecture says", async () => {
    const decisions = (t: TraceFile) =>
      t.events.filter(
        (e) => e.kind === "decision" && e.agent === "sams-agent" && e.part === "outbound-gate",
      );
    const over = decisions(await run("mortgage-over-ask"));
    expect(over.some((e) => e.outcome === "stop" && e.reason === "not-authorised")).toBe(true);
    const limit = await run("mortgage-out-of-limit");
    expect(
      limit.events.some((e) => e.check === "limits-approval" && e.reason === "excessive-scope"),
    ).toBe(true);
    expect(
      decisions(limit).some((e) => e.outcome === "stop" && e.reason === "approval-denied"),
    ).toBe(true);
    const fee = decisions(await run("mortgage-injected-fee"));
    expect(fee.at(-1)).toMatchObject({ outcome: "stop", reason: "not-authorised" });
  });

  it("Sam's agent shows how it resolved trust in North Bank and in Harbour Bank", async () => {
    const trace = await run("mortgage-core");
    const recipient = trace.events.find((e) => e.check === "recipient" && e.agent === "sams-agent");
    expect(recipient?.resolution?.path.map((p) => p.kind)).toEqual([
      "own-list",
      "root",
      "register",
    ]);
    const bank = trace.events.find(
      (e) => e.check === "source" && e.agent === "sams-agent" && e.caption.includes("Harbour Bank"),
    );
    expect(bank?.resolution?.path.map((p) => p.kind)).toEqual(["own-list"]);
  });
});
