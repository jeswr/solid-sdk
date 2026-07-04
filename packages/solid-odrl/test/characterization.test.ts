// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// GOLDEN-MASTER / characterization tests. These pin the PUBLIC API's observable
// outputs as committed snapshots BEFORE any structural refactor, so a later
// behaviour-preserving change is provably behaviour-preserving: the snapshots must
// stay byte-identical (never `--update` a snapshot to make a red test green — that
// launders a behaviour change).
//
// What is pinned:
//   1. The EXPRESS graph — a blank-node-label-INDEPENDENT, TOPOLOGY-PRESERVING
//      canonical serialisation of policyToRdf's quads (blanks inlined as nested
//      sorted `[ … ]` blocks under their parent), so a serialisation change —
//      INCLUDING a constraint attached to the wrong rule or contents swapped
//      between permission/prohibition — is caught, without depending on n3's
//      non-stable blank-node counter.
//   2. The PARSE round-trip — the structured OdrlPolicy recovered from Turtle +
//      JSON-LD (blank-node-label-free by construction).
//   3. The JSON-LD document — deterministic projection with the pinned @context.
//   4. The EVALUATE decision + full explainable result for a matrix of requests,
//      INCLUDING the security-essential fail-closed / conflict / subsumption paths.

import { parseRdf } from "@jeswr/fetch-rdf";
import type { Quad } from "@rdfjs/types";
import { describe, expect, it } from "vitest";
import { requestContextFromA2AIntent, requestContextFromWac } from "../src/compose.js";
import { delegationProvenance, evaluateDelegated } from "../src/delegation.js";
import { evaluate } from "../src/evaluate.js";
import { parsePolicy, policyToJsonLd, policyToRdf, policyToTurtle } from "../src/policy.js";
import type { OdrlPolicy, OdrlRule, RequestContext } from "../src/types.js";

const OWNER = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const CAROL = "https://carol.example/profile/card#me";
const RES = "https://alice.example/notes/private.ttl";
const OTHER = "https://alice.example/notes/other.ttl";
const NOW = new Date("2026-06-16T12:00:00Z");
const RND = "https://w3id.org/dpv#ResearchAndDevelopment";

// Fixtures for the delegation decision matrix (below).
const AGENT_A = "https://agent-a.example/id#it";
const AGENT_B = "https://agent-b.example/id#it";
const AGENT_C = "https://agent-c.example/id#it";
const ROOT_ID = "https://alice.example/policies/root";
const HOP1_ID = "https://agent-a.example/policies/to-b";
const HOP2_ID = "https://agent-b.example/policies/to-c";
const PAST = "2026-01-01T00:00:00Z";
const DEPTH_2 = {
  constraints: [
    { leftOperand: "delegationDepth" as const, operator: "lteq" as const, rightOperand: 2 },
  ],
};
const READ_B: RequestContext = { agent: AGENT_B, action: "read", target: RES };
const READ_C: RequestContext = { agent: AGENT_C, action: "read", target: RES };

/**
 * A blank-node-label-INDEPENDENT, TOPOLOGY-PRESERVING canonical serialisation of a
 * quad set. n3's blank-node counter is not stable across test ordering, so the raw
 * labels can't be snapshotted — but collapsing every blank to one marker would lose
 * graph structure (a constraint attached to the WRONG rule, or contents swapped
 * between permission/prohibition, could still fingerprint the same). Instead every
 * blank node is INLINED under its parent as a nested, recursively-canonicalised
 * `[ pred obj ; … ]` block (Turtle-blank style), with each level's properties
 * sorted. This pins the full tree shape — which predicate sits on which node, and
 * which rule owns which constraint/duty — while staying deterministic and label-
 * free. The ODRL policy graphs here are trees (no blank-node cycles); a `seen`
 * guard bounds any pathological input.
 */
