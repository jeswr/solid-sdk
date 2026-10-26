
import type { OdrlPolicy, RequestContext } from "@jeswr/solid-odrl";
import { ACTION_IRI, evaluate, policyToRdf } from "@jeswr/solid-odrl";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import { createEngine } from "./engine.js";
import {
  createRdfEngine,
  PolicyIdentifierCollisionError,
  PolicySubjectUnsupportedError,
} from "./node.js";
import { createFakeRdfEngine } from "./testing.js";
import type { PolicyContext } from "./types.js";

const dataset = (policy: OdrlPolicy) => new Store(policyToRdf(policy));

const OWNER = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const CAROL = "https://carol.example/profile/card#me";
const RES = "https://alice.example/notes/private.ttl";
const OTHER = "https://alice.example/notes/other.ttl";
const POLICY = "https://alice.example/policies/p";
const NOW = new Date("2026-06-16T12:00:00Z");
const RND = "https://w3id.org/dpv#ResearchAndDevelopment";
const ODRL = "http://www.w3.org/ns/odrl/2/";

// Copied from solid-odrl/test/characterization.test.ts's base decision matrix.
// D2 omits strict-duty switches and arbitrary request attributes: the three
// corresponding cases are outside this facade's representable request surface.
const cases: Array<{
  name: string;
  policy: OdrlPolicy;
  request: RequestContext;
  requireDuties?: boolean;
}> = [
  {
    name: "permit: matching permission only",
    policy: {
      id: POLICY,
      permissions: [{ type: "permission", action: "read", target: RES, assignee: BOB }],
    },
    request: { agent: BOB, action: "read", target: RES },
  },
  {
    name: "deny: matching prohibition only",
    policy: { id: POLICY, prohibitions: [{ type: "prohibition", action: "read", target: RES }] },
    request: { agent: BOB, action: "read", target: RES },
  },
  {
    name: "notApplicable: no rule matches",
    policy: {
      id: POLICY,
      permissions: [{ type: "permission", action: "read", target: RES, assignee: BOB }],
    },
    request: { agent: CAROL, action: "read", target: OTHER },
  },
  {
    name: "conflict default (no strategy) → deny (fail-closed prohibit)",
    policy: {
      id: POLICY,
      permissions: [{ type: "permission", action: "read", target: RES }],
      prohibitions: [{ type: "prohibition", action: "read", target: RES }],
    },
    request: { action: "read", target: RES },
  },
  {
    name: "conflict perm → permit",
    policy: {
      id: POLICY,
      conflict: "perm",
      permissions: [{ type: "permission", action: "read", target: RES }],
      prohibitions: [{ type: "prohibition", action: "read", target: RES }],
    },
    request: { action: "read", target: RES },
  },
  {
    name: "conflict invalid → deny",
    policy: {
      id: POLICY,
      conflict: "invalid",
      permissions: [{ type: "permission", action: "read", target: RES }],
      prohibitions: [{ type: "prohibition", action: "read", target: RES }],
    },
    request: { action: "read", target: RES },
  },
  {
    name: "use umbrella covers a read request",
    policy: { id: POLICY, permissions: [{ type: "permission", action: "use", target: RES }] },
    request: { action: "read", target: RES },
  },
  {
    name: "use umbrella does NOT cover a control request (fail-closed)",
    policy: { id: POLICY, permissions: [{ type: "permission", action: "use", target: RES }] },
    request: { action: "control", target: RES },
  },
  {
    name: "write subsumes an append request",
    policy: { id: POLICY, permissions: [{ type: "permission", action: "write", target: RES }] },
    request: { action: "append", target: RES },
  },
  {
    name: "append does NOT cover a write request (no over-grant)",
    policy: { id: POLICY, permissions: [{ type: "permission", action: "append", target: RES }] },
    request: { action: "write", target: RES },
  },
  {
    name: "constraint fail-closed: missing purpose in context → notApplicable",
    policy: {
      id: POLICY,
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
      id: POLICY,
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
      id: POLICY,
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
      id: POLICY,
      permissions: [
        { type: "permission", action: "read", target: RES, duties: [{ action: "attribute" }] },
      ],
    },
    request: { action: "read", target: RES },
  },
  {
    name: "requireDuties with unfulfilled duty → deny",
    policy: {
      id: POLICY,
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
      id: POLICY,
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
      id: POLICY,
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
for (const [name, factory] of [
  ["real", createRdfEngine],
  ["fake", createFakeRdfEngine],
] as const) {
  describe(`${name} policy projection`, () => {
    test.each(
      cases.filter((c) => !c.requireDuties && !c.request.attributes?.recipient),
    )("solid-odrl corpus: $name", async ({ policy, request }) => {
      const engine = factory();
      const ctx: PolicyContext = {
        action: request.action,
        target: request.target as string,
        assignee: request.agent,
        purpose: request.attributes?.purpose as string | undefined,
        now: NOW,
      };
      try {
        const expected = evaluate(policy, request, { now: NOW });
        const result = await engine.evaluatePolicy(dataset(policy), ctx);
        expect(result.allow).toBe(expected.decision === "permit");
        expect(result.matched).toHaveLength(
          expected.matchedPermissions.length + expected.matchedProhibitions.length,
        );
        expect(result.unmet).toHaveLength(expected.duties.filter((d) => !d.fulfilled).length);
        // Accept both the ODRL IRI and solid-odrl's action short name.
        expect(
          await engine.evaluatePolicy(dataset(policy), {
            ...ctx,
            action: ACTION_IRI[ctx.action as keyof typeof ACTION_IRI],
          }),
        ).toEqual(result);
      } finally {
        engine.dispose();
      }
    });

    test("named and anonymous rule/duty IDs follow dataset document order; input is unchanged", async () => {
      const engine = factory();
      const data = new Store(
        new Parser().parse(`
        @prefix odrl: <${ODRL}> .
        <${POLICY}> a odrl:Set ; odrl:conflict odrl:perm ;
          odrl:prohibition _:deny ; odrl:permission <https://example/named>, _:read, _:other ;
          odrl:obligation [ odrl:action odrl:inform ] .
        _:deny odrl:action odrl:read .
        <https://example/named> odrl:action odrl:read ; odrl:duty <https://example/duty> .
        <https://example/duty> odrl:action odrl:attribute .
        _:read odrl:action odrl:read ; odrl:duty [ odrl:action odrl:compensate ] .
        _:other odrl:action odrl:write ; odrl:duty [ odrl:action odrl:delete ] .
        <urn:rdf-engine:trace:0> <https://example/p> "collision sentinel" .
      `),
      );
      const original = [...data];
      try {
        const result = await engine.evaluatePolicy(data, { action: "read", target: RES });
        expect(result).toEqual({
          allow: true,
          matched: ["https://example/named", `${POLICY}#rule-3`, `${POLICY}#rule-1`],
          unmet: ["https://example/duty", `${POLICY}#duty-3`, `${POLICY}#duty-1`],
        });
        expect([...data]).toEqual(original);
        expect(await engine.evaluatePolicy(data, { action: "read", target: RES })).toEqual(result);
      } finally {
        engine.dispose();
      }
    });

    test.each(
      ["NamedNode", "BlankNode"].flatMap((termType) =>
        ["unrelated", "permission", "prohibition", "obligation"].map((relation) => ({
          termType,
          relation,
        })),
      ),
    )("keeps $termType policy identity apart from a same-value $relation subject", async ({
      termType,
      relation,
    }) => {
      const root =
        termType === "NamedNode" ? DataFactory.namedNode(POLICY) : DataFactory.blankNode(POLICY);
      const shadow =
        termType === "NamedNode" ? DataFactory.blankNode(POLICY) : DataFactory.namedNode(POLICY);
      const parsed = new Parser().parse(`
        @prefix odrl: <${ODRL}> .
        <urn:shadow> odrl:${relation} [ odrl:action odrl:read ] .
        <${POLICY}> a odrl:Set, odrl:Policy ; odrl:conflict odrl:perm ;
          odrl:permission [ odrl:action odrl:read ;
            odrl:duty [ odrl:action odrl:attribute ] ] ;
          odrl:obligation [ odrl:action odrl:inform ] .
      `);
      // Factory construction preserves a label that Turtle would scope/rename.
      const data = new Store(
        parsed.map((q) =>
          DataFactory.quad(
            q.subject.value === "urn:shadow"
              ? shadow
              : q.subject.value === POLICY
                ? root
                : q.subject,
            q.predicate,
            q.object,
            q.graph,
          ),
        ),
      );
      const original = [...data];
      const engine = factory();
      try {
        const expected = {
          allow: true,
          matched: [`${POLICY}#rule-1`],
          unmet: [`${POLICY}#duty-2`, `${POLICY}#duty-1`],
        };
        expect(await engine.evaluatePolicy(data, { action: "read", target: RES })).toEqual(
          expected,
        );
        expect(await engine.evaluatePolicy(data, { action: "read", target: RES })).toEqual(
          expected,
        );
        expect([...data]).toEqual(original);
      } finally {
        engine.dispose();
      }
    });

    test("rejects ambiguous typed policy subjects with the same value", async () => {
      const data = dataset({
        id: POLICY,
        permissions: [{ type: "permission", action: "read" }],
      });
      data.addQuad(
        DataFactory.blankNode(POLICY),
        DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        DataFactory.namedNode(`${ODRL}Set`),
      );
      const original = [...data];
      const engine = factory();
      try {
        for (const action of ["read", "unknown"]) {
          const result = engine.evaluatePolicy(data, { action, target: RES });
          await expect(result).rejects.toBeInstanceOf(PolicySubjectUnsupportedError);
          await expect(result).rejects.toMatchObject({
            name: "PolicySubjectUnsupportedError",
            identifier: POLICY,
          });
        }
        expect([...data]).toEqual(original);
      } finally {
        engine.dispose();
      }
    });

    test("missing policy, no applicable rule, and unknown actions deny with empty lists", async () => {
      const engine = factory();
      try {
        const data = dataset({
          id: POLICY,
          permissions: [{ type: "permission", action: "read", target: RES }],
        });
        for (const [policy, action] of [
          [new Store(), "read"],
          [data, "delete"],
          [data, "unknown"],
          [data, "toString"],
        ] as const) {
          expect(await engine.evaluatePolicy(policy, { action, target: RES })).toEqual({
            allow: false,
            matched: [],
            unmet: [],
          });
        }
        expect(await engine.evaluatePolicy(data, { action: "read", target: OTHER })).toEqual({
          allow: false,
          matched: [],
          unmet: [],
        });
      } finally {
        engine.dispose();
      }
      await expect(
        engine.evaluatePolicy(new Store(), { action: "read", target: RES }),
      ).rejects.toThrow("disposed");
    });

    test.each(
      (["permission", "prohibition", "duty", "obligation"] as const).flatMap((relation) =>
        [false, true].map((namedFirst) => ({ relation, namedFirst })),
      ),
    )("rejects colliding $relation IDs (named first: $namedFirst)", async ({
      relation,
      namedFirst,
    }) => {
      const kind = relation === "permission" || relation === "prohibition" ? "rule" : "duty";
      const identifier = `${POLICY}#${kind}-${namedFirst ? 2 : 1}`;
      const references = namedFirst
        ? `<${identifier}>, _:anonymous`
        : `_:anonymous, <${identifier}>`;
      const data = new Store(
        new Parser().parse(`
          @prefix odrl: <${ODRL}> .
          <${POLICY}> a odrl:Set ; ${
            relation === "duty"
              ? `odrl:permission <https://example/rule> .
                 <https://example/rule> odrl:action odrl:read ; odrl:duty ${references}`
              : `odrl:${relation} ${references}`
          } .
          <${identifier}> odrl:action odrl:read .
          _:anonymous odrl:action odrl:read .
        `),
      );
      const original = [...data];
      const engine = factory();
      try {
        for (const action of ["read", "delete", "unknown"]) {
          const result = engine.evaluatePolicy(data, { action, target: RES });
          await expect(result).rejects.toBeInstanceOf(PolicyIdentifierCollisionError);
          await expect(result).rejects.toMatchObject({
            name: "PolicyIdentifierCollisionError",
            identifier,
          });
        }
        expect([...data]).toEqual(original);
      } finally {
        engine.dispose();
      }
    });

    test.each(
      (["rule", "duty"] as const).flatMap((kind) =>
        (["subject", "predicate", "object", "graph", "datatype"] as const).map((position) => ({
          kind,
          position,
        })),
      ),
    )("reserves named nodes in $position position against generated $kind IDs", async ({
      kind,
      position,
    }) => {
      const identifier = `${POLICY}#${kind}-1`;
      const sentinel = {
        subject: `<${identifier}> <https://example/p> "sentinel" .`,
        predicate: `<https://example/s> <${identifier}> "sentinel" .`,
        object: `<https://example/s> <https://example/p> <${identifier}> .`,
        graph: `<${identifier}> { <https://example/s> <https://example/p> "sentinel" . }`,
        datatype: `<https://example/s> <https://example/p> "sentinel"^^<${identifier}> .`,
      }[position];
      const data = new Store(
        new Parser({ format: "application/trig" }).parse(`
          @prefix odrl: <${ODRL}> .
          <${POLICY}> a odrl:Set ; odrl:permission [ odrl:action odrl:read ;
            odrl:duty [ odrl:action odrl:attribute ] ] .
          ${sentinel}
        `),
      );
      const engine = factory();
      try {
        await expect(
          engine.evaluatePolicy(data, { action: "read", target: RES }),
        ).rejects.toBeInstanceOf(PolicyIdentifierCollisionError);
      } finally {
        engine.dispose();
      }
    });

    test("literal text matching generated IDs is not a named-node collision", async () => {
      const data = new Store(
        new Parser().parse(`
          @prefix odrl: <${ODRL}> .
          <${POLICY}> a odrl:Set ; odrl:permission [ odrl:action odrl:read ;
            odrl:duty [ odrl:action odrl:attribute ] ] .
          <https://example/s> <https://example/p> "${POLICY}#rule-1", "${POLICY}#duty-1" .
        `),
      );
      const engine = factory();
      try {
        expect(await engine.evaluatePolicy(data, { action: "read", target: RES })).toEqual({
          allow: true,
          matched: [`${POLICY}#rule-1`],
          unmet: [`${POLICY}#duty-1`],
        });
      } finally {
        engine.dispose();
      }
    });

    test("trace naming preserves blank targets and skips malformed nodes and duplicate graph references", async () => {
      const engine = factory();
      const data = new Store(
        new Parser({ format: "application/trig" }).parse(`
        @prefix odrl: <${ODRL}> .
        <${POLICY}> a odrl:Set ; odrl:permission _:bad, _:read .
        _:bad odrl:action <https://example/unsupported> .
        _:read odrl:action odrl:read ; odrl:target _:read ; odrl:duty _:badDuty, _:duty .
        _:badDuty odrl:action <https://example/unsupported> .
        _:duty odrl:action odrl:attribute .
        <https://example/g> { <${POLICY}> odrl:permission _:read . _:read odrl:duty _:duty . }
      `),
      );
      try {
        expect(await engine.evaluatePolicy(data, { action: "read", target: RES })).toEqual({
          allow: true,
          matched: [`${POLICY}#rule-2`, `${POLICY}#rule-2`],
          unmet: Array(4).fill(`${POLICY}#duty-2`),
        });
      } finally {
        engine.dispose();
      }
    });

    test("injected time expires permissions and missing purpose fails closed", async () => {
      const engine = factory();
      const data = dataset({
        id: POLICY,
        permissions: [
          {
            type: "permission",
            action: "read",
            constraints: [
              { leftOperand: "purpose", operator: "eq", rightOperand: RND },
              { leftOperand: "dateTime", operator: "lt", rightOperand: "2027-01-01T00:00:00Z" },
            ],
          },
        ],
      });
      try {
        for (const [purpose, now, allow] of [
          [RND, NOW, true],
          [undefined, NOW, false],
          ["wrong", NOW, false],
          [RND, new Date("2028-01-01"), false],
        ] as const) {
          expect(
            (await engine.evaluatePolicy(data, { action: "read", target: RES, purpose, now }))
              .allow,
          ).toBe(allow);
        }
      } finally {
        engine.dispose();
      }
    });
  });
}

test.each([
  undefined,
  0,
  "1",
  Number.NaN,
  Number.POSITIVE_INFINITY,
  1,
  2,
])("detects the versioned policy hook (%s) but never invokes the experimental probe", async (policyContractVersion) => {
  const runtime = await import("@sparq-org/sparq/wasm-node");
  const policyEvaluate = vi.fn(() => {
    throw new Error("experimental probe called");
  });
  const engine = createEngine(async () => ({ ...runtime, policyEvaluate, policyContractVersion }));
  try {
    const result = await engine.evaluatePolicy(
      dataset({ id: POLICY, permissions: [{ type: "permission", action: "read" }] }),
      { action: "read", target: RES },
    );
    expect(result.allow).toBe(true);
    expect(engine.features?.policyEvaluate).toBe(
      typeof policyContractVersion === "number" &&
        Number.isFinite(policyContractVersion) &&
        policyContractVersion >= 1,
    );
    expect(policyEvaluate).not.toHaveBeenCalled();
  } finally {
    engine.dispose();
  }
});

test("a marker without a callable policy export is not a capability", async () => {
  const runtime = await import("@sparq-org/sparq/wasm-node");
  const engine = createEngine(async () => ({ ...runtime, policyContractVersion: 1 }));
  try {
    await engine.ready();
    expect(engine.features?.policyEvaluate).toBe(false);
  } finally {
    engine.dispose();
  }
});
