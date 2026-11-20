// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { existsSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { openConversation } from "../src/core/conversation.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { availableAdapters } from "../src/derive/adapters/index.js";
import {
  loadSparqZkQuery,
  SPARQ_ZK_QUERY,
  type SparqZkQuery,
} from "../src/derive/adapters/sparq-zk-query.js";
import { ruleSchema } from "../src/derive/rules.js";
import {
  DERIVATION_LIMITS,
  type DerivedRequest,
  verifierRegistry,
} from "../src/derive/verifiers.js";
import { GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { queryVerificationMethod } from "../src/model/sparq-query.js";
import { testKey } from "../src/reference/keys.js";
import { signClaim } from "../src/scenarios/common.js";
import type { TraceEventInput } from "../src/trace/types.js";

const local = join(import.meta.dirname, "../.sparq/sparq-zk-query");
const installed = existsSync(join(process.env.ANSWERABLE_SPARQ_ZK_QUERY ?? local, "index.js"));

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

describe.skipIf(!installed)("real Noir query proofs (requires the optional archive)", () => {
  const issuer = "urn:issuer";
  const subject = "urn:subject";
  const query = "ASK {?s <urn:p> ?x}";
  const now = Math.floor(Date.now() / 1000);
  let system: SparqZkQuery;
  let policy: Parameters<SparqZkQuery["prove"]>[0]["policy"];
  const nonce = "true-proof";
  let yes: Awaited<ReturnType<SparqZkQuery["prove"]>>;
  const keys = (seed: number) => system.issuerKeygen(new Uint8Array([seed]));
  const issue = async (claimType: string, seed: number) =>
    system.issue({
      issuerKey: (await keys(seed)).secretKey,
      subject,
      claims: { statements: [{ issuer, subject, claimType, value: 1 }] },
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
      bounds: { credentials: 1, quadsPerCredential: 4, rowsPerTable: 4 },
      notBefore: now - 1,
      notAfter: now + 3600,
    };
    yes = await prove(await issue("urn:p", 1), nonce);
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

  it("returns a verified false and the gate stops on the unmet condition", async () => {
    const proof = await prove(await issue("urn:q", 1), "false-proof");
    expect(proof.result).toBe(false);
    const at = new Date(now * 1000).toISOString();
    const purpose = "urn:purpose:test-condition";
    const rule = ruleSchema.parse({
      id: "urn:rule:test-condition",
      template: "membership",
      params: { input: "urn:p", values: [1] },
      output: "condition.result",
      inputsFrom: [issuer],
      assurances: ["attested"],
      proofQuery: query,
    });
    const stored: DerivedRequest = {
      rule: rule.id,
      ruleDigest: digestOf(rule),
      subject,
      purpose,
      assurances: ["attested"],
      nonce: "false-proof",
      query,
      policy,
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
          subjects: [subject],
        },
      ],
    });
    const memory = new GateMemory();
    const events: TraceEventInput[] = [];
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
        proofIssuerKeys: [{ issuer, key: (await keys(1)).publicKey, claimTypes: ["urn:p"] }],
        acceptedProofs: [
          {
            rule: rule.id,
            method: system.method,
            assurance: "attested",
            binds: ["rule", "issuers", "fresh"],
            purposes: [purpose],
          },
        ],
        sink: { agent: "receiver", emit: (event) => events.push(event) },
      },
    });
    const jws = await signClaim(holder, {
      id: "urn:statement:false",
      issuer: subject,
      subject,
      claimType: rule.output,
      method: "derived",
      asOf: at,
      value: false,
      derivation: {
        rule: rule.id,
        ruleDigest: stored.ruleDigest,
        assurance: "attested",
        deriver: subject,
        at,
        outputDigest: digestOf(false),
        proofBinds: ["rule", "issuers", "fresh"],
        inputs: [],
        proof: { method: system.method, nonce: stored.nonce, presentation: proof.presentation },
      },
    });
    const conversation = "urn:test-conversation";
    const admission = inbound.arrive(undefined, undefined, undefined);
    expect(
      await admission.complete(
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
      ),
    ).toMatchObject({ ok: false, reason: "not-authorised" });
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

  it("refuses a credential signed by a key outside the stored issuer roster", async () => {
    await expect(prove(await issue("urn:p", 2), "wrong-issuer")).rejects.toThrow(
      /issuer|authoriz/i,
    );
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
