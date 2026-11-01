// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import { describe, expect, it } from "vitest";
import { grant, policy } from "../../test/helpers.js";
import {
  bob,
  fixture,
  manager,
  memoryAccess,
  owner,
  required,
  resource,
  root,
  selection,
} from "../../test/roles-helpers.js";
import { readAcp, writeAcp } from "../index.js";
import { ACL, ACP, modeIri, serialize } from "../rdf.js";
import type { Mode } from "../types.js";
import { addGrant, grantsWithRoles, readGrants, removeGrant, setGrants } from "./index.js";
import { properties, roots } from "./rdf.js";

const nn = DataFactory.namedNode;
const endpoint = `${resource}.acr`;
const parent = `${root}folder/`;
const carol = { type: "webid" as const, id: "https://carol.example/#me" };
const app = { type: "app" as const, id: "https://app.example/" };
async function acp(
  modes: Mode[] = ["read"],
  implementation: "css" | "ess" = "css",
  url = resource,
  members = false,
) {
  if (implementation === "css") {
    const data = await parseRdf(
      await fixture("acp", url, [manager, selection()], members),
      "text/turtle",
    );
    for (const p of bobPolicies(data)) {
      p.values(`${ACP}allow`).clear();
      for (const mode of modes) p.add(`${ACP}allow`, modeIri(mode));
    }
    return serialize(data);
  }
  return writeAcp(
    policy(
      grant([[{ kind: "agent", webId: owner }]], {
        modes: new Set(["read", "write", "append", "control"]),
        appliesTo: members ? "both" : "resource",
      }),
      grant([[{ kind: "agent", webId: bob }]], {
        modes: new Set(modes),
        appliesTo: members ? "both" : "resource",
      }),
    ),
    url,
    `${url}.acr`,
    implementation,
  );
}
function bobPolicies(data: Store) {
  const matcher = required([...data.match(null, nn(`${ACP}agent`), nn(bob))][0]).subject;
  return [...data.match(null, nn(`${ACP}allOf`), matcher)].map((q) => properties(q.subject, data));
}

