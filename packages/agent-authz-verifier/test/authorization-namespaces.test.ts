// AUTHORED-BY Codex GPT-6
import { issue, SVC, type VerifiableCredential } from "@jeswr/solid-vc";
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

  it("unions mixed action aliases and accepts identical singleton aliases", () => {
    const vc = {
      ...base.credentials.mandate,
      credentialSubject: {
        ...subject(LEGACY_SVC_NS),
        ...subject(SVC),
        [`${LEGACY_SVC_NS}action`]: ["read"],
        [`${SVC}action`]: ["read", "grantUse"],
      },
    };
    expect(readBoundAuthorization(vc)).toEqual({
      principal: CAST.alice,
      authorizes: CAST.agentA,
      action: ["read", "grantUse"],
      target: CAST.records,
      policy: CAST.mandateId,
    });
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
