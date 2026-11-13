// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { JsonObject } from "../src/core/types.js";
import { ProofCache, proofRequestDigest } from "../src/derive/cache.js";
import { queryFor, ruleSchema } from "../src/derive/rules.js";
import { type DerivedRequest, verifierRegistry } from "../src/derive/verifiers.js";
import { type GateContext, GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { signClaim } from "../src/scenarios/common.js";
import type { TraceEventInput } from "../src/trace/types.js";
import { ToyProofSystem } from "./doubles/proof.js";

async function proofFixture() {
  const system = new ToyProofSystem(),
    issuer = "urn:source",
    holder = "urn:holder",
    subject = "urn:person",
    purpose = "urn:purpose:test",
    at = "2026-11-13T09:00:00.000Z";
  const rule = ruleSchema.parse({
    id: "urn:rule:test",
    template: "threshold",
    params: { input: "funds", operator: "gte", value: 100 },
    output: "enough",
    inputsFrom: [issuer],
    assurances: ["attested", "proved"],
  });
  const keys = await system.issuerKeygen(new Uint8Array([1]));
  const credential = await system.issue({
    issuerKey: keys.secretKey,
    subject,
    claims: { claimType: "funds", value: 200 },
  });
  const policy = { issuerKeys: [keys.publicKey], status: {} };
  const request: DerivedRequest = {
    rule: rule.id,
    ruleDigest: digestOf(rule),
    subject,
    purpose,
    assurances: ["attested", "proved"],
    nonce: "urn:nonce:one",
    query: queryFor(rule),
    policy,
    consumed: false,
  };
  const args = { query: request.query, credentials: [credential], policy, nonce: request.nonce };
  const proof = await system.prove(args);
  const statement: JsonObject = {
    id: "urn:answer",
    issuer: holder,
    subject,
    claimType: rule.output,
    value: proof.result,
    method: "derived",
    asOf: at,
    derivation: {
      rule: rule.id,
      ruleDigest: digestOf(rule),
      assurance: "attested",
      deriver: holder,
      at,
      outputDigest: digestOf(proof.result),
      proofBinds: [...system.binds],
      proof: { method: system.method, presentation: proof.presentation, nonce: request.nonce },
      inputs: [],
    },
  };
  const key = await testKey("proof-fixture/holder"),
    events: TraceEventInput[] = [],
    memory = new GateMemory();
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:receiver",
    keys: [
      { kid: key.kid, alg: key.alg, publicJwk: key.publicJwk, role: "issuer", subject: holder },
    ],
    sourceAuthority: [
      {
        id: "urn:source-rule",
        version: "1",
        source: issuer,
        claimTypes: ["funds"],
        subjects: [subject],
      },
    ],
  });
  let saves = 0;
  const gate: GateContext = {
    ...verifierRegistry([system]),
    rules: [rule],
    taskId: "urn:task",
    acceptedProofs: [
      {
        rule: rule.id,
        method: system.method,
        assurance: "attested",
        binds: [...system.binds],
        purposes: [purpose],
      },
    ],
    proofIssuerKeys: [{ issuer, key: keys.publicKey, claimTypes: ["funds"] }],
    derivedRequests: { [request.nonce]: request },
    saveDerivationState: () => {
      saves++;
    },
    reliance: {
      id: "urn:reliance",
      rules: ["funds", "enough"].map((claimType) => ({
        id: `urn:reliance:${claimType}`,
        claimType,
        methods: ["derived", "recorded-by-authority"],
        maxAgeDays: 1,
        text: "Test policy.",
      })),
    },
    sink: { agent: "receiver", emit: (e) => events.push(e) },
  };
  const inbound = new InboundGate({
    identity: { actor: "urn:actor", party: "urn:receiver" },
    trust,
    limits: DEFAULT_LIMITS,
    now: () => at,
    record: () => {},
    memory,
    gate,
    agreementTerms: () => undefined,
  });
  const admit = async () =>
    inbound.admitStatements([{ jws: await signClaim(key, statement) }], {
      task: "urn:task",
      subject,
      purpose,
    });
  return {
    system,
    issuer,
    holder,
    subject,
    purpose,
    at,
    rule,
    keys,
    credential,
    request,
    args,
    proof,
    statement,
    events,
    gate,
    memory,
    trust,
    admit,
    saves: () => saves,
  };
}
it("checks a limited proof through the real source gate and consumes its own nonce only after verification", async () => {
  const f = await proofFixture();
  expect(await f.admit()).toEqual({ admitted: 1, refused: 0 });
  expect(f.request.consumed).toBe(true);
  expect(f.saves()).toBe(1);
  expect(f.events.filter((e) => e.check === "source").map((e) => e.rule?.id)).toEqual([
    "DER-6",
    "DER-16",
    "DER-16",
    "DER-16",
    "DER-17",
    "DER-13",
    "DER-13a",
    "DER-18",
  ]);
  expect(await f.admit()).toEqual({ admitted: 0, refused: 1 });
  expect(f.events.findLast((e) => e.kind === "decision")?.reason).toBe("replay-conflict");
});
it.each([
  ["rule", "rule-not-accepted"],
  ["method", "method-not-accepted"],
  ["purpose", "method-not-accepted"],
  ["assurance", "assurance-insufficient"],
  ["query", "derivation-not-verified"],
  ["value", "derivation-not-verified"],
  ["overstates", "derivation-not-verified"],
  ["proved-without-subject", "derivation-not-verified"],
  ["issuer", "source-not-authoritative"],
  ["nonce", "replay-conflict"],
  ["unissued", "replay-conflict"],
  ["fitness", "method-not-accepted"],
])("fails only the %s condition without laundering the claim", async (attack, reason) => {
  const f = await proofFixture(),
    d = f.statement.derivation as JsonObject,
    p = d.proof as JsonObject;
  if (attack === "rule") d.ruleDigest = "wrong";
  if (attack === "method") p.method = "unregistered";
  if (attack === "purpose")
    required((f.gate.acceptedProofs as unknown as { purposes: string[] }[])[0]).purposes = [
      "urn:other",
    ];
  if (attack === "assurance") f.request.assurances = ["proved"];
  if (attack === "query") f.request.query = f.request.query.replace("100", "999");
  if (attack === "value") {
    f.statement.value = false;
    d.outputDigest = digestOf(false);
  }
  if (attack === "overstates") d.proofBinds = ["rule", "issuers", "subject"];
  if (attack === "proved-without-subject") {
    d.assurance = "proved";
    required((f.gate.acceptedProofs as unknown as { assurance: string }[])[0]).assurance = "proved";
  }
  if (attack === "issuer")
    required((f.gate.proofIssuerKeys as unknown as { issuer: string }[])[0]).issuer = "urn:unknown";
  if (attack === "nonce") f.request.consumed = true;
  if (attack === "unissued") p.nonce = "urn:unissued";
  if (attack === "fitness")
    required((f.gate.acceptedProofs as unknown as { binds: string[] }[])[0]).binds = ["subject"];
  expect(await f.admit()).toEqual({ admitted: 0, refused: 1 });
  expect(f.events.findLast((e) => e.kind === "decision")?.reason).toBe(reason);
  expect(f.memory.facts.size).toBe(0);
  if (!["nonce", "fitness"].includes(attack)) expect(f.request.consumed).toBe(false);
});
it("a failed proof leaves the nonce available for a corrected proof", async () => {
  const f = await proofFixture(),
    p = (f.statement.derivation as JsonObject).proof as JsonObject;
  p.presentation = { bad: true };
  expect((await f.admit()).admitted).toBe(0);
  expect(f.request.consumed).toBe(false);
  p.presentation = f.proof.presentation;
  expect((await f.admit()).admitted).toBe(1);
});
it("falls back to an explicitly accepted attested holder when proof bindings are insufficient", async () => {
  const f = await proofFixture();
  required((f.gate.acceptedProofs as unknown as { binds: string[] }[])[0]).binds = ["subject"];
  (f.gate as { attestedDerivers: unknown }).attestedDerivers = [
    { deriver: f.holder, rule: f.rule.id, purposes: [f.purpose] },
  ];
  expect((await f.admit()).admitted).toBe(1);
  expect(f.events.some((e) => e.caption.includes("holder's signature attests"))).toBe(true);
});
it("cache keys cover exact query, policy, nonce and credential digests and reject mismatched file contents", async () => {
  const f = await proofFixture(),
    directory = mkdtempSync(join(tmpdir(), "proof-cache-")),
    cache = new ProofCache(directory);
  try {
    cache.write(f.system.method, f.args, f.proof);
    expect(cache.read(f.system.method, f.args)).toEqual(f.proof);
    for (const delta of [
      { query: "other" },
      { policy: {} },
      { nonce: "other" },
      { credentials: [] },
    ])
      expect(cache.read(f.system.method, { ...f.args, ...delta })).toBeUndefined();
    const path = join(directory, `${proofRequestDigest(f.args).slice(8)}.json`),
      entry = JSON.parse(readFileSync(path, "utf8"));
    entry.requestDigest = "wrong";
    writeFileSync(path, JSON.stringify(entry));
    expect(cache.read(f.system.method, f.args)).toBeUndefined();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
it("compiles receiver-owned threshold/date, boolean and membership SELECT DISTINCT queries", () => {
  const common = { id: "urn:r", inputsFrom: ["urn:i"], output: "out" };
  for (const rule of [
    {
      ...common,
      template: "threshold",
      params: { input: "birth", date: "2008-11-13", operator: "lte" },
    },
    { ...common, template: "all-of", params: { inputs: ["a", "b"] } },
    { ...common, template: "any-of", params: { inputs: ["a", "b"] } },
    { ...common, template: "membership", params: { input: "degree", values: ["BSc"] } },
  ])
    expect(queryFor(ruleSchema.parse(rule))).toMatch(/^SELECT DISTINCT/);
});
it("persists receiver-issued nonces before sending, consumes after success and rejects replay after restart", async () => {
  const { AgentRuntime } = await import("../src/runtime/agent.js"),
    { Cast, mandateOf } = await import("../src/scenarios/common.js"),
    { FileStateStore } = await import("../src/store/state.js"),
    { MemoryLedger } = await import("../src/store/ledger.js"),
    { idSource } = await import("../src/reference/keys.js"),
    { CONFIG_ED25519 } = await import("../src/profile/configurations.js");
  const f = await proofFixture(),
    directory = mkdtempSync(join(tmpdir(), "proof-nonce-"));
  let store = new FileStateStore(join(directory, "state.json"));
  try {
    const cast = new Cast(() => new Date(f.at)),
      actor = await cast.add(
        { name: "receiver", actor: "urn:receiver:actor", party: "urn:receiver" },
        mandateOf("proof", [], []),
        [],
      );
    const trust = await TrustStore.load({
      ...actor.trust,
      keys: [...actor.trust.keys, ...f.trust.data.keys],
      sourceAuthority: f.trust.data.sourceAuthority,
    });
    const make = () =>
      AgentRuntime.create({
        identity: actor.identity,
        actorKeys: [actor.actorKey],
        trust,
        mandateJws: actor.mandateJws,
        representationJws: actor.representationJws,
        accepted: [CONFIG_ED25519],
        handlers: [],
        store,
        ledger: new MemoryLedger(),
        now: () => new Date(f.at),
        newId: idSource("durable-proof")("receiver"),
        gates: { ...f.gate, derivedRequests: undefined },
      });
    let runtime = await make();
    const request = runtime.issueDerivationRequest({
      rule: f.rule.id,
      subject: f.subject,
      purpose: f.purpose,
      assurances: ["attested"],
    });
    expect(
      (store.load().domain.derivedRequests as unknown as Record<string, DerivedRequest>)[
        request.nonce
      ],
    ).toEqual(request);
    const proof = await f.system.prove({ ...f.args, nonce: request.nonce, policy: request.policy });
    const derivation = f.statement.derivation as JsonObject;
    derivation.proof = {
      method: f.system.method,
      presentation: proof.presentation,
      nonce: request.nonce,
    };
    const key = await testKey("proof-fixture/holder"),
      jws = await signClaim(key, f.statement);
    store.close();
    store = new FileStateStore(join(directory, "state.json"));
    runtime = await make();
    expect(
      (
        await runtime.admitStatements([{ jws }], {
          task: "urn:task",
          subject: f.subject,
          purpose: f.purpose,
        })
      ).admitted,
    ).toBe(1);
    expect(
      (store.load().domain.derivedRequests as unknown as Record<string, DerivedRequest>)[
        request.nonce
      ]?.consumed,
    ).toBe(true);
    store.close();
    store = new FileStateStore(join(directory, "state.json"));
    runtime = await make();
    expect(
      (
        await runtime.admitStatements([{ jws }], {
          task: "urn:task",
          subject: f.subject,
          purpose: f.purpose,
        })
      ).admitted,
    ).toBe(0);
    expect(f.events.findLast((e) => e.kind === "decision")?.reason).toBe("replay-conflict");
    expect(
      runtime.issueDerivationRequest({
        rule: f.rule.id,
        subject: f.subject,
        purpose: f.purpose,
        assurances: ["attested"],
      }).nonce,
    ).not.toBe(request.nonce);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});
it("tracks actual test-double use even without a required-method declaration", async () => {
  const { registryForRun } = await import("../src/derive/verifiers.js"),
    { assertPublishable } = await import("../src/engine/publication.js");
  const f = await proofFixture(),
    tracked = registryForRun(verifierRegistry([f.system]), true);
  await required(tracked.registry.proofSystems.get(f.system.method)).verify({
    expectedQuery: f.args.query,
    presentation: f.proof.presentation,
    policy: f.args.policy,
    nonce: f.args.nonce,
  });
  expect(() => assertPublishable({ usedTestDouble: tracked.usedTestDouble() })).toThrow(
    "test-double",
  );
  const forbidden = registryForRun(verifierRegistry([f.system]));
  expect(() =>
    required(forbidden.registry.proofSystems.get(f.system.method)).verify({
      expectedQuery: f.args.query,
      presentation: f.proof.presentation,
      policy: f.args.policy,
      nonce: f.args.nonce,
    }),
  ).toThrow("test-double");
  expect(forbidden.usedTestDouble()).toBe(true);
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Required test fixture is missing");
  return value;
}
it("stores a weaker reliance label separately while retaining the holder's signed statement bytes", async () => {
  const f = await proofFixture();
  required((f.gate.acceptedProofs as unknown as { binds: string[] }[])[0]).binds = ["subject"];
  const quality = required(
    (
      f.gate.reliance as unknown as { rules: { claimType: string; methods: string[] }[] }
    ).rules.find((r) => r.claimType === "enough"),
  );
  quality.methods = ["reported-by-subject"];
  expect((await f.admit()).admitted).toBe(1);
  const fact = required(f.memory.facts.get(String(f.statement.id)));
  expect(fact.method).toBe("reported-by-subject");
  expect(fact.statement).toEqual(f.statement);
  expect(fact.digest).toBe(digestOf(f.statement));
  expect(f.events.find((e) => e.kind === "store")?.fact?.method).toBe("reported-by-subject");
});

it("claims a proof nonce across concurrent verification and admits exactly one copy", async () => {
  const f = await proofFixture();
  const verify = f.system.verify.bind(f.system);
  f.system.verify = async (input) => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    return verify(input);
  };
  const results = await Promise.all([f.admit(), f.admit()]);
  expect(results.map((r) => r.admitted).sort()).toEqual([0, 1]);
  expect(f.events.some((e) => e.reason === "replay-conflict")).toBe(true);
});
