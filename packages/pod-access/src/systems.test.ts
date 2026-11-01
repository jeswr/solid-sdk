// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { grant, policy, stranger } from "../test/helpers.js";
import { emptyPolicy, ownerPolicy, policiesEqual, scopePolicy, unionPolicies } from "./policy.js";
import { ACL, ACP, modeIri, RDF, RdfNode, readModes, safeIri, serialize } from "./rdf.js";
import { PolicyTooComplex, readAcp, writeAcp } from "./systems/acp.js";
import { readWac, writeWac } from "./systems/wac.js";
import type { Subject } from "./types.js";

const resource = "https://pod.example/folder/";
const url = `${resource}.acl`;
async function parsed(turtle: string) {
  return parseRdf(turtle, "text/turtle", { baseIRI: url });
}
function graph() {
  const dataset = new Store();
  const node = (id: string, properties: Record<string, string[]> = {}) => {
    const result = new RdfNode(id, dataset, DataFactory);
    for (const [key, values] of Object.entries(properties))
      for (const value of values) result.add(key, value);
    return result;
  };
  return { dataset, node };
}
describe("RDF and WAC", () => {
  it("reads every WAC scope, origin and subject with Write implying Append", async () => {
    const subjects: Subject[][] = [
      [
        { kind: "agent", webId: stranger },
        { kind: "origin", origin: "https://app.example" },
      ],
      [{ kind: "public" }],
      [{ kind: "authenticated" }],
      [{ kind: "group", group: "urn:group" }],
    ];
    const source = policy(
      grant(subjects, {
        modes: new Set(["write", "append", "read", "control"]),
        appliesTo: "both",
      }),
    );
    await expect(writeWac(source, resource, url)).rejects.toThrow("origin restrictions");
    const turtle = await writeWac(
      policy(
        grant(
          subjects.map((clause) => clause.filter((s) => s.kind !== "origin")),
          {
            modes: new Set(["write", "append", "read", "control"]),
            appliesTo: "both",
          },
        ),
      ),
      resource,
      url,
    );
    const dataset = await parsed(turtle);
    new RdfNode(`${url}#authorization-0`, dataset, DataFactory).add(
      `${ACL}origin`,
      "https://app.example",
    );
    const read = readWac(dataset, resource, url);
    for (const scope of ["resource", "members"] as const)
      expect(policiesEqual(scopePolicy(source, scope), scopePolicy(read, scope))).toBe(true);
    expect(read.grants[0]?.appliesTo).toBe("both");
    expect(readWac(dataset, "https://unrelated.example/", url)).toEqual(emptyPolicy());
    const member = await writeWac(
      policy(grant(undefined, { appliesTo: "members" })),
      resource,
      url,
    );
    expect(readWac(await parsed(member), resource, url).grants[0]?.appliesTo).toBe("members");
    expect(readModes([modeIri("write")])).toEqual(new Set(["write", "append"]));
  });
  it("recognizes defaultForNew and refuses unsupported or malformed classes", async () => {
    const { node, dataset } = graph();
    node(`${url}#auth`, {
      [`${RDF}type`]: [`${ACL}Authorization`],
      [`${ACL}defaultForNew`]: [resource],
      [`${ACL}agentClass`]: ["urn:unknown-class"],
      [`${ACL}mode`]: [`${ACL}Read`],
    });
    expect(() => readWac(dataset, resource, url)).toThrow("NSS");
    expect(() => readWac(dataset, resource, url, "nss")).toThrow("class");
    const malformed = await parsed(
      '@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#a> a acl:Authorization; acl:accessTo <https://pod.example/folder/>; acl:mode "Read".',
    );
    expect(() => readWac(malformed, resource, url)).toThrow();
  });
  it("refuses unrepresentable WAC graphs and unsafe IRIREFs", async () => {
    await expect(writeWac({ grants: [], denials: [grant()] }, resource, url)).rejects.toThrow(
      "denials",
    );
    await expect(
      writeWac(policy(grant(undefined, { except: [{ kind: "public" }] })), resource, url),
    ).rejects.toThrow("exclusions");
    await expect(
      writeWac(policy(grant([[{ kind: "public" }, { kind: "authenticated" }]])), resource, url),
    ).rejects.toThrow("one principal");
    await expect(
      writeWac(policy(grant([[{ kind: "client", clientId: "urn:client" }]])), resource, url),
    ).rejects.toThrow("Unsupported");
    expect(() => safeIri("https://pod.example/> <urn:forged> <urn:p> <urn:o>")).toThrow();
    expect(() => safeIri("relative")).toThrow();
    expect(safeIri("urn:okay")).toBe("urn:okay");
    const dataset = await parsed('<urn:a> <urn:p> "literal".');
    expect(await serialize(dataset)).toContain('"literal"');
    const { dataset: unsafe, node } = graph();
    node("urn:x").add("urn:p", "urn:okay");
    unsafe.addQuad(
      DataFactory.namedNode("urn:a>bad"),
      DataFactory.namedNode("urn:p"),
      DataFactory.literal("value"),
    );
    expect(() => serialize(unsafe)).toThrow("Unsafe");
    const bad = await parsed('<urn:x> <urn:p> "not a node".');
    expect(() => new RdfNode("urn:x", bad, DataFactory).nodes("urn:p")).toThrow("node required");
  });
});

