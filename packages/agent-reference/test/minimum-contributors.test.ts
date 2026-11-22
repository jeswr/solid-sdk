// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "../src/core/types.js";
import { loadSparqAggregate } from "../src/derive/adapters/sparq-aggregate.js";
import { verifyJointMessageOutcome } from "../src/derive/verification.js";
import { verifierRegistry } from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import type { Scenario } from "../src/engine/schema.js";

const backend = loadSparqAggregate();
const root = new URL("..", import.meta.url).pathname;

const employers = ["contributor-1-agent", "contributor-2-agent", "contributor-3-agent"];

function stopAfterContributions(script: Scenario["script"], contributors: readonly string[]) {
  const last = script.findIndex((step) => step.id === `contribution-${contributors.at(-1)}`);
  if (last < 0) throw new Error("Incomplete salary fixture");
  return script
    .slice(0, last + 1)
    .filter(
      (step) =>
        !(
          step.type === "joint-send" &&
          step.operation === "contribute" &&
          contributors.includes(step.agent)
        ) &&
        !(
          step.type === "receive" &&
          step.from !== undefined &&
          contributors.includes(step.from) &&
          step.id.startsWith("receive-contribute-")
        ),
    );
}

function threeEmployers(scenario: Scenario, minimum: number) {
  const session = scenario.jointSession!;
  const excluded = session.contributors.filter((party) => !employers.includes(party));
  session.minimumContributors = minimum;
  session.contributors = employers;
  session.inputs = Object.fromEntries(employers.map((agent) => [agent, session.inputs[agent]!]));
  scenario.script = scenario.script.filter(
    (step) =>
      !excluded.includes(step.agent) &&
      !(step.type === "joint-send" && excluded.includes(step.peer)) &&
      !(step.type === "receive" && step.from !== undefined && excluded.includes(step.from)) &&
      step.id !== "check-verified-total",
  );
  scenario.branches = [];
}

const assertNoFacts: Scenario["script"] = [
  { id: "requester-facts", type: "facts", agent: "requester-agent" },
  {
    id: "check-observed-release",
    type: "assert",
    agent: "requester-agent",
    // biome-ignore lint/style/useNamingConvention: scenario template field
    actual: { $ref: "steps.requester-facts" },
    expected: [],
    operator: "equals",
  },
];
const aggregateOptions = { compare: false, registry: verifierRegistry(backend ? [backend] : []) };

