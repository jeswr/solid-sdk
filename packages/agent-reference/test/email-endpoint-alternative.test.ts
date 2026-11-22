// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.2 Sol
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
import type { Scenario } from "../src/engine/schema.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";
import { testKey } from "../src/reference/keys.js";
import { Cast, mandateOf, signClaim } from "../src/scenarios/common.js";
import { TraceRecorder } from "../src/trace/recorder.js";

const id = "identity-email-endpoint";
const root = new URL("..", import.meta.url).pathname;

it("accepts the payroll mailbox reply only as an answered challenge from the address Paywell signed", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  expect(configurationById(alternativeWireId(id))?.status).toBe("executable");
  const entry = scenario.configurations.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`${id} is not a configuration of mortgage-main`);
  expect(patchDifferences(scenario, entry, profile)).toEqual([]);
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const world = entry.world as { branches: Scenario["branches"] };
  const branch = world.branches.find((b) => b.id === "mailbox-reply-as-evidence")!;
  branch.expect = { outcome: "stop", check: "evidence", reason: "structured-form-required" };
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
  expect(failure.disagrees).toBe(false);
  expect(failure.actual).toMatchObject({
    outcome: "stop",
    check: "evidence",
    reason: "structured-form-required",
  });
  const stop = failure.trace.events.findLast((e) => e.kind === "decision")!;
  expect(failure.trace.events.slice(stop.seq).some((e) => e.kind === "message-out")).toBe(false);
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

it.each([
  "bad-signature",
  "external-unadmitted",
] as const)("continues to stop invalid structured evidence (%s)", async (variant) => {
  const at = "2026-11-13T09:00:00.000Z";
  const operation = { id: "urn:test:share-income", version: "1" };
  const owner = "urn:test:borrower",
    receiver = "urn:test:lender";
  const issuer = "urn:test:payroll";
  const purpose = "urn:test:credit";
  const cast = new Cast(() => new Date(at));
  const sender = await cast.add(
    { name: "sender", actor: "urn:test:borrower-agent", party: owner },
    mandateOf("structured-evidence", [{ type: "permission", action: "use", target: operation.id }]),
    [operation.id],
  );
  await cast.add(
    { name: "receiver", actor: "urn:test:lender-agent", party: receiver },
    mandateOf("receiver", []),
    [operation.id],
  );
  cast.introduce("sender", "receiver");
  const externalKey = await testKey("email-structured-evidence:payroll");
  cast.pinIssuer("sender", issuer, externalKey);
  const recorder = new TraceRecorder();
  const { runtime } = await cast.runtime(
    "sender",
    [
      {
        requiresRepresentation: true,
        description: {
          ...operation,
          label: "Share income",
          pattern: "invoke",
          access: "represented",
          roles: ["initiator"],
          models: [],
          effects: [],
          outcomes: [],
        },
        intentForInvoke: (ctx) => ({
          action: "use",
          operation: operation.id,
          target: operation.id,
          recipient: receiver,
          purpose,
          conversation: ctx.conversation.id,
          parameters: { claimType: "income" },
        }),
      },
    ],
    [],
    undefined,
    { gates: { sink: recorder.sink("sender") } },
  );
  const fromOwner = variant === "bad-signature";
  let jws = await signClaim(fromOwner ? sender.ownerKey : externalKey, {
    id: "urn:test:income",
    issuer: fromOwner ? owner : issuer,
    subject: owner,
    claimType: "income",
    method: "recorded-by-authority",
    asOf: at,
    value: 10,
  });
  if (fromOwner) {
    const signatureStart = jws.lastIndexOf(".") + 1;
    jws =
      jws.slice(0, signatureStart) +
      (jws[signatureStart] === "A" ? "B" : "A") +
      jws.slice(signatureStart + 1);
  }
  const result = await runtime.startInvocation({
    peer: { actor: "urn:test:lender-agent", party: receiver },
    operation,
    input: {},
    basis: { kind: "represented" },
    purpose,
    discover: false,
    models: [],
    evidence: [{ role: "credential", format: "jws-compact", value: jws }],
  });
  const events = recorder.events();
  expect(events.findLast((e) => e.kind === "check")).toMatchObject({
    check: "evidence",
    verdict: "fail",
    reason: "evidence-invalid",
  });
  expect(result).toMatchObject({ reason: "evidence-invalid", outbound: [] });
  expect(events.some((e) => e.kind === "message-out")).toBe(false);
});
