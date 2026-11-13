// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, rmSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { JsonObject } from "../src/core/types.js";
import { ruleSchema } from "../src/derive/rules.js";
import { type FixedJointSession, verifierRegistry } from "../src/derive/verifiers.js";
import { type GateContext, GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { JointParty } from "../src/mechanisms/joint.js";
import { signCompact } from "../src/mechanisms/jws.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import type { HandlerContext } from "../src/runtime/operations.js";
import { Cast, mandateOf, signClaim } from "../src/scenarios/common.js";
import { FileStateStore } from "../src/store/state.js";
import type { TraceEventInput } from "../src/trace/types.js";
import { ToyJointProtocol } from "./doubles/joint.js";

async function jointFixture(n = 3, count = 5) {
  const protocol = new ToyJointProtocol(),
    parties = Array.from({ length: n }, (_, i) => `urn:party:${i}`);
  const keys = await Promise.all(
    parties.map((p) => protocol.generateKeys(new TextEncoder().encode(p))),
  );
  const made = await protocol.newSession({
    sessionId: "urn:session:test",
    statistic: "count-and-sum",
    minimumGroup: 10,
    minimumContributors: 3,
    roster: parties.map((party, i) => ({ party, publicKeys: required(keys[i]).publicKeys })),
  });
  const all = await Promise.all(
    parties.map((party, i) =>
      protocol.contribute({
        session: made.session,
        party,
        secretKeys: required(keys[i]).secretKeys,
        count,
        sum: count * 100,
      }),
    ),
  );
  const contributions = all.map((a) => a.contribution),
    partials: JsonObject[] = [];
  for (const [i, party] of parties.entries()) {
    const p = await protocol.receiveAndPartial({
      session: made.session,
      party,
      secretKeys: required(keys[i]).secretKeys,
      contributions,
      shares: all.flatMap((a) => (a.shares[party] ? [required(a.shares[party])] : [])),
    });
    if (!p.ok) throw new Error(p.reason);
    partials.push(p.partial);
  }
  const outcome = await protocol.finish({ session: made.session, contributions, partials });
  return { protocol, parties, keys, made, all, contributions, partials, outcome };
}
async function gateFixture() {
  const f = await jointFixture(),
    rule = ruleSchema.parse({
      id: "urn:rule:joint",
      output: "joint.total",
      inputsFrom: f.parties,
      template: "sum",
      params: {
        input: "joint.sum",
        completeness: "joint.complete",
        period: { start: "2026-10-01", end: "2026-10-31" },
      },
      assurances: ["joint"],
    });
  const fixed: FixedJointSession = {
    method: f.protocol.method,
    session: f.made.session,
    ruleDigest: f.made.ruleDigest,
    rule: rule.id,
    purpose: "urn:purpose:test",
    assurances: ["joint"],
  };
  const key = await testKey("joint/gate-signer"),
    trust = await TrustStore.load({
      version: 1,
      owner: "urn:receiver",
      keys: [
        {
          role: "issuer",
          subject: "urn:computer",
          kid: key.kid,
          alg: key.alg,
          publicJwk: key.publicJwk,
        },
      ],
      sourceAuthority: [],
    });
  const events: TraceEventInput[] = [],
    memory = new GateMemory();
  const gate: GateContext = {
    ...verifierRegistry([f.protocol]),
    rules: [rule],
    acceptedJoint: [
      {
        rule: rule.id,
        method: f.protocol.method,
        purposes: [fixed.purpose],
        minimumContributors: 3,
      },
    ],
    fixedJointSessions: { [String(f.made.session.sessionId)]: fixed },
    reliance: {
      id: "urn:reliance",
      rules: [
        {
          id: "urn:reliance:joint",
          claimType: "joint.total",
          methods: ["derived"],
          maxAgeDays: 1,
          text: "Test joint result.",
        },
      ],
    },
    sink: { agent: "receiver", emit: (e) => events.push(e) },
  };
  const statement: JsonObject = {
    id: "urn:joint-result",
    issuer: "urn:computer",
    subject: "urn:session:test",
    method: "derived",
    claimType: "joint.total",
    value: { count: 15, sum: 1500 },
    asOf: "2026-11-13T09:00:00.000Z",
    derivation: {
      rule: rule.id,
      ruleDigest: digestOf(rule),
      assurance: "joint",
      deriver: "urn:computer",
      outputDigest: digestOf({ count: 15, sum: 1500 }),
      inputs: [],
      joint: {
        method: f.protocol.method,
        session: structuredClone(f.made.session),
        contributions: structuredClone(f.contributions),
        outcome: f.outcome as unknown as JsonObject,
        parties: f.parties,
        assumption: f.protocol.assumption,
      },
    },
  };
  const inbound = new InboundGate({
    identity: { actor: "urn:actor:receiver" },
    trust,
    limits: DEFAULT_LIMITS,
    now: () => "2026-11-13T09:00:00.000Z",
    record: () => {},
    memory,
    gate,
    agreementTerms: () => undefined,
  });
  const admit = () =>
    signClaim(key, statement).then((jws) =>
      inbound.admitStatements([{ jws }], { task: "urn:task", purpose: fixed.purpose }),
    );
  return { ...f, gate, fixed, statement, events, memory, admit };
}
it("accepts a joint record only after every roster signature, contribution and outcome checks", async () => {
  const f = await gateFixture();
  expect((await f.admit()).admitted).toBe(1);
  expect(f.events.some((e) => e.rule?.id === "DER-14" && e.verdict === "pass")).toBe(true);
});
it.each([
  "missing",
  "unsigned",
  "off-roster-key",
  "digest",
  "minimum",
  "changed-outcome",
  "missing-partial",
  "bad-partial",
])("refuses %s joint evidence at the real source gate", async (attack) => {
  const f = await gateFixture(),
    joint = (f.statement.derivation as JsonObject).joint as JsonObject,
    contributions = joint.contributions as JsonObject[];
  if (attack === "missing") contributions.pop();
  if (attack === "unsigned") delete required(contributions[0]).signature;
  if (attack === "off-roster-key") {
    const c = required(contributions[0]),
      { signature, ...payload } = c;
    const outsider = await testKey("joint/off-roster");
    c.signature = await signCompact(outsider, "awp-toy-contribution+jws", payload);
  }
  if (attack === "digest") (joint.session as JsonObject).ruleDigest = "other";
  if (attack === "minimum")
    required(
      (f.gate.acceptedJoint as unknown as { minimumContributors: number }[])[0],
    ).minimumContributors = 4;
  if (attack === "changed-outcome")
    ((joint.outcome as JsonObject).evidence as JsonObject).session = "other";
  if (attack === "bad-partial") {
    const { loadSigningKey } = await import("../src/mechanisms/jws.js");
    const p = required(
      ((joint.outcome as JsonObject).evidence as JsonObject).partials as JsonObject[],
    )[0];
    if (!p) throw new Error("Missing partial");
    p.count = Number(p.count) + 1;
    const { signature, ...payload } = p;
    const key = await loadSigningKey(
      required(f.keys[0]).secretKeys.signing as import("jose").JWK,
      "EdDSA",
    );
    p.signature = await signCompact(key, "awp-toy-partial+jws", payload);
  }
  if (attack === "missing-partial")
    (((joint.outcome as JsonObject).evidence as JsonObject).partials as JsonObject[]).pop();
  expect((await f.admit()).admitted).toBe(0);
  expect(f.events.findLast((e) => e.kind === "decision")?.reason).toBe("derivation-not-verified");
});
it("produces verifiable nonnumeric below-minimum and too-few outcomes, and never treats a missing roster input as a smaller total", async () => {
  for (const [n, count, type] of [
    [3, 1, "below-minimum-group"],
    [2, 10, "too-few-contributors"],
  ] as const) {
    const f = await jointFixture(n, count);
    expect(f.outcome.type).toBe(type);
    expect(f.outcome).not.toHaveProperty("count");
    expect(f.outcome).not.toHaveProperty("sum");
    expect(
      (
        await f.protocol.verifyOutcome({
          session: f.made.session,
          outcome: f.outcome,
          contributions: f.contributions,
        })
      ).ok,
    ).toBe(true);
  }
  const f = await jointFixture();
  const contributions = f.contributions.slice(1),
    outcome = await f.protocol.finish({
      session: f.made.session,
      contributions,
      partials: f.partials,
    });
  expect(
    await f.protocol.verifyOutcome({ session: f.made.session, contributions, outcome }),
  ).toMatchObject({ ok: false, partyAtFault: f.parties[0] });
});
it("resumes the holder's durable joint state between its contribution and partial after a file-store restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "joint-restart-"));
  let store = new FileStateStore(join(directory, "joint.json"));
  let runtimeStore = new FileStateStore(join(directory, "runtime.json"));
  try {
    const f = await jointFixture(),
      party = required(f.parties[0]),
      purpose = "urn:purpose:test",
      at = new Date("2026-11-13T09:00:00.000Z");
    const cast = new Cast(() => at);
    const actor = await cast.add(
      { name: "holder", actor: "urn:holder:actor", party },
      mandateOf("joint", [], []),
      [],
    );
    const source = actor.ownerKey;
    cast.rule("holder", {
      id: "urn:rule:data",
      version: "1",
      source: party,
      claimTypes: ["joint.count", "joint.sum"],
      subjects: [party],
    });
    const gates: GateContext = {
      taskId: "urn:task",
      purposes: { [purpose]: ["joint.count", "joint.sum"] },
      reliance: {
        id: "urn:reliance",
        rules: ["joint.count", "joint.sum"].map((claimType) => ({
          id: `urn:r:${claimType}`,
          claimType,
          methods: ["recorded-by-authority"],
          maxAgeDays: 1,
          text: "Test data.",
        })),
      },
    };
    const trust = await TrustStore.load(cast.trust.get("holder"));
    const ledger = new (await import("../src/store/ledger.js")).MemoryLedger();
    const makeRuntime = async () =>
      AgentRuntime.create({
        identity: actor.identity,
        actorKeys: [actor.actorKey],
        trust,
        mandateJws: actor.mandateJws,
        representationJws: actor.representationJws,
        accepted: [(await import("../src/profile/configurations.js")).CONFIG_ED25519],
        handlers: [],
        store: runtimeStore,
        ledger,
        now: () => at,
        gates,
      });
    let runtime = await makeRuntime();
    const inputs = ["count", "sum"].map((k) => `urn:input:${k}`);
    await runtime.admitStatements(
      await Promise.all(
        inputs.map(async (id, i) => ({
          jws: await signClaim(source, {
            id,
            issuer: party,
            subject: party,
            claimType: i ? "joint.sum" : "joint.count",
            value: i ? 500 : 5,
            method: "recorded-by-authority",
            asOf: at.toISOString(),
            terms: {
              policy: {
                id: "urn:terms",
                permissions: [
                  { type: "permission", action: "use" },
                  { type: "permission", action: "distribute" },
                ],
              },
            },
          }),
        })),
      ),
      { task: "urn:task", purpose },
    );
    const fixed: FixedJointSession = {
      method: f.protocol.method,
      rule: "urn:rule:joint",
      session: f.made.session,
      ruleDigest: f.made.ruleDigest,
      purpose,
      assurances: ["joint"],
    };
    const make = () =>
      new JointParty({
        party,
        requester: "urn:requester",
        protocol: f.protocol,
        secretKeys: required(f.keys[0]).secretKeys,
        fixed,
        runtime: () => runtime,
        store,
        inputs,
        purpose,
        recipient: "urn:requester",
      });
    const ctx = { peer: { party: "urn:requester" }, record: () => {} } as unknown as HandlerContext;
    let holder = make();
    await holder.receive(ctx, "urn:op:joint:open", {
      sessionId: required(f.made.session.sessionId),
      session: f.made.session,
      ruleDigest: f.made.ruleDigest,
    });
    const contributed = await holder.contribute();
    expect(contributed.ok).toBe(true);
    for (let i = 1; i < 3; i++)
      await holder.receive({ ...ctx, peer: { party: f.parties[i] } }, "urn:op:joint:contribute", {
        sessionId: required(f.made.session.sessionId),
        contribution: required(f.all[i]).contribution,
        share: required(required(f.all[i]).shares[party]),
      });
    store.close();
    runtimeStore.close();
    store = new FileStateStore(join(directory, "joint.json"));
    runtimeStore = new FileStateStore(join(directory, "runtime.json"));
    runtime = await makeRuntime();
    holder = make();
    expect(runtime.admittedStatements()).toHaveLength(2);
    expect(await holder.partial()).toMatchObject({ ok: true });
    expect(store.load().domain.joint).toHaveProperty("own");
  } finally {
    store.close();
    runtimeStore.close();
    rmSync(directory, { recursive: true });
  }
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Required test fixture is missing");
  return value;
}