function canonicalGraph(quads: readonly Quad[]): string {
  const bySubject = new Map<string, Quad[]>();
  const key = (t: Quad["subject"] | Quad["object"]): string => {
    if (t.termType === "BlankNode") return `_:${t.value}`;
    if (t.termType === "Literal") {
      const dt = t.datatype?.value ? `^^${t.datatype.value}` : "";
      return `"${t.value}"${dt}`;
    }
    return `<${t.value}>`;
  };
  for (const q of quads) {
    const k = key(q.subject);
    (bySubject.get(k) ?? bySubject.set(k, []).get(k)!).push(q);
  }
  const renderNode = (k: string, seen: ReadonlySet<string>): string => {
    const lines = (bySubject.get(k) ?? [])
      .map((q) => `${q.predicate.value} ${renderObject(q.object, seen)}`)
      .sort();
    return `[ ${lines.join(" ; ")} ]`;
  };
  const renderObject = (o: Quad["object"], seen: ReadonlySet<string>): string => {
    const k = key(o);
    if (o.termType === "BlankNode") {
      if (seen.has(k)) return "_:CYCLE";
      return renderNode(k, new Set([...seen, k]));
    }
    return k;
  };
  // Top-level subjects are the NAMED nodes (the policy IRI + any named rule); blank
  // subjects are reached by inlining. Emit each named subject's sorted properties.
  return [...bySubject.keys()]
    .filter((k) => k.startsWith("<"))
    .sort()
    .map((k) => {
      const lines = (bySubject.get(k) ?? [])
        .map((q) => `${q.predicate.value} ${renderObject(q.object, new Set([k]))}`)
        .sort();
      return `${k}\n  ${lines.join("\n  ")}`;
    })
    .join("\n");
}

const RICH_POLICY: OdrlPolicy = {
  id: "https://alice.example/policies/p1",
  type: "Offer",
  profile: "https://w3id.org/oac#",
  assigner: OWNER,
  conflict: "prohibit",
  permissions: [
    {
      type: "permission",
      action: "read",
      target: RES,
      assignee: BOB,
      constraints: [
        { leftOperand: "purpose", operator: "eq", rightOperand: RND },
        { leftOperand: "dateTime", operator: "lteq", rightOperand: "2027-01-01T00:00:00Z" },
        { leftOperand: "count", operator: "lteq", rightOperand: 5 },
      ],
      duties: [
        {
          action: "attribute",
          constraints: [{ leftOperand: "recipient", operator: "eq", rightOperand: OWNER }],
        },
      ],
    },
  ],
  prohibitions: [{ type: "prohibition", action: "distribute", target: RES }],
  obligations: [{ action: "inform", target: OWNER }],
};

describe("characterization: express graph fingerprint", () => {
  it("policyToRdf emits a stable canonical graph for the rich policy", () => {
    expect(canonicalGraph(policyToRdf(RICH_POLICY))).toMatchSnapshot();
  });

  it("policyToRdf emits a stable graph for the append/control acl-mode policy", () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/acl",
      permissions: [
        { type: "permission", action: "append", target: RES, assignee: BOB },
        { type: "permission", action: "control", target: RES, assignee: OWNER },
      ],
      prohibitions: [{ type: "prohibition", action: "delete", target: RES }],
    };
    expect(canonicalGraph(policyToRdf(policy))).toMatchSnapshot();
  });
});

describe("characterization: JSON-LD projection", () => {
  it("policyToJsonLd is a stable document for the rich policy", () => {
    expect(policyToJsonLd(RICH_POLICY)).toMatchSnapshot();
  });
});

describe("characterization: parse round-trip structure", () => {
  it("Turtle round-trip recovers a stable OdrlPolicy", async () => {
    const parsed = await parsePolicy(await policyToTurtle(RICH_POLICY));
    expect(parsed).toMatchSnapshot();
  });

  it("JSON-LD round-trip recovers a stable OdrlPolicy", async () => {
    const doc = JSON.stringify(policyToJsonLd(RICH_POLICY));
    const dataset = await parseRdf(doc, "application/ld+json");
    const parsed = (await import("../src/policy.js")).policyFromRdf(dataset);
    expect(parsed).toMatchSnapshot();
  });
});