describe("ACP expressions and writers", () => {
  it("round-trips every supported subject, condition, exclusion, denial and scope in CSS and ESS dialects", async () => {
    for (const dialect of ["css", "ess"] as const) {
      const subjects: Subject[] = [
        { kind: "agent", webId: stranger },
        { kind: "public" },
        { kind: "authenticated" },
        ...(dialect === "ess" ? ([{ kind: "owner" }, { kind: "creator" }] as Subject[]) : []),
        { kind: "client", clientId: "urn:client" },
        ...(dialect === "css" ? ([{ kind: "issuer", issuer: "urn:issuer" }] as Subject[]) : []),
      ];
      const source = unionPolicies(
        dialect === "css"
          ? ownerPolicy(stranger, true)
          : unionPolicies(
              ownerPolicy(stranger),
              policy(
                grant([[{ kind: "agent", webId: stranger }]], {
                  modes: new Set(["read", "write", "append"]),
                  appliesTo: "members",
                }),
              ),
            ),
        policy(
          grant(
            subjects.map((s) => [s]),
            { appliesTo: "members", except: [{ kind: "agent", webId: "urn:excluded" }] },
          ),
        ),
      );
      source.denials.push(
        grant([[{ kind: "client", clientId: "urn:client" }]], {
          modes: new Set(["control"]),
          appliesTo: dialect === "css" ? "both" : "resource",
          except: [{ kind: "agent", webId: "urn:excluded-control" }],
        }),
      );
      const turtle = await writeAcp(source, resource, url, dialect);
      const dataset = await parsed(turtle);
      const actual = readAcp(dataset, resource, url, dialect);
      for (const scope of ["resource", "members"] as const)
        expect(policiesEqual(scopePolicy(source, scope), scopePolicy(actual, scope))).toBe(true);
      expect(turtle.includes("acr-policy")).toBe(dialect === "ess");
    }
    await expect(
      writeAcp(policy(grant([[{ kind: "group", group: "urn:group" }]])), resource, url),
    ).rejects.toThrow("Unsupported");
    await expect(
      writeAcp(
        policy(grant([[{ kind: "origin", origin: "https://origin.example" }]])),
        resource,
        url,
      ),
    ).rejects.toThrow("Unsupported");
  });
  it("ANDs attributes and allOf matchers, ORs anyOf values, and flattens simple noneOf", () => {
    const { dataset, node } = graph();
    node(url, { [`${ACP}resource`]: [resource], [`${ACP}accessControl`]: ["urn:control"] });
    node("urn:control", { [`${ACP}apply`]: ["urn:policy"] });
    node("urn:policy", {
      [`${ACP}allow`]: [`${ACL}Read`],
      [`${ACP}deny`]: [`${ACL}Write`],
      [`${ACP}allOf`]: ["urn:a"],
      [`${ACP}anyOf`]: ["urn:b", "urn:c"],
      [`${ACP}noneOf`]: ["urn:d"],
    });
    node("urn:a", {
      [`${ACP}agent`]: [stranger, `${ACP}AuthenticatedAgent`],
      [`${ACP}client`]: ["urn:client"],
    });
    node("urn:b", { [`${ACP}issuer`]: ["urn:issuer"] });
    node("urn:c", { [`${ACP}vc`]: ["urn:vc"] });
    node("urn:d", { [`${ACP}agent`]: ["urn:excluded"] });
    const result = readAcp(dataset, resource, url);
    expect(result.grants[0]?.who).toHaveLength(2);
    expect(result.grants[0]?.who.flat().some((subject) => subject.kind === "vc")).toBe(false);
    expect(result.grants[0]?.who.every((c) => c.length === 3)).toBe(true);
    expect(result.grants[0]?.except).toEqual([{ kind: "agent", webId: "urn:excluded" }]);
    expect(result.denials[0]?.modes).toEqual(new Set(["write", "append"]));
    const onlyNone = graph();
    onlyNone.node(url, { [`${ACP}resource`]: [resource], [`${ACP}accessControl`]: ["urn:c"] });
    onlyNone.node("urn:c", { [`${ACP}apply`]: ["urn:p"] });
    onlyNone.node("urn:p", { [`${ACP}allow`]: [`${ACL}Read`], [`${ACP}noneOf`]: ["urn:no"] });
    expect(readAcp(onlyNone.dataset, resource, url)).toEqual({ ...emptyPolicy(), explicit: true });
  });
  it("uses the ESS typed ACR fallback, empty matchers grant nothing, and bounds expansion", () => {
    const { dataset, node } = graph();
    node(url, {
      [`${RDF}type`]: [`${ACP}AccessControlResource`],
      [`${ACP}accessControl`]: ["urn:control"],
    });
    node("urn:control", { [`${ACP}apply`]: ["urn:policy"] });
    const p = node("urn:policy", {
      [`${ACP}allow`]: [`${ACP}Read`],
      [`${ACP}allOf`]: ["urn:matcher"],
    });
    expect(() => readAcp(dataset, resource, url)).toThrow("ESS");
    expect(readAcp(dataset, resource, url, "ess").grants[0]?.who).toEqual([]);
    const matcher = node("urn:matcher", { [`${ACP}agent`]: [`${ACP}PublicAgent`] });
    expect(readAcp(dataset, resource, url, "ess").grants[0]?.who).toEqual([[{ kind: "public" }]]);
    p.add(`${ACP}noneOf`, "urn:exclusion");
    node("urn:exclusion", { [`${ACP}agent`]: [stranger], [`${ACP}client`]: ["urn:client"] });
    expect(() => readAcp(dataset, resource, url, "ess")).toThrow(PolicyTooComplex);
    for (const q of [
      ...dataset.match(DataFactory.namedNode("urn:policy"), DataFactory.namedNode(`${ACP}noneOf`)),
    ])
      dataset.delete(q);
    for (let i = 0; i < 65; i++) matcher.add(`${ACP}agent`, `urn:agent-${i}`);
    expect(() => readAcp(dataset, resource, url)).toThrow("64 clauses");
  });
});
