// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it, vi } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import * as quality from "../src/gates/quality.js";

const root = join(import.meta.dirname, "..");

it("does not label an unsigned mailbox as a negotiated prose upgrade", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const paths = await runScenario(profile, scenario, {
    configuration: "meaning-plain-language-upgrade",
  });
  expect(paths.map((path) => path.path)).toEqual(["main", "prose-as-evidence"]);
  for (const path of paths) {
    expect(path.trace).toBeUndefined();
    expect(path.blocked).toContain("upgrade boundary is not implemented");
  }
});

it("maps the payroll status through an accepted publisher and confines the journey to meaning", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const baseline = (await runScenario(profile, scenario))[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: "meaning-registry-lookup" });
  const main = paths[0]?.trace;
  expect(
    paths.map((path) => ({
      path: path.path,
      actual: path.actual,
      blocked: path.blocked,
      note: path.note,
    })),
  ).toMatchObject([
    { path: "main", blocked: undefined },
    {
      path: "mapping-from-nobody",
      actual: { outcome: "ask-more", reason: "unsupported-term", check: "fitness" },
    },
  ]);
  if (!baseline || !main) throw new Error("Missing real mortgage trace");
  expect(confinementDifferences(baseline, main, "meaning")).toEqual([]);
  const description = main.events.find(
    (event) =>
      event.agent === "lender" &&
      event.kind === "message-out" &&
      event.packet?.kind === "description",
  )?.packet?.layers.content.raw as
    | { description?: { vocabularies?: { iri: string; relation: string }[] } }
    | undefined;
  const vocabulary = scenario.configurations.find((c) => c.id === "meaning-registry-lookup")?.world
    .registryMeaning as { requestedList: string; policy: { routes: { fromList: string }[] } };
  expect(description?.description?.vocabularies).toEqual(
    expect.arrayContaining([
      { iri: vocabulary.requestedList, relation: "implements-versioned-code-list" },
      { iri: vocabulary.policy.routes[0]!.fromList, relation: "maps-from-versioned-code-list" },
    ]),
  );
  const mapped = main.events.find((event) => event.fact?.claimType === "employment.status")?.fact;
  expect(
    main.events.some(
      (event) => event.agent === "sams-agent" && event.fact?.claimType === "employment.status",
    ),
  ).toBe(true);
  expect(mapped?.value).toMatchObject({
    code: "employed",
    method: "derived",
    signedParentDigest: expect.stringMatching(/^sha-256:/),
    derivation: { type: "code-mapping", version: "1", originalCode: { code: "PAYE" } },
  });
  expect(
    paths[1]?.trace?.events.some((event) => event.fact?.claimType === "employment.status"),
  ).toBe(false);
  expect(paths[1]?.disagrees).toBe(false);
}, 60_000);

it("requires principals’ exact-exchange term approvals rather than the agents’ agreement", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const baseline = (await runScenario(profile, scenario))[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: "meaning-negotiated" });
  const main = paths[0]?.trace;
  if (!baseline || !main) throw new Error("Missing real mortgage trace");
  expect(confinementDifferences(baseline, main, "meaning")).toEqual([]);
  const record = main.events.find((event) => event.fact?.claimType === "term.deliberation");
  expect(record?.fact?.value).toMatchObject({
    principalApprovals: 2,
    signedRecord: expect.any(String),
  });
  expect(
    main.events.some(
      (event) => event.check === "disclosure" && event.caption.includes("principals approved"),
    ),
  ).toBe(true);
  expect(paths[1]?.actual).toMatchObject({
    check: "disclosure",
    outcome: "ask-principal",
    reason: "approval-required",
  });
  expect(paths[1]?.disagrees).toBe(false);
  expect(
    paths[1]?.trace?.events.find((event) => event.fact?.claimType === "term.deliberation")?.fact
      ?.value,
  ).toMatchObject({ principalApprovals: 0 });
}, 60_000);