describe("review round 1 regressions", () => {
  it.each([
    "set",
    "add",
    "remove",
  ] as const)("%s edits canonical ESS roots without resource bindings", async (operation) => {
    const mem = memoryAccess("acp");
    const data = await parseRdf(await acp(["read"], "ess"), "text/turtle");
    properties(nn(endpoint), data).values(`${ACP}resource`).clear();
    mem.attach(resource, await serialize(data));
    const options = { ...mem.options, implementation: "ess" as const, webId: owner };
    const result =
      operation === "set"
        ? await setGrants([resource], [manager, selection("editor")], options)
        : operation === "add"
          ? await addGrant([resource], selection("editor"), options)
          : await removeGrant([resource], selection().agent, options);
    expect(result.failed).toEqual([]);
    expect(mem.writes()).toHaveLength(1);
    const grants = await grantsWithRoles(resource, options);
    expect(grants).toContainEqual({ ...manager, source: endpoint });
    const bobGrant = grants.find((g) => g.agent.type === "webid" && g.agent.id === bob);
    if (operation === "remove") expect(bobGrant).toBeUndefined();
    else expect(bobGrant).toEqual({ ...selection("editor"), source: endpoint });
  });

  it.each([
    false,
    true,
  ])("inherited rows never overwrite direct edits (reverse=%s)", async (reverse) => {
    const mem = memoryAccess("acp");
    mem.attach(resource, await fixture("acp", resource, [manager, selection("editor")]));
    mem.attach(parent, await fixture("acp", parent, [selection()], true));
    const snapshot = await readGrants(resource, mem.options);
    const grants = snapshot.grants.map((g) =>
      g.agent.type === "webid" && g.agent.id === bob && !g.inherited
        ? { ...g, role: "viewer" as const }
        : g,
    );
    if (reverse) grants.reverse();
    expect(
      (await setGrants([resource], grants, { ...mem.options, webId: owner, expected: snapshot }))
        .failed,
    ).toEqual([]);
    expect(mem.writes()).toHaveLength(1);
    const data = await parseRdf(required(mem.docs.get(endpoint)).body, "text/turtle");
    expect(bobPolicies(data).some((p) => p.iris(`${ACP}allow`).includes(`${ACL}Write`))).toBe(
      false,
    );
  });

  it.each([
    "client",
    "active-client",
    "authenticated",
  ] as const)("refuses an unrepresentable allOf %s conjunction on every API", async (condition) => {
    const mem = memoryAccess("acp");
    const data = await parseRdf(await acp(["read"], "ess"), "text/turtle");
    const extra = properties(nn("urn:extra-matcher"), data);
    if (condition === "authenticated") extra.add(`${ACP}agent`, `${ACP}AuthenticatedAgent`);
    if (condition !== "authenticated") extra.add(`${ACP}client`, app.id);
    if (condition === "active-client") extra.add(`${ACP}agent`, `${ACP}PublicAgent`);
    for (const p of bobPolicies(data)) p.terms(`${ACP}allOf`).add(extra as Term);
    const body = await serialize(data);
    mem.attach(resource, body);
    const options = { ...mem.options, implementation: "ess" as const, webId: owner };
    await expect(readGrants(resource, options)).rejects.toThrow();
    for (const result of [
      await setGrants([resource], [manager, selection("viewer", carol)], options),
      await addGrant([resource], selection("viewer", carol), options),
      await removeGrant([resource], carol, options),
    ])
      expect(result.failed).toHaveLength(1);
    expect(mem.writes()).toHaveLength(0);
    expect(mem.docs.get(endpoint)?.body).toBe(body);
  });

  for (const model of ["wac", "acp"] as const)
    it.each([
      "editor",
      "manager",
    ] as const)(`${model} preserves raw modes of an unchanged chatroom %s`, async (bobRole) => {
      const mem = memoryAccess(model);
      const suffix = model === "wac" ? ".acl" : ".acr";
      mem.attach(resource, await fixture(model, resource, [manager, selection(bobRole)]));
      const body = required(mem.docs.get(resource + suffix)).body;
      const options = { ...mem.options, webId: owner, kind: "chatroom" as const };
      const snapshot = await readGrants(resource, options);
      expect(
        (await setGrants([resource], snapshot.grants, { ...options, expected: snapshot })).failed,
      ).toEqual([]);
      expect(mem.writes()).toHaveLength(0);
      expect(mem.docs.get(resource + suffix)?.body).toBe(body);
      // Editing another principal must also preserve Bob's existing Write.
      expect(
        (await setGrants([resource], [...snapshot.grants, selection("viewer", carol)], options))
          .failed,
      ).toEqual([]);
      const data = await parseRdf(required(mem.docs.get(resource + suffix)).body, "text/turtle");
      const hasBobWrite =
        model === "acp"
          ? bobPolicies(data).some((p) => p.iris(`${ACP}allow`).includes(`${ACL}Write`))
          : [...data.match(null, nn(`${ACL}agent`), nn(bob))].some((q) =>
              properties(q.subject, data).iris(`${ACL}mode`).includes(`${ACL}Write`),
            );
      expect(hasBobWrite).toBe(true);
      expect(
        (await grantsWithRoles(resource, options)).find(
          (g) => g.agent.type === "webid" && g.agent.id === bob,
        )?.role,
      ).toBe(bobRole);
    });

  it("writes CSS managers as resource Control, independently of the role reader", async () => {
    const mem = memoryAccess("acp");
    mem.attach(resource, await fixture("acp"));
    const options = { ...mem.options, implementation: "css" as const, webId: owner };
    expect((await addGrant([resource], selection("manager"), options)).failed).toEqual([]);
    const data = await parseRdf(required(mem.docs.get(endpoint)).body, "text/turtle");
    const p = required(bobPolicies(data)[0]);
    expect(p.iris(`${ACP}allow`)).toContain(`${ACL}Control`);
    expect(data.match(null, nn(`${ACP}access`)).size).toBe(0);
    const effective = readAcp(data, resource, endpoint, "css");
    expect(
      effective.grants.some(
        (g) =>
          g.who.some((c) => c.some((s) => s.kind === "agent" && s.webId === bob)) &&
          g.modes.has("control"),
      ),
    ).toBe(true);
    expect((await addGrant([resource], selection("manager"), options)).failed).toEqual([]);
    expect(mem.writes()).toHaveLength(1);
  });

  it("reads actual CSS resource Control as manager", async () => {
    const mem = memoryAccess("acp");
    mem.attach(
      resource,
      await writeAcp(
        policy(
          grant([[{ kind: "agent", webId: bob }]], {
            modes: new Set(["read", "write", "control"]),
          }),
        ),
        resource,
        endpoint,
        "css",
      ),
    );
    expect(await grantsWithRoles(resource, mem.options)).toContainEqual({
      ...selection("manager"),
      source: endpoint,
    });
  });

  it.each([
    "set",
    "add",
  ] as const)("%s writes ESS managers through separate ACR Read+Write", async (operation) => {
    const mem = memoryAccess("acp");
    mem.attach(resource, await acp(["read"], "ess"));
    const options = { ...mem.options, implementation: "ess" as const, webId: owner };
    const result =
      operation === "set"
        ? await setGrants([resource], [manager, selection("manager")], options)
        : await addGrant([resource], selection("manager"), options);
    expect(result.failed).toEqual([]);
    const data = await parseRdf(required(mem.docs.get(endpoint)).body, "text/turtle");
    const policies = bobPolicies(data);
    expect(policies).toHaveLength(2);
    expect(policies.every((p) => !p.iris(`${ACP}allow`).includes(`${ACP}Control`))).toBe(true);
    const management = properties(nn(endpoint), data).nodes(`${ACP}access`);
    expect(management.some((p) => policies.some((b) => b.equals(p as Term)))).toBe(true);
    expect(await grantsWithRoles(resource, options)).toContainEqual({
      ...selection("manager"),
      source: endpoint,
    });
  });

  it.each([
    "access",
    "memberAccess",
    "unbound",
  ] as const)("refuses CSS-inactive ESS %s management shapes", async (shape) => {
    const mem = memoryAccess("acp");
    const data = await parseRdf(await acp(), "text/turtle");
    const binding = properties(required(roots(data)[0]) as Term, data);
    if (shape === "unbound") {
      const canonical = properties(nn(endpoint), data);
      for (const q of [...data.match(binding as Term)]) {
        if (q.predicate.value !== `${ACP}resource`)
          canonical.terms(q.predicate.value).add(q.object);
        binding.terms(q.predicate.value).clear();
      }
    } else binding.terms(ACP + shape).add(required(bobPolicies(data)[0]) as Term);
    mem.attach(resource, await serialize(data));
    await expect(readGrants(resource, mem.options)).rejects.toThrow("CSS");
    expect(
      (await addGrant([resource], selection("viewer", carol), { ...mem.options, webId: owner }))
        .failed,
    ).toHaveLength(1);
    expect(mem.writes()).toHaveLength(0);
  });

  it.each([
    false,
    true,
  ])("combines ACP modes across sources before projecting (inherited Read=%s)", async (inheritedRead) => {
    const mem = memoryAccess("acp");
    mem.attach(resource, await acp(inheritedRead ? ["write"] : ["read"]));
    mem.attach(parent, await acp(inheritedRead ? ["read"] : ["write"], "css", parent, true));
    const options = { ...mem.options, webId: owner };
    const snapshot = await readGrants(resource, options);
    const bobRows = snapshot.grants.filter((g) => g.agent.type === "webid" && g.agent.id === bob);
    expect(bobRows).toEqual([
      { ...selection("editor"), source: endpoint },
      { ...selection("editor"), inherited: true, source: `${parent}.acr` },
    ]);
    expect(
      (await setGrants([resource], snapshot.grants, { ...options, expected: snapshot })).failed,
    ).toEqual([]);
    expect((await addGrant([resource], selection("editor"), options)).failed).toEqual([]);
    expect(mem.writes()).toHaveLength(0);
    expect(
      (await setGrants([resource], [...snapshot.grants, selection("viewer", carol)], options))
        .failed,
    ).toEqual([]);
    expect(mem.writes()).toHaveLength(1);
    expect(
      (await removeGrant([resource], selection().agent, options)).failed[0]?.error,
    ).toMatchObject({ code: "inherited-grant" });
  });

  it.each([
    resource,
    parent,
  ])("refuses CSS-effective member controls under a foreign binding in %s", async (location) => {
    const mem = memoryAccess("acp");
    mem.attach(resource, await fixture("acp"));
    const data = await parseRdf(await acp(["read"], "css", location), "text/turtle");
    const foreign = properties(nn("urn:foreign-root"), data);
    foreign.add(`${ACP}resource`, "urn:another");
    const control = properties(nn("urn:foreign-control"), data);
    const p = properties(nn("urn:foreign-policy"), data);
    const matcher = properties(nn("urn:foreign-matcher"), data);
    foreign.terms(`${ACP}memberAccessControl`).add(control as Term);
    control.terms(`${ACP}apply`).add(p as Term);
    p.add(`${ACP}allow`, `${ACL}Write`);
    p.terms(`${ACP}allOf`).add(matcher as Term);
    matcher.add(`${ACP}agent`, `${ACP}PublicAgent`);
    mem.attach(location, await serialize(data));
    await expect(readGrants(resource, mem.options)).rejects.toThrow("member");
    expect(
      (await addGrant([resource], selection("viewer", carol), { ...mem.options, webId: owner }))
        .failed,
    ).toHaveLength(1);
    expect(mem.writes()).toHaveLength(0);
  });

  it("refuses an ancestor accessControl bound back to the selected child on CSS", async () => {
    const mem = memoryAccess("acp");
    mem.attach(resource, await fixture("acp"));
    mem.attach(
      parent,
      await writeAcp(
        policy(
          grant([[{ kind: "public" }]], {
            modes: new Set(["read", "write"]),
          }),
        ),
        resource,
        "urn:child-binding",
        "css",
      ),
    );
    await expect(readGrants(resource, mem.options)).rejects.toThrow("binding");
    expect(
      (await setGrants([resource], [manager, selection()], { ...mem.options, webId: owner }))
        .failed,
    ).toHaveLength(1);
    expect(mem.writes()).toHaveLength(0);
  });

  it.each([
    "set",
    "add",
    "remove",
  ] as const)("%s preserves CSS-inactive ACR-self controls without projecting them", async (operation) => {
    const mem = memoryAccess("acp");
    const self = await writeAcp(
      policy(
        grant([[{ kind: "agent", webId: bob }]], {
          modes: new Set(["read", "write"]),
        }),
      ),
      endpoint,
      "urn:self-binding",
      "css",
    );
    mem.attach(resource, `${await fixture("acp", resource, [manager, selection()])}\n${self}`);
    const options = { ...mem.options, webId: owner };
    expect(await grantsWithRoles(resource, options)).toContainEqual({
      ...selection(),
      source: endpoint,
    });
    const result =
      operation === "set"
        ? await setGrants([resource], [manager, selection("editor")], options)
        : operation === "add"
          ? await addGrant([resource], selection("editor"), options)
          : await removeGrant([resource], selection().agent, options);
    expect(result.failed).toEqual([]);
    const after = await parseRdf(required(mem.docs.get(endpoint)).body, "text/turtle");
    const original = await parseRdf(self, "text/turtle");
    expect([...original].every((q) => after.has(q))).toBe(true);
    expect(mem.writes()).toHaveLength(1);
  });

  it.each([
    "css",
    "ess",
  ] as const)("refuses inactive %s mode vocabulary before projection or mutation", async (implementation) => {
    const mem = memoryAccess("acp");
    const data = await parseRdf(await acp(["read"], implementation), "text/turtle");
    const p = required(bobPolicies(data)[0]);
    p.values(`${ACP}allow`).clear();
    p.add(`${ACP}allow`, `${implementation === "css" ? ACP : ACL}Read`);
    for (const matcher of p.nodes(`${ACP}allOf`)) {
      const node = properties(matcher as Term, data);
      node.values(`${ACP}agent`).clear();
      node.add(`${ACP}agent`, `${ACP}PublicAgent`);
    }
    mem.attach(resource, await serialize(data));
    const options = { ...mem.options, implementation, webId: owner };
    await expect(readGrants(resource, options)).rejects.toThrow("mode");
    expect(
      (await setGrants([resource], [manager, selection("viewer", carol)], options)).failed,
    ).toHaveLength(1);
    expect(mem.writes()).toHaveLength(0);
  });

  it.each([
    "css",
    "ess",
  ] as const)("refuses special %s clients instead of presenting wildcard access as an app grant", async (implementation) => {
    const mem = memoryAccess("acp");
    const data = await parseRdf(await acp(["read"], implementation), "text/turtle");
    const p = required(bobPolicies(data)[0]);
    for (const matcher of p.nodes(`${ACP}allOf`)) {
      const node = properties(matcher as Term, data);
      node.values(`${ACP}agent`).clear();
      node.add(`${ACP}agent`, `${ACP}PublicAgent`);
      node.add(`${ACP}client`, `${ACP}PublicClient`);
    }
    mem.attach(resource, await serialize(data));
    const options = { ...mem.options, implementation, webId: owner };
    await expect(readGrants(resource, options)).rejects.toThrow("special ACP client");
    expect((await addGrant([resource], selection("viewer", carol), options)).failed).toHaveLength(
      1,
    );
    expect(mem.writes()).toHaveLength(0);
  });

  it.each([
    "set",
    "add",
  ] as const)("%s activates ESS app matchers before reporting success and replaying", async (operation) => {
    const mem = memoryAccess("acp");
    // Use ESS fixtures for the trusted ESS assertion.
    mem.attach(resource, await acp(["read"], "ess"));
    const options = { ...mem.options, implementation: "ess" as const, webId: owner };
    const apply = () =>
      operation === "add"
        ? addGrant([resource], selection("viewer", app), options)
        : setGrants([resource], [manager, selection(), selection("viewer", app)], options);
    expect((await apply()).failed).toEqual([]);
    const data = await parseRdf(required(mem.docs.get(endpoint)).body, "text/turtle");
    const matcher = properties(
      required([...data.match(null, nn(`${ACP}client`), nn(app.id))][0]).subject,
      data,
    );
    expect(matcher.iris(`${ACP}agent`)).toEqual([`${ACP}PublicAgent`]);
    expect(
      readAcp(data, resource, endpoint, "ess").grants.some(
        (g) =>
          g.who.some((c) => c.some((s) => s.kind === "client" && s.clientId === app.id)) &&
          g.modes.has("read"),
      ),
    ).toBe(true);
    expect(await grantsWithRoles(resource, options)).toContainEqual({
      ...selection("viewer", app),
      source: endpoint,
    });
    expect((await apply()).failed).toEqual([]);
    expect(mem.writes()).toHaveLength(1);
    expect((await removeGrant([resource], app, options)).failed).toEqual([]);
    expect((await grantsWithRoles(resource, options)).some((g) => g.agent.type === "app")).toBe(
      false,
    );
  });
});
