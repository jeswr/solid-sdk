// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { RDF_TYPE } from "../src/model/store/common.js";
import { AWP } from "../src/profile/vocabulary.js";
import type { TraceFile } from "../src/trace/types.js";

it("lifts the signed key-bound grant, confines the journey and refuses an absent actor", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, {
    configuration: "authority-authorization-server",
    linked: true,
  });
  const main = paths.find((p) => p.path === "main"),
    failure = paths.find((p) => p.path === "token-as-the-person");
  if (!baseline || !main?.trace || !failure?.trace)
    throw new Error("The real authority grant paths must run");
  expect(confinementDifferences(baseline, main.trace, "authority")).toEqual([]);
  const lift = main.trace.events.find((e) => e.fact?.claimType === "authority.grant-lift");
  if (!lift) throw new Error("Missing grant lift event");
  const { linked, ...plainLift } = lift;
  const committed: TraceFile = JSON.parse(
    readFileSync(
      new URL("../traces/mortgage-main--authority-authorization-server.json", import.meta.url),
      "utf8",
    ),
  );
  const committedLift = committed.events.find((e) => e.fact?.claimType === "authority.grant-lift");
  if (!committedLift) throw new Error("Missing committed grant lift event");
  const { linked: _committedKeys, ...committedPlainLift } = committedLift;
  expect(plainLift).toEqual(committedPlainLift);
  const views = linked?.map((key) => main.trace?.linked?.[key]);
  expect(views?.map((view) => view?.what)).toEqual(["record-entry"]);
  const dataset = await parseRdf(views?.[0]?.turtle ?? "", "text/turtle");
  const grants = dataset.getSubjects(RDF_TYPE, `${AWP}GrantRecord`, null);
  expect(grants).toHaveLength(1);
  const [grant] = grants;
  if (!grant) throw new Error("Missing grant record");
  expect(
    dataset.getObjects(grant, `${AWP}recordIdentifier`, null).map((term) => term.value),
  ).toEqual([lift.fact?.id]);
  expect(
    failure.trace.events.some(
      (e) =>
        e.check === "authority" && e.verdict === "fail" && e.reason === "representation-invalid",
    ),
  ).toBe(true);
  for (const t of [main.trace, failure.trace])
    for (const e of t.events)
      expect(`${e.caption} ${e.rule?.text ?? ""} ${e.chat?.text ?? ""}`).not.toMatch(
        /https?:\/\/|urn:|did:/,
      );
}, 180000);
