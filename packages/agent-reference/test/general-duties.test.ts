// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, rmSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { patch, runScenario } from "../src/engine/run.js";
import { DutyExecutor, emptyDuties } from "../src/runtime/duties.js";
import { FileStateStore } from "../src/store/state.js";

const root = join(import.meta.dirname, "..");
it("erases along two onward links and reports an undischargeable onward part honestly", async () => {
  const { profile, scenario } = loadCase(root, "erasure-request");
  const paths = await runScenario(profile, scenario);
  expect(paths.every((p) => !p.blocked && !p.disagrees)).toBe(true);
  const events = required(required(paths[0]).trace).events;
  for (const agent of ["company-agent", "partner-agent", "downstream-agent"])
    expect(events.some((e) => e.agent === agent && e.caption.startsWith("Payloads deleted"))).toBe(
      true,
    );
  const receipt = required(required(paths[1]).trace).events.find(
    (e) => e.agent === "company-agent" && e.kind === "message-out" && e.packet?.kind === "deliver",
  );
  expect(JSON.stringify(receipt?.packet?.layers.content.raw)).toContain('"reason":"no-agreement"');
  expect(paths[1]?.actual).toMatchObject({ outcome: "stop", reason: "no-agreement" });
});
it("refuses subject substitution before erasing, and preserves a missing duty in the middle", async () => {
  const { profile, scenario } = loadCase(root, "erasure-request");
  scenario.branches = [];
  scenario.expect = [];
  scenario.script = scenario.script.slice(0, 15);
  const request = scenario.script.find((s) => s.id === "erase");
  if (request?.type !== "start") throw Error("fixture");
  request.contents.subject = "urn:someone-else";
  profile.identifiers.push("urn:someone-else");
  const [wrong] = await runScenario(profile, scenario, { compare: false });
  expect(wrong?.actual).toMatchObject({ outcome: "refuse", reason: "representation-out-of-scope" });
  expect(wrong?.trace?.events.some((e) => e.caption.startsWith("Payloads deleted"))).toBe(false);
  const f = loadCase(root, "erasure-request");
  f.scenario.branches = [];
  f.scenario.expect = [];
  f.scenario.script = f.scenario.script.slice(0, 19);
  const middle = f.scenario.script.find((s) => s.id === "second-onward-offer");
  if (middle?.type !== "start") throw Error("fixture");
  middle.contents.duties = [];
  const [partial] = await runScenario(f.profile, f.scenario, { compare: false });
  expect(
    partial?.trace?.events.some(
      (e) => e.agent === "partner-agent" && e.outcome === "stop" && e.reason === "no-agreement",
    ),
  ).toBe(true);
});
it("keeps pending work over a file-state restart and never erases a missed deadline with a late ack", () => {
  const dir = mkdtempSync(join(tmpdir(), "duties-"));
  let at = "2026-11-13T09:00:00.000Z";
  try {
    const first = new FileStateStore(join(dir, "state"));
    const state = first.load();
    state.duties = emptyDuties();
    const executor = new DutyExecutor(
      state.duties,
      () => at,
      () => {},
    );
    const duty = executor.add({
      kind: "notify",
      source: "urn:agreement",
      items: [],
      recipient: { actor: "urn:actor", party: "urn:party" },
      due: "2026-11-13T09:01:00.000Z",
    });
    first.save(state);
    first.close();
    const second = new FileStateStore(join(dir, "state"));
    const reloaded = second.load();
    const resumed = new DutyExecutor(
      reloaded.duties,
      () => at,
      () => {},
    );
    expect(resumed.audit()[0]?.status).toBe("pending");
    resumed.sent(duty.id, "urn:message", "urn:conversation");
    at = "2026-11-13T09:01:01.000Z";
    expect(resumed.audit()[0]?.status).toBe("missed");
    resumed.acknowledge("urn:conversation", "urn:party");
    expect(resumed.audit()[0]).toMatchObject({
      status: "missed",
      missedAt: at,
      acknowledgedAt: at,
    });
    second.save(reloaded);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("sends three gated notices, records acknowledgements and preserves a late acknowledgement", async () => {
  const { profile, scenario } = loadCase(root, "incident-notice");
  const paths = await runScenario(profile, scenario);
  expect(paths.every((p) => !p.blocked && !p.disagrees)).toBe(true);
  expect(
    paths[0]?.trace?.events.filter((e) => e.kind === "message-out" && e.packet?.kind === "invoke"),
  ).toHaveLength(3);
  const last = paths[0]?.trace?.events.findLast((e) => e.caption.startsWith("Duty audit:"));
  expect(last?.caption.match(/"status":"acknowledged"/g)).toHaveLength(3);
  const world = patch(scenario, required(scenario.branches[0]).change);
  world.branches = [];
  world.expect = [];
  world.script.push(
    { id: "late-notice", agent: "customer-agent", type: "receive", from: "provider-agent" },
    { id: "late-ack", agent: "provider-agent", type: "receive", from: "customer-agent" },
    { id: "late-audit", agent: "provider-agent", type: "general-duties", discharge: false },
  );
  const [late] = await runScenario(profile, world, { compare: false });
  const audit = late?.trace?.events.findLast((e) => e.caption.startsWith("Duty audit:"));
  expect(audit?.caption).toContain('"status":"missed"');
  expect(audit?.caption).toContain('"acknowledgedAt"');
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture");
  return value;
}
