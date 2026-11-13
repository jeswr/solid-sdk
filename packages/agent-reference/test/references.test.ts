// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import type { ItemTerms } from "../src/gates/common.js";
import { evaluateItemTerms } from "../src/gates/quality.js";
import { LocalResourceHolder, type ResourceGrant } from "../src/mechanisms/references.js";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { MemoryLedger } from "../src/store/ledger.js";

const root = join(import.meta.dirname, "..");

it("runs every health-referral branch with explicit local-holder configuration and clinician selection", async () => {
  const { profile, scenario } = loadCase(root, "health-referral");
  const paths = await runScenario(profile, scenario);
  expect(paths).toHaveLength(3);
  expect(paths.every((p) => p.matches && !p.blocked)).toBe(true);
  expect(paths[0]?.trace?.configuration.layers["data-access"]).toBe("by-reference-local-holder");
  expect(
    paths[0]?.trace?.standIns?.some((s) => s.replacedBy.includes("no Solid access-control claim")),
  ).toBe(true);
  expect(
    paths[0]?.trace?.events.some((e) => e.agent === "clinic-agent" && e.outcome === "admit"),
  ).toBe(true);
  expect(paths[1]?.trace?.events.findLast((e) => e.kind === "decision")).toMatchObject({
    outcome: "ask-principal",
    reason: "approval-required",
  });
  expect(paths[2]?.trace?.events.at(-1)).toMatchObject({
    outcome: "stop",
    reason: "source-unknown",
  });
});

it("the holder independently checks signed identity, item, purpose, expiry, digest and replay, recording every read", async () => {
  const holderKey = await testKey("reference/holder"),
    readerKey = await testKey("reference/reader"),
    stranger = await testKey("reference/stranger");
  const publicKey = (key: typeof holderKey) => ({
    kid: key.kid,
    alg: key.alg,
    publicJwk: key.publicJwk,
  });
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:holder",
    sourceAuthority: [],
    keys: [
      { ...publicKey(holderKey), role: "issuer", subject: "urn:holder" },
      { ...publicKey(readerKey), role: "actor", subject: "urn:reader:agent", party: "urn:reader" },
      {
        ...publicKey(stranger),
        role: "actor",
        subject: "urn:stranger:agent",
        party: "urn:stranger",
      },
    ],
  });
  const now = "2026-11-13T09:00:00.000Z",
    ledger = new MemoryLedger();
  const items = [
    {
      id: "urn:item",
      issuer: "urn:holder",
      subject: "urn:patient",
      claimType: "history",
      value: 1,
    },
  ];
  const holder = new LocalResourceHolder({
    identity: "urn:holder",
    key: holderKey,
    trust,
    resources: { "urn:resource": items },
    ledger,
    now: () => now,
  });
  const grant: ResourceGrant = {
    type: "ResourceGrant",
    id: "urn:grant",
    issuer: "urn:holder",
    ref: "urn:resource",
    reader: { actor: "urn:reader:agent", party: "urn:reader" },
    items: [{ id: "urn:item", claimType: "history" }],
    purpose: "urn:purpose:referral",
    validUntil: "2026-11-14T00:00:00.000Z",
    digest: digestOf(items),
  };
  let sequence = 0;
  const read = async (change = {}, grantChange = {}, key = readerKey, referenceChange = {}) => {
    const request = {
      type: "ResourceRead",
      id: `urn:request:${sequence++}`,
      actor: "urn:reader:agent",
      party: "urn:reader",
      ref: "urn:resource",
      item: "urn:item",
      purpose: grant.purpose,
      at: now,
      ...change,
    };
    return holder.read(
      {
        ref: "urn:resource",
        claimTypes: ["history"],
        grant: await signStatement(holderKey, "awp-resource-grant+jws", {
          ...grant,
          ...grantChange,
        }),
        ...referenceChange,
      },
      await signStatement(key, "awp-resource-read+jws", request),
    );
  };
  const first = await read();
  expect(first).toMatchObject({ ok: true });
  if (!first.ok) throw new Error("holder did not serve permitted read");
  const claim = JSON.parse(Buffer.from(first.jws.split(".")[1] ?? "", "base64url").toString());
  expect(
    evaluateItemTerms(claim.terms as ItemTerms, {
      agent: "urn:reader:agent",
      action: "use",
      target: "urn:item",
      purpose: grant.purpose,
      at: now,
    }).verdict,
  ).toBe("pass");
  expect(
    evaluateItemTerms(claim.terms as ItemTerms, {
      agent: "urn:stranger:agent",
      action: "use",
      target: "urn:item",
      purpose: grant.purpose,
      at: now,
    }).verdict,
  ).toBe("fail");
  expect(await read({}, {}, stranger)).toMatchObject({ ok: false, reason: "not-authorised" });
  expect(
    await read({ actor: "urn:stranger:agent", party: "urn:stranger" }, {}, stranger),
  ).toMatchObject({ reason: "not-authorised" });
  expect(await read({ item: "urn:whole-record" })).toMatchObject({ reason: "not-authorised" });
  expect(await read({ purpose: "urn:purpose:marketing" })).toMatchObject({
    reason: "purpose-not-permitted",
  });
  expect(await read({}, { validUntil: now })).toMatchObject({ reason: "expired" });
  expect(await read({}, {}, readerKey, { digest: "changed" })).toMatchObject({
    reason: "evidence-invalid",
  });
  expect(await read({}, {}, readerKey, { claimTypes: ["whole-record"] })).toMatchObject({
    reason: "evidence-invalid",
  });
  expect(await read({}, { ref: "urn:missing" }, readerKey, { ref: "urn:missing" })).toMatchObject({
    reason: "not-authorised",
  });
  const replay = { id: "urn:replay" };
  expect(await read(replay)).toMatchObject({ ok: true });
  expect(await read(replay)).toMatchObject({ reason: "not-authorised" });
  expect(ledger.entries().filter((e) => e.record.type === "resource-read")).toHaveLength(11);
});

it("disclosure counts the signed grant's whole record even though the message carries no values", async () => {
  const { profile, scenario } = loadCase(root, "health-referral");
  profile.personDecisions = [];
  scenario.branches = [];
  scenario.script = scenario.script.slice(0, 2);
  scenario.stress = ["disclosure"];
  const grant = scenario.grants[0],
    start = scenario.script[1];
  if (!grant || start?.type !== "start") throw new Error("fixture");
  grant.statements.push("full");
  start.intent.parameters = {
    resource: "urn:resource:patient-history",
    grantDigest: { ["$ref"]: "grantDigests.history-grant" },
    items: ["urn:scenario:health-referral:history", "urn:scenario:health-referral:full"],
  };
  const [path] = await runScenario(profile, scenario, { compare: false });
  expect(path?.trace?.events.at(-1)).toMatchObject({ outcome: "stop", reason: "excessive-scope" });
});
