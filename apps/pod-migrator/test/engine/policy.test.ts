// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  assertNotWider,
  effectivePolicy,
  emptyPolicy,
  ownerPolicy,
  policiesEqual,
  scopePolicy,
  unionPolicies,
} from "../../src/engine/policy.js";
import { type TranslationContext, translatePolicy } from "../../src/engine/translation.js";
import type { AccessDocument, EffectivePolicy, Subject } from "../../src/engine/types.js";
import { grant, policy, stranger } from "./helpers.js";

const sourceOwner = "https://source.example/owner#me";
const targetOwner = "https://target.example/owner#me";
const context: TranslationContext = {
  resourceUrl: "https://source.example/pod/file",
  sourceOwner,
  targetOwner,
  groups: new Map(),
};
const agent: Subject = { kind: "agent", webId: stranger };
function translated(source: EffectivePolicy, model: "wac" | "acp", ctx = context) {
  const result = translatePolicy(source, model, ctx);
  assertNotWider(source, result.policy, { sourceOwner, targetOwner, groups: ctx.groups });
  return result;
}
describe("every translation-table construct", () => {
  it("preserves named, public and authenticated subjects in either system", () => {
    for (const model of ["wac", "acp"] as const)
      for (const subject of [agent, { kind: "public" }, { kind: "authenticated" }] as Subject[])
        expect(
          policiesEqual(
            policy(grant([[subject]])),
            translated(policy(grant([[subject]])), model).policy,
          ),
        ).toBe(true);
  });
  it("offers only safe group choices and expands a bounded membership snapshot", () => {
    const group = "https://source.example/pod/group#id";
    const source = policy(grant([[{ kind: "group", group }, { kind: "authenticated" }], [agent]]));
    expect(translated(policy(grant([[{ kind: "group", group }]])), "wac").report).toEqual([]);
    const unavailable = translated(source, "acp");
    expect(unavailable.report[0]?.options.map((o) => o.id)).toEqual(["skip", "abort"]);
    const ctx = { ...context, groups: new Map([[group, [stranger, sourceOwner]]]) };
    const report = translatePolicy(source, "acp", ctx).report;
    const expanded = translatePolicy(source, "acp", ctx, { [report[0]?.id as string]: "expand" });
    expect(expanded.policy.grants[0]?.who).toHaveLength(3);
    assertNotWider(source, expanded.policy, { groups: ctx.groups });
    expect(
      translatePolicy(source, "acp", { ...ctx, groups: new Map([[group, []]]) }).report[0]
        ?.explanation,
    ).toContain("empty");
  });
  it("never drops only an origin, client, issuer or credential condition", () => {
    const origin: Subject = { kind: "origin", origin: "https://app.example" };
    expect(
      translated(policy(grant([[agent, origin], [agent]])), "acp").policy.grants[0]?.who,
    ).toEqual([[agent]]);
    expect(translated(policy(grant([[agent, origin]])), "wac").report).toEqual([]);
    for (const condition of [
      { kind: "client", clientId: "https://app.example/id" },
      { kind: "issuer", issuer: "https://issuer.example" },
      { kind: "vc", vcType: "https://vc.example/type" },
    ] as Subject[]) {
      const source = policy(grant([[agent, condition], [agent]]));
      expect(translated(source, "wac").report[0]?.kind).toBe("condition-unsupported");
      expect(translated(source, "wac").policy.grants[0]?.who).toEqual([[agent]]);
      expect(policiesEqual(source, translated(source, "acp").policy)).toBe(true);
    }
  });
  it("drops entire excluded grants, and subtracts or conservatively drops denials", () => {
    const excluded = policy(grant(undefined, { except: [agent] }));
    expect(translated(excluded, "wac").policy.grants).toEqual([]);
    expect(translated(excluded, "wac").report[0]?.kind).toBe("exclusion-unsupported");
    const exact = {
      grants: [grant([[agent]], { modes: new Set(["read", "control"]) })],
      denials: [grant([[agent]])],
    };
    expect(translated(exact, "wac").policy.grants[0]?.modes).toEqual(new Set(["control"]));
    expect(
      translated({ grants: [grant()], denials: [grant([[agent]])] }, "wac").policy.grants,
    ).toEqual([]);
    const disjoint = {
      grants: [grant([[agent]])],
      denials: [grant([[{ kind: "agent", webId: sourceOwner }]])],
    };
    expect(translated(disjoint, "wac").policy.grants).toHaveLength(1);
    expect(translated(disjoint, "acp").policy.denials[0]?.except).toContainEqual({
      kind: "agent",
      webId: targetOwner,
    });
    expect(
      translated(
        { grants: [grant()], denials: [grant(undefined, { modes: new Set(["control"]) })] },
        "wac",
      ).policy.grants,
    ).toHaveLength(1);
    expect(
      translated({ grants: [grant([[agent]])], denials: [grant()] }, "wac").policy.grants,
    ).toEqual([]);
  });
  it("maps owner and creator roles and preserves the source owner's WebID", () => {
    for (const model of ["wac", "acp"] as const) {
      const source = policy(
        grant([
          [{ kind: "owner" }],
          [{ kind: "creator" }],
          [{ kind: "agent", webId: sourceOwner }],
        ]),
      );
      const result = translated(source, model);
      expect(result.report.map((i) => i.kind)).toEqual([
        "owner-mapped",
        "owner-mapped",
        "source-owner-kept",
      ]);
      expect(result.policy.grants[0]?.who[0]).toEqual([{ kind: "agent", webId: targetOwner }]);
    }
  });
  it("narrows principal intersections rather than unioning them", () => {
    expect(
      translated(
        policy(grant([[agent, { kind: "authenticated" }, { kind: "public" }, agent]])),
        "wac",
      ).policy.grants[0]?.who,
    ).toEqual([[agent]]);
    const combined = policy(
      grant([
        [
          { kind: "group", group: "https://g.example/a" },
          { kind: "group", group: "https://g.example/b" },
        ],
      ]),
    );
    expect(translated(combined, "wac").policy.grants).toEqual([]);
    expect(translated(policy(grant([], { modes: new Set() })), "wac").policy.grants).toEqual([]);
  });
});

