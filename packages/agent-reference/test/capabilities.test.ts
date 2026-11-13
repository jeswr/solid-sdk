// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { CORE_REASON_CODES } from "../src/core/types.js";
import { loadCase } from "../src/engine/load.js";
import { patch, runScenario } from "../src/engine/run.js";
import { checkOrganisationApprovals } from "../src/gates/approvals.js";
import { GateMemory } from "../src/gates/common.js";
import { paymentBinding } from "../src/gates/payment.js";

const root = join(import.meta.dirname, "..");
const run = async (id: string) => {
  const { profile, scenario } = loadCase(root, id);
  return runScenario(profile, scenario);
};
it("executes every new catalogue path with canonical reasons and declared stand-ins", async () => {
  for (const id of ["master-data-change", "pay-an-invoice", "false-but-signed", "flat-share"]) {
    const { profile, scenario } = loadCase(root, id);
    const results = await runScenario(profile, scenario);
    expect(results).toHaveLength(scenario.branches.length + 1);
    for (const result of results) {
      expect(result.blocked).toBeUndefined();
      expect(result.matches).toBe(true);
      expect(result.trace?.standIns).toEqual(profile.standIns);
      for (const e of result.trace?.events ?? [])
        if (e.reason) expect(CORE_REASON_CODES).toContain(e.reason);
    }
  }
});
it("requires two controllers and records a rejected self-approval without performing an effect", async () => {
  const results = await run("master-data-change");
  const main = results[0]?.trace?.events ?? [];
  expect(
    main.filter((e) => e.check === "limits-approval" && e.verdict === "ask-principal").length,
  ).toBeGreaterThanOrEqual(2);
  expect(main.some((e) => e.check === "evidence" && e.verdict === "pass")).toBe(true);
  expect(results[1]?.trace?.events.at(-1)).toMatchObject({
    outcome: "stop",
    reason: "not-authorised",
  });
});
it("corroboration rejects disagreement, a shared controller, missing control provenance and stale corroborators", async () => {
  const { profile, scenario } = loadCase(root, "false-but-signed");
  for (const change of [
    {},
    { trust: { controllers: { "urn:fictional:tax-register": "urn:controller:employer" } } },
    { trust: { controllers: { "urn:fictional:tax-register": "" } } },
  ]) {
    const world = patch(scenario, { ...change, branches: [], stress: ["source", "fitness"] });
    if (Object.keys(change).length && world.statements[1]) world.statements[1].value.value = 90000;
    const results = await runScenario(profile, world, { compare: false });
    expect(
      results[0]?.trace?.events.some(
        (e) => e.outcome === "ask-more" && e.reason === "completeness-not-established",
      ),
    ).toBe(true);
  }
  const agreeing = structuredClone(scenario);
  if (!agreeing.statements[1]) throw new Error("fixture");
  agreeing.statements[1].value.value = 90000;
  agreeing.branches = [];
  agreeing.stress = ["source", "fitness"];
  const pass = await runScenario(profile, agreeing, { compare: false });
  expect(pass[0]?.trace?.events.filter((e) => e.outcome === "admit")).toHaveLength(2);
  agreeing.statements[1].asOf = "2025-01-01T00:00:00.000Z";
  const stale = await runScenario(profile, agreeing, { compare: false });
  expect(stale[0]?.trace?.events.some((e) => e.reason === "completeness-not-established")).toBe(
    true,
  );
});
it("with no corroboration requirement the false claim passes and the record names its signer", async () => {
  const results = await run("false-but-signed");
  const events = results[1]?.trace?.events ?? [];
  expect(
    events
      .filter((e) => e.kind === "check")
      .every((e) => e.verdict === "pass" || e.verdict === "not-applicable"),
  ).toBe(true);
  expect(events.some((e) => e.outcome === "go")).toBe(true);
  expect(events.find((e) => e.kind === "store")?.fact?.source).toBe("urn:fictional:employer");
});
it("an unknown sender is held outside core memory, and refusal cannot admit it", async () => {
  const { profile, scenario } = loadCase(root, "flat-share");
  const held = (await runScenario(profile, scenario))[1]?.trace?.events ?? [];
  expect(held.at(-2)).toMatchObject({ outcome: "ask-principal", reason: "source-unknown" });
  expect(
    held.filter(
      (e) => e.agent === "blair-agent" && ["store", "recall", "propose"].includes(e.kind),
    ),
  ).toEqual([]);
  const denied = patch(scenario, {
    branches: [],
    script: [
      ...scenario.script.slice(0, 2),
      { id: "deny", agent: "blair-agent", type: "trust-decision", decision: "deny" },
    ],
  });
  const events = (await runScenario(profile, denied, { compare: false }))[0]?.trace?.events ?? [];
  expect(events.at(-1)).toMatchObject({ outcome: "refuse", reason: "source-unknown" });
});
it("does not count repeated signers, missing/expired/withdrawn roles or the requester", () => {
  const memory = new GateMemory();
  const intent = {
    action: "use",
    operation: "urn:op",
    target: "urn:op",
    parameters: {},
    conversation: "urn:task",
  };
  const rule = { count: 2, roles: ["finance-controller"], distinctFromRequester: true };
  const approval = {
    type: "OrganisationApproval" as const,
    id: "urn:approval",
    signer: "urn:alice",
    actor: "urn:agent",
    kid: "key-alice",
    actionDigest: "digest",
    conversation: "urn:task",
    issuedAt: "2026-11-13T09:00:00.000Z",
    validUntil: "2026-12-01T00:00:00.000Z",
  };
  const base = {
    intent,
    rule,
    approvals: [approval],
    memory,
    task: "urn:task",
    organization: "urn:org",
    requester: "urn:requester",
    at: "2026-11-13T09:00:00.000Z",
  };
  expect(checkOrganisationApprovals(base)).toBe("invalid");
  const role = {
    kind: "statement" as const,
    id: "urn:role",
    digest: "digest",
    accepted: true,
    source: "urn:directory",
    claimType: "organization.role",
    label: "role",
    statement: {
      subject: "urn:alice",
      subjectKey: "key-alice",
      role: "finance-controller",
      organization: "urn:org",
      validFrom: "2026-11-01T00:00:00.000Z",
      validUntil: "2026-12-01T00:00:00.000Z",
      status: "active",
    },
  };
  memory.enter("urn:task", role);
  memory.facts.set(role.id, role);
  expect(
    checkOrganisationApprovals({
      ...base,
      approvals: [approval, { ...approval, id: "urn:another" }],
    }),
  ).toBe("missing");
  expect(checkOrganisationApprovals({ ...base, requester: "urn:alice" })).toBe("invalid");
  expect(checkOrganisationApprovals({ ...base, at: "2027-01-01T00:00:00.000Z" })).toBe("invalid");
  memory.enter("urn:task", {
    ...role,
    id: "urn:withdrawal",
    statement: { ...role.statement, status: "withdrawn" },
  });
  memory.facts.set("urn:withdrawal", { ...role, id: "urn:withdrawal" });
  expect(checkOrganisationApprovals(base)).toBe("invalid");
});
it("invoice-only payment data never establishes an account, and payment prose is refused", () => {
  const memory = new GateMemory();
  memory.rememberIdentifiers("urn:task", ["urn:payee", "urn:invoice"]);
  const intent = {
    action: "pay",
    operation: "urn:op",
    target: "urn:op",
    conversation: "urn:task",
    parameters: { payee: "urn:payee", reference: "urn:invoice", amount: 10, currency: "GBP" },
  };
  expect(paymentBinding(intent, memory, "urn:task", "2026-11-13T09:00:00.000Z", "urn:actor")).toBe(
    "structured-form-required",
  );
  expect(
    paymentBinding(
      { ...intent, parameters: { ...intent.parameters, note: "Please pay them" } },
      memory,
      "urn:task",
      "2026-11-13T09:00:00.000Z",
      "urn:actor",
    ),
  ).toBe("structured-form-required");
});

it("a trust pin is rechecked for a new purpose and after its expiry", async () => {
  const { profile, scenario } = loadCase(root, "flat-share");
  const opening = scenario.script[0];
  if (!opening || opening.type !== "start") throw new Error("opening");
  for (const otherScope of [true, false]) {
    const next = structuredClone(opening);
    next.id = "another-offer";
    const steps = scenario.script.slice(0, 3);
    if (!otherScope)
      steps.push({
        id: "expire-pin",
        agent: "blair-agent",
        type: "advance",
        milliseconds: 25 * 3600_000,
      });
    steps.push(next, {
      id: "another-receive",
      agent: "blair-agent",
      type: "receive",
      from: "alex-agent",
    });
    const world = patch(scenario, {
      branches: [],
      script: steps,
      inject: otherScope
        ? [
            {
              step: "another-receive",
              target: "body",
              path: ["terms", "purpose"],
              value: "urn:purpose:other-task",
              resign: true,
            },
          ]
        : [],
    });
    const events = (await runScenario(profile, world, { compare: false }))[0]?.trace?.events ?? [];
    expect(events.at(-2)).toMatchObject({ outcome: "ask-principal", reason: "source-unknown" });
  }
});