it("uses an accepted index certificate and falls back to per-record freshness outside its category", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const baseline = (await runScenario(profile, scenario))[0]?.trace;
  const paths = await runScenario(profile, scenario, {
    configuration: "reliance-quality-certificate",
  });
  const main = paths[0]?.trace;
  if (!baseline || !main) throw new Error("Missing real mortgage trace");
  expect(confinementDifferences(baseline, main, "reliance")).toEqual([]);
  expect(
    main.events.some(
      (event) =>
        event.agent === "sams-agent" &&
        event.check === "fitness" &&
        event.verdict === "pass" &&
        event.caption.includes("no per-record freshness"),
    ),
  ).toBe(true);
  expect(paths[1]?.actual).toMatchObject({
    check: "fitness",
    outcome: "admit",
    reason: "stale-data",
  });
  expect(paths[1]?.disagrees).toBe(false);
  expect(
    paths[1]?.trace?.events.some(
      (event) =>
        event.agent === "sams-agent" && event.fact?.id === "urn:awp:product:northbank-fixed-5",
    ),
  ).toBe(false);
}, 60_000);

it("skips per-record quality work for certified products, including the admission batch", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const entry = scenario.configurations.find((c) => c.id === "reliance-quality-certificate");
  if (!entry) throw new Error("Missing certificate configuration");
  entry.world.branches = [];
  const checked = vi.spyOn(quality, "fitnessOf");
  try {
    const paths = await runScenario(profile, scenario, {
      configuration: "reliance-quality-certificate",
    });
    expect(paths[0]?.trace).toBeDefined();
    expect(paths[0]?.disagrees).toBe(false);
    expect(checked.mock.calls.filter(([claim]) => claim.claimType === "mortgage.product")).toEqual(
      [],
    );
  } finally {
    checked.mockRestore();
  }
}, 60_000);

it("accepts calibrated bank confidence and refuses a high uncalibrated model estimate", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const baseline = (await runScenario(profile, scenario))[0]?.trace;
  const paths = await runScenario(profile, scenario, {
    configuration: "reliance-stated-confidence",
  });
  const main = paths[0]?.trace;
  if (!baseline || !main) throw new Error("Missing real mortgage trace");
  expect(confinementDifferences(baseline, main, "reliance")).toEqual([]);
  expect(
    main.events.some(
      (event) =>
        event.check === "fitness" &&
        event.verdict === "pass" &&
        event.caption.includes("confidence meets"),
    ),
  ).toBe(true);
  expect(paths[1]?.actual).toMatchObject({
    check: "fitness",
    outcome: "ask-more",
    reason: "confidence-too-low",
  });
  expect(paths[1]?.disagrees).toBe(false);
  expect(
    paths[1]?.trace?.events.some(
      (event) =>
        event.agent === "lender" && event.fact?.claimType === "income.gross.monthly-series",
    ),
  ).toBe(false);
}, 60_000);

it("requires independent bank credits within tolerance and refuses the same root record twice", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const baseline = (await runScenario(profile, scenario))[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: "reliance-corroboration" });
  const main = paths[0]?.trace;
  if (!baseline || !main) throw new Error("Missing real mortgage trace");
  expect(confinementDifferences(baseline, main, "reliance")).toEqual([]);
  expect(
    main.events.some(
      (event) =>
        event.check === "fitness" &&
        event.verdict === "pass" &&
        event.caption.includes("salary credits agree"),
    ),
  ).toBe(true);
  expect(paths[1]?.actual).toMatchObject({
    check: "fitness",
    outcome: "ask-more",
    reason: "evidence-missing",
  });
  expect(paths[1]?.disagrees).toBe(false);
  expect(
    paths[1]?.trace?.events.some(
      (event) =>
        event.agent === "lender" && event.fact?.claimType === "income.gross.monthly-series",
    ),
  ).toBe(false);
}, 60_000);