describe("access proof", () => {
  it("rejects widening, condition removal, dropped exclusions and dropped denies", () => {
    expect(() => assertNotWider(emptyPolicy(), policy(grant()))).toThrow("widens");
    for (const source of [
      policy(grant([[agent, { kind: "origin", origin: "https://app.example" }]])),
      policy(grant(undefined, { except: [agent] })),
      { grants: [grant()], denials: [grant([[agent]])] },
    ])
      expect(() => assertNotWider(source, policy(grant()))).toThrow();
    expect(policiesEqual(emptyPolicy(), policy(grant()))).toBe(false);
    expect(() =>
      assertNotWider(emptyPolicy(), ownerPolicy(targetOwner), { targetOwner }),
    ).not.toThrow();
    expect(() =>
      assertNotWider(
        policy(grant([[{ kind: "owner" }]])),
        policy(grant([[{ kind: "agent", webId: sourceOwner }]])),
        { sourceOwner },
      ),
    ).not.toThrow();
    expect(() =>
      assertNotWider(
        policy(grant([[{ kind: "creator" }]])),
        policy(grant([[{ kind: "creator" }]])),
      ),
    ).not.toThrow();
  });
  it("knows identity exclusivity and authentication implication", () => {
    for (const [a, b] of [
      [agent, { kind: "agent", webId: sourceOwner }],
      [
        { kind: "client", clientId: "urn:a" },
        { kind: "client", clientId: "urn:b" },
      ],
      [
        { kind: "issuer", issuer: "urn:a" },
        { kind: "issuer", issuer: "urn:b" },
      ],
      [
        { kind: "origin", origin: "urn:a" },
        { kind: "origin", origin: "urn:b" },
      ],
    ] as Subject[][])
      expect(() =>
        assertNotWider(emptyPolicy(), policy(grant([[a as Subject, b as Subject]]))),
      ).not.toThrow();
    expect(() =>
      assertNotWider(policy(grant([[{ kind: "authenticated" }]])), policy(grant([[agent]]))),
    ).not.toThrow();
  });
  it("checks randomized policies against real finite identity contexts", () => {
    let seed = 11;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const subjects: Subject[] = [
      { kind: "public" },
      { kind: "authenticated" },
      agent,
      { kind: "client", clientId: "urn:client" },
    ];
    for (let index = 0; index < 150; index++) {
      const rules = Array.from({ length: random() % 4 }, () =>
        grant([[subjects[random() % subjects.length] as Subject]], {
          modes: new Set(random() % 2 ? ["read"] : ["write", "append"]),
          except: random() % 3 ? [] : [agent],
        }),
      );
      const source = { grants: rules, denials: random() % 2 ? [grant([[agent]])] : [] };
      for (const model of ["wac", "acp"] as const) {
        const target = translated(source, model).policy;
        for (const webId of [undefined, stranger, sourceOwner])
          for (const client of [undefined, "urn:client", "urn:other"]) {
            const matches = (subject: Subject): boolean => {
              switch (subject.kind) {
                case "public":
                  return true;
                case "authenticated":
                  return webId !== undefined;
                case "agent":
                  return subject.webId === webId;
                case "client":
                  return subject.clientId === client;
                default:
                  throw new Error("Unexpected randomized subject");
              }
            };
            const permits = (
              p: EffectivePolicy,
              mode: import("../../src/engine/types.js").Mode,
            ) => {
              const applies = (rule: import("../../src/engine/types.js").Grant) =>
                rule.modes.has(mode) &&
                rule.who.some((clause) => clause.every(matches)) &&
                !rule.except.some(matches);
              return p.grants.some(applies) && !p.denials.some(applies);
            };
            for (const mode of ["read", "append", "write", "control"] as const)
              if (permits(target, mode)) expect(permits(source, mode)).toBe(true);
          }
      }
    }
  });
  it("WAC replaces inherited defaults; ACP unions them with denies winning", () => {
    const root = "https://source.example/pod/";
    const child = `${root}folder/`;
    const file = `${child}file`;
    const doc = (url: string, p: EffectivePolicy): AccessDocument => ({
      url,
      policy: p,
      turtle: "",
      etag: null,
    });
    const documents = new Map([
      [root, doc(root, policy(grant(undefined, { appliesTo: "both" })))],
      [child, doc(child, ownerPolicy(sourceOwner, true))],
    ]);
    expect(effectivePolicy("wac", file, root, documents).grants).toHaveLength(1);
    expect(effectivePolicy("acp", file, root, documents).grants).toHaveLength(2);
    expect(effectivePolicy("wac", root, root, new Map())).toEqual(emptyPolicy());
    expect(
      scopePolicy(
        unionPolicies(policy(grant(undefined, { appliesTo: "members" })), {
          grants: [],
          denials: [grant(undefined, { appliesTo: "both" })],
        }),
        "members",
      ).denials,
    ).toHaveLength(1);
  });
});

it("uses RDF identity independently of JavaScript property order", () => {
  const a: Subject = { kind: "agent", webId: stranger };
  const same: Subject = { webId: stranger, kind: "agent" };
  expect(() => assertNotWider(policy(grant([[a]])), policy(grant([[same]])))).not.toThrow();
  expect(() => assertNotWider(emptyPolicy(), policy(grant([[a, same]])))).toThrow("widens");
});

it("drops impossible intersections of different agents when translating to WAC", () => {
  const source = policy(
    grant([
      [
        { kind: "agent", webId: stranger },
        { kind: "agent", webId: sourceOwner },
      ],
    ]),
  );
  expect(translated(source, "wac").policy.grants).toEqual([]);
});
