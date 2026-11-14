// AUTHORED-BY Codex GPT-6
// Research-grade, unaudited package: these checks establish integration, not an audit.
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { randomBytes } from "crypto";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { writeSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { JsonObject } from "../src/core/types.js";
import { availableAdapters } from "../src/derive/adapters/index.js";
import { loadSparqAggregate } from "../src/derive/adapters/sparq-aggregate.js";
import { verifyJointMessageOutcome } from "../src/derive/verification.js";
import type { SessionParams } from "../src/derive/verifiers.js";
import { verifierRegistry } from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { JointParty } from "../src/mechanisms/joint.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import type { AgentRuntime } from "../src/runtime/agent.js";
import type { HandlerContext } from "../src/runtime/operations.js";
import { signClaim } from "../src/scenarios/common.js";
import { MemoryStateStore } from "../src/store/state.js";

const installed = loadSparqAggregate();
if (!installed)
  writeSync(
    1,
    "Skipped real aggregation tests: research-grade, unaudited sparq-verifiable-aggregate is not installed.\n",
  );
const root = join(import.meta.dirname, "..");
async function fixture(
  n = 3,
  count = 5,
  minimumGroup = 10,
  threshold?: SessionParams["threshold"],
) {
  const protocol = required(loadSparqAggregate());
  const parties = Array.from({ length: n }, (_, i) => `urn:party:${i}`);
  const keys = await Promise.all(
    parties.map((p) => protocol.generateKeys(new TextEncoder().encode(p))),
  );
  const made = await protocol.newSession({
    sessionId: randomBytes(32).toString("base64url"),
    statistic: "count-and-sum",
    minimumGroup,
    minimumContributors: 3,
    ...(threshold ? { threshold } : {}),
    roster: parties.map((party, i) => ({ party, publicKeys: required(keys[i]).publicKeys })),
  });
  const states = await Promise.all(
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
  const contributions = states.map((s) => s.contribution);
  const dispatches =
    n < 3
      ? []
      : await Promise.all(
          parties.map((party, i) =>
            protocol.receiveAndPartial({
              session: made.session,
              party,
              secretKeys: required(keys[i]).secretKeys,
              contributions,
              shares: [],
              local: required(states[i]).local,
            }),
          ),
        );
  const finish = async (cs = contributions) => {
    const own = dispatches[0];
    const partials = dispatches.flatMap((d, i) =>
      d.ok && i !== 0
        ? (d.partial.messages as JsonObject[])
            .filter((m) => m.recipient === 0)
            .map((message) => ({ party: required(parties[i]), message }))
        : [],
    );
    return protocol.finish({
      session: made.session,
      party: required(parties[0]),
      secretKeys: required(keys[0]).secretKeys,
      contributions: cs,
      partials,
      local: own?.ok ? own.local : undefined,
    });
  };
  return { protocol, parties, keys, made, states, contributions, dispatches, finish };
}

describe.skipIf(!installed)("real research-grade, unaudited aggregation", () => {
  it("claims a bare outcome in the inbound source check, rejects concurrent replay, and releases a failed claim", async () => {
    const f = await fixture(),
      outcome = await f.finish();
    const fixed = {
      method: f.protocol.method,
      session: f.made.session,
      ruleDigest: f.made.ruleDigest,
      rule: "urn:rule",
      purpose: "urn:purpose",
      assurances: ["joint"],
      outcomeConsumed: false,
    };
    const gate = {
      ...verifierRegistry([f.protocol]),
      acceptedJoint: [
        {
          method: fixed.method,
          rule: fixed.rule,
          purposes: [fixed.purpose],
          minimumContributors: 3,
        },
      ],
      fixedJointSessions: { [String(f.made.session.sessionId)]: fixed },
    };
    const value = {
      sessionId: String(f.made.session.sessionId),
      outcome: outcome as unknown as JsonObject,
      contributions: f.contributions,
    };
    expect((await verifyJointMessageOutcome(gate, value, "urn:wrong-purpose")).reason).toBe(
      "method-not-accepted",
    );
    expect((await verifyJointMessageOutcome({ ...gate, acceptedJoint: [] }, value)).reason).toBe(
      "method-not-accepted",
    );
    const bad = structuredClone(value);
    (bad.outcome.evidence as JsonObject).signature = "AA";
    expect((await verifyJointMessageOutcome(gate, bad)).ok).toBe(false);
    expect(fixed.outcomeConsumed).toBe(false);
    const verify = f.protocol.verifyOutcome.bind(f.protocol);
    f.protocol.verifyOutcome = async (input) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return verify(input);
    };
    const results = await Promise.all([
      verifyJointMessageOutcome(gate, value),
      verifyJointMessageOutcome(gate, value),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.reason).toBe("replay-conflict");
    expect((await verifyJointMessageOutcome(gate, value)).reason).toBe("replay-conflict");
  }, 60000);
  it("checks a release and a hidden-total threshold verdict", async () => {
    for (const threshold of [
      undefined,
      { statistic: "sum", operator: ">=", value: 1000 } as const,
    ]) {
      const f = await fixture(3, 5, 10, threshold),
        outcome = await f.finish();
      expect(outcome).toMatchObject(
        threshold
          ? { type: "threshold-verdict", verdict: true }
          : { type: "release", count: 15, sum: 1500 },
      );
      expect(
        (
          await f.protocol.verifyOutcome({
            session: f.made.session,
            contributions: f.contributions,
            outcome,
          })
        ).ok,
      ).toBe(true);
      if (threshold) {
        expect(outcome).not.toHaveProperty("count");
        expect(outcome).not.toHaveProperty("sum");
      }
    }
  }, 60000);
  it.each([
    [3, 1, "below-minimum-group"],
    [2, 10, "too-few-contributors"],
  ] as const)(
    "verifies the %s party refusal without releasing totals",
    async (n, count, type) => {
      const f = await fixture(n, count),
        outcome = await f.finish();
      expect(outcome.type).toBe(type);
      expect(outcome).not.toHaveProperty("count");
      expect(outcome).not.toHaveProperty("sum");
      expect(
        (
          await f.protocol.verifyOutcome({
            session: f.made.session,
            contributions: f.contributions,
            outcome,
          })
        ).ok,
      ).toBe(true);
    },
    60000,
  );
  it("refuses missing and tampered contributions and retains the backend check and index", async () => {
    const f = await fixture();
    await expect(f.finish(f.contributions.slice(1))).rejects.toMatchObject({
      reason: "input-not-attested",
    });
    const changed = structuredClone(f.contributions);
    required(changed[0]).signature = "AA";
    const checked = await f.protocol.receiveAndPartial({
      session: f.made.session,
      party: required(f.parties[0]),
      secretKeys: required(f.keys[0]).secretKeys,
      contributions: changed,
      shares: [],
      local: required(f.states[0]).local,
    });
    expect(checked).toMatchObject({
      ok: false,
      reason: "input-not-attested",
      index: 0,
      partyAtFault: f.parties[0],
    });
    expect(!checked.ok && typeof checked.check === "string" && checked.check.length > 0).toBe(true);
  }, 60000);
  it("rejects a signed outcome against a different, correctly signed complete contribution set and unknown wire fields", async () => {
    const f = await fixture(),
      outcome = await f.finish();
    const replacement = await f.protocol.contribute({
      session: f.made.session,
      party: required(f.parties[0]),
      secretKeys: required(f.keys[0]).secretKeys,
      count: 6,
      sum: 600,
    });
    expect(
      (
        await f.protocol.verifyOutcome({
          session: f.made.session,
          contributions: [replacement.contribution, ...f.contributions.slice(1)],
          outcome,
        })
      ).ok,
    ).toBe(false);
    const extra = structuredClone(outcome);
    extra.evidence.extra = true;
    expect(
      (
        await f.protocol.verifyOutcome({
          session: f.made.session,
          contributions: f.contributions,
          outcome: extra,
        })
      ).ok,
    ).toBe(false);
  }, 60000);
  it("requires independently pinned identity-signed key bindings before accepting a real roster", async () => {
    const f = await fixture(),
      identity = await testKey("aggregate/binding");
    const party = required(f.parties[0]),
      events: { reason?: string }[] = [];
    const trust = await TrustStore.load({
      version: 1,
      owner: "urn:requester",
      keys: [
        {
          kid: identity.kid,
          alg: identity.alg,
          publicJwk: identity.publicJwk,
          role: "issuer",
          subject: party,
        },
      ],
      sourceAuthority: [
        {
          id: "urn:binding-rule",
          version: "1",
          source: party,
          claimTypes: ["joint.keys"],
          subjects: "any",
        },
      ],
    });
    const gate = new InboundGate({
      identity: { actor: "urn:requester" },
      trust,
      limits: DEFAULT_LIMITS,
      now: () => "2026-11-13T09:00:00Z",
      record: () => {},
      memory: new GateMemory(),
      gate: { sink: { agent: "requester", emit: (e) => events.push(e) } },
      agreementTerms: () => undefined,
    });
    const member = { party, publicKeys: required(f.keys[0]).publicKeys };
    const binding = await signClaim(identity, {
      id: "urn:binding",
      issuer: party,
      subject: party,
      claimType: "joint.keys",
      method: "recorded-by-authority",
      asOf: "2026-11-13T09:00:00Z",
      value: { publicKeys: member.publicKeys, computeOnly: false },
    });
    expect(
      await gate.checkJointBindings({ wire: {}, roster: [{ ...member, keyBinding: binding }] }),
    ).toBe(true);
    expect(await gate.checkJointBindings({ wire: {}, roster: [member] })).toBe(false);
    expect(events.at(-1)?.reason).toBe("source-not-accepted");
    const outsider = await testKey("aggregate/outsider");
    const forged = await signClaim(outsider, {
      id: "urn:forged",
      issuer: party,
      subject: party,
      claimType: "joint.keys",
      method: "recorded-by-authority",
      value: { publicKeys: member.publicKeys, computeOnly: false },
    });
    expect(
      await gate.checkJointBindings({ wire: {}, roster: [{ ...member, keyBinding: forged }] }),
    ).toBe(false);
  }, 60000);
  it("answers once to open/contribute, refuses a rule mismatch, and routes partials only to their encrypted recipient", async () => {
    const f = await fixture(),
      party = required(f.parties[0]);
    const runtime = {
      admittedStatements: () => [
        { id: "urn:count", claimType: "joint.count", value: 5 },
        { id: "urn:sum", claimType: "joint.sum", value: 500 },
      ],
      derivationRelease: () => true,
    } as unknown as AgentRuntime;
    const holder = new JointParty({
      party,
      requester: "urn:requester",
      protocol: f.protocol,
      secretKeys: required(f.keys[0]).secretKeys,
      fixed: {
        method: f.protocol.method,
        session: f.made.session,
        ruleDigest: f.made.ruleDigest,
        rule: "urn:rule",
        purpose: "urn:purpose",
        assurances: ["joint"],
      },
      runtime: () => runtime,
      store: new MemoryStateStore(),
      inputs: ["urn:count", "urn:sum"],
      purpose: "urn:purpose",
      recipient: "urn:requester",
    });
    const ctx = { peer: { party: "urn:requester" }, record: () => {} } as unknown as HandlerContext;
    const open = {
      sessionId: String(f.made.session.sessionId),
      session: f.made.session,
      ruleDigest: f.made.ruleDigest,
    };
    expect(
      await holder.receive(ctx, "urn:op:joint:open", { ...open, ruleDigest: "wrong" }),
    ).toMatchObject({ ok: false, reason: "rule-not-accepted" });
    expect(await holder.receive(ctx, "urn:op:joint:open", open)).toMatchObject({ ok: true });
    expect(await holder.receive(ctx, "urn:op:joint:open", open)).toMatchObject({
      ok: false,
      reason: "replay-conflict",
    });
    expect(await holder.contribute()).toMatchObject({ ok: true });
    expect(await holder.contribute()).toMatchObject({ ok: false, reason: "replay-conflict" });
    await expect(
      holder.receive({ ...ctx, peer: { party: required(f.parties[1]) } }, "urn:op:joint:partial", {
        sessionId: String(f.made.session.sessionId),
        partial: {
          party: required(f.parties[1]),
          message: { recipient: 0, packet: { ciphertext: "x".repeat(5000) } },
        },
      }),
    ).rejects.toMatchObject({ code: "too-large" });
    const contribution = required(f.contributions[1]);
    const from = { ...ctx, peer: { party: required(f.parties[1]) } };
    expect(
      await holder.receive(from, "urn:op:joint:contribute", {
        sessionId: String(f.made.session.sessionId),
        contribution,
        share: {},
      }),
    ).toMatchObject({ ok: true });
    expect(
      await holder.receive(from, "urn:op:joint:contribute", {
        sessionId: String(f.made.session.sessionId),
        contribution,
        share: {},
      }),
    ).toMatchObject({ ok: false, reason: "replay-conflict" });
    expect(
      await holder.receive(from, "urn:op:joint:partial", {
        sessionId: String(f.made.session.sessionId),
        partial: { party: required(f.parties[1]), message: { recipient: 2 } },
      }),
    ).toMatchObject({ ok: false, reason: "source-not-accepted" });
  }, 60000);
  it("runs the six actual gated paths and searches every trace for all keys, shares and audit openings used", async () => {
    const registry = await availableAdapters(),
      protocol = required(registry.jointProtocols.get("sparq-aggregate/1"));
    const secretValues = new Set<string>();
    const collect = (v: unknown) => {
      if (typeof v === "string") secretValues.add(v);
      else if (v && typeof v === "object") for (const x of Object.values(v)) collect(x);
    };
    // Observe real package responses only in this test; values are never assertion output.
    const callable = protocol as unknown as { call: (...args: unknown[]) => unknown };
    const call = callable.call.bind(protocol);
    const spy = vi.spyOn(callable, "call").mockImplementation((...args) => {
      const result = call(...args) as Record<string, unknown>;
      if (result.secret) collect(result.secret);
      if (result.local) collect((result.local as Record<string, unknown>).shares);
      if (result.audit_opening) collect(result.audit_opening);
      return result;
    });
    try {
      let runs = 0;
      for (const name of ["cohort-count", "platform-income", "salary-benchmark"]) {
        const { profile, scenario } = loadCase(root, name);
        const paths = await runScenario(profile, scenario, {
          registry: verifierRegistry([protocol]),
          compare: false,
        });
        for (const path of paths.filter(
          (p) =>
            p.trace?.generated &&
            p.usedTestDouble !== true &&
            (p.path === "main" || name !== "platform-income"),
        )) {
          runs++;
          const serialized = JSON.stringify(path.trace);
          expect([...secretValues].some((v) => serialized.includes(v))).toBe(false);
          expect(serialized.includes('"shares"')).toBe(false);
          expect(serialized.includes('"packet":{"ephemeral_key"')).toBe(false);
          if (path.path === "main")
            expect(
              path.trace?.events.some((e) => e.rule?.id === "DER-14" && e.verdict === "pass"),
            ).toBe(true);
          else if (name === "salary-benchmark") {
            expect(path.actual).toMatchObject({ outcome: "admit", reason: "fit-for-use" });
            expect(path.disagrees).toBe(true);
            expect(path.expected).toMatchObject({ outcome: "stop", reason: "prohibited" });
          } else
            expect(path.actual).toMatchObject({
              outcome: "stop",
              reason:
                name === "cohort-count" && path.path === "branch-2"
                  ? "derivation-not-verified"
                  : "prohibited",
            });
        }
      }
      expect(runs).toBe(6);
      expect(secretValues.size > 0).toBe(true);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  }, 600000);
});
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing fixture");
  return value;
}
