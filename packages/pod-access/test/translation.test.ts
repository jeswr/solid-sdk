// AUTHORED-BY Codex GPT-6

import type { EffectivePolicy, Subject } from "@jeswr/pod-access";
import {
  assertNotWider,
  policiesEqual,
  type TranslationContext,
  translatePolicy,
} from "@jeswr/pod-access";
import { describe, expect, it } from "vitest";

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
    expect(translated(policy(grant([[agent, origin]])), "wac").report[0]?.kind).toBe(
      "origin-unsupported",
    );
    expect(translated(policy(grant([[agent, origin]])), "wac").policy.grants).toEqual([]);
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
