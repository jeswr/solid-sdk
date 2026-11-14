// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

const decisionsOf = (trace: import("../src/trace/types.js").TraceFile) =>
  trace.events.map(({ agent, part, kind, check, verdict, reason, outcome }) => ({
    agent,
    part,
    kind,
    check,
    verdict,
    reason,
    outcome,
  }));
for (const name of ["mortgage-main", "mortgage-core"])
  it(`${name} has identical decisions with JWS and Data Integrity`, async () => {
    const root = new URL("../", import.meta.url).pathname;
    const input = loadCase(root, name);
    const baseline = await runScenario(input.profile, input.scenario);
    const alternative = await runScenario(input.profile, input.scenario, {
      configuration: "authenticity-data-integrity",
    });
    expect(alternative.filter((path) => baseline.some((p) => p.path === path.path))).toHaveLength(
      baseline.length,
    );
    for (const path of alternative.filter((path) => baseline.some((p) => p.path === path.path))) {
      expect(path.blocked).toBeUndefined();
      expect(path.trace).toBeDefined();
      const original = baseline.find((p) => p.path === path.path)!;
      expect(decisionsOf(path.trace!)).toEqual(decisionsOf(original.trace!));
      const packets = path.trace!.events.flatMap((e) => (e.packet ? [e.packet] : []));
      expect(packets.length).toBeGreaterThan(0);
      expect(packets.some((p) => p.jsonld?.includes("eddsa-rdfc-2022"))).toBe(true);
      expect(packets.every((p) => p.jsonld && p.context && p.rdf && p.attachments)).toBe(true);
    }
  }, 180_000);
