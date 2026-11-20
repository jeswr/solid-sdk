// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { matrixPrerequisite, matrixWorld } from "../src/engine/matrix.js";
import { patch, runScenario } from "../src/engine/run.js";
import { scenarioSchema } from "../src/engine/schema.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";
import { BASELINE } from "../src/suites/baseline.js";

const root = join(import.meta.dirname, "..");

it("validates exactly one registered layer and its registered suite, with a matching id", () => {
  const { scenario } = loadCase(root, "mortgage-core");
  for (const entry of [
    { id: "transport-email", change: { transport: "email", trust: "pinned-list" } },
    { id: "transport-email", change: { unknown: "email" } },
    { id: "transport-email", change: { transport: "unknown" } },
    { id: "transport-email", change: { transport: "jws" } },
    { id: "transport-direct-http", change: { transport: "direct-http" } },
    { id: "email", change: { transport: "email" } },
  ])
    expect(() => scenarioSchema.parse({ ...scenario, configurations: [entry] })).toThrow();
  expect(
    scenarioSchema.parse({
      ...scenario,
      configurations: [
        { id: "authenticity-data-integrity", change: { authenticity: "data-integrity" } },
      ],
    }).configurations[0]?.world,
  ).toEqual({});
});

it("upserts world and branch lists by id while preserving existing literal-array patch behavior", () => {
  const original = {
    script: [
      { id: "first", value: 1 },
      { id: "second", value: 2 },
    ],
  };
  expect(patch(original, { script: { second: { value: 3 }, third: { value: 4 } } })).toEqual({
    script: [
      { id: "first", value: 1 },
      { id: "second", value: 3 },
      { id: "third", value: 4 },
    ],
  });
  expect(patch(original, { script: [{ id: "only", value: 9 }] }).script).toHaveLength(1);
  expect(patch({ mandates: [] }, { mandates: { agent: { autonomous: [] } } })).toEqual({
    mandates: [{ agent: "agent", autonomous: [] }],
  });
  expect(() => patch(original, { script: { first: { id: "second" } } })).toThrow(
    "identity mismatch",
  );
  expect(() => patch(original, JSON.parse('{"script":{"__proto__":{"value":2}}}'))).toThrow();
});

const mortgage = loadCase(root, "mortgage-main");

it("runs the four unconfigured mortgage paths", async () => {
  const results = await runScenario(mortgage.profile, mortgage.scenario);
  expect(results.every((result) => result.configuration === undefined)).toBe(true);
  expect(results.map((result) => result.path)).toEqual([
    "main",
    "fee-amount-differs",
    "fee-payee-differs",
    "fee-no-offer",
  ]);
}, 180_000);

it.each(
  mortgage.scenario.configurations.map(({ id }) => id),
)("runs scoped branches and the declared layer change in %s", async (configuration) => {
  const { profile, scenario } = mortgage;
  const entry = scenario.configurations.find(({ id }) => id === configuration);
  if (!entry) throw new Error("Missing matrix entry");
  const paths = await runScenario(profile, scenario, { configuration });
  expect(paths.every((path) => path.configuration === entry.id)).toBe(true);
  expect(paths.map((result) => result.path)).toEqual([
    "main",
    ...scenarioSchema
      .parse(matrixWorld(scenario, entry))
      .branches.filter(
        (branch) => !("onlyUnder" in branch) || !branch.onlyUnder || branch.onlyUnder === entry.id,
      )
      .map((branch) => branch.id),
  ]);
  if (configurationById(alternativeWireId(entry.id))?.status === "unresolved") {
    for (const path of paths) {
      expect(path.trace).toBeUndefined();
      expect(path.blocked).toMatch(
        /no executable runtime configuration|registered suite constraint/,
      );
    }
    return;
  }
  const header = paths[0]?.trace?.configuration;
  expect(header?.id).toBe(entry.id);
  for (const event of paths[0]?.trace?.events ?? []) {
    expect(event.caption).not.toMatch(/https?:\/\/|urn:/);
    expect(event.rule?.text ?? "").not.toMatch(/https?:\/\/|urn:/);
    // Exact text under principal review keeps its bytes (brief 31 §2.4): the drafted email
    // and the exact action parameters an approval binds to are shown as they are.
    const reviewed =
      event.part === "core" &&
      event.caption === "Agent-written plain text for exact principal review.";
    const chat = reviewed ? "" : (event.chat?.text ?? "").split(" Parameters: ")[0];
    expect(chat).not.toMatch(/https?:\/\/|urn:/);
  }
  expect(Object.keys(header?.layers ?? {})).toEqual(Object.keys(BASELINE.layers));
  expect(
    Object.keys(BASELINE.layers).filter(
      (layer) =>
        header?.layers[layer as keyof typeof BASELINE.layers] !==
        BASELINE.layers[layer as keyof typeof BASELINE.layers],
    ),
  ).toEqual(
    // With `requires`, the prerequisite's layer change is part of the cell (brief 31 item 4).
    Object.keys(BASELINE.layers).filter(
      (layer) =>
        layer in entry.change || layer in (matrixPrerequisite(scenario, entry)?.change ?? {}),
    ),
  );
}, 180_000);

