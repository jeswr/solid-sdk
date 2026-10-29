// AUTHORED-BY Codex GPT-6
import {
  canonicalNQuads,
  credentialToRdf,
  issue,
  SVC,
  type VerifiableCredential,
  verifyCredential,
} from "@jeswr/solid-vc";
import { beforeAll, describe, expect, it } from "vitest";
import { readBoundAuthorization, verifyAgentAuthority } from "../src/index.js";
import { buildFixture, CAST, type Fixture, makeStatusResolver } from "./fixture.js";

const LEGACY_SVC_NS = "https://w3id.org/jeswr/solid-vc#";
let base: Fixture;
beforeAll(async () => {
  base = await buildFixture();
});

function subject(namespace: string) {
  return {
    id: CAST.alice,
    [`${namespace}authorizes`]: CAST.agentA,
    [`${namespace}action`]: ["read", "grantUse"],
    [`${namespace}target`]: CAST.records,
    [`${namespace}policy`]: CAST.mandateId,
  };
}

function credential(type: string, namespace: string): VerifiableCredential {
  return { ...base.credentials.mandate, type: [type], credentialSubject: subject(namespace) };
}

describe("authorization namespace migration", () => {
  it.each([
    ["AgentAuthorizationCredential", LEGACY_SVC_NS],
    ["AgentAuthorizationCredential", SVC],
    [`${LEGACY_SVC_NS}AgentAuthorizationCredential`, LEGACY_SVC_NS],
    [`${LEGACY_SVC_NS}AgentAuthorizationCredential`, SVC],
    [`${SVC}AgentAuthorizationCredential`, LEGACY_SVC_NS],
    [`${SVC}AgentAuthorizationCredential`, SVC],
  ])("reads type %s with claims in %s without rewriting the credential", (type, namespace) => {
    const vc = credential(type, namespace);
    const original = structuredClone(vc);
    expect(readBoundAuthorization(vc)).toEqual({
      principal: CAST.alice,
      authorizes: CAST.agentA,
      action: ["read", "grantUse"],
      target: CAST.records,
      policy: CAST.mandateId,
    });
    expect(vc).toEqual(original);
  });

  it("rejects differing action aliases even with identical singleton aliases", () => {
    const vc = {
      ...base.credentials.mandate,
      credentialSubject: {
        ...subject(LEGACY_SVC_NS),
        ...subject(SVC),
        [`${LEGACY_SVC_NS}action`]: ["read"],
        [`${SVC}action`]: ["read", "grantUse"],
      },
    };
    expect(readBoundAuthorization(vc)).toBeUndefined();
  });

  it("normalizes equal action sets and accepts identical singleton aliases", () => {
    const vc = {
      ...base.credentials.mandate,
      credentialSubject: {
        ...subject(LEGACY_SVC_NS),
        ...subject(SVC),
        [`${LEGACY_SVC_NS}action`]: ["grantUse", "read", "read"],
        [`${SVC}action`]: ["read", "grantUse"],
      },
    };
    expect(readBoundAuthorization(vc)).toEqual({
      principal: CAST.alice,
      authorizes: CAST.agentA,
      action: ["grantUse", "read"],
      target: CAST.records,
      policy: CAST.mandateId,
    });
  });

  it.each([LEGACY_SVC_NS, SVC])("denies differing signed action sets in %s", async (namespace) => {
    const other = namespace === SVC ? LEGACY_SVC_NS : SVC;
    const conflicting = await issue({
      credential: {
        ...base.credentials.mandate,
        credentialSubject: {
          ...subject(namespace),
          [`${namespace}action`]: ["read"],
          [`${other}action`]: ["read", "grantUse"],
        },
      },
      key: base.keys.alice,
    });
    await expectValidSignature(conflicting);
    expect(readBoundAuthorization(conflicting)).toBeUndefined();
    expect(await verify(conflicting)).toMatchObject({
      authorized: false,
      phase: "B",
      code: "BINDING_MISMATCH",
    });
  });

  it.each([
    "authorizes",
    "target",
    "policy",
  ])("denies a signed %s conflict moved into a second same-id subject", async (claim) => {
    const conflicting = await issue({
      credential: {
        ...base.credentials.mandate,
        credentialSubject: {
          ...subject(SVC),
          [`${LEGACY_SVC_NS}${claim}`]: "https://attacker.example/conflict",
        },
      },
      key: base.keys.alice,
    });
    const split = {
      ...conflicting,
      credentialSubject: [
        subject(SVC),
        { id: CAST.alice, [`${LEGACY_SVC_NS}${claim}`]: "https://attacker.example/conflict" },
      ],
    };
    expect(await canonicalNQuads(credentialToRdf(split))).toBe(
      await canonicalNQuads(credentialToRdf(conflicting)),
    );
    await expectValidSignature(split);
    expect(await verify(split)).toMatchObject({
      authorized: false,
      phase: "B",
      code: "BINDING_MISMATCH",
    });
  });

  it.each([
    "authorizes",
    "target",
    "policy",
  ])("denies a signed %s conflict renamed to its bare legacy spelling", async (claim) => {
    const conflicting = await issue({
      credential: {
        ...base.credentials.mandate,
        credentialSubject: {
          ...subject(SVC),
          [`${LEGACY_SVC_NS}${claim}`]: "https://attacker.example/conflict",
        },
      },
      key: base.keys.alice,
    });
    const shorthand = {
      ...conflicting,
      credentialSubject: { ...subject(SVC), [claim]: "https://attacker.example/conflict" },
    };
    expect(await canonicalNQuads(credentialToRdf(shorthand))).toBe(
      await canonicalNQuads(credentialToRdf(conflicting)),
    );
    await expectValidSignature(shorthand);
    expect(await verify(shorthand)).toMatchObject({
      authorized: false,
      phase: "B",
      code: "BINDING_MISMATCH",
    });
  });

  it("denies a bare action alias that widens the canonical action set", async () => {
    const conflicting = await issue({
      credential: {
        ...base.credentials.mandate,
        credentialSubject: { ...subject(SVC), action: ["read", "grantUse", "write"] },
      },
      key: base.keys.alice,
    });
    await expectValidSignature(conflicting);
    expect(await verify(conflicting)).toMatchObject({
      authorized: false,
      code: "BINDING_MISMATCH",
    });
  });

  it("accepts a single-element subject array and equal shorthand aliases", async () => {
    const vc = await issue({
      credential: {
        ...base.credentials.mandate,
        credentialSubject: [
          { ...subject(SVC), authorizes: CAST.agentA, action: ["grantUse", "read"] },
        ],
      },
      key: base.keys.alice,
    });
    expect(await verify(vc)).toMatchObject({ authorized: true });
  });

  it.each([
    "authorizes",
    "target",
    "policy",
  ])("checks all %s values sharing the legacy predicate", (claim) => {
    const vc = {
      ...base.credentials.mandate,
      credentialSubject: {
        ...subject(LEGACY_SVC_NS),
        [claim]: "https://attacker.example/conflict",
      },
    };
    expect(readBoundAuthorization(vc)).toBeUndefined();
  });

  it.each([
    [],
    [subject(SVC), subject(SVC)],
    [subject(SVC), { id: CAST.agentA }],
  ])("rejects unsupported multiple or empty subject arrays: %j", (...subjects) => {
    expect(
      readBoundAuthorization({ ...base.credentials.mandate, credentialSubject: subjects }),
    ).toBeUndefined();
  });

  it.each(["authorizes", "target", "policy"])("rejects conflicting %s aliases", (claim) => {
    for (const namespace of [LEGACY_SVC_NS, SVC]) {
      const other = namespace === SVC ? LEGACY_SVC_NS : SVC;
      const vc = {
        ...credential("AgentAuthorizationCredential", namespace),
        credentialSubject: {
          ...subject(namespace),
          [`${other}${claim}`]: "https://attacker.example/conflict",
        },
      };
      expect(readBoundAuthorization(vc)).toBeUndefined();
    }
  });

  it.each([
    "authorizes",
    "target",
    "policy",
  ])("rejects multiple %s values in one alias", (claim) => {
    const vc = {
      ...base.credentials.mandate,
      credentialSubject: {
        ...subject(SVC),
        [`${SVC}${claim}`]: ["https://example.org/one", "https://example.org/two"],
      },
    };
    expect(readBoundAuthorization(vc)).toBeUndefined();
  });

  it.each(["authorizes", "action", "target", "policy"])("rejects malformed %s aliases", (claim) => {
    for (const value of [42, { id: "https://attacker.example/conflict" }, ["read", 42]]) {
      const vc = {
        ...base.credentials.mandate,
        credentialSubject: {
          ...subject(LEGACY_SVC_NS),
          [`${SVC}${claim}`]: value,
        },
      };
      expect(readBoundAuthorization(vc)).toBeUndefined();
    }
  });

  it.each([
    "authorizes",
    "target",
    "policy",
  ])("denies a signed conflicting %s alias", async (claim) => {
    const conflicting = await issue({
      credential: {
        ...base.credentials.mandate,
        credentialSubject: {
          ...subject(LEGACY_SVC_NS),
          [`${SVC}${claim}`]: "https://attacker.example/conflict",
        },
      },
      key: base.keys.alice,
    });
    expect(await verify(conflicting)).toMatchObject({
      authorized: false,
      phase: "B",
      code: "BINDING_MISMATCH",
    });
  });

  it("does not derive authority from inherited claims absent from the signed graph", async () => {
    const claims = subject(SVC);
    delete claims[`${SVC}authorizes`];
    Object.setPrototypeOf(claims, { [`${SVC}authorizes`]: CAST.agentA });
    const signed = await issue({
      credential: { ...base.credentials.mandate, credentialSubject: claims },
      key: base.keys.alice,
    });
    expect(
      credentialToRdf(signed).some((quad) => quad.predicate.value === `${SVC}authorizes`),
    ).toBe(false);
    await expectValidSignature(signed);
    expect(await verify(signed)).toMatchObject({ authorized: false, code: "BINDING_MISMATCH" });
  });

  it("permits a chain with legacy and canonical signed hops while preserving G1", async () => {
    const canonical = await issue({
      credential: credential(`${SVC}AgentAuthorizationCredential`, SVC),
      key: base.keys.alice,
    });
    const original = structuredClone(canonical);
    const result = await verify(canonical);
    expect(result.authorized).toBe(true);
    expect(result.policyIntegrityProvisional).toBe(false);
    expect(canonical).toEqual(original);
  });

  it("rejects rebasing a legacy credential without a new proof in Phase A", async () => {
    const rebased = credential(`${SVC}AgentAuthorizationCredential`, SVC);
    const result = await verify(rebased);
    expect(result).toMatchObject({ authorized: false, phase: "A", code: "INVALID_SIGNATURE" });
  });
});

async function expectValidSignature(vc: VerifiableCredential) {
  expect(
    await verifyCredential(vc, {
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
    }),
  ).toMatchObject({ verified: true });
}

async function verify(root: VerifiableCredential) {
  return verifyAgentAuthority(
    {
      credentials: [root, base.credentials.agreement],
      policies: [base.mandate, base.agreement],
      policyContents: {
        [CAST.mandateId]: { content: base.policyDocuments.mandate },
        [CAST.agreementId]: { content: base.policyDocuments.agreement },
      },
    },
    {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { purpose: CAST.purpose, dateTime: base.now.toISOString() },
      },
      rootPrincipal: CAST.alice,
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: makeStatusResolver("valid"),
      actor: CAST.inst,
    },
  );
}