// The security-essential decision matrix: every branch of the evaluator's
// permit/deny/notApplicable + conflict + fail-closed + subsumption semantics,
// pinned as a full explainable result so a "simplification" that changes an
// edge-case evaluation is caught as a snapshot diff (= a policy-bypass bug).
describe("characterization: evaluate decision matrix", () => {
  const cases: Array<{
    name: string;
    policy: OdrlPolicy;
    request: RequestContext;
    requireDuties?: boolean;
  }> = [
    {
      name: "permit: matching permission only",
      policy: {
        id: "p",
        permissions: [{ type: "permission", action: "read", target: RES, assignee: BOB }],
      },
      request: { agent: BOB, action: "read", target: RES },
    },
    {
      name: "deny: matching prohibition only",
      policy: { id: "p", prohibitions: [{ type: "prohibition", action: "read", target: RES }] },
      request: { agent: BOB, action: "read", target: RES },
    },
    {
      name: "notApplicable: no rule matches",
      policy: {
        id: "p",
        permissions: [{ type: "permission", action: "read", target: RES, assignee: BOB }],
      },
      request: { agent: CAROL, action: "read", target: OTHER },
    },
    {
      name: "conflict default (no strategy) → deny (fail-closed prohibit)",
      policy: {
        id: "p",
        permissions: [{ type: "permission", action: "read", target: RES }],
        prohibitions: [{ type: "prohibition", action: "read", target: RES }],
      },
      request: { action: "read", target: RES },
    },
    {
      name: "conflict perm → permit",
      policy: {
        id: "p",
        conflict: "perm",
        permissions: [{ type: "permission", action: "read", target: RES }],
        prohibitions: [{ type: "prohibition", action: "read", target: RES }],
      },
      request: { action: "read", target: RES },
    },
    {
      name: "conflict invalid → deny",
      policy: {
        id: "p",
        conflict: "invalid",
        permissions: [{ type: "permission", action: "read", target: RES }],
        prohibitions: [{ type: "prohibition", action: "read", target: RES }],
      },
      request: { action: "read", target: RES },
    },
    {
      name: "use umbrella covers a read request",
      policy: { id: "p", permissions: [{ type: "permission", action: "use", target: RES }] },
      request: { action: "read", target: RES },
    },
    {
      name: "use umbrella does NOT cover a control request (fail-closed)",
      policy: { id: "p", permissions: [{ type: "permission", action: "use", target: RES }] },
      request: { action: "control", target: RES },
    },
    {
      name: "write subsumes an append request",
      policy: { id: "p", permissions: [{ type: "permission", action: "write", target: RES }] },
      request: { action: "append", target: RES },
    },
    {
      name: "append does NOT cover a write request (no over-grant)",
      policy: { id: "p", permissions: [{ type: "permission", action: "append", target: RES }] },
      request: { action: "write", target: RES },
    },
    {
      name: "constraint fail-closed: missing purpose in context → notApplicable",
      policy: {
        id: "p",
        permissions: [
          {
            type: "permission",
            action: "read",
            target: RES,
            constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: RND }],
          },
        ],
      },
      request: { action: "read", target: RES },
    },
    {
      name: "constraint satisfied: purpose supplied → permit",
      policy: {
        id: "p",
        permissions: [
          {
            type: "permission",
            action: "read",
            target: RES,
            constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: RND }],
          },
        ],
      },
      request: { action: "read", target: RES, attributes: { purpose: RND } },
    },
    {
      name: "dateTime lteq against injected now → permit",
      policy: {
        id: "p",
        permissions: [
          {
            type: "permission",
            action: "read",
            target: RES,
            constraints: [
              { leftOperand: "dateTime", operator: "lteq", rightOperand: "2027-01-01T00:00:00Z" },
            ],
          },
        ],
      },
      request: { action: "read", target: RES },
    },
    {
      name: "permit with unfulfilled duty (advisory) → permit, duty reported",
      policy: {
        id: "p",
        permissions: [
          { type: "permission", action: "read", target: RES, duties: [{ action: "attribute" }] },
        ],
      },
      request: { action: "read", target: RES },
    },
    {
      name: "requireDuties with unfulfilled duty → deny",
      policy: {
        id: "p",
        permissions: [
          { type: "permission", action: "read", target: RES, duties: [{ action: "attribute" }] },
        ],
      },
      request: { action: "read", target: RES },
      requireDuties: true,
    },
    {
      name: "requireDuties with discharged duty → permit",
      policy: {
        id: "p",
        permissions: [
          { type: "permission", action: "read", target: RES, duties: [{ action: "attribute" }] },
        ],
      },
      request: { action: "read", target: RES, attributes: { "fulfilled:attribute": true } },
      requireDuties: true,
    },
    {
      name: "isAnyOf set membership → permit",
      policy: {
        id: "p",
        permissions: [
          {
            type: "permission",
            action: "read",
            target: RES,
            constraints: [
              { leftOperand: "recipient", operator: "isAnyOf", rightOperand: [OWNER, BOB] },
            ],
          },
        ],
      },
      request: { action: "read", target: RES, attributes: { recipient: BOB } },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = evaluate(c.policy, c.request, {
        now: NOW,
        requireDuties: c.requireDuties ?? false,
      });
      expect(r).toMatchSnapshot();
    });
  }
});

