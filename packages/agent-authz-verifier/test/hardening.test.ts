// AUTHORED-BY Claude Opus 5.5
//
// Hardening regressions (sst-8xm.9.19). Each case pins a fail-open the
// adversarial review reproduced against the previous verifier:
//  - Phase D evaluated presenter-supplied policy objects that nothing tied to the
//    digest-checked content (a genuine document plus a widened object permitted);
//  - a lossy policy projection could drop a signed restriction;
//  - an omitted `isControlledBy` fell back to solid-vc's prefix heuristic;
//  - an Invalid Date `now` skipped every validity-window comparison;
//  - an unknown request action threw instead of denying;
//  - the chain-length cap ran only after a key resolution per credential;
//  - a bare-string `revoked` became a set of characters;
//  - a chain without content permitted on presenter-chosen objects by default.

import { type OdrlPolicy, policyToTurtle, type RequestContext } from "@jeswr/solid-odrl";
import { issueAgentAuthorization, type VerifiableCredential } from "@jeswr/solid-vc";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type PresentedChain,
  type VerifyAuthorityOptions,
  type VerifyAuthorityResult,
  verifyAgentAuthority,
} from "../src/index.js";
import { buildFixture, CAST, type Fixture, VALID_FROM, VALID_UNTIL } from "./fixture.js";

let base: Fixture;
beforeAll(async () => {
  base = await buildFixture();
});

const SECRET = "https://alice.solid.example/data/secret.ttl";

/** The single-hop institute → agentR chain, content-bound by default. */
function internalChain(overrides: Partial<PresentedChain> = {}): PresentedChain {
  return {
    credentials: [base.credentials.instituteAgent],
    policies: [base.instituteInternal],
    policyContents: {
      [CAST.instituteInternalId]: { content: base.policyDocuments.instituteInternal },
    },
    ...overrides,
  };
}

function readRequest(target: string = CAST.records): RequestContext {
  return {
    action: "read",
    target,
    attributes: { dateTime: base.now.toISOString() },
  };
}

function verifyInternal(
  chain: PresentedChain,
  overrides: Partial<VerifyAuthorityOptions> = {},
): Promise<VerifyAuthorityResult> {
  return verifyAgentAuthority(chain, {
    request: readRequest(),
    rootPrincipal: CAST.inst,
    now: base.now,
    resolveKey: base.registry.resolveKey,
    isControlledBy: base.registry.isControlledBy,
    ...overrides,
  });
}

/** The institute's policy with a forged extra permission: modify on any resource. */
function widenedInternal(): OdrlPolicy {
  const genuine = base.instituteInternal;
  return {
    ...genuine,
    permissions: [
      ...(genuine.permissions ?? []),
      { type: "permission", action: "modify", target: SECRET, assignee: CAST.agentR },
    ],
  };
}

