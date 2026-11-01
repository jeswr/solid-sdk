// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { acceptedTargets, rejectedTargets, targetFixture } from "../test/allowlist-fixtures.js";
import { grant, policy, stranger } from "../test/helpers.js";
import {
  ACL,
  ACP,
  assertNotWider,
  effectiveMembers,
  emptyPolicy,
  ownerPolicy,
  RDF,
  RdfNode,
  readAcp,
  readWac,
  serialize,
  translatePolicy,
  writeAcp,
  writeWac,
} from "./index.js";
import type { AccessDocument, EffectivePolicy, Subject } from "./types.js";

const resource = "https://pod.example/folder/";
const url = `${resource}.acr`;
function graph(scope = "accessControl", binding: string | undefined = resource) {
  const dataset = new Store();
  const n = (id: string) => new RdfNode(id, dataset, DataFactory);
  n(url).add(`${RDF}type`, `${ACP}AccessControlResource`);
  if (binding !== undefined) n(url).add(`${ACP}resource`, binding);
  n(url).add(
    ACP + scope,
    scope === "access" || scope === "memberAccess" ? "urn:policy" : "urn:control",
  );
  if (scope !== "access" && scope !== "memberAccess")
    n("urn:control").add(`${ACP}apply`, "urn:policy");
  n("urn:policy").add(`${ACP}allOf`, "urn:matcher");
  return { dataset, n };
}
const context = {
  resourceUrl: resource,
  sourceOwner: "urn:source",
  targetOwner: "urn:target",
  groups: new Map<string, string[]>(),
};

it("bounds an exponentially expensive policy proof", () => {
  const source = policy(
    ...Array.from({ length: 350 }, (_, i) => grant([[{ kind: "group", group: `urn:group-${i}` }]])),
  );
  expect(() => assertNotWider(source, source)).toThrow("too complex");
});
it("covers conservative symbolic exclusions and denials", () => {
  const context = {
    resourceUrl: "urn:resource",
    sourceOwner: "urn:source",
    targetOwner: "urn:target",
    groups: new Map<string, string[]>(),
  };
  const source = {
    grants: [grant(undefined, { except: [{ kind: "owner" }] })],
    denials: [
      grant([[{ kind: "owner" }]], {
        except: [{ kind: "owner" }, { kind: "creator" }, { kind: "agent", webId: stranger }],
      }),
    ],
  };
  const result = translatePolicy(source, "acp", context);
  assertNotWider(source, result.policy, context);
  const excludedCreator = translatePolicy(
    policy(grant(undefined, { except: [{ kind: "creator" }] })),
    "acp",
    context,
  );
  expect(excludedCreator.policy.grants).toEqual([]);
  const deniedCreator = { grants: [grant()], denials: [grant([[{ kind: "creator" }]])] };
  const narrowed = translatePolicy(deniedCreator, "acp", context);
  assertNotWider(deniedCreator, narrowed.policy, context);
  expect(narrowed.policy.grants[0]?.modes.size).toBe(0);
});
it("propagates RDF writer failures", async () => {
  const spy = vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback: unknown) => {
    (callback as (error: Error) => void)(new Error("writer failure"));
    return undefined as never;
  });
  await expect(serialize(new Store())).rejects.toThrow("writer failure");
  spy.mockRestore();
});

describe("unvalidated ACP target grammar", () => {
  it.each(acceptedTargets)("accepts %s", async (shape) => {
    const dataset = await targetFixture(resource, url, shape);
    expect(() => readAcp(dataset, resource, url, "ess", true)).not.toThrow();
    expect(() => readAcp(dataset, resource, url, undefined, true)).toThrow();
  });
  it.each(rejectedTargets)("refuses %s", async (shape) => {
    const dataset = await targetFixture(resource, url, shape);
    expect(() => readAcp(dataset, resource, url, "ess", true)).toThrow();
  });
});

it("composes member controls with WAC replacement and ACP additive semantics", () => {
  const child = `${resource}child/`;
  const doc = (policy: EffectivePolicy): AccessDocument => ({
    policy,
    url,
    turtle: "",
    etag: null,
  });
  const documents = new Map([
    [resource, doc(ownerPolicy("urn:root", true))],
    [child, doc(ownerPolicy("urn:child", true))],
  ]);
  expect(effectiveMembers("wac", child, resource, documents).grants).toHaveLength(1);
  expect(effectiveMembers("acp", child, resource, documents).grants).toHaveLength(2);
  expect(effectiveMembers("wac", child, resource, new Map())).toEqual(emptyPolicy());
});

