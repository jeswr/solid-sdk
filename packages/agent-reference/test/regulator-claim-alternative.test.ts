// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import {
  addedSegmentDifferences,
  confinementDifferences,
  patchDifferences,
} from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { matrixWorld } from "../src/engine/matrix.js";
import { patch, runScenario } from "../src/engine/run.js";
import { recordSegmentSchema } from "../src/mechanisms/forum.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import { decodeCompactPayload } from "../src/wire/inspect.js";

const id = "accountability-regulator-claim";
const root = new URL("..", import.meta.url).pathname;

it("files the fee claim with the ombudsman the admitted register answer names and decides it on both range records", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  expect(configurationById(alternativeWireId(id))?.status).toBe("executable");
  const entry = scenario.configurations.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`${id} is not a configuration of mortgage-main`);
  expect(entry.requires).toBe("identity-anonymous");
  expect(patchDifferences(scenario, entry, profile)).toEqual([]);
  const reference = (
    await runScenario(
      profile,
      { ...scenario, branches: [] },
      { configuration: "identity-anonymous" },
    )
  )[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: id });
  expect(paths.map((p) => p.path)).toEqual(["main", "entry-withheld"]);
  const [main, withheld] = paths;
  if (!reference || !main?.trace || !withheld?.trace)
    throw new Error(JSON.stringify(paths.map((p) => ({ path: p.path, blocked: p.blocked }))));
  expect(confinementDifferences(reference, main.trace, "accountability")).toEqual([]);
  expect(addedSegmentDifferences(main.trace, entry, matrixWorld(scenario, entry).parties)).toEqual(
    [],
  );

  const terms = main.trace.events.filter(
    (event) => event.addedBy === id && event.check === "data-terms",
  );
  for (const label of [
    "Signed representation",
    "Signed fee invoke",
    "Signed agreement offer",
    "Signed agreement acceptance",
  ])
    expect(terms.some((event) => event.verdict === "pass" && event.caption.startsWith(label))).toBe(
      true,
    );

  // The forum decides on the lender-signed fee statement against the agreed terms.
  const decision = main.trace.events.find(
    (event) => event.agent === "forum" && event.kind === "decision",
  );
  expect(decision?.reason).toBe("not-authorised");
  expect(decision?.caption).toContain("fee-not-in-terms");
  // Both agents admit the forum's signed decision.
  const admitted = main.trace.events.filter(
    (event) => event.addedBy === id && event.kind === "decision" && event.agent !== "forum",
  );
  expect(admitted.slice(-2).map((event) => event.outcome)).toEqual(["admit", "admit"]);

  // Entry withheld: the gap in the lender's range is measured at fitness, not as registered.
  expect(withheld.actual).toMatchObject({
    outcome: "refuse",
    reason: "record-unavailable",
    check: "fitness",
  });
  const refusal = withheld.trace.events.find(
    (event) => event.agent === "forum" && event.kind === "decision",
  );
  expect(refusal).toMatchObject({ outcome: "refuse", reason: "record-unavailable" });
}, 900_000);

it("sends no claim when the admitted register answer names a forum this world does not host", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  scenario.configurations = scenario.configurations.map((entry) =>
    entry.id === id
      ? (patch(entry, {
          world: {
            statements: { "north-dispute-route": { value: { forum: "urn:fictional:elsewhere" } } },
            branches: [],
          },
        }) as typeof entry)
      : entry,
  );
  await expect(runScenario(profile, scenario, { configuration: id })).rejects.toThrow(
    /dispute route urn:fictional:elsewhere is not a forum this world hosts/,
  );
}, 900_000);

it("stops records missing consent for the signed agreement acceptance or representation proof", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const entry = scenario.configurations.find((candidate) => candidate.id === id)!;
  scenario.branches = [];
  entry.world.branches = [
    {
      id: "ungranted-acceptance",
      what: "The claimant lacks permission to release the agreement acceptance.",
      onlyUnder: id,
      change: {
        stopAfter: "file-claim",
        script: { "file-claim": { proofOwners: ["north-agent"] } },
      },
      expect: { outcome: "stop", check: "evidence", reason: "evidence-invalid" },
      outline: [],
    },
    {
      id: "ungranted-representation",
      what: "The respondent lacks permission to release the representation proof.",
      onlyUnder: id,
      change: { stopAfter: "answer", script: { answer: { proofOwners: [] } } },
      expect: { outcome: "stop", check: "evidence", reason: "evidence-invalid" },
      outline: [],
    },
  ];
  const [, claimant, respondent] = await runScenario(profile, scenario, { configuration: id });
  for (const [path, agent] of [
    [claimant, "sams-agent"],
    [respondent, "lender"],
  ] as const) {
    const stop = path?.trace?.events.findLast(
      (event) => event.kind === "decision" && event.agent === agent,
    );
    expect(stop).toMatchObject({
      part: "outbound-gate",
      outcome: "stop",
      reason: "evidence-invalid",
    });
  }
}, 300_000);

it("requires the exact fee invoke grant alongside the credential and representation grants", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const entry = scenario.configurations.find((candidate) => candidate.id === id)!;
  scenario.branches = [];
  entry.world.branches = [
    {
      id: "withheld-invoke",
      what: "The permission for the exact signed fee invoke is missing.",
      onlyUnder: id,
      change: { stopAfter: "file-claim" },
      expect: { outcome: "stop", check: "evidence", reason: "evidence-invalid" },
      outline: [],
    },
  ];
  let withheld = 0;
  const runTask = AgentRuntime.prototype.runTask;
  const filter = vi.spyOn(AgentRuntime.prototype, "runTask").mockImplementation(function (
    this: AgentRuntime,
    task,
  ) {
    if (task.kind === "record-release" && task.plan.params.operation === "submit") {
      const params = task.plan.params;
      const request = decodeCompactPayload(String(params.request));
      const segment = recordSegmentSchema.parse(decodeCompactPayload(String(request.segment)));
      if (!segment.conversation.includes("withheld-invoke")) return runTask.call(this, task);
      const invokes = new Set<string>(segment.messages.map(({ jws }) => digestOf(jws)));
      const grants = (params.proofGrants as string[]).filter((proof) => {
        if (!invokes.has(String(decodeCompactPayload(proof).digest))) return true;
        withheld++;
        return false;
      });
      const reduced = { ...params, proofGrants: grants };
      return runTask.call(this, {
        ...task,
        plan: {
          ...task.plan,
          params: reduced,
          intent: { ...task.plan.intent, parameters: reduced },
        },
      });
    }
    return runTask.call(this, task);
  });
  try {
    const paths = await runScenario(profile, scenario, { configuration: id });
    const path = paths.find(({ path }) => path === "withheld-invoke");
    expect(withheld).toBeGreaterThan(0);
    expect(path?.trace?.events).toContainEqual(
      expect.objectContaining({
        agent: "sams-agent",
        part: "outbound-gate",
        kind: "decision",
        outcome: "stop",
        reason: "evidence-invalid",
      }),
    );
    expect(path?.trace?.events.some(({ agent }) => agent === "forum")).toBe(false);
  } finally {
    filter.mockRestore();
  }
}, 300_000);
