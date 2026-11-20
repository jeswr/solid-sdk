// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Claude Opus 5.5
// Brief 31 §2.9: after the regulator claim, Sam's agent publishes only Sam's own statement and
// the forum's signed decision to a host with no gate; the lender's signed reply is attached;
// a separately keyed reader's agent fetches every hosted item and runs its own inbound checks.
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import type { TraceEvent } from "../src/trace/types.js";

const root = new URL("..", import.meta.url).pathname;
const id = "accountability-reputation-post";
const decisions = (events: readonly TraceEvent[], agent: string, part: string) =>
  events.filter((e) => e.agent === agent && e.part === part && e.kind === "decision");

it("publishes Sam's statement and the forum decision; the reader checks each hosted item", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const paths = await runScenario(profile, scenario, { configuration: id });
  expect(paths.map((path) => path.path)).toEqual([
    "main",
    "post-about-a-person",
    "evidence-not-publishable",
  ]);
  const main = paths.find((path) => path.path === "main")?.trace;
  if (!main) throw new Error("the main path must run");
  expect(main.standIns?.map((s) => s.what)).toContain("The fictional public post host");
  const sent = decisions(main.events, "sams-agent", "outbound-gate").filter(
    (e) => e.outcome === "go" && e.caption.includes("public post host"),
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]?.caption).toContain("reputation review statement");
  expect(sent[0]?.caption).toContain("forum decision statement");
  expect(sent[0]?.caption).not.toMatch(/deposit|income/);
  const replied = decisions(main.events, "lender", "outbound-gate").filter(
    (e) => e.outcome === "go" && e.caption.includes("public post host"),
  );
  expect(replied).toHaveLength(1);
  // Every hosted item went through the reader's five inbound checks and was admitted.
  const reader = decisions(main.events, "post-reader-agent", "inbound-gate");
  expect(reader.map((e) => e.outcome)).toEqual(["admit", "admit", "admit"]);
  const checks = main.events.filter(
    (e) => e.agent === "post-reader-agent" && e.part === "inbound-gate" && e.kind === "check",
  );
  for (const check of ["integrity", "source", "authority", "terms", "fitness"])
    expect(checks.filter((e) => e.check === check)).toHaveLength(3);

  const person = paths.find((path) => path.path === "post-about-a-person");
  expect(person?.disagrees).toBe(false);
  const stop = person?.trace?.events.find(
    (e) => e.agent === "sams-agent" && e.kind === "check" && e.verdict === "fail",
  );
  expect([stop?.check, stop?.reason]).toEqual(["data-terms", "prohibited"]);
  expect(stop?.caption).toContain("forum decision statement");
  expect(decisions(person?.trace?.events ?? [], "post-reader-agent", "inbound-gate")).toEqual([]);

  // Measured: the disclosure check runs before the bank's terms are reached.
  const evidence = paths.find((path) => path.path === "evidence-not-publishable");
  expect(evidence?.disagrees).toBe(false);
  expect(evidence?.note).toBeUndefined();
  expect(evidence?.actual).toMatchObject({
    outcome: "stop",
    reason: "excessive-scope",
    check: "disclosure",
  });
  const first = evidence?.trace?.events.find(
    (e) => e.agent === "sams-agent" && e.kind === "check" && e.verdict === "fail",
  );
  expect([first?.check, first?.reason]).toEqual(["disclosure", "excessive-scope"]);
});

it("the host vouches for nothing: an item the reader does not trust is refused", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const configurations = scenario.configurations.map((entry) => {
    if (entry.id !== id) return entry;
    const world = structuredClone(entry.world) as {
      trust: { sources: Record<string, { id: string }[]> };
      branches?: unknown;
    };
    world.trust.sources["post-reader-agent"] = world.trust.sources["post-reader-agent"]!.filter(
      (rule) => rule.id !== "urn:source:post-reader-agent:review",
    );
    world.branches = {};
    return { ...entry, world };
  });
  const [main] = await runScenario(profile, { ...scenario, configurations }, { configuration: id });
  const reader = decisions(main?.trace?.events ?? [], "post-reader-agent", "inbound-gate");
  expect(reader.map((e) => e.outcome)).toEqual(["refuse", "admit", "admit"]);
});