it("preserves scoped report identity, provenance and conservative target decisions", () => {
  const vc: Subject = { kind: "vc", vcType: "urn:vc" };
  const client: Subject = { kind: "client", clientId: "urn:client" };
  const issuer: Subject = { kind: "issuer", issuer: "urn:issuer" };
  for (const targetImplementation of ["ess", "css"] as const) {
    for (const condition of targetImplementation === "css" ? [vc] : [client, issuer, vc]) {
      const input = {
        grants: [grant(), grant([[condition]]), grant(undefined, { except: [condition] })],
        denials: [grant([[condition]], { modes: new Set(["write"]), except: [condition] })],
      };
      const result = translatePolicy(input, "acp", {
        ...context,
        targetImplementation,
        scopeId: "members:",
        sourceRules: new Map([["https://source.example/pod/.acl", "source turtle"]]),
      });
      expect(result.policy.grants[1]?.who).toEqual(undefined);
      expect(
        result.report.every(
          (item) => item.id.includes(":members:") && item.sourceRuleTurtle === "source turtle",
        ),
      ).toBe(true);
      expect(result.report.map((item) => item.kind)).toContain("exclusion-unsupported");
      if (targetImplementation === "ess") {
        expect(result.policy.denials[0]?.who).toEqual([[{ kind: "public" }]]);
        expect(result.policy.denials[0]?.modes).toEqual(new Set(["write", "append"]));
        expect(result.policy.denials[0]?.except).toEqual([
          { kind: "agent", webId: context.targetOwner },
        ]);
      } else {
        expect(result.policy.denials).toEqual([]);
        expect(result.policy.grants[0]?.modes).toEqual(new Set(["read"]));
      }
    }
  }
  const source = policy(grant(undefined, { except: [{ kind: "owner" }] }));
  expect(translatePolicy(source, "acp", context).policy.grants[0]?.except).toEqual([
    { kind: "agent", webId: context.sourceOwner },
  ]);
  const denial = grant([[{ kind: "owner" }]], { except: [{ kind: "owner" }, { kind: "creator" }] });
  expect(
    translatePolicy({ grants: [grant()], denials: [denial] }, "acp", context).policy.denials[0]
      ?.except,
  ).toEqual([
    { kind: "agent", webId: context.sourceOwner },
    { kind: "agent", webId: context.targetOwner },
  ]);
});

it("does not retain either Write or Append through a partial denial", async () => {
  for (const mode of ["write", "append"] as const) {
    const translated = translatePolicy(
      { grants: [], denials: [grant(undefined, { modes: new Set([mode]) })] },
      "acp",
      context,
    );
    expect(translated.policy.denials[0]?.modes).toEqual(new Set(["write", "append"]));
    await expect(
      writeAcp(
        { grants: [], denials: [grant(undefined, { modes: new Set([mode]) })] },
        resource,
        url,
      ),
    ).rejects.toThrow("both Write and Append");
  }
});

it("rejects intersecting origins and preserves serializable ACP VC expressions", async () => {
  await expect(
    writeWac(
      policy(
        grant([
          [
            { kind: "agent", webId: stranger },
            { kind: "origin", origin: "urn:a" },
            { kind: "origin", origin: "urn:b" },
          ],
        ]),
      ),
      resource,
      url,
    ),
  ).rejects.toThrow("origins");
  const turtle = await writeAcp(policy(grant([[{ kind: "vc", vcType: "urn:vc" }]])), resource, url);
  expect(turtle).toContain("urn:vc");
});

it("reads WAC targets without relying on origin enforcement and rejects unknown constructs", async () => {
  const input = await parseRdf(
    await writeWac(ownerPolicy("urn:owner", true), resource, url),
    "text/turtle",
    { baseIRI: url },
  );
  const n = new RdfNode(`${url}#authorization-0`, input, DataFactory);
  n.add(`${ACL}origin`, "urn:origin");
  expect(readWac(input, resource, url, "css", true).grants[0]?.who).toEqual([
    [{ kind: "agent", webId: "urn:owner" }],
  ]);
  n.add("urn:extension", "urn:unknown");
  expect(() => readWac(input, resource, url, "css", true)).toThrow("unknown");
  const detached = new Store();
  new RdfNode("urn:detached", detached, DataFactory).add(`${ACL}unknown`, "urn:value");
  expect(() => readWac(detached, resource, url, "css", true)).toThrow("unknown");
});

