// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import { grant, policy, stranger } from "../test/helpers.js";
import type { EffectivePolicy } from "./index.js";
import {
  assertNotWider,
  emptyPolicy,
  policiesEqual,
  readAcp,
  readWac,
  scopePolicy,
  translatePolicy,
  unionPolicies,
  writeAcp,
  writeWac,
} from "./index.js";

const resource = "https://pod.example/folder/";
const context = {
  resourceUrl: resource,
  sourceOwner: "urn:source-owner",
  targetOwner: "urn:target-owner",
  targetImplementation: "css" as const,
  groups: new Map<string, string[]>(),
};

describe("normalized translation and proof inputs", () => {
  it.each(["members", "both"] as const)("rejects unnormalized %s grants and denials", (scope) => {
    for (const field of ["grants", "denials"] as const) {
      const source = policy(grant());
      source[field].push(grant(undefined, { appliesTo: scope }));
      for (const target of ["wac", "acp"] as const)
        expect(() => translatePolicy(source, target, context)).toThrow("scopePolicy");
      expect(() => assertNotWider(source, emptyPolicy(), context)).toThrow("scopePolicy");
      expect(() => assertNotWider(emptyPolicy(), source, context)).toThrow("scopePolicy");
      expect(policiesEqual(source, source, context)).toBe(false);
    }
  });

  it.each([
    "wac",
    "acp",
  ] as const)("keeps scopes separate when translating %s reader output", async (sourceSystem) => {
    const sourceUrl = `${resource}.${sourceSystem === "wac" ? "acl" : "acr"}`;
    const sourceReader = sourceSystem === "wac" ? readWac : readAcp;
    const input: EffectivePolicy = {
      grants: [
        grant([[{ kind: "agent", webId: stranger }]]),
        grant(undefined, { appliesTo: "members", modes: new Set(["write", "append"]) }),
        grant([[{ kind: "authenticated" }]], {
          appliesTo: "both",
          modes: new Set(["control"]),
        }),
      ],
      denials:
        sourceSystem === "acp"
          ? [
              grant([[{ kind: "agent", webId: stranger }]], {
                appliesTo: "members",
                modes: new Set(["control"]),
              }),
            ]
          : [],
    };
    const sourceTurtle = await (sourceSystem === "wac"
      ? writeWac(input, resource, sourceUrl)
      : writeAcp(input, resource, sourceUrl, "css"));
    const source = sourceReader(
      await parseRdf(sourceTurtle, "text/turtle", { baseIRI: sourceUrl }),
      resource,
      sourceUrl,
      "css",
    );
    const targetSystem = sourceSystem === "wac" ? "acp" : "wac";
    expect(() => translatePolicy(source, targetSystem, context)).toThrow("scopePolicy");

    const sourceResource = scopePolicy(source, "resource");
    const sourceMembers = scopePolicy(source, "members");
    const translatedResource = translatePolicy(sourceResource, targetSystem, context).policy;
    const translatedMembers = translatePolicy(sourceMembers, targetSystem, {
      ...context,
      scopeId: "members:",
    }).policy;
    assertNotWider(sourceResource, translatedResource, context);
    assertNotWider(sourceMembers, translatedMembers, context);
    expect(() => assertNotWider(sourceResource, translatedMembers, context)).toThrow("widens");
    expect(() => assertNotWider(sourceMembers, translatedResource, context)).toThrow("widens");

    const combined = unionPolicies(translatedResource, {
      grants: translatedMembers.grants.map((rule) => ({ ...rule, appliesTo: "members" })),
      denials: translatedMembers.denials.map((rule) => ({ ...rule, appliesTo: "members" })),
    });
    const targetUrl = `${resource}.${targetSystem === "wac" ? "acl" : "acr"}`;
    const targetReader = targetSystem === "wac" ? readWac : readAcp;
    const targetTurtle = await (targetSystem === "wac"
      ? writeWac(combined, resource, targetUrl)
      : writeAcp(combined, resource, targetUrl, "css"));
    const actual = targetReader(
      await parseRdf(targetTurtle, "text/turtle", { baseIRI: targetUrl }),
      resource,
      targetUrl,
      "css",
      true,
    );
    for (const scope of ["resource", "members"] as const)
      assertNotWider(scopePolicy(source, scope), scopePolicy(actual, scope), context);
    expect(scopePolicy(actual, "resource").grants.some((rule) => rule.modes.has("write"))).toBe(
      false,
    );
    expect(scopePolicy(actual, "members").grants.some((rule) => rule.modes.has("read"))).toBe(
      false,
    );
    expect(scopePolicy(actual, "members").grants.some((rule) => rule.modes.has("write"))).toBe(
      true,
    );
  });
});