// The DELEGATION decision matrix (the agent-delegation profile,
// docs/delegation-profile.md): the full explainable DelegatedEvaluationResult is
// pinned for every fail-closed branch of the chain walker — valid 1-/2-hop chains
// are the ONLY permits; over-broad, expired-mid-chain, cyclic, depth-exceeded,
// wrong-nextPolicy and revoked chains are all denies. The BASE matrix above is
// untouched by the profile (its snapshots must stay byte-identical — the profile
// must not change any non-delegation evaluation).
describe("characterization: delegation decision matrix", () => {
  const rootPolicy = (grantUse: Partial<OdrlRule> = {}): OdrlPolicy => ({
    id: ROOT_ID,
    type: "Agreement",
    assigner: OWNER,
    permissions: [
      { type: "permission", action: "read", target: RES, assignee: AGENT_A },
      {
        type: "permission",
        action: "grantUse",
        target: RES,
        assignee: AGENT_A,
        ...grantUse,
      },
    ],
  });
  const hop1Policy = (overrides: Partial<OdrlPolicy> = {}): OdrlPolicy => ({
    id: HOP1_ID,
    type: "Agreement",
    assigner: AGENT_A,
    assignee: AGENT_B,
    delegatedUnder: ROOT_ID,
    permissions: [{ type: "permission", action: "read", target: RES, assignee: AGENT_B }],
    ...overrides,
  });
  const hop1WithGrant = hop1Policy({
    permissions: [
      { type: "permission", action: "read", target: RES, assignee: AGENT_B },
      { type: "permission", action: "grantUse", target: RES, assignee: AGENT_B },
    ],
  });
  const hop2Policy: OdrlPolicy = {
    id: HOP2_ID,
    type: "Agreement",
    assigner: AGENT_B,
    assignee: AGENT_C,
    delegatedUnder: HOP1_ID,
    permissions: [{ type: "permission", action: "read", target: RES, assignee: AGENT_C }],
  };

  const cases: Array<{
    name: string;
    chain: readonly OdrlPolicy[];
    request: RequestContext;
    revoked?: readonly string[];
  }> = [
    { name: "valid 1-hop chain → permit", chain: [rootPolicy(), hop1Policy()], request: READ_B },
    {
      name: "valid 2-hop chain (root depth 2) → permit",
      chain: [rootPolicy(DEPTH_2), hop1WithGrant, hop2Policy],
      request: READ_C,
    },
    {
      name: "over-broad hop (delegate granted write the delegator lacks) → deny",
      chain: [
        rootPolicy(),
        hop1Policy({
          permissions: [{ type: "permission", action: "write", target: RES, assignee: AGENT_B }],
        }),
      ],
      request: { ...READ_B, action: "write" },
    },
    {
      name: "expired mid-chain hop → deny",
      chain: [
        rootPolicy(DEPTH_2),
        hop1Policy({
          permissions: [
            {
              type: "permission",
              action: "read",
              target: RES,
              assignee: AGENT_B,
              constraints: [{ leftOperand: "dateTime", operator: "lteq", rightOperand: PAST }],
            },
            { type: "permission", action: "grantUse", target: RES, assignee: AGENT_B },
          ],
        }),
        hop2Policy,
      ],
      request: READ_C,
    },
    {
      name: "cyclic chain (root repeated) → deny",
      chain: [rootPolicy(DEPTH_2), hop1WithGrant, rootPolicy(DEPTH_2)],
      request: READ_B,
    },
    {
      name: "depth exceeded (2 hops under the default budget of 1) → deny",
      chain: [rootPolicy(), hop1WithGrant, hop2Policy],
      request: READ_C,
    },
    {
      name: "depth exceeded (2 hops under an explicit lteq 1) → deny",
      chain: [
        rootPolicy({
          constraints: [{ leftOperand: "delegationDepth", operator: "lteq", rightOperand: 1 }],
        }),
        hop1WithGrant,
        hop2Policy,
      ],
      request: READ_C,
    },
    {
      name: "nextPolicy narrows: the mandated hop is granted, in-scope request → permit",
      chain: [rootPolicy({ duties: [{ action: "nextPolicy", target: HOP1_ID }] }), hop1Policy()],
      request: READ_B,
    },
    {
      name: "nextPolicy narrows: out-of-scope request against the mandated hop → deny",
      chain: [rootPolicy({ duties: [{ action: "nextPolicy", target: HOP1_ID }] }), hop1Policy()],
      request: { ...READ_B, action: "write" },
    },
    {
      name: "nextPolicy violated (a different policy was delegated) → deny",
      chain: [rootPolicy({ duties: [{ action: "nextPolicy", target: HOP2_ID }] }), hop1Policy()],
      request: READ_B,
    },
    {
      name: "revoked hop → deny",
      chain: [rootPolicy(), hop1Policy()],
      request: READ_B,
      revoked: [HOP1_ID],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = evaluateDelegated(c.chain, c.request, {
        now: NOW,
        ...(c.revoked !== undefined && { revoked: c.revoked }),
      });
      expect(r).toMatchSnapshot();
    });
  }

  it("delegationProvenance emits a stable PROV-O overlay for the 2-hop chain", () => {
    const quads = delegationProvenance([rootPolicy(DEPTH_2), hop1WithGrant, hop2Policy]);
    expect(canonicalGraph(quads)).toMatchSnapshot();
  });

  it("a delegated Agreement's express graph is stable (delegatedUnder + grantUse + nextPolicy)", () => {
    const policy = hop1Policy({
      permissions: [
        { type: "permission", action: "read", target: RES, assignee: AGENT_B },
        {
          type: "permission",
          action: "grantUse",
          target: RES,
          assignee: AGENT_B,
          constraints: [{ leftOperand: "delegationDepth", operator: "lteq", rightOperand: 1 }],
          duties: [{ action: "nextPolicy", target: HOP2_ID }],
        },
      ],
    });
    expect(canonicalGraph(policyToRdf(policy))).toMatchSnapshot();
    expect(policyToJsonLd(policy)).toMatchSnapshot();
  });
});

describe("characterization: compose adapters", () => {
  it("requestContextFromA2AIntent maps the verb table stably", () => {
    const verbs = [
      "read",
      "create",
      "update",
      "append",
      "delete",
      "list",
      "grant",
      "subscribe",
      "query",
      "unknownverb",
    ];
    const out = verbs.map((action) =>
      requestContextFromA2AIntent({ action, target: RES, agent: BOB, recipient: CAROL }),
    );
    expect(out).toMatchSnapshot();
  });

  it("requestContextFromWac maps each ACL mode stably", () => {
    const out = (["Read", "Write", "Append", "Control"] as const).map((mode) =>
      requestContextFromWac(BOB, mode, RES),
    );
    expect(out).toMatchSnapshot();
  });
});