describe.skipIf(!backend)("joint contributor minimum with the optional aggregate package", () => {
  it("stops both employers when the third slot only computes", async () => {
    const { profile, scenario } = loadCase(root, "salary-benchmark");
    const branch = scenario.branches.find((b) => b.id === "branch-1")!;
    const change = branch.change as Pick<Scenario, "jointSession" | "script">;
    const contributors = change.jointSession!.contributors;
    change.script = [...stopAfterContributions(change.script, contributors), ...assertNoFacts];
    scenario.branches = [branch];
    const [, failure] = await runScenario(profile, scenario, aggregateOptions);
    const events = failure!.trace!.events;
    expect(events.filter((e) => e.kind === "decision" && e.outcome === "stop")).toEqual(
      contributors.map((agent) => expect.objectContaining({ agent, reason: "prohibited" })),
    );
    for (const agent of contributors)
      expect(events).toContainEqual(
        expect.objectContaining({
          agent,
          part: "outbound-gate",
          check: "data-terms",
          verdict: "fail",
          reason: "prohibited",
        }),
      );
    expect(
      events.some(
        (e) =>
          contributors.includes(e.agent) &&
          e.kind === "message-out" &&
          /urn:op:joint:(contribute|partial)/.test(e.packet?.jsonld ?? ""),
      ),
    ).toBe(false);
    expect(
      events.some(
        (e) =>
          e.agent === "computer-agent" &&
          e.kind === "message-out" &&
          /urn:op:joint:contribute/.test(e.packet?.jsonld ?? ""),
      ),
    ).toBe(true);
  }, 120_000);

  it.each([
    1, 3,
  ])("uses the local minimum of three even when the requester states %s", async (minimum) => {
    const { profile, scenario } = loadCase(root, "salary-benchmark");
    threeEmployers(scenario, minimum);
    if (minimum === 1)
      scenario.script = [...stopAfterContributions(scenario.script, employers), ...assertNoFacts];
    const [path] = await runScenario(profile, scenario, aggregateOptions);
    const events = path!.trace!.events;
    if (minimum === 1) {
      expect(events).toContainEqual(
        expect.objectContaining({
          agent: employers[0],
          check: "data-terms",
          verdict: "fail",
          reason: "prohibited",
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          agent: employers[0],
          outcome: "stop",
          reason: "prohibited",
        }),
      );
    } else {
      expect(events).toContainEqual(
        expect.objectContaining({
          agent: "requester-agent",
          part: "inbound-gate",
          outcome: "admit",
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          agent: "requester-agent",
          rule: expect.objectContaining({ id: "DER-14" }),
          verdict: "pass",
        }),
      );
      expect(events.some((e) => e.kind === "decision" && e.outcome === "stop")).toBe(false);
    }
  }, 120_000);

  it("preserves the recorded salary main projection", async () => {
    const { profile, scenario } = loadCase(root, "salary-benchmark");
    const [main] = await runScenario(profile, { ...scenario, branches: [] }, aggregateOptions);
    const oracle = JSON.parse(
      readFileSync(new URL("./oracle/pre-rdf.json", import.meta.url), "utf8"),
    );
    expect(
      main!.trace!.events.map(({ agent, part, kind, check, verdict, reason, outcome }) => ({
        agent,
        part,
        kind,
        check,
        verdict,
        reason,
        outcome,
      })),
    ).toEqual(oracle["salary-benchmark/main"]);
  }, 120_000);

  it("refuses a verified release at the receiver when the finisher only computes", async () => {
    const protocol = backend!;
    const parties = ["urn:joint:employer-a", "urn:joint:employer-b", "urn:joint:finisher"];
    const keys = await Promise.all(
      parties.map((party) => protocol.generateKeys(new TextEncoder().encode(party))),
    );
    const made = await protocol.newSession({
      sessionId: Buffer.alloc(32, 34).toString("base64url"),
      statistic: "count-and-sum",
      minimumGroup: 10,
      minimumContributors: 3,
      roster: parties.map((party, i) => ({
        party,
        publicKeys: keys[i]!.publicKeys,
        computeOnly: i === 2,
      })),
    });
    const states = await Promise.all(
      parties.map((party, i) =>
        protocol.contribute({
          session: made.session,
          party,
          secretKeys: keys[i]!.secretKeys,
          count: i === 2 ? 0 : 6,
          sum: i === 2 ? 0 : 600,
        }),
      ),
    );
    const contributions = states.map((state) => state.contribution);
    const partials = await Promise.all(
      parties.map((party, i) =>
        protocol.receiveAndPartial({
          session: made.session,
          party,
          secretKeys: keys[i]!.secretKeys,
          contributions,
          shares: [],
          local: states[i]!.local,
        }),
      ),
    );
    const finisher = partials[2];
    if (!finisher?.ok) throw new Error("Finisher's partial did not verify");
    const outcome = await protocol.finish({
      session: made.session,
      party: parties[2]!,
      secretKeys: keys[2]!.secretKeys,
      contributions,
      partials: partials.slice(0, 2).flatMap((part, i) => {
        if (!part.ok) throw new Error("Employer's partial did not verify");
        return (part.partial.messages as JsonObject[])
          .filter((message) => message.recipient === 2)
          .map((message) => ({ party: parties[i]!, message }));
      }),
      local: finisher.local,
    });
    expect(outcome).toMatchObject({ type: "release", count: 12, sum: 1200 });
    expect(
      await protocol.verifyOutcome({ session: made.session, outcome, contributions }),
    ).toMatchObject({ ok: true, contributors: parties });
    const rule = "urn:joint:rule",
      purpose = "urn:joint:purpose";
    expect(
      await verifyJointMessageOutcome(
        {
          acceptedJoint: [
            { rule, method: protocol.method, purposes: [purpose], minimumContributors: 3 },
          ],
          jointProtocols: verifierRegistry([protocol]).jointProtocols,
          fixedJointSessions: {
            [String(made.session.sessionId)]: {
              ...made,
              rule,
              method: protocol.method,
              purpose,
              assurances: ["joint"],
            },
          },
        },
        {
          sessionId: made.session.sessionId!,
          outcome: outcome as unknown as JsonObject,
          contributions,
        },
        purpose,
      ),
    ).toMatchObject({ ok: false, reason: "derivation-not-verified" });
  }, 60_000);
});