it("refuses a signed opening under a configuration the receiver does not advertise", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-core");
  const parties = structuredClone(scenario.parties);
  const sender = parties.find((party) => party.id === "sam-agent");
  const receiver = parties.find((party) => party.id === "north-agent");
  if (!sender || !receiver) throw new Error("Missing agents");
  sender.configurations = ["transport-email"];
  receiver.configurations = ["baseline"];
  scenario.script = scenario.script.slice(0, 3);
  scenario.branches = [];
  scenario.configurations = [
    {
      id: "transport-email",
      change: { transport: "email" },
      world: {
        parties,
        carriage: { parties: [sender.id, receiver.id] },
      },
    },
  ];
  const result = (await runScenario(profile, scenario, { configuration: "transport-email" }))[0];
  expect(
    result?.trace?.events.some(
      (event) => event.outcome === "refuse" && event.reason === "unsupported-configuration",
    ),
  ).toBe(true);
  expect(
    result?.trace?.events.some((event) => event.part === "core" && event.agent === "lender"),
  ).toBe(false);
});

it("refuses a signed step down inside an already selected conversation", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-core");
  const parties = structuredClone(scenario.parties).map((party) => ({
    ...party,
    configurations: ["transport-email", "baseline"],
  }));
  scenario.script = scenario.script.slice(0, 5);
  scenario.branches = [
    {
      id: "step-down",
      what: "The sender signs an application under the wrong configuration.",
      onlyUnder: "transport-email",
      expect: { outcome: "admit", check: "integrity", reason: "intact" },
      catalogueExpected: { outcome: "refuse", reason: "configuration-mismatch" },
      outline: [],
      change: {
        inject: [
          {
            step: "application-arrives",
            target: "message",
            path: ["configuration"],
            value: BASELINE.pilotConfiguration,
            resign: true,
          },
        ],
      },
    },
  ];
  scenario.configurations = [
    {
      id: "transport-email",
      change: { transport: "email" },
      world: {
        parties,
        carriage: { parties: ["sam-agent", "north-agent"] },
      },
    },
  ];
  const paths = await runScenario(profile, scenario, { configuration: "transport-email" });
  const result = paths.find((path) => path.path === "step-down");
  expect(result).toMatchObject({
    disagrees: false,
    actual: { outcome: "refuse", reason: "configuration-mismatch" },
  });
  expect(
    result?.trace?.events.some(
      (event) => event.outcome === "refuse" && event.reason === "configuration-mismatch",
    ),
  ).toBe(true);
});

it("reruns every ordinary branch under each selected configuration", async () => {
  const { profile, scenario } = loadCase(root, "probing-counterparty");
  scenario.configurations = [
    {
      id: "transport-email",
      change: { transport: "email" },
      world: { carriage: { parties: ["person-agent", "service-agent"] } },
    },
  ];
  const paths = await runScenario(profile, scenario, { configuration: "all" });
  const expected = ["main", ...scenario.branches.map((branch) => branch.id)];
  expect(paths.filter((path) => !path.configuration).map((path) => path.path)).toEqual(expected);
  expect(
    paths.filter((path) => path.configuration === "transport-email").map((path) => path.path),
  ).toEqual(expected);
  expect(paths.every((path) => path.trace && !path.blocked)).toBe(true);
});