describe("G1 binds the EVALUATED policy to the signed content", () => {
  it("baseline: the genuine content-bound chain permits, not provisional", async () => {
    const r = await verifyInternal(internalChain());
    expect(r.authorized).toBe(true);
    expect(r.policyIntegrityProvisional).toBe(false);
  });

  it("genuine content + a widened policy object never permits the widened action", async () => {
    const r = await verifyInternal(internalChain({ policies: [widenedInternal()] }), {
      request: { action: "modify", target: SECRET, attributes: {} },
    });
    expect(r.authorized).toBe(false);
  });

  it("the genuine signed policy is what Phase D evaluates (a narrowed object cannot hide a grant either way)", async () => {
    // A presented object that drops the read permission: the signed content still
    // grants read, so the decision follows the signature, not the presenter.
    const narrowed: OdrlPolicy = { ...base.instituteInternal, permissions: [] };
    const r = await verifyInternal(internalChain({ policies: [narrowed] }));
    expect(r.authorized).toBe(true);
  });

  it("signed content the evaluator cannot fully represent is refused (no lossy weakening)", async () => {
    // The signed document carries a prohibition whose action the ODRL projection
    // does not know; a projection that silently dropped it would evaluate a
    // weaker policy than the issuer signed.
    const lossyContent = `${base.policyDocuments.instituteInternal}
<${CAST.instituteInternalId}> <http://www.w3.org/ns/odrl/2/prohibition> [
  <http://www.w3.org/ns/odrl/2/action> <https://example.org/actions/unknown> ;
  <http://www.w3.org/ns/odrl/2/target> <${CAST.records}>
] .
`;
    const vc = await issueAgentAuthorization(
      {
        principal: CAST.inst,
        agent: CAST.agentR,
        action: "read",
        target: CAST.records,
        policy: CAST.instituteInternalId,
        policyContent: lossyContent,
        validFrom: VALID_FROM,
        validUntil: VALID_UNTIL,
      },
      base.keys.inst,
    );
    const r = await verifyInternal(
      internalChain({
        credentials: [vc],
        policyContents: { [CAST.instituteInternalId]: { content: lossyContent } },
      }),
    );
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("POLICY_INTEGRITY");
  });

  it("signed content whose policy sits at a different chain position is refused", async () => {
    // The signed content says the policy is delegated under some other parent;
    // the presented object claims it is a root.
    const moved: OdrlPolicy = {
      ...base.instituteInternal,
      delegatedUnder: "https://institute.example/policies/other.ttl#policy",
    };
    const movedContent = await policyToTurtle(moved);
    const vc = await issueAgentAuthorization(
      {
        principal: CAST.inst,
        agent: CAST.agentR,
        action: "read",
        target: CAST.records,
        policy: CAST.instituteInternalId,
        policyContent: movedContent,
        validFrom: VALID_FROM,
        validUntil: VALID_UNTIL,
      },
      base.keys.inst,
    );
    const r = await verifyInternal(
      internalChain({
        credentials: [vc],
        policyContents: { [CAST.instituteInternalId]: { content: movedContent } },
      }),
    );
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_INTEGRITY");
  });

  it("a chain presented without content denies by default", async () => {
    const r = await verifyInternal(internalChain({ policyContents: undefined }));
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("B");
    expect(r.code).toBe("POLICY_INTEGRITY");
  });

  it("allowProvisionalPolicy opts in to trusted-by-location policies, marked provisional", async () => {
    const r = await verifyInternal(internalChain({ policyContents: undefined }), {
      allowProvisionalPolicy: true,
    });
    expect(r.authorized).toBe(true);
    expect(r.policyIntegrityProvisional).toBe(true);
  });
});

describe("option validation fails closed", () => {
  it("a missing isControlledBy seam denies instead of using the prefix heuristic", async () => {
    const options = {
      request: readRequest(),
      rootPrincipal: CAST.inst,
      now: base.now,
      resolveKey: base.registry.resolveKey,
    } as unknown as VerifyAuthorityOptions;
    const r = await verifyAgentAuthority(internalChain(), options);
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("INVALID_OPTIONS");
  });

  it("an Invalid Date `now` denies instead of skipping the validity window", async () => {
    const r = await verifyInternal(internalChain(), { now: new Date("not a timestamp") });
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("INVALID_OPTIONS");
  });

  it("a non-Date `now` denies", async () => {
    const r = await verifyInternal(internalChain(), {
      now: "2026-08-01T00:00:00Z" as unknown as Date,
    });
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("INVALID_OPTIONS");
  });

  it("an object that only claims to be a Date denies instead of throwing", async () => {
    const r = await verifyInternal(internalChain(), {
      now: { [Symbol.toStringTag]: "Date" } as unknown as Date,
    });
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("INVALID_OPTIONS");
  });

  it("a non-integer maxChainLength denies", async () => {
    const r = await verifyInternal(internalChain(), { maxChainLength: Number.NaN });
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("INVALID_OPTIONS");
  });

  it("a bare-string `revoked` still revokes the named policy", async () => {
    const r = await verifyInternal(internalChain(), {
      revoked: CAST.instituteInternalId as unknown as readonly string[],
    });
    expect(r.authorized).toBe(false);
    expect(r.phase).toBe("C");
    expect(r.code).toBe("REVOKED");
  });

  it("a `revoked` value that is neither a string nor a string array denies", async () => {
    const r = await verifyInternal(internalChain(), {
      revoked: { length: 0 } as unknown as readonly string[],
    });
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("INVALID_OPTIONS");
  });
});