it("rejects misplaced, ambiguous and detached ACP controls", () => {
  for (const mutation of ["unplaced", "ambiguous", "detached", "unknown", "foreign-predicate"]) {
    const { dataset, n } = graph();
    n("urn:policy").add(`${ACP}allow`, `${ACL}Read`);
    n("urn:matcher").add(`${ACP}agent`, stranger);
    if (mutation === "unplaced") n("urn:other").add(`${RDF}type`, `${ACP}AccessControlResource`);
    if (mutation === "ambiguous") n(url).add(`${ACP}resource`, "urn:other");
    if (mutation === "detached") n("urn:detached").add(`${ACP}deny`, `${ACL}Read`);
    if (mutation === "unknown") n("urn:matcher").add(`${ACP}extension`, "urn:value");
    if (mutation === "foreign-predicate") n("urn:matcher").add("urn:extension", "urn:value");
    expect(() => readAcp(dataset, resource, url, "css", true)).toThrow();
  }
});

it("retains foreign denials and rejects unplaceable grants", () => {
  for (const scope of ["accessControl", "memberAccessControl", "access", "memberAccess"]) {
    for (const binding of ["urn:foreign", url]) {
      const { dataset, n } = graph(scope, binding);
      n("urn:policy").add(`${ACP}deny`, `${ACL}Read`);
      n("urn:policy").add(`${ACP}deny`, `${ACL}Write`);
      n("urn:matcher").add(`${ACP}agent`, stranger);
      const read = readAcp(dataset, resource, url);
      expect(read.denials).toHaveLength(1);
      n("urn:policy").add(`${ACP}allow`, `${ACL}Read`);
      n("urn:policy").add(`${ACP}allow`, `${ACL}Write`);
      expect(() => readAcp(dataset, resource, url)).toThrow();
    }
  }
});

it("rejects target ACP role restrictions and partial Write/Append denials", () => {
  for (const role of ["OwnerAgent", "CreatorAgent"]) {
    const { dataset, n } = graph();
    n("urn:policy").add(`${ACP}allow`, `${ACL}Read`);
    n("urn:matcher").add(`${ACP}agent`, ACP + role);
    expect(() => readAcp(dataset, resource, url, "css", true)).toThrow("owner/creator/vc");
  }
  for (const mode of ["Write", "Append"]) {
    const { dataset, n } = graph();
    n("urn:policy").add(`${ACP}deny`, ACL + mode);
    n("urn:matcher").add(`${ACP}agent`, stranger);
    expect(() => readAcp(dataset, resource, url, "css", true)).toThrow("ambiguous");
  }
});

it("conservatively reports inactive modes and matcher enforcement in source dialects", () => {
  for (const dialect of ["css", "ess"] as const) {
    for (const kind of ["owner", "creator", "issuer", "vc"] as const) {
      const { dataset, n } = graph();
      const vocabulary = dialect === "css" ? ACL : ACP;
      n("urn:policy").add(`${ACP}allow`, `${vocabulary}Read`);
      n("urn:policy").add(`${ACP}deny`, `${vocabulary}Read`);
      if (kind === "owner" || kind === "creator")
        n("urn:matcher").add(
          `${ACP}agent`,
          ACP + (kind === "owner" ? "OwnerAgent" : "CreatorAgent"),
        );
      else {
        n("urn:matcher").add(ACP + kind, "urn:condition");
        n("urn:matcher").add(`${ACP}agent`, `${ACP}PublicAgent`);
      }
      const onInactive = vi.fn();
      const read = readAcp(dataset, resource, url, dialect, false, onInactive);
      expect(read.grants[0]?.who.length === 0).toBe(
        dialect === "css" ? kind !== "issuer" : kind === "issuer" || kind === "vc",
      );
      if (dialect === "css" ? kind !== "issuer" : kind === "issuer" || kind === "vc")
        expect(onInactive).toHaveBeenCalled();
      expect(read.denials).toHaveLength(1);
    }
  }
  const { dataset, n } = graph();
  n("urn:policy").add(`${ACP}allow`, `${ACL}Read`);
  n("urn:matcher").add(`${ACP}agent`, stranger);
  const onInactive = vi.fn();
  expect(readAcp(dataset, resource, url, "ess", false, onInactive).grants).toEqual([]);
  expect(onInactive.mock.calls[0]?.[1]).toContain("modes");
});

