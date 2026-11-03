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

import {
  type OdrlPolicy,
  policyToRdf,
  policyToTurtle,
  type RequestContext,
} from "@jeswr/solid-odrl";
import {
  digestRdfContent,
  issueAgentAuthorization,
  type VerifiableCredential,
} from "@jeswr/solid-vc";
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

  it("Turtle relative forms the base-free digest merges cannot be swapped for one another", async () => {
    const reports = "https://institute.example/policies/reports/";
    const scoped: OdrlPolicy = {
      ...base.instituteInternal,
      permissions: [{ type: "permission", action: "read", target: reports, assignee: CAST.agentR }],
    };
    const absolute = await policyToTurtle(scoped);
    const signedForm = absolute.replaceAll(`<${reports}>`, "<./reports/>");
    const swapped = absolute.replaceAll(`<${reports}>`, "<../reports/>");
    expect(signedForm).not.toBe(absolute);
    expect(await digestRdfContent(swapped)).toBe(await digestRdfContent(signedForm));
    const r = await verifySigned(
      signedForm,
      { [CAST.instituteInternalId]: { content: swapped } },
      readRequest("https://institute.example/reports/"),
    );
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_INTEGRITY");
  });

  it("JSON-LD content cannot add relative-IRI rules the base-free signed graph dropped", async () => {
    const doc = CAST.instituteInternalId.replace(/#.*$/, "");
    const forgedId = `${doc}#forged`;
    const forged: OdrlPolicy = {
      ...base.instituteInternal,
      permissions: [
        ...(base.instituteInternal.permissions ?? []),
        {
          id: forgedId,
          type: "permission",
          action: "modify",
          target: SECRET,
          assignee: CAST.agentR,
        },
      ],
    };
    // Hand-written JSON-LD of the forged graph, with only the forged rule relative.
    type Term = {
      termType: string;
      value: string;
      language?: string;
      datatype?: { value: string };
    };
    const term = (t: Term) =>
      t.termType === "NamedNode"
        ? { "@id": t.value === forgedId ? "#forged" : t.value }
        : t.termType === "BlankNode"
          ? { "@id": `_:${t.value}` }
          : t.language
            ? { "@value": t.value, "@language": t.language }
            : { "@value": t.value, "@type": t.datatype?.value };
    const nodes = new Map<string, Record<string, unknown[] | string>>();
    for (const q of policyToRdf(forged)) {
      const id = term(q.subject as Term)["@id"] as string;
      const node = nodes.get(id) ?? { "@id": id };
      const values = (node[q.predicate.value] as unknown[] | undefined) ?? [];
      values.push(term(q.object as Term));
      node[q.predicate.value] = values;
      nodes.set(id, node);
    }
    const content = JSON.stringify({ "@graph": [...nodes.values()] });
    // The base-free digest is the genuine one: the relative rule is dropped.
    expect(await digestRdfContent(content, "application/ld+json")).toBe(
      await digestRdfContent(base.policyDocuments.instituteInternal),
    );
    const r = await verifyInternal(
      internalChain({
        policyContents: {
          [CAST.instituteInternalId]: { content, contentType: "application/ld+json" },
        },
      }),
      {
        request: {
          action: "modify",
          target: SECRET,
          attributes: { dateTime: base.now.toISOString() },
        },
      },
    );
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_INTEGRITY");
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

  it("an out-of-range validity bound denies instead of rolling forward", async () => {
    for (const validUntil of ["2027-02-30T00:00:00Z", "2027-01-01T00:00:00+15:00"]) {
      const vc = await issueAgentAuthorization(
        {
          principal: CAST.inst,
          agent: CAST.agentR,
          action: "read",
          target: CAST.records,
          policy: CAST.instituteInternalId,
          policyContent: base.policyDocuments.instituteInternal,
          validFrom: VALID_FROM,
          validUntil,
        },
        base.keys.inst,
      );
      const r = await verifyInternal(internalChain({ credentials: [vc] }));
      expect(r.authorized).toBe(false);
      expect(r.code).toBe("MALFORMED");
    }
  });

  it("a leaf grantUse prohibition on depth does not block a read, whatever depth the caller claims", async () => {
    const leafDepth: OdrlPolicy = {
      ...base.instituteInternal,
      prohibitions: [
        {
          type: "prohibition",
          action: "grantUse",
          constraints: [{ leftOperand: "delegationDepth", operator: "gt", rightOperand: 5 }],
        },
      ],
    };
    const content = await policyToTurtle(leafDepth);
    const presented = { [CAST.instituteInternalId]: { content } };
    expect((await verifySigned(content, presented)).authorized).toBe(true);
    const claimed = readRequest();
    const r = await verifySigned(content, presented, {
      ...claimed,
      attributes: { ...claimed.attributes, delegationDepth: 0 },
    });
    expect(r.authorized).toBe(true);
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

describe("prohibition probes match the evaluator's reads (Codex round 2)", () => {
  const XsdDateTime = "http://www.w3.org/2001/XMLSchema#dateTime";

  /** Single-hop: an unconstrained read for agentR, plus `prohibitions`, content-bound. */
  async function verifyInternalWith(
    prohibitions: OdrlPolicy["prohibitions"],
    attributes: RequestContext["attributes"],
  ): Promise<VerifyAuthorityResult> {
    const policy: OdrlPolicy = {
      ...base.instituteInternal,
      permissions: [
        { type: "permission", action: "read", target: CAST.records, assignee: CAST.agentR },
      ],
      prohibitions,
    };
    const content = await policyToTurtle(policy);
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
    return verifyInternal(
      internalChain({
        credentials: [vc],
        policies: [policy],
        policyContents: { [CAST.instituteInternalId]: { content } },
      }),
      { request: { action: "read", target: CAST.records, attributes } },
    );
  }

  /** Two hops: the mandate with extra `prohibitions` (re-signed) over the agreement. */
  async function verifyPrimaryWith(
    prohibitions: OdrlPolicy["prohibitions"],
  ): Promise<VerifyAuthorityResult> {
    const mandate: OdrlPolicy = {
      ...base.mandate,
      prohibitions: [...(base.mandate.prohibitions ?? []), ...(prohibitions ?? [])],
    };
    const content = await policyToTurtle(mandate);
    const vc = await issueAgentAuthorization(
      {
        principal: CAST.alice,
        agent: CAST.agentA,
        action: ["read", "grantUse"],
        target: CAST.records,
        policy: CAST.mandateId,
        policyContent: content,
        validFrom: VALID_FROM,
        validUntil: VALID_UNTIL,
      },
      base.keys.alice,
    );
    return verifyAgentAuthority(
      {
        credentials: [vc, base.credentials.agreement],
        policies: [mandate, base.agreement],
        policyContents: {
          [CAST.mandateId]: { content },
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
      },
    );
  }

  it("a dateTime attribute that is not a zoned dateTime string denies, whatever its type", async () => {
    const after = [
      {
        type: "prohibition" as const,
        action: "read" as const,
        target: CAST.records,
        constraints: [
          { leftOperand: "dateTime" as const, operator: "gt" as const, rightOperand: VALID_FROM },
        ],
      },
    ];
    expect((await verifyInternalWith(after, {})).authorized).toBe(false);
    for (const dateTime of [0, 1_700_000_000_000, true]) {
      const r = await verifyInternalWith(after, {
        dateTime,
      } as unknown as RequestContext["attributes"]);
      expect(r.authorized).toBe(false);
      expect(r.code).toBe("POLICY_DENIED");
    }
  });

  it("an attribute compared as an instant (xsd:dateTime datatype) must be a zoned dateTime", async () => {
    const span = [
      {
        type: "prohibition" as const,
        action: "read" as const,
        target: CAST.records,
        constraints: [
          {
            leftOperand: "elapsedTime" as const,
            operator: "lt" as const,
            rightOperand: VALID_UNTIL,
            datatype: XsdDateTime,
          },
        ],
      },
    ];
    for (const elapsedTime of ["garbage", "2026-08-01T00:00:00", 5]) {
      const r = await verifyInternalWith(span, {
        dateTime: base.now.toISOString(),
        elapsedTime,
      } as unknown as RequestContext["attributes"]);
      expect(r.authorized).toBe(false);
      expect(r.code).toBe("POLICY_DENIED");
    }
    // A zoned instant inside the window is prohibited; outside it is not.
    const inside = await verifyInternalWith(span, {
      dateTime: base.now.toISOString(),
      elapsedTime: "2026-08-01T00:00:00Z",
    });
    expect(inside.authorized).toBe(false);
    const outside = await verifyInternalWith(span, {
      dateTime: base.now.toISOString(),
      elapsedTime: "2028-01-01T00:00:00Z",
    });
    expect(outside.authorized).toBe(true);
  });

  it("a signed temporal bound that is not an instant denies rather than comparing as text", async () => {
    const r = await verifyInternalWith(
      [
        {
          type: "prohibition",
          action: "read",
          target: CAST.records,
          constraints: [{ leftOperand: "dateTime", operator: "gt", rightOperand: "not-a-date" }],
        },
      ],
      { dateTime: base.now.toISOString() },
    );
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("a prohibition assigned to another agent does not block a request that omits its operand", async () => {
    const other = [
      {
        type: "prohibition" as const,
        action: "read" as const,
        target: CAST.records,
        assignee: "https://other.example/profile#me",
        constraints: [
          {
            leftOperand: "purpose" as const,
            operator: "eq" as const,
            rightOperand: CAST.misusePurpose,
          },
        ],
      },
    ];
    const r = await verifyInternalWith(other, { dateTime: base.now.toISOString() });
    expect(r.code).toBeUndefined();
    expect(r.authorized).toBe(true);
    // The same prohibition on the requester still denies.
    const mine = await verifyInternalWith(
      [{ ...other[0], assignee: CAST.agentR } as NonNullable<OdrlPolicy["prohibitions"]>[number]],
      { dateTime: base.now.toISOString() },
    );
    expect(mine.authorized).toBe(false);
    expect(mine.code).toBe("POLICY_DENIED");
  });

  it("an ancestor grantUse prohibition applies only at the depth the evaluator injects", async () => {
    const grantUse = (bound: number) => [
      {
        type: "prohibition" as const,
        action: "grantUse" as const,
        target: CAST.records,
        constraints: [
          { leftOperand: "delegationDepth" as const, operator: "gt" as const, rightOperand: bound },
          {
            leftOperand: "spatial" as const,
            operator: "eq" as const,
            rightOperand: "https://example.org/region/eu",
          },
        ],
      },
    ];
    // The one edge below the mandate leaves depth 1: `> 3` cannot apply.
    const inapplicable = await verifyPrimaryWith(grantUse(3));
    expect(inapplicable.code).toBeUndefined();
    expect(inapplicable.authorized).toBe(true);
    // `> 0` applies, and its unsupplied spatial operand cannot switch it off.
    const applicable = await verifyPrimaryWith(grantUse(0));
    expect(applicable.authorized).toBe(false);
    expect(applicable.code).toBe("POLICY_DENIED");
  });

  const XsdDate = "http://www.w3.org/2001/XMLSchema#date";
  const XsdDuration = "http://www.w3.org/2001/XMLSchema#duration";
  const today = () => ({ dateTime: base.now.toISOString() });
  const prohibit = (
    constraints: NonNullable<NonNullable<OdrlPolicy["prohibitions"]>[number]["constraints"]>,
    extra: Partial<NonNullable<OdrlPolicy["prohibitions"]>[number]> = {},
  ) => [
    {
      type: "prohibition" as const,
      action: "read" as const,
      target: CAST.records,
      constraints,
      ...extra,
    },
  ];
  const spatialEu = {
    leftOperand: "spatial" as const,
    operator: "eq" as const,
    rightOperand: "https://example.org/region/eu",
  };

  it("an ancestor prohibition on its delegate with an omitted operand denies", async () => {
    const r = await verifyPrimaryWith(prohibit([spatialEu], { assignee: CAST.agentA }));
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("an ancestor grantUse prohibition on the delegator with an omitted operand denies", async () => {
    const r = await verifyPrimaryWith([
      {
        type: "prohibition",
        action: "grantUse",
        target: CAST.records,
        assignee: CAST.agentA,
        constraints: [spatialEu],
      },
    ]);
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("the injected depth is exact: `> 1` cannot apply to the one edge below the mandate", async () => {
    const r = await verifyPrimaryWith([
      {
        type: "prohibition",
        action: "grantUse",
        target: CAST.records,
        constraints: [
          { leftOperand: "delegationDepth", operator: "gt", rightOperand: 1 },
          spatialEu,
        ],
      },
    ]);
    expect(r.code).toBeUndefined();
    expect(r.authorized).toBe(true);
  });

  it("a boolean operand value is unsupplied, so the prohibition still denies", async () => {
    const r = await verifyInternalWith(
      prohibit([{ leftOperand: "purpose", operator: "eq", rightOperand: CAST.misusePurpose }]),
      { ...today(), purpose: true },
    );
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("an omitted dateTime is read as now, as the evaluator reads it", async () => {
    const r = await verifyInternalWith(
      prohibit([{ leftOperand: "dateTime", operator: "lt", rightOperand: "2026-01-01T00:00:00Z" }]),
      {},
    );
    expect(r.code).toBeUndefined();
    expect(r.authorized).toBe(true);
  });

  it("a temporal set whose operands are only partly instants denies", async () => {
    const r = await verifyInternalWith(
      prohibit([
        {
          leftOperand: "dateTime",
          operator: "isNoneOf",
          rightOperand: [VALID_FROM, "garbage"],
        },
      ]),
      today(),
    );
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("an xsd:date bound applies as an instant, but one with an offset (compared as text) denies", async () => {
    const until = (bound: string) =>
      prohibit([
        { leftOperand: "dateTime", operator: "lt", rightOperand: bound, datatype: XsdDate },
      ]);
    expect((await verifyInternalWith(until("2026-09-01"), today())).authorized).toBe(false);
    const past = await verifyInternalWith(until("2026-07-01"), today());
    expect(past.code).toBeUndefined();
    expect(past.authorized).toBe(true);
    expect((await verifyInternalWith(until("2026-07-01Z"), today())).authorized).toBe(true);
    const offset = await verifyInternalWith(until("2026-08-01-12:00"), today());
    expect(offset.authorized).toBe(false);
    expect(offset.code).toBe("POLICY_DENIED");
  });

  it("an xsd:date bound denies under operators that would read it as midnight UTC", async () => {
    const day = base.now.toISOString().slice(0, 10);
    for (const [operator, rightOperand] of [
      ["eq", day],
      ["neq", day],
      ["gt", day],
      ["lteq", day],
      ["isAnyOf", [day]],
      ["isNoneOf", [day]],
      ["isAllOf", [day]],
    ] as const) {
      const r = await verifyInternalWith(
        prohibit([
          {
            leftOperand: "dateTime",
            operator,
            rightOperand: rightOperand as never,
            datatype: XsdDate,
          },
        ]),
        today(),
      );
      expect(r.authorized, operator).toBe(false);
      expect(r.code, operator).toBe("POLICY_DENIED");
    }
    const after = await verifyInternalWith(
      prohibit([
        {
          leftOperand: "dateTime",
          operator: "gteq",
          rightOperand: "2026-12-01",
          datatype: XsdDate,
        },
      ]),
      today(),
    );
    expect(after.code).toBeUndefined();
    expect(after.authorized).toBe(true);
  });

  it("an instant finer than the evaluator's milliseconds denies (bound or request)", async () => {
    // Date.parse keeps milliseconds only, so each pair below would compare equal
    // and the prohibition (which should fire) would not.
    const later = (bound: string) =>
      prohibit([{ leftOperand: "dateTime", operator: "gt", rightOperand: bound }]);
    const bound = await verifyInternalWith(later("2026-08-01T00:00:00.0001Z"), {
      dateTime: "2026-08-01T00:00:00.0002Z",
    });
    expect(bound.authorized).toBe(false);
    expect(bound.code).toBe("POLICY_DENIED");
    const request = await verifyInternalWith(later("2026-08-01T00:00:00Z"), {
      dateTime: "2026-08-01T00:00:00.0004Z",
    });
    expect(request.authorized).toBe(false);
    expect(request.code).toBe("POLICY_DENIED");
    const padded = await verifyInternalWith(later("2026-08-01T00:00:00.123000Z"), {
      dateTime: "2026-08-01T00:00:00.122Z",
    });
    expect(padded.code).toBeUndefined();
    expect(padded.authorized).toBe(true);
  });

  it("a value for a numeric operand must read as a number", async () => {
    const over = prohibit([{ leftOperand: "count", operator: "gt", rightOperand: 100 }]);
    for (const count of ["", " ", "1,000", "-", true]) {
      const r = await verifyInternalWith(over, {
        ...today(),
        count,
      } as RequestContext["attributes"]);
      expect(r.authorized).toBe(false);
      expect(r.code).toBe("POLICY_DENIED");
    }
    expect((await verifyInternalWith(over, { ...today(), count: 50 })).authorized).toBe(true);
    expect((await verifyInternalWith(over, { ...today(), count: "50" })).authorized).toBe(true);
    expect((await verifyInternalWith(over, { ...today(), count: 500 })).authorized).toBe(false);
  });

  it("an ordering over durations (compared as text) denies", async () => {
    const r = await verifyInternalWith(
      prohibit([
        { leftOperand: "elapsedTime", operator: "gt", rightOperand: "PT1H", datatype: XsdDuration },
      ]),
      { ...today(), elapsedTime: "P1D" },
    );
    expect(r.authorized).toBe(false);
    expect(r.code).toBe("POLICY_DENIED");
  });

  it("a single policy under the perm conflict strategy keeps its permission over an unsupplied prohibition", async () => {
    const policy: OdrlPolicy = {
      ...base.instituteInternal,
      conflict: "perm",
      permissions: [
        { type: "permission", action: "read", target: CAST.records, assignee: CAST.agentR },
      ],
      prohibitions: prohibit([spatialEu]),
    };
    const content = await policyToTurtle(policy);
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
    const presented = internalChain({
      credentials: [vc],
      policies: [policy],
      policyContents: { [CAST.instituteInternalId]: { content } },
    });
    const omitted = await verifyInternal(presented, {
      request: { action: "read", target: CAST.records, attributes: today() },
    });
    const supplied = await verifyInternal(presented, {
      request: {
        action: "read",
        target: CAST.records,
        attributes: { ...today(), spatial: "https://example.org/region/eu" },
      },
    });
    expect(supplied.authorized).toBe(true);
    expect(omitted.authorized).toBe(true);
  });
});