describe("Phase D input guards", () => {
  for (const action of ["fly", "toString", "__proto__"]) {
    it(`an unknown request action (${action}) denies without throwing`, async () => {
      const r = await verifyInternal(internalChain(), {
        request: { action: action as RequestContext["action"], target: CAST.records },
      });
      expect(r.authorized).toBe(false);
      expect(r.phase).toBe("D");
      expect(r.code).toBe("POLICY_DENIED");
    });
  }

  it("a multi-valued request attribute denies (solid-odrl would read one element)", async () => {
    const attributes = { dateTime: base.now.toISOString() };
    const single = await verifyInternal(internalChain(), {
      request: { ...readRequest(), attributes: { ...attributes, purpose: CAST.purpose } },
    });
    expect(single.authorized).toBe(true);
    const multi = await verifyInternal(internalChain(), {
      request: {
        ...readRequest(),
        attributes: { ...attributes, purpose: [CAST.purpose, "https://evil.example/marketing"] },
      },
    });
    expect(multi.authorized).toBe(false);
    expect(multi.phase).toBe("D");
    expect(multi.code).toBe("POLICY_DENIED");
  });

  it("a null content entry denies with POLICY_INTEGRITY instead of throwing", async () => {
    const r = await verifyInternal(
      internalChain({
        policyContents: {
          [CAST.instituteInternalId]: null,
        } as unknown as PresentedChain["policyContents"],
      }),
    );
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_INTEGRITY");
  });

  it("an over-long chain is refused before any key is resolved", async () => {
    let resolutions = 0;
    const credentials: VerifiableCredential[] = Array.from(
      { length: 40 },
      () => base.credentials.instituteAgent,
    );
    const r = await verifyInternal(internalChain({ credentials }), {
      resolveKey: (vm: string) => {
        resolutions += 1;
        return base.registry.resolveKey(vm);
      },
    });
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("CHAIN_MALFORMED");
    expect(resolutions).toBe(0);
  });

  it("requireDuties denies while a chain duty is unfulfilled, and permits once it is asserted", async () => {
    const primary: PresentedChain = {
      credentials: [base.credentials.mandate, base.credentials.agreement],
      policies: [base.mandate, base.agreement],
      policyContents: {
        [CAST.mandateId]: { content: base.policyDocuments.mandate },
        [CAST.agreementId]: { content: base.policyDocuments.agreement },
      },
    };
    const options = (attributes: RequestContext["attributes"]): VerifyAuthorityOptions => ({
      request: { action: "read", target: CAST.records, attributes },
      rootPrincipal: CAST.alice,
      now: base.now,
      resolveKey: base.registry.resolveKey,
      isControlledBy: base.registry.isControlledBy,
      resolveStatus: () => ({ status: "valid" }),
      requireDuties: true,
    });
    const attrs = { purpose: CAST.purpose, dateTime: base.now.toISOString() };
    const pending = await verifyAgentAuthority(primary, options(attrs));
    expect(pending.authorized).toBe(false);
    expect(pending.phase).toBe("D");
    const discharged = await verifyAgentAuthority(
      primary,
      options({ ...attrs, "fulfilled:delete": true, "fulfilled:inform": true }),
    );
    expect(discharged.authorized).toBe(true);
  });
});

