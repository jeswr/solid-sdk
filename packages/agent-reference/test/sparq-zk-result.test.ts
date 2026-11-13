// AUTHORED-BY Codex GPT-6
// Research-grade, unaudited; sparq commitment-signed credentials, not standard VCs;
// test-only issuer keys. Diagnostic adapter tests are never scenario recordings.
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { randomBytes } from "crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
  // biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
} from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error Executable installer has no declaration file.
import { install, RESULT_SHA256 } from "../scripts/install-sparq.mjs";
import { digestOf } from "../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { JsonObject } from "../src/core/types.js";
import { availableAdapters } from "../src/derive/adapters/index.js";
import {
  loadSparqZkResult,
  type ResultPackage,
  resultCredential,
  resultPresentation,
  resultProved,
  resultVerified,
  SPARQ_ZK_RESULT,
  SparqZkResult,
} from "../src/derive/adapters/sparq-zk-result.js";
import { queryFor, ruleSchema } from "../src/derive/rules.js";
import { verifyOpaqueDerivation } from "../src/derive/verification.js";
import {
  DERIVATION_LIMITS,
  type DerivedRequest,
  verifierRegistry,
} from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { type GateContext, GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { signClaim } from "../src/scenarios/common.js";
import type { TraceEventInput } from "../src/trace/types.js";

const root = join(import.meta.dirname, "..");
const installed = existsSync(
  join(process.env.ANSWERABLE_SPARQ_ZK_RESULT ?? join(root, ".sparq/sparq-zk-result"), "index.js"),
);
if (!installed)
  writeSync(
    1,
    `Skipped real result-proof tests: ${SPARQ_ZK_RESULT.notice} Optional .sparq/sparq-zk-result installation absent.\n`,
  );
const query =
  'SELECT DISTINCT ?subject WHERE { ?subject <urn:claim:identity.verified> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> . }';
const otherQuery =
  "SELECT DISTINCT ?result WHERE { ?subject <urn:claim:identity.verified> ?result . }";
const issuer = "urn:result:issuer",
  subject = "urn:result:holder",
  holder = subject,
  purpose = "urn:purpose:result-diagnostic";
const status = { status_list: "urn:result:status", version: 1, index: 0 };
const at = "2026-11-13T09:00:00.000Z";
const names = [
  "age-check",
  "introduction",
  "visa-application",
  "right-to-work",
  "tenancy-application",
  "degree-recognition",
];

it("pins the result archive hash before unpacking and preserves absent and existing destinations", () => {
  expect(RESULT_SHA256).toBe(SPARQ_ZK_RESULT.sha256);
  const directory = mkdtempSync(join(tmpdir(), "result-install-"));
  try {
    const archive = join(directory, "wrong.tgz"),
      destination = join(directory, "installed");
    writeFileSync(archive, "not an authenticated archive");
    expect(() => install(archive, destination)).toThrow("SHA-256 mismatch");
    expect(existsSync(destination)).toBe(false);
    mkdirSync(destination);
    writeFileSync(join(destination, "keep"), "unchanged");
    expect(() => install(archive, destination)).toThrow("SHA-256 mismatch");
    expect(readFileSync(join(destination, "keep"), "utf8")).toBe("unchanged");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("uses strict nested schemas for every delivered return type and retains native failure reasons", async () => {
  const presentation = {
    version: 5,
    query,
    rows: [{ subject: { kind: "iri", value: subject } }],
    challenge: "0x123",
    issuer_slots: ["key"],
    proof: [1],
  };
  expect(() => resultPresentation.parse({ ...presentation, ignored: true })).toThrow();
  expect(() =>
    resultPresentation.parse({
      ...presentation,
      rows: [{ subject: { kind: "iri", value: subject, ignored: true } }],
    }),
  ).toThrow();
  expect(() => resultProved.parse({ presentation, result: [], ignored: true })).toThrow();
  expect(() =>
    resultVerified.parse({ verified: false, released: [], reason: "actual reason", ignored: true }),
  ).toThrow();
  expect(() =>
    resultCredential.parse({
      graphNQuads: "",
      salt: "salt",
      issuer: "key",
      signature: "sig",
      statusRef: { ...status, ignored: true },
    }),
  ).toThrow();
  const api: ResultPackage = {
    testIssuerKeygen: () => ({ publicKey: "key", seedHex: "1", ignored: true }),
    issue: () => ({
      graphNQuads: "",
      salt: "salt",
      issuer: "key",
      signature: "sig",
      statusRef: status,
      ignored: true,
    }),
    prove: async () => ({ presentation, result: [], ignored: true }),
    verify: async () => ({ verified: false, released: [], reason: "kept native reason" }),
  };
  const system = new SparqZkResult(api);
  await expect(system.issuerKeygen(new Uint8Array([1]))).rejects.toThrow();
  await expect(
    system.issue({
      issuerKey: { publicKey: "key", seedHex: "1" },
      subject,
      claims: { statements: [{ subject, claimType: "identity.verified", value: true }] },
      status,
    }),
  ).rejects.toThrow();
  const policy = { trustedIssuers: ["key"], snapshots: [], minVersion: 1, maxVersion: 1 };
  await expect(system.prove({ query, credentials: [], policy, nonce: "fresh" })).rejects.toThrow();
  expect(
    await system.verify({
      expectedQuery: query,
      presentation,
      policy,
      nonce: "fresh",
      seenNonces: new Set<string>(),
    }),
  ).toEqual({ ok: false, reason: "kept native reason" });
  api.verify = async () => ({ verified: false, released: [], ignored: true });
  await expect(
    system.verify({
      expectedQuery: query,
      presentation,
      policy,
      nonce: "fresh",
      seenNonces: new Set<string>(),
    }),
  ).rejects.toThrow();
});

it("keeps all six unsupported rules blocked with or without the optional installation", async () => {
  const registries = [verifierRegistry(), ...(installed ? [await availableAdapters()] : [])];
  for (const id of names) {
    const { profile, scenario } = loadCase(root, id);
    const path = id === "right-to-work" ? "hidden-validity-proof" : "main";
    expect(queryFor(profile.rules[0] as Parameters<typeof queryFor>[0])).toContain("GRAPH ?g");
    const reason =
      id === "right-to-work"
        ? (
            required(scenario.branches.find((b) => b.id === path)).change.blocked as {
              path: string;
              reason: string;
            }[]
          )[0]?.reason
        : scenario.blocked[0]?.reason;
    expect(reason).toMatch(/^Blocked:/);
    for (const registry of registries) {
      const result = (await runScenario(profile, scenario, { registry })).find(
        (p) => p.path === path,
      );
      expect(result?.blocked).toBe(reason);
      expect(result?.trace).toBeUndefined();
    }
  }
}, 120_000);

it("registers no result adapter for an explicitly absent installation", async () => {
  vi.stubEnv("ANSWERABLE_SPARQ_ZK_RESULT", join(tmpdir(), "brief28-absent-package"));
  try {
    expect((await availableAdapters()).proofSystems.has(SPARQ_ZK_RESULT.method)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("claims the receiver nonce before any verifier await", async () => {
  let entered = 0;
  let resume: () => void = () => {};
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const rule = ruleSchema.parse({
    id: "urn:rule:race",
    template: "membership",
    params: { input: "identity.verified", values: [true] },
    output: "result",
    inputsFrom: [issuer],
    assurances: ["attested"],
    proofQuery: query,
  });
  const request: DerivedRequest = {
    rule: rule.id,
    ruleDigest: digestOf(rule),
    subject,
    purpose,
    assurances: ["attested"],
    nonce: "race",
    query,
    policy: {},
    consumed: false,
  };
  const system = new SparqZkResult({
    testIssuerKeygen() {},
    issue() {},
    prove: async () => ({}),
    verify: async () => ({}),
  });
  system.verify = async () => {
    entered++;
    await paused;
    return { ok: false, reason: "controlled failure" };
  };
  const gate: GateContext = {
    ...verifierRegistry([system]),
    rules: [rule],
    derivedRequests: { race: request },
    acceptedProofs: [
      {
        rule: rule.id,
        method: system.method,
        assurance: "attested",
        binds: [...system.binds],
        purposes: [purpose],
      },
    ],
  };
  const statement: JsonObject = {
    issuer: holder,
    subject,
    method: "derived",
    claimType: rule.output,
    value: [],
    derivation: {
      rule: rule.id,
      ruleDigest: digestOf(rule),
      deriver: holder,
      assurance: "attested",
      outputDigest: digestOf([]),
      proof: { method: system.method, presentation: {}, nonce: "race" },
    },
  };
  const check = () =>
    verifyOpaqueDerivation({
      statement,
      gate,
      purpose,
      acceptsSource: () => true,
      event: () => {},
    });
  const first = check();
  await Promise.resolve();
  try {
    expect(await Promise.race([check(), Promise.resolve("did not refuse synchronously")])).toEqual({
      ok: false,
      reason: "replay-conflict",
    });
    expect(entered).toBe(1);
  } finally {
    resume();
    await first;
  }
  expect(request.consumed).toBe(false);
});

type Sample = {
  keys: Awaited<ReturnType<SparqZkResult["issuerKeygen"]>>;
  policy: JsonObject;
  nonce: string;
  proof: Awaited<ReturnType<SparqZkResult["prove"]>>;
};
async function gateFixture(
  system: SparqZkResult,
  data: Sample,
  bindKey = true,
  bindStatus = true,
  expectedQuery = query,
) {
  const issuerKey = await testKey("brief28/issuer-identity"),
    holderKey = await testKey("brief28/holder");
  const rule = ruleSchema.parse({
    id: "urn:rule:diagnostic",
    template: "membership",
    params: { input: "identity.verified", values: [true] },
    output: "diagnostic.rows",
    inputsFrom: [issuer],
    assurances: ["attested"],
    proofQuery: expectedQuery,
  });
  const request: DerivedRequest = {
    rule: rule.id,
    ruleDigest: digestOf(rule),
    subject,
    purpose,
    assurances: ["attested"],
    nonce: data.nonce,
    query: queryFor(rule),
    policy: data.policy,
    consumed: false,
  };
  const events: TraceEventInput[] = [],
    memory = new GateMemory();
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:result:receiver",
    keys: [
      {
        kid: issuerKey.kid,
        alg: issuerKey.alg,
        publicJwk: issuerKey.publicJwk,
        role: "issuer",
        subject: issuer,
      },
      {
        kid: holderKey.kid,
        alg: holderKey.alg,
        publicJwk: holderKey.publicJwk,
        role: "issuer",
        subject: holder,
      },
    ],
    sourceAuthority: [
      {
        id: "urn:source:diagnostic",
        version: "1",
        source: issuer,
        claimTypes: ["identity.verified", "proof.issuer-key", "proof.status"],
        subjects: [issuer, subject],
      },
    ],
  });
  let saved = "";
  const gate: GateContext = {
    ...verifierRegistry([system]),
    rules: [rule],
    taskId: "urn:task:diagnostic",
    proofIssuerKeys: [{ issuer, key: data.keys.publicKey, claimTypes: ["identity.verified"] }],
    derivedRequests: { [request.nonce]: request },
    saveDerivationState: () => {
      saved = JSON.stringify(request);
    },
    acceptedProofs: [
      {
        rule: rule.id,
        method: system.method,
        assurance: "attested",
        binds: [...system.binds],
        purposes: [purpose],
      },
    ],
    reliance: {
      id: "urn:reliance:diagnostic",
      rules: ["identity.verified", "proof.issuer-key", "proof.status", "diagnostic.rows"].map(
        (claimType) => ({
          id: `urn:reliance:${claimType}`,
          claimType,
          methods: ["derived", "recorded-by-authority"],
          maxAgeDays: 1,
          text: "Diagnostic test policy.",
        }),
      ),
    },
    sink: { agent: "diagnostic-receiver", emit: (e) => events.push(e) },
  };
  const inbound = new InboundGate({
    identity: { actor: "urn:result:receiver:actor", party: "urn:result:receiver" },
    trust,
    limits: { ...DEFAULT_LIMITS, ...DERIVATION_LIMITS },
    now: () => at,
    record: () => {},
    memory,
    gate,
    agreementTerms: () => undefined,
  });
  const sourceStatement = (kind: string, value: JsonObject) => ({
    id: `urn:result:${kind}`,
    issuer,
    subject: issuer,
    claimType: kind,
    method: "recorded-by-authority",
    asOf: at,
    value,
  });
  const keyStatement = sourceStatement("proof.issuer-key", {
    method: system.method,
    ...data.keys.publicKey,
    statusLists: [status.status_list],
  });
  const snapshotStatement = sourceStatement("proof.status", {
    method: system.method,
    status_list: status.status_list,
    version: 1,
    bits: [0],
  });
  for (const binding of [
    ...(bindKey ? [keyStatement] : []),
    ...(bindStatus ? [snapshotStatement] : []),
  ]) {
    expect(
      await inbound.admitStatements([{ jws: await signClaim(issuerKey, binding) }], {
        task: "urn:task:diagnostic",
        purpose,
      }),
    ).toEqual({ admitted: 1, refused: 0 });
  }
  const statement: JsonObject = {
    id: "urn:result:answer",
    issuer: holder,
    subject,
    claimType: rule.output,
    value: data.proof.result,
    method: "derived",
    asOf: at,
    derivation: {
      rule: rule.id,
      ruleDigest: digestOf(rule),
      assurance: "attested",
      deriver: holder,
      at,
      outputDigest: digestOf(data.proof.result),
      proofBinds: [...system.binds],
      proof: { method: system.method, presentation: data.proof.presentation, nonce: data.nonce },
      inputs: [],
    },
  };
  const admit = async () =>
    inbound.admitStatements(
      [{ jws: await signClaim(holderKey, statement), format: "derivation+jws" }],
      { task: "urn:task:diagnostic", subject, purpose },
    );
  return { admit, events, memory, request, gate, statement, saved: () => saved };
}

describe.skipIf(!installed)("real offline result proofs (diagnostics, not six-path runs)", () => {
  let system: SparqZkResult;
  let samples: Sample[];
  beforeAll(async () => {
    system = (await loadSparqZkResult()) as SparqZkResult;
    samples = [];
    const times: { proveMs: number; verifyMs: number }[] = [];
    const salts = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const keys = await system.issuerKeygen(new TextEncoder().encode("brief28/diagnostic-seed"));
      const credential = await system.issue({
        issuerKey: keys.secretKey,
        subject,
        claims: { statements: [{ subject, claimType: "identity.verified", value: true }] },
        status,
      });
      salts.add(String(credential.salt));
      const policy = {
        trustedIssuers: [String(keys.publicKey.publicKey)],
        snapshots: [{ status_list: status.status_list, version: 1, bits: [0] }],
        minVersion: 1,
        maxVersion: 1,
      };
      const nonce = randomBytes(32).toString("hex");
      const start = performance.now();
      const proof = await system.prove({ query, credentials: [credential], policy, nonce });
      const proved = performance.now();
      const verified = await system.verify({
        expectedQuery: query,
        presentation: proof.presentation,
        policy,
        nonce,
        seenNonces: new Set<string>(),
      });
      times.push({ proveMs: proved - start, verifyMs: performance.now() - proved });
      expect(verified).toMatchObject({
        ok: true,
        released: proof.result,
        issuerKeys: [keys.publicKey],
      });
      samples.push({ keys, policy, nonce, proof });
    }
    expect(salts.size).toBe(3);
    expect(new Set(samples.map((sample) => digestOf(sample.keys.publicKey))).size).toBe(1);
    writeFileSync(
      join(tmpdir(), "brief28-diagnostic-times.json"),
      JSON.stringify({ query, samples: times }, null, 2),
    );
  }, 180_000);
  it("really proves and verifies three fresh, randomly salted diagnostic presentations", () => {
    expect(new Set(samples.map((s) => digestOf(s.proof.presentation))).size).toBe(3);
    expect(system.binds).not.toContain("subject");
    expect(system.binds).not.toContain("complete");
  });
  it("admits after checking signed issuer keys and status, persists consumption, and refuses replay", async () => {
    const f = await gateFixture(system, required(samples[0]));
    expect((await f.admit()).admitted).toBe(1);
    expect(f.request.consumed).toBe(true);
    expect(JSON.parse(f.saved()).consumed).toBe(true);
    expect(await f.admit()).toEqual({ admitted: 0, refused: 1 });
    expect(f.events.at(-1)?.reason).toBe("replay-conflict");
    expect(JSON.stringify(f.events)).not.toMatch(/graphNQuads|seedHex/);
  }, 60_000);
  it.each([
    [false, true],
    [true, false],
  ])("refuses missing key/status admission (%s, %s) before native verification", async (keyBinding, statusBinding) => {
    const f = await gateFixture(system, required(samples[0]), keyBinding, statusBinding);
    const verify = vi.spyOn(system, "verify");
    try {
      expect(await f.admit()).toEqual({ admitted: 0, refused: 1 });
      expect(f.events.at(-1)?.reason).toBe("source-not-accepted");
      expect(verify).not.toHaveBeenCalled();
      expect(f.request.consumed).toBe(false);
    } finally {
      verify.mockRestore();
    }
  });
  it("refuses a real proof for another profile query and keeps its native reason in the trace", async () => {
    const f = await gateFixture(system, required(samples[0]), true, true, otherQuery);
    expect(await f.admit()).toEqual({ admitted: 0, refused: 1 });
    expect(f.request.consumed).toBe(false);
    expect(f.events.some((e) => e.caption.includes("statement rejected"))).toBe(true);
    expect(f.events.at(-1)?.reason).toBe("derivation-not-verified");
  }, 60_000);
  it("refuses altered rows and issuer slots using the actual verifier", async () => {
    const sample = required(samples[0]);
    const other = await system.issuerKeygen(new TextEncoder().encode("brief28/other-test-issuer"));
    const bothTrusted = {
      ...sample.policy,
      trustedIssuers: [String(sample.keys.publicKey.publicKey), String(other.publicKey.publicKey)],
    };
    const substituted = await system.verify({
      expectedQuery: query,
      presentation: {
        ...sample.proof.presentation,
        issuer_slots: [String(other.publicKey.publicKey)],
      },
      policy: bothTrusted,
      nonce: sample.nonce,
      seenNonces: new Set<string>(),
    });
    expect(substituted).toMatchObject({ ok: false, reason: "cryptographic proof rejected" });
    for (const presentation of [
      {
        ...sample.proof.presentation,
        rows: [{ subject: { kind: "iri", value: "urn:substitute" } }],
      },
      { ...sample.proof.presentation, issuer_slots: ["untrusted"] },
    ]) {
      expect(
        (
          await system.verify({
            expectedQuery: query,
            presentation,
            policy: sample.policy,
            nonce: sample.nonce,
            seenNonces: new Set<string>(),
          })
        ).ok,
      ).toBe(false);
    }
  }, 60_000);
  it("rejects all six required queries instead of substituting an admitted weaker query", async () => {
    const keys = required(samples[0]).keys;
    const credential = await system.issue({
      issuerKey: keys.secretKey,
      subject,
      claims: { statements: [{ subject, claimType: "identity.verified", value: true }] },
      status,
    });
    for (const id of names) {
      const { profile } = loadCase(root, id);
      await expect(
        system.prove({
          query: queryFor(profile.rules[0] as Parameters<typeof queryFor>[0]),
          credentials: [credential],
          policy: required(samples[0]).policy,
          nonce: randomBytes(32).toString("hex"),
        }),
      ).rejects.toThrow("operator outside positive BGP/JOIN/FILTER");
    }
  }, 60_000);
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("Required diagnostic fixture is missing");
  return value;
}