it("keeps ESS client activation narrow while retaining broad denial readings", () => {
  for (const agent of [
    "PublicAgent",
    "AuthenticatedAgent",
    "OwnerAgent",
    "CreatorAgent",
    stranger,
  ]) {
    for (const attribute of ["client", "issuer", "vc"]) {
      const { dataset, n } = graph();
      n("urn:policy").add(`${ACP}allow`, `${ACP}Read`);
      n("urn:policy").add(`${ACP}deny`, `${ACP}Read`);
      n("urn:matcher").add(`${ACP}agent`, agent === stranger ? agent : ACP + agent);
      n("urn:matcher").add(
        ACP + attribute,
        attribute === "client" ? `${ACP}PublicClient` : "urn:condition",
      );
      const read = readAcp(dataset, resource, url, "ess");
      if (attribute === "client") {
        expect(
          read.grants[0]?.who[0]?.some((s) =>
            ["authenticated", "agent", "owner", "creator"].includes(s.kind),
          ),
        ).toBe(true);
      } else expect(read.grants[0]?.who).toEqual([]);
      expect(read.denials[0]?.who.flat().some((s) => s.kind === "issuer" || s.kind === "vc")).toBe(
        false,
      );
    }
  }
  for (const attribute of ["client", "issuer", "vc"]) {
    const { dataset, n } = graph();
    n("urn:policy").add(`${ACP}allow`, `${ACP}Read`);
    n("urn:policy").add(`${ACP}deny`, `${ACP}Read`);
    n("urn:matcher").add(ACP + attribute, "urn:condition");
    expect(readAcp(dataset, resource, url, "ess").grants[0]?.who).toEqual([]);
  }
});

it("never turns uncertain or conjunctive denial exemptions into broader exceptions", () => {
  for (const dialect of ["css", "ess"] as const) {
    for (const exclusion of ["issuer", "vc", "client", "owner", "creator", "agent"]) {
      const { dataset, n } = graph();
      n("urn:policy").add(`${ACP}deny`, `${dialect === "css" ? ACL : ACP}Read`);
      n("urn:matcher").add(`${ACP}agent`, `${ACP}PublicAgent`);
      n("urn:policy").add(`${ACP}noneOf`, "urn:excluded");
      n("urn:excluded").add(
        `${ACP}agent`,
        exclusion === "owner"
          ? `${ACP}OwnerAgent`
          : exclusion === "creator"
            ? `${ACP}CreatorAgent`
            : stranger,
      );
      if (["client", "issuer", "vc"].includes(exclusion))
        n("urn:excluded").add(ACP + exclusion, "urn:condition");
      if (exclusion === "client") {
        expect(() => readAcp(dataset, resource, url, dialect)).toThrow("Conjunctive");
      } else if (["issuer", "vc"].includes(exclusion) && dialect === "css") {
        expect(() => readAcp(dataset, resource, url, dialect)).toThrow("Conjunctive");
      } else {
        const onInactive = vi.fn();
        const read = readAcp(dataset, resource, url, dialect, false, onInactive);
        expect(read.denials[0]?.except).toEqual(
          exclusion === "agent" ? [{ kind: "agent", webId: stranger }] : [],
        );
        if (dialect === "ess" && ["issuer", "vc"].includes(exclusion))
          expect(onInactive).toHaveBeenCalled();
      }
    }
  }
});

it("writes ESS Control separately for resource, member and combined scopes", async () => {
  for (const appliesTo of ["resource", "members", "both"] as const) {
    const input = policy(
      grant([[{ kind: "agent", webId: stranger }]], { modes: new Set(["control"]), appliesTo }),
    );
    const turtle = await writeAcp(input, resource, url, "ess");
    const dataset = await parseRdf(turtle, "text/turtle", { baseIRI: url });
    const read = readAcp(dataset, resource, url, "ess", true);
    expect(read.grants.some((g) => g.modes.has("control"))).toBe(true);
    expect([...dataset.match(null, DataFactory.namedNode(`${ACP}access`))].length > 0).toBe(
      appliesTo !== "members",
    );
    expect([...dataset.match(null, DataFactory.namedNode(`${ACP}memberAccess`))].length > 0).toBe(
      appliesTo !== "resource",
    );
  }
});

it("requires login for ESS grants when the client restriction is only in noneOf", () => {
  const { dataset, n } = graph();
  n("urn:policy").add(`${ACP}allow`, `${ACP}Read`);
  n("urn:policy").add(`${ACP}deny`, `${ACP}Read`);
  n("urn:matcher").add(`${ACP}agent`, `${ACP}PublicAgent`);
  n("urn:policy").add(`${ACP}noneOf`, "urn:excluded");
  n("urn:excluded").add(`${ACP}agent`, `${ACP}PublicAgent`);
  n("urn:excluded").add(`${ACP}client`, "urn:client");
  const read = readAcp(dataset, resource, url, "ess");
  expect(read.grants[0]?.who).toEqual([[{ kind: "authenticated" }]]);
  expect(read.denials[0]?.except).toEqual([]);
});

it("retains a resource-only WAC scope without granting member defaults", async () => {
  const dataset = await parseRdf(
    await writeWac(ownerPolicy(stranger), resource, url),
    "text/turtle",
    { baseIRI: url },
  );
  expect(readWac(dataset, resource, url).grants[0]?.appliesTo).toBe("resource");
});
