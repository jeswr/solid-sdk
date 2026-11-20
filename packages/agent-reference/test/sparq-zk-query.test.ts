// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { openConversation } from "../src/core/conversation.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { JsonObject } from "../src/core/types.js";
import { availableAdapters } from "../src/derive/adapters/index.js";
import {
  loadSparqZkQuery,
  SPARQ_ZK_QUERY,
  SparqZkQuery,
} from "../src/derive/adapters/sparq-zk-query.js";
import { queryFor, ruleSchema } from "../src/derive/rules.js";
import { verifyOpaqueDerivation } from "../src/derive/verification.js";
import {
  DERIVATION_LIMITS,
  type DerivedRequest,
  type ProofBinds,
  type ProofSystem,
  verifierRegistry,
} from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { patch, runScenario } from "../src/engine/run.js";
import { domainProfileSchema, scenarioSchema } from "../src/engine/schema.js";
import { GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { queryVerificationMethod } from "../src/model/sparq-query.js";
import { testKey } from "../src/reference/keys.js";
import { signClaim } from "../src/scenarios/common.js";
import type { TraceEventInput } from "../src/trace/types.js";

const local = join(import.meta.dirname, "../.sparq/sparq-zk-query");
const root = join(import.meta.dirname, "..");
const installed = existsSync(join(process.env.ANSWERABLE_SPARQ_ZK_QUERY ?? local, "index.js"));

it("checks absence against the complete pinned dataset without requiring a medication credential", async () => {
  const { profile } = loadCase(root, "trial-eligibility");
  const rule = ruleSchema.parse(profile.rules[0]);
  const subject = "urn:trial:subject";
  const purpose = "urn:purpose:trial-eligibility";
  const issuer = "urn:trial:issuer";
  rule.inputsFrom = [issuer];
  const key = { publicKey: "00".repeat(32) };
  const inputs = ["trial.age", "trial.diagnosis", "trial.medication-complete"];
  const ruleDigest = digestOf(rule);
  const nonce = "trial-absence";
  const policy = { inputCommitment: "00".repeat(32) };
  const checked = async (complete: boolean, coverageKinds: string[]) => {
    const binds: ProofBinds[] = ["rule", "issuers", "fresh"];
    if (complete) binds.push("complete");
    const verify: ProofSystem["verify"] = async (input) => {
      expect(input).toMatchObject({ booleanResult: true, policy, nonce });
      return { ok: true, released: true, binds, issuerKeys: [key] };
    };
    const system = {
      method: SPARQ_ZK_QUERY.method,
      kind: "real" as const,
      binds,
      verify,
      issue: vi.fn(),
      issuerKeygen: vi.fn(),
      prove: vi.fn(),
    };
    const request: DerivedRequest = {
      rule: rule.id,
      ruleDigest,
      subject,
      purpose,
      nonce,
      assurances: ["attested"],
      query: queryFor(rule),
      policy,
      consumed: false,
    };
    return verifyOpaqueDerivation({
      statement: {
        subject,
        issuer: subject,
        claimType: rule.output,
        method: "derived",
        value: true,
        derivation: {
          rule: rule.id,
          ruleDigest,
          assurance: "attested",
          deriver: subject,
          outputDigest: digestOf(true),
          proofBinds: binds,
          proof: { method: system.method, nonce, presentation: {} },
        },
      },
      gate: {
        ...verifierRegistry([system]),
        rules: [rule],
        acceptedProofs: [
          {
            rule: rule.id,
            method: system.method,
            assurance: "attested",
            purposes: [purpose],
            binds: ["rule", "issuers", "fresh"],
          },
        ],
        derivedRequests: { [nonce]: request },
        proofIssuerKeys: [{ issuer, key, claimTypes: inputs }],
        queryProofPolicies: [
          {
            rule: rule.id,
            subject,
            policy,
            coverage: [{ issuer, key, claimTypes: coverageKinds }],
          },
        ],
      },
      purpose,
      acceptsSource: (source, kind) => source === issuer && inputs.includes(kind),
      event: () => {},
    });
  };
  expect(await checked(true, inputs)).toMatchObject({ ok: true });
  expect(await checked(false, inputs)).toMatchObject({
    ok: false,
    reason: "derivation-not-verified",
  });
  expect(await checked(true, inputs.slice(0, -1))).toMatchObject({
    ok: false,
    reason: "source-not-authoritative",
  });
});

it("omits the query verifier when its optional package is missing", async () => {
  vi.stubEnv("ANSWERABLE_SPARQ_ZK_QUERY", join(local, "missing-package"));
  try {
    const registry = await availableAdapters();
    expect(registry.proofSystems.has(SPARQ_ZK_QUERY.method)).toBe(false);
    expect(registry.loaded.join("\n")).not.toContain(SPARQ_ZK_QUERY.package);
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  { rows: [] },
  {
    rows: [
      ['"true"^^<http://www.w3.org/2001/XMLSchema#boolean>'],
      ['"false"^^<http://www.w3.org/2001/XMLSchema#boolean>'],
    ],
  },
])("refuses a SELECT with zero or multiple rows for a Boolean rule (%j)", async ({ rows }) => {
  const word = "00".repeat(32);
  const released = { variables: ["result"], rows };
  const policy = {
    trustedIssuers: [word],
    trustMembers: [{ issuer: "urn:issuer", verificationMethod: "urn:key", publicKey: word }],
    bounds: { credentials: 1, quadsPerCredential: 4, rowsPerTable: 4 },
    audience: "urn:receiver",
    notBefore: 0,
    notAfter: 1,
  };
  const presentation = {
    requestDigest: word,
    inputCommitment: word,
    signatureMode: 1,
    result: released,
    proof: word,
  };
  const adapter = new SparqZkQuery({
    testIssuerKeygen() {},
    testIssue() {},
    request: (args) => ({
      ...args,
      planHash: word,
      verificationKey: word,
      digest: word,
      requestRdf: "",
    }),
    prove: async () => ({ presentation, result: released }),
    verify: async () => ({
      verified: true,
      released,
      report: {
        rule: { query: "SELECT ?result {}", planHash: word },
        issuers: [word],
        subject: [],
        fresh: word,
        complete: true,
        issuerRoot: word,
        trustMembers: policy.trustMembers,
      },
    }),
  });
  expect(
    await adapter.verify({
      expectedQuery: "SELECT ?result {}",
      presentation,
      policy,
      nonce: "test",
      booleanResult: true,
      seenNonces: new Set<string>(),
    }),
  ).toEqual({ ok: false, reason: "The query must release exactly one Boolean result" });
  await expect(
    adapter.prove({
      query: "SELECT ?result {}",
      credentials: [],
      policy,
      nonce: "test",
      booleanResult: true,
    }),
  ).rejects.toThrow(/exactly one Boolean/);
});

const catalogueAsk = "ASK {?s <urn:p> ?x FILTER(?x > 8)}";
const catalogueBounds = { credentials: 1, quadsPerCredential: 4, rowsPerTable: 4 };
const threshold = { input: "urn:p", operator: "gt", value: 8 } as const;

it.skipIf(!installed).each(["main", "supplier-below-threshold"])(
  "issues all supplier decimals for recycled-content/%s",
  async (path) => {
    const system = await loadSparqZkQuery("wasm");
    if (!system) throw new Error("Expected installed query adapter");
    const { scenario } = loadCase(root, "recycled-content");
    const world = patch(
      scenario,
      scenario.branches.find((branch) => branch.id === path)?.change ?? {},
    );
    const literals = [];
    for (const spec of world.proofCredentials) {
      const issuer = world.parties.find((p) => p.id === spec.issuer)?.identity;
      if (!issuer) throw new Error("Missing supplier fixture issuer");
      const keys = await system.issuerKeygen(new TextEncoder().encode(issuer));
      const statements = spec.statements.map((id) => {
        const statement = world.statements.find((s) => s.id === id);
        if (!statement) throw new Error("Missing supplier fixture statement");
        return { ...statement.value, issuer, subject: spec.subject, claimType: statement.kind };
      });
      const issued = await system.issue({
        issuerKey: keys.secretKey,
        subject: spec.subject,
        claims: { statements },
      });
      literals.push(
        String(issued.graphNQuads).match(
          /"([\d.]+)"\^\^<http:\/\/www\.w3\.org\/2001\/XMLSchema#decimal>/,
        )?.[1],
      );
    }
    expect(literals).toEqual(["0.35", "0.4", path === "main" ? "0.38" : "0.29"]);
  },
);

it.skipIf(!installed)(
  "runs a real pinned Boolean query round trip through the scenario engine",
  async () => {
    const backend = process.env.SPARQ_NARGO && process.env.SPARQ_BB ? "native" : "wasm";
    const system = await loadSparqZkQuery(backend);
    if (!system) throw new Error("Expected installed query adapter");
    const source = "urn:fictional:recycled-content:tier";
    const world = loadCase(root, "recycled-content");
    const profile = domainProfileSchema.parse(
      JSON.parse(JSON.stringify(world.profile).replaceAll("material.recycled-fraction", "urn:p")),
    );
    const scenario = scenarioSchema.parse(
      JSON.parse(JSON.stringify(world.scenario).replaceAll("material.recycled-fraction", "urn:p")),
    );
    const rule = profile.rules[0];
    if (!rule || !("template" in rule) || rule.template !== "threshold")
      throw new Error("Expected recycled-content threshold rule");
    profile.sources = { ...profile.sources, supplier: source };
    rule.inputsFrom = ["supplier"];
    rule.proofQuery = catalogueAsk;
    rule.params = threshold;
    const supplier = scenario.statements.find((statement) => statement.id === "audited-tier");
    if (!supplier) throw new Error("Expected supplier fixture");
    supplier.value = { value: 9 };
    scenario.requiredMethods = [system.method];
    scenario.proofCredentials = scenario.proofCredentials.filter((spec) => spec.issuer === "tier");
    scenario.branches = [];
    scenario.blocked = [];
    scenario.queryProofOptions = {
      [rule.id]: {
        bounds: catalogueBounds,
        audience: "urn:fictional:recycled-content:receiver",
        notBefore: 0,
        notAfter: 32_503_680_000,
      },
    };
    for (const step of scenario.script) {
      if (step.type === "admit" && step.id === "private-inputs") step.statements = ["audited-tier"];
      if (step.type === "prove") step.inputs = ["audited-tier"];
    }
    const [path] = await runScenario(profile, scenario, {
      registry: verifierRegistry([system]),
      compare: false,
    });
    expect(path?.trace?.events).toContainEqual(
      expect.objectContaining({
        verdict: "pass",
        rule: expect.objectContaining({ id: "DER-13a" }),
        caption: expect.stringContaining("rule, issuers, fresh, complete"),
      }),
    );
    expect(path?.trace?.events).toContainEqual(
      expect.objectContaining({
        verdict: "pass",
        rule: expect.objectContaining({ id: "DER-18" }),
      }),
    );
    expect(JSON.stringify(path?.trace)).not.toMatch(/presentationSaltHex|graphNQuads|seedHex/);
  },
  300_000,
);

describe.skipIf(!installed)("real Noir query proofs (requires the optional archive)", () => {
  const issuer = "urn:issuer";
  const subject = "urn:subject";
  const query = catalogueAsk;
  const now = Math.floor(Date.now() / 1000);
  let system: SparqZkQuery;
  let policy: Parameters<SparqZkQuery["prove"]>[0]["policy"];
  const nonce = "true-proof";
  let yes: Awaited<ReturnType<SparqZkQuery["prove"]>>;
  let no: typeof yes;
  let pinnedNo: typeof yes;
  let pinnedPolicy: typeof policy;
  const keys = (seed: number) => system.issuerKeygen(new Uint8Array([seed]));
  const issue = async (value: number, seed: number) =>
    system.issue({
      issuerKey: (await keys(seed)).secretKey,
      subject,
      claims: { statements: [{ issuer, subject, claimType: "urn:p", value }] },
    });
  const prove = async (credential: Awaited<ReturnType<typeof issue>>, nonce: string) =>
    system.prove({ query, policy, nonce, credentials: [credential] });
  const verify = (proof: typeof yes, nonce: string, seenNonces?: Set<string>) =>
    system.verify({
      expectedQuery: query,
      presentation: proof.presentation,
      policy,
      nonce,
      seenNonces,
    });

  beforeAll(async () => {
    const loaded = await loadSparqZkQuery("wasm");
    if (!loaded) throw new Error("Expected installed query adapter");
    system = loaded;
    const publicKey = String((await keys(1)).publicKey.publicKey);
    policy = {
      trustedIssuers: [publicKey],
      trustMembers: [{ issuer, verificationMethod: queryVerificationMethod(issuer), publicKey }],
      audience: "urn:receiver",
      bounds: catalogueBounds,
      notBefore: now - 1,
      notAfter: now + 3600,
    };
    yes = await prove(await issue(9, 1), nonce);
    const credential = await issue(1, 1);
    no = await prove(credential, "false-proof");
    const args = {
      query,
      policy,
      nonce: "pinned-false",
      credentials: [credential],
      presentationSaltHex: "a2".repeat(32),
    };
    pinnedPolicy = { ...policy, inputCommitment: system.fixtureInputCommitment(args) };
    pinnedNo = await system.prove({ ...args, policy: pinnedPolicy, booleanResult: true });
  }, 300_000);

  it("returns a verified true and keeps the method notice in discovery", async () => {
    const registry = await availableAdapters();
    expect(registry.loaded.join("\n")).toContain(SPARQ_ZK_QUERY.notice);
    expect(yes.result).toBe(true);
    expect(await verify(yes, nonce, new Set())).toMatchObject({
      ok: true,
      released: true,
      binds: ["rule", "issuers", "fresh"],
    });
  });

  async function receiveProof(input: {
    proof: typeof yes;
    nonce: string;
    policy: JsonObject;
    requiredBindings: ProofBinds[];
    claimedBindings: ProofBinds[];
    pin?: boolean;
    requestedSubject?: string;
    secondSupplier?: boolean;
  }) {
    const requestedSubject = input.requestedSubject ?? subject;
    const at = new Date(now * 1000).toISOString();
    const purpose = "urn:purpose:test-condition";
    const rule = ruleSchema.parse({
      id: "urn:rule:test-condition",
      template: "threshold",
      params: threshold,
      output: "condition.result",
      inputsFrom: input.secondSupplier ? [issuer, "urn:second-issuer"] : [issuer],
      assurances: ["attested"],
      proofQuery: query,
    });
    const stored: DerivedRequest = {
      rule: rule.id,
      ruleDigest: digestOf(rule),
      subject: requestedSubject,
      purpose,
      assurances: ["attested"],
      nonce: input.nonce,
      query,
      policy: input.policy,
      consumed: false,
    };
    const holder = await testKey("query-test-holder");
    const trust = await TrustStore.load({
      version: 1,
      owner: "urn:receiver",
      keys: [
        { kid: holder.kid, alg: holder.alg, publicJwk: holder.publicJwk, role: "issuer", subject },
      ],
      sourceAuthority: [
        {
          id: "urn:source:query",
          version: "1",
          source: issuer,
          claimTypes: ["urn:p"],
          subjects: [requestedSubject],
        },
      ],
    });
    const memory = new GateMemory();
    const events: TraceEventInput[] = [];
    const coverage = [{ issuer, key: (await keys(1)).publicKey, claimTypes: ["urn:p"] }];
    const inbound = new InboundGate({
      identity: { actor: "urn:receiver:actor", party: "urn:receiver" },
      trust,
      memory,
      limits: { ...DEFAULT_LIMITS, ...DERIVATION_LIMITS },
      now: () => at,
      record: () => {},
      agreementTerms: () => undefined,
      gate: {
        ...verifierRegistry([system]),
        rules: [rule],
        derivedRequests: { [stored.nonce]: stored },
        saveDerivationState: () => {},
        proofIssuerKeys: coverage,
        ...(input.pin
          ? { queryProofPolicies: [{ rule: rule.id, subject, policy: input.policy, coverage }] }
          : {}),
        acceptedProofs: [
          {
            rule: rule.id,
            method: system.method,
            assurance: "attested",
            binds: input.requiredBindings,
            purposes: [purpose],
          },
        ],
        sink: { agent: "receiver", emit: (event) => events.push(event) },
      },
    });
    const jws = await signClaim(holder, {
      id: "urn:statement:condition-result",
      issuer: subject,
      subject: requestedSubject,
      claimType: rule.output,
      method: "derived",
      asOf: at,
      value: input.proof.result,
      derivation: {
        rule: rule.id,
        ruleDigest: stored.ruleDigest,
        assurance: "attested",
        deriver: subject,
        at,
        outputDigest: digestOf(input.proof.result),
        proofBinds: input.claimedBindings,
        inputs: [],
        proof: {
          method: system.method,
          nonce: stored.nonce,
          presentation: input.proof.presentation,
        },
      },
    });
    const conversation = "urn:test-conversation";
    const admission = inbound.arrive(undefined, undefined, undefined);
    const decision = await admission.complete(
      openConversation({ id: conversation, peer: { party: subject }, role: "responder", at }),
      {
        id: "urn:test-message",
        conversation,
        kind: "invoke",
        profile: "urn:test-profile",
        configuration: "urn:test-configuration",
        from: { onBehalfOf: subject },
        createdAt: at,
        expiresAt: new Date((now + 60) * 1000).toISOString(),
        evidence: [{ role: "credential", value: jws, format: "derivation+jws" }],
        body: {
          operation: { id: "urn:test-operation", version: "1" },
          purpose,
          basis: { kind: "represented" },
          input: {},
        },
      },
    );
    return { decision, events, stored };
  }

  const basicBindings: ProofBinds[] = ["rule", "issuers", "fresh"];
  const fullBindings: ProofBinds[] = [...basicBindings, "complete"];

  it("returns a verified false and the gate stops on the unmet condition", async () => {
    expect(pinnedNo.result).toBe(false);
    const { decision, events, stored } = await receiveProof({
      proof: pinnedNo,
      nonce: "pinned-false",
      policy: pinnedPolicy,
      pin: true,
      requiredBindings: fullBindings,
      claimedBindings: fullBindings,
    });
    expect(decision).toMatchObject({ ok: false, reason: "not-authorised" });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verdict: "pass",
          rule: expect.objectContaining({ id: "DER-17" }),
        }),
        expect.objectContaining({ kind: "decision", outcome: "refuse", reason: "not-authorised" }),
      ]),
    );
    expect(stored.consumed).toBe(true);
  }, 300_000);

  it("refuses a valid Noir proof pinned to another subject", async () => {
    const { decision, events } = await receiveProof({
      proof: pinnedNo,
      nonce: "pinned-false",
      policy: pinnedPolicy,
      pin: true,
      requestedSubject: "urn:different-subject",
      requiredBindings: fullBindings,
      claimedBindings: fullBindings,
    });
    expect(decision).not.toMatchObject({ reason: "not-authorised" });
    expect(events).toContainEqual(
      expect.objectContaining({
        verdict: "fail",
        reason: "derivation-not-verified",
        rule: expect.objectContaining({ id: "DER-17" }),
      }),
    );
  });

  it.each([
    true,
    false,
  ])("refuses proof bindings missing complete before acting on %s", async (value) => {
    const { decision, events } = await receiveProof({
      proof: value ? yes : no,
      nonce: value ? nonce : "false-proof",
      policy,
      requiredBindings: fullBindings,
      claimedBindings: basicBindings,
    });
    expect(decision).not.toMatchObject({ reason: "not-authorised" });
    expect(events).toContainEqual(
      expect.objectContaining({
        verdict: "fail",
        reason: "assurance-insufficient",
        rule: expect.objectContaining({ id: "DER-13a" }),
      }),
    );
  });

  it("refuses a complete proof over a pinned dataset that omits a required supplier", async () => {
    const { decision, events } = await receiveProof({
      proof: pinnedNo,
      nonce: "pinned-false",
      policy: pinnedPolicy,
      pin: true,
      secondSupplier: true,
      requiredBindings: fullBindings,
      claimedBindings: fullBindings,
    });
    expect(decision).not.toMatchObject({ reason: "not-authorised" });
    expect(events).toContainEqual(
      expect.objectContaining({
        verdict: "fail",
        reason: "source-not-authoritative",
        rule: expect.objectContaining({ id: "DER-18" }),
      }),
    );
  });

  it("refuses a credential signed by a key outside the stored issuer roster", async () => {
    await expect(prove(await issue(9, 2), "wrong-issuer")).rejects.toThrow(/issuer|authoriz/i);
    const key = String((await keys(2)).publicKey.publicKey);
    const seenNonces = new Set<string>();
    const checked = await system.verify({
      expectedQuery: query,
      presentation: yes.presentation,
      nonce,
      seenNonces,
      policy: {
        ...policy,
        trustedIssuers: [key],
        trustMembers: [
          { issuer, verificationMethod: queryVerificationMethod(issuer), publicKey: key },
        ],
      },
    });
    expect(checked).toMatchObject({ ok: false, reason: expect.stringMatching(/request|issuer/i) });
    expect(seenNonces.size).toBe(0);
  });

  it("consumes a nonce once and refuses replay", async () => {
    const seen = new Set<string>();
    expect(await verify(yes, nonce, seen)).toMatchObject({ ok: true });
    expect(await verify(yes, nonce, seen)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/nonce|replay|consum/i),
    });
  });

  it("refuses a tampered presentation without consuming its nonce", async () => {
    const seen = new Set<string>();
    const original = String(yes.presentation.proof);
    const bad = {
      ...yes,
      presentation: {
        ...yes.presentation,
        proof: `${original[0] === "0" ? "1" : "0"}${original.slice(1)}`,
      },
    };
    expect(await verify(bad, nonce, seen)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/proof/i),
    });
    expect(seen.size).toBe(0);
  });

  it("fails closed without the receiver nonce store", async () => {
    expect(await verify(yes, nonce)).toEqual({
      ok: false,
      reason: "persistent nonce store missing",
    });
  });
});
