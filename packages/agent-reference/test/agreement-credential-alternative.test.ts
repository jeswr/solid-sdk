// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { signStatement } from "../src/mechanisms/statements.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";
import { BASELINE } from "../src/suites/baseline.js";
import { AgreementCredentialProtocol } from "../src/wire/agreement-credential.js";
import { decodeCompactPayload } from "../src/wire/inspect.js";

it("runs a two-proof native valuation credential and keeps a single proof as an offer", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  expect(configurationById(alternativeWireId("authenticity-data-integrity"))?.status).toBe(
    "executable",
  );
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, {
    configuration: "commitments-agreement-credential",
  });
  const main = paths.find((path) => path.path === "main"),
    failure = paths.find((path) => path.path === "one-proof-missing");
  if (!baseline || !main?.trace || !failure?.trace)
    throw new Error(
      JSON.stringify(paths.map((path) => ({ path: path.path, blocked: path.blocked }))),
    );
  expect(main.trace.configuration.layers.authenticity).toBe(BASELINE.layers.authenticity);
  expect(confinementDifferences(baseline, main.trace, "commitments")).toEqual([]);
  expect(failure.disagrees).toBe(false);
  expect(
    main.trace.events.some((event) =>
      event.caption.startsWith("Both parties' Data Integrity proofs"),
    ),
  ).toBe(true);
  expect(failure.trace.events).toContainEqual(
    expect.objectContaining({ check: "authority", verdict: "fail", reason: "no-agreement" }),
  );
  const native: {
    proof:
      | { verificationMethod: string; cryptosuite: string }
      | { verificationMethod: string; cryptosuite: string }[];
    credentialStatus: unknown[];
  }[] = [];
  for (const event of main.trace.events) {
    if (event.fact?.claimType === "agreement.credential")
      native.push(event.fact.value as (typeof native)[number]);
    expect(`${event.caption} ${event.rule?.text ?? ""} ${event.chat?.text ?? ""}`).not.toMatch(
      /https?:\/\/|urn:|did:/,
    );
  }
  const full = native.find((vc) => Array.isArray(vc.proof) && vc.proof.length === 2);
  expect(full).toBeDefined();
  expect(
    new Set(
      (full!.proof as { verificationMethod: string }[]).map((proof) => proof.verificationMethod),
    ).size,
  ).toBe(2);
  expect(
    (full!.proof as { cryptosuite: string }[]).every(
      (proof) => proof.cryptosuite === "eddsa-rdfc-2022",
    ),
  ).toBe(true);
  expect(full!.credentialStatus).toHaveLength(2);
  expect(
    main.trace.events.filter((event) => event.check === "receipt" && event.verdict === "pass"),
  ).toHaveLength(2);
}, 180000);

it("stops an authentic carrier with unapproved private credential fields before it leaves", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const entry = scenario.configurations.find(
    (entry) => entry.id === "commitments-agreement-credential",
  )!;
  entry.world = { ...entry.world, branches: [], stopAfter: "fee-offer" };
  const original = AgreementCredentialProtocol.prototype.offer;
  const producer = vi
    .spyOn(AgreementCredentialProtocol.prototype, "offer")
    .mockImplementation(async function (this: AgreementCredentialProtocol, message, key) {
      const evidence = await original.call(this, message, key);
      if (!evidence) return evidence;
      const payload = decodeCompactPayload(evidence.value);
      const vc = payload.credential as { credentialSubject: Record<string, unknown> };
      vc.credentialSubject.privateNote = "A private note unrelated to the valuation.";
      return {
        ...evidence,
        value: await signStatement(key, "awp-agreement-credential+jws", payload),
      };
    });
  try {
    const main = (await runScenario(profile, scenario, { configuration: entry.id }))[0];
    expect(main?.trace?.events).toContainEqual(
      expect.objectContaining({
        agent: "valuer-agent",
        check: "evidence",
        verdict: "fail",
        reason: "evidence-invalid",
      }),
    );
    expect(
      main?.trace?.events.some(
        (event) =>
          event.agent === "valuer-agent" &&
          event.kind === "message-out" &&
          event.packet?.kind === "propose",
      ),
    ).toBe(false);
  } finally {
    producer.mockRestore();
  }
}, 180000);

it("the payment provider independently rechecks the native credential before a ledger transfer", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const entry = scenario.configurations.find(
    (entry) => entry.id === "commitments-agreement-credential",
  )!;
  entry.world = { ...entry.world, branches: [], stopAfter: "provider-settles" };
  const original = AgreementCredentialProtocol.prototype.check;
  let acceptances = 0;
  const check = vi
    .spyOn(AgreementCredentialProtocol.prototype, "check")
    .mockImplementation(async function (
      this: AgreementCredentialProtocol,
      message,
      offer,
      trust,
      at,
    ) {
      const proposed = offer?.live;
      if (
        message.live.kind === "accept" &&
        proposed?.kind === "propose" &&
        proposed.body.terms.compensation &&
        ++acceptances === 3
      )
        return { state: "invalid", reason: "evidence-invalid" };
      return original.call(this, message, offer, trust, at);
    });
  try {
    const main = (await runScenario(profile, scenario, { configuration: entry.id }))[0];
    expect(acceptances).toBe(3);
    expect(
      main?.trace?.events.some(
        (event) =>
          event.caption === "The fictional provider records the ledger transfer and its receipt.",
      ),
    ).toBe(false);
  } finally {
    check.mockRestore();
  }
}, 180000);
