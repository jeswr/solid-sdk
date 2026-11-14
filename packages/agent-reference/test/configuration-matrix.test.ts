// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { matrixWorld } from "../src/engine/matrix.js";
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

it("runs scoped branches and the declared layer change in each matrix cell", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const results = await runScenario(profile, scenario, { configuration: "all" });
  expect(results).toHaveLength(
    4 +
      scenario.configurations.reduce(
        (count, entry) =>
          count +
          1 +
          scenarioSchema
            .parse(matrixWorld(scenario, entry))
            .branches.filter((branch) => !branch.onlyUnder || branch.onlyUnder === entry.id).length,
        0,
      ),
  );
  expect(results.filter((result) => !result.configuration).map((result) => result.path)).toEqual([
    "main",
    "fee-amount-differs",
    "fee-payee-differs",
    "fee-no-offer",
  ]);
  for (const entry of scenario.configurations) {
    const paths = results.filter((result) => result.configuration === entry.id);
    expect(paths.map((result) => result.path)).toEqual([
      "main",
      ...scenarioSchema
        .parse(matrixWorld(scenario, entry))
        .branches.filter(
          (branch) =>
            !("onlyUnder" in branch) || !branch.onlyUnder || branch.onlyUnder === entry.id,
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
      continue;
    }
    const header = paths[0]?.trace?.configuration;
    expect(header?.id).toBe(entry.id);
    for (const event of paths[0]?.trace?.events ?? []) {
      expect(event.caption).not.toMatch(/https?:\/\/|urn:/);
      expect(event.rule?.text ?? "").not.toMatch(/https?:\/\/|urn:/);
      expect(event.chat?.text ?? "").not.toMatch(/https?:\/\/|urn:/);
    }
    expect(Object.keys(header?.layers ?? {})).toEqual(Object.keys(BASELINE.layers));
    expect(
      Object.keys(BASELINE.layers).filter(
        (layer) =>
          header?.layers[layer as keyof typeof BASELINE.layers] !==
          BASELINE.layers[layer as keyof typeof BASELINE.layers],
      ),
    ).toEqual(Object.keys(entry.change));
  }
  // The matrix now includes 34 more live paths; retain every assertion and budget the aggregate run.
}, 900_000);

it("refuses a signed opening under a configuration the receiver does not advertise", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-core");
  const parties = structuredClone(scenario.parties);
  const sender = parties.find((party) => party.id === "sam-agent");
  const receiver = parties.find((party) => party.id === "north-agent");
  if (!sender || !receiver) throw new Error("Missing agents");
  sender.configurations = ["transport-email"];
  receiver.configurations = ["baseline"];
  scenario.configurations = [
    {
      id: "transport-email",
      change: { transport: "email" },
      world: {
        parties,
        script: scenario.script.slice(0, 3),
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
  scenario.configurations = [
    {
      id: "transport-email",
      change: { transport: "email" },
      world: {
        parties,
        script: scenario.script.slice(0, 5),
        carriage: { parties: ["sam-agent", "north-agent"] },
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
  const result = (await runScenario(profile, scenario, { configuration: "transport-email" }))[0];
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