describe("signed-content reading is order- and accessor-independent", () => {
  /** Issue the institute credential over `content` and verify with it presented. */
  async function verifySigned(
    content: string,
    presented: PresentedChain["policyContents"],
    request: RequestContext = readRequest(),
  ): Promise<VerifyAuthorityResult> {
    const vc = await issueAgentAuthorization(
      {
        principal: CAST.inst,
        agent: CAST.agentR,
        action: "read",
        target: CAST.records,
        policy: CAST.instituteInternalId,
        policyContent: content,
        validFrom: VALID_FROM,
        validUntil: VALID_UNTIL,
      },
      base.keys.inst,
    );
    return verifyInternal(internalChain({ credentials: [vc], policyContents: presented }), {
      request,
    });
  }

  it("signed content with relative IRIs and no @base resolves against the policy document", async () => {
    const absolute = await policyToTurtle(base.instituteInternal);
    const content = absolute.replaceAll(`<${CAST.instituteInternalId}>`, "<#policy>");
    expect(content).not.toBe(absolute);
    const r = await verifySigned(content, { [CAST.instituteInternalId]: { content } });
    expect(r.code).toBeUndefined();
    expect(r.authorized).toBe(true);
  });

  it("a prohibition whose operand the request leaves out still denies", async () => {
    const guarded: OdrlPolicy = {
      ...base.instituteInternal,
      prohibitions: [
        {
          type: "prohibition",
          action: "read",
          target: CAST.records,
          constraints: [
            { leftOperand: "purpose", operator: "eq", rightOperand: "https://evil.example/ads" },
          ],
        },
      ],
    };
    const content = await policyToTurtle(guarded);
    const presented = { [CAST.instituteInternalId]: { content } };
    const silent = await verifySigned(content, presented);
    expect(silent.authorized).toBe(false);
    expect(silent.phase).toBe("D");
    expect(silent.code).toBe("POLICY_DENIED");
    const research = readRequest();
    const stated = await verifySigned(content, presented, {
      ...research,
      attributes: { ...research.attributes, purpose: CAST.purpose },
    });
    expect(stated.authorized).toBe(true);
    const ads = await verifySigned(content, presented, {
      ...research,
      attributes: { ...research.attributes, purpose: "https://evil.example/ads" },
    });
    expect(ads.authorized).toBe(false);
  });

  it("a malformed scalar in the request context denies instead of throwing", async () => {
    for (const attributes of [
      { dateTime: "not a timestamp" },
      { dateTime: "2026-08-01T00:00:00" },
      { dateTime: base.now.toISOString(), count: Number.NaN },
      { dateTime: base.now.toISOString(), purpose: {} },
    ]) {
      const r = await verifyInternal(internalChain(), {
        request: {
          ...readRequest(),
          attributes: attributes as unknown as RequestContext["attributes"],
        },
      });
      expect(r.authorized).toBe(false);
      expect(r.code).toBe("POLICY_DENIED");
    }
  });

  it("a validity bound without a timezone, or one that does not parse, denies", async () => {
    const content = base.policyDocuments.instituteInternal;
    for (const validFrom of ["2026-01-01T00:00:00", "the first of January"]) {
      const vc = await issueAgentAuthorization(
        {
          principal: CAST.inst,
          agent: CAST.agentR,
          action: "read",
          target: CAST.records,
          policy: CAST.instituteInternalId,
          policyContent: content,
          validFrom,
          validUntil: VALID_UNTIL,
        },
        base.keys.inst,
      ).catch(() => undefined);
      if (vc === undefined) continue;
      const r = await verifyInternal(internalChain({ credentials: [vc] }));
      expect(r.authorized).toBe(false);
      expect(r.phase).toBe("A");
    }
  });

  it("a scalar operator with several right operands is refused (the triple order would pick one)", async () => {
    const twoBounds: OdrlPolicy = {
      ...base.instituteInternal,
      permissions: [
        {
          type: "permission",
          action: "read",
          target: CAST.records,
          assignee: CAST.agentR,
          constraints: [
            {
              leftOperand: "dateTime",
              operator: "lteq",
              rightOperand: ["2026-07-15T00:00:00Z", "2027-07-03T00:00:00Z"],
            },
          ],
        },
      ],
    };
    const content = await policyToTurtle(twoBounds);
    const r = await verifySigned(content, { [CAST.instituteInternalId]: { content } });
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_INTEGRITY");
  });

  it("content behind an accessor is read once: a getter that swaps bytes after the digest gate cannot widen", async () => {
    const genuine = base.policyDocuments.instituteInternal;
    const forged = await policyToTurtle(widenedInternal());
    let reads = 0;
    const presented = {
      get content() {
        reads += 1;
        return reads === 1 ? genuine : forged;
      },
    };
    const r = await verifySigned(
      genuine,
      { [CAST.instituteInternalId]: presented },
      {
        action: "modify",
        target: SECRET,
        attributes: {},
      },
    );
    expect(r.authorized).toBe(false);
    expect(reads).toBe(1);
  });

  it("`now` is copied, so a seam that mutates the caller's Date cannot move the instant", async () => {
    const now = new Date(base.now.getTime());
    const r = await verifyInternal(internalChain(), {
      now,
      resolveKey: (vm: string) => {
        now.setTime(Date.parse("2030-01-01T00:00:00Z"));
        return base.registry.resolveKey(vm);
      },
      // The status pass re-verifies the credential at `now` after the key seam ran.
      resolveStatus: () => ({ status: "absent" }),
    });
    expect(r.authorized).toBe(true);
  });

  it("a Set of revoked policy IRIs is accepted", async () => {
    const r = await verifyInternal(internalChain(), {
      revoked: new Set([CAST.instituteInternalId]) as unknown as readonly string[],
    });
    expect(r.code).toBe("REVOKED");
  });
});
