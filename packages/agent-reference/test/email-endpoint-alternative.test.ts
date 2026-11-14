// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import {
  addedSegmentDifferences,
  confinementDifferences,
  patchDifferences,
} from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { matrixWorld } from "../src/engine/matrix.js";
import { patch, runScenario } from "../src/engine/run.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";

const id = "identity-email-endpoint";
const root = new URL("..", import.meta.url).pathname;

it("accepts the payroll mailbox reply only as an answered challenge from the address Paywell signed", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  expect(configurationById(alternativeWireId(id))?.status).toBe("executable");
  const entry = scenario.configurations.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`${id} is not a configuration of mortgage-main`);
  expect(patchDifferences(scenario, entry)).toEqual([]);
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: id });
  expect(paths.map((p) => p.path)).toEqual(["main", "mailbox-reply-as-evidence"]);
  const [main, failure] = paths;
  if (!baseline || !main?.trace || !failure?.trace)
    throw new Error(JSON.stringify(paths.map((p) => ({ path: p.path, blocked: p.blocked }))));
  expect(confinementDifferences(baseline, main.trace, "identity")).toEqual([]);
  expect(addedSegmentDifferences(main.trace, entry, matrixWorld(scenario, entry).parties)).toEqual(
    [],
  );
  // The challenge reply passes source and records every inbound check; it is content only.
  const added = main.trace.events.filter((event) => event.addedBy === id);
  const source = added.find(
    (event) => event.check === "source" && event.caption.includes("challenge"),
  );
  expect(source?.verdict).toBe("pass");
  // Forwarding the prose as evidence is stopped by the evidence check, not as registered.
  expect(failure.disagrees).toBe(true);
  expect(failure.actual).toMatchObject({
    outcome: "stop",
    check: "evidence",
    reason: "evidence-invalid",
  });
}, 900_000);

it("refuses a reply that does not carry the challenge", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  scenario.configurations = scenario.configurations.map((entry) =>
    entry.id === id
      ? (patch(entry, {
          world: {
            mailboxes: [
              {
                party: "paywell-mailbox",
                address: "mailto:payroll@paywell.example",
                replies: ["The annual gross income is 64800 USD."],
              },
            ],
            branches: [],
          },
        }) as typeof entry)
      : entry,
  );
  // Stop at the reply: nothing after it can use content the gate refused.
  const [main] = await runScenario(
    profile,
    { ...scenario, branches: [], stopAfter: "challenge-reply" },
    { configuration: id, compare: false },
  );
  const refusal = main?.trace?.events.find(
    (event) => event.addedBy === id && event.check === "source" && event.verdict === "fail",
  );
  expect(refusal?.reason).toBe("source-unknown");
}, 900_000);
