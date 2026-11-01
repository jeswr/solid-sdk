// AUTHORED-BY Codex

import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
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
import { ACL, ACP, RDF, serialize } from "../rdf.js";
import { load, scoped } from "./http.js";
import { grantsWithRoles, modesToRole, rolesToModes, setGrants } from "./index.js";
import * as roleRdf from "./rdf.js";
import { appendAcp, properties, readPolicy, roots, subjectAgent } from "./rdf.js";

const nn = DataFactory.namedNode;
const aclUrl = `${resource}.acl`;
const acrUrl = `${resource}.acr`;
async function acpDataset() {
  return parseRdf(await fixture("acp"), "text/turtle");
}
function nodeOf(dataset: Store, predicate: string) {
  return properties(required([...dataset.match(null, nn(predicate))][0]).subject, dataset);
}
describe("bounded discovery and hostile transports", () => {
  it.each([
    "https://elsewhere.example/secret",
    `${root}file?x`,
    `${root}file#x`,
    "ftp://pod.example/file",
    "https://user:pass@pod.example/file",
    `${root}encoded%2f../escape`,
  ])("checks access scope before fetching %s", async (url) => {
    // Encoded traversal must be refused along with authority/normalization ambiguity.
    const mem = memoryAccess();
    mem.heads.set(resource, { link: `<${url}>; rel=acl` });
    await expect(grantsWithRoles(resource, mem.options)).rejects.toBeDefined();
    expect(mem.writes()).toHaveLength(0);
  });
  it("handles relative, unquoted and multi-rel links, ignores unrelated/missing rels", async () => {
    const mem = memoryAccess();
    mem.heads.set(resource, {
      link: '<file.acl>; rel="acl alternate", <other>; title="comma, value", <meta>; rel=describedby',
    });
    mem.put(aclUrl, await fixture("wac"));
    expect(await grantsWithRoles(resource, { fetch: mem.fetch })).toHaveLength(1);
    expect(() => scoped(resource, `${root}folder`)).toThrow();
  });
  it.each([
    ['<file.acl>; rel=acl; anchor="https://pod.example/other"', "Anchored"],
    ["<a>; rel=acl, <b>; rel=acl", "Multiple"],
    ["<metadata>; rel=describedby", "no access"],
  ])("rejects ambiguous discovery %s", async (link, message) => {
    const mem = memoryAccess();
    mem.heads.set(resource, { link });
    await expect(grantsWithRoles(resource, mem.options)).rejects.toThrow(message);
  });
  it.each([true, false])("refuses redirect responses (%s)", async (redirected) => {
    const mem = memoryAccess();
    mem.intercept(() => {
      const res = new Response(null);
      Object.defineProperties(res, {
        redirected: { value: redirected },
        url: { value: "https://evil.example/" },
      });
      return res;
    });
    await expect(grantsWithRoles(resource, mem.options)).rejects.toMatchObject({ code: "scope" });
  });
  it("accepts the correct response URL and rejects read and write failures", async () => {
    const mem = memoryAccess();
    mem.attach(resource, await fixture("wac"));
    mem.intercept((url, init) => {
      if (init.method === "HEAD") {
        const res = new Response(null, { headers: mem.heads.get(url) });
        Object.defineProperty(res, "url", { value: url });
        return res;
      }
      if (init.method === "PUT") return new Response(null, { status: 503 });
      return undefined;
    });
    expect(
      (await setGrants([resource], [manager, selection()], { ...mem.options, webId: owner }))
        .failed[0]?.error,
    ).toMatchObject({ code: "invalid-response" });
    mem.intercept(() => new Response(null, { status: 403 }));
    await expect(grantsWithRoles(resource, mem.options)).rejects.toThrow("403");
    mem.intercept(() => {
      throw new Error("network");
    });
    expect((await setGrants([resource], [], { ...mem.options, webId: owner })).failed).toHaveLength(
      1,
    );
  });
  it("bounds bytes, quads, traversal, and refuses malformed or remote-context RDF", async () => {
    const mem = memoryAccess();
    mem.attach(resource);
    for (const body of [
      "x".repeat(1048577),
      Array.from({ length: 10001 }, (_, i) => `<urn:s${i}> <urn:p> <urn:o>.`).join("\n"),
      "<invalid turtle",
    ]) {
      mem.put(aclUrl, body);
      await expect(grantsWithRoles(resource, mem.options)).rejects.toBeDefined();
    }
    mem.docs.set(aclUrl, {
      body: '{"@context":"https://evil.example/context","@id":"https://evil.example/"}',
      etag: '"1"',
      type: "application/ld+json",
    });
    await expect(grantsWithRoles(resource, mem.options)).rejects.toBeDefined();
    expect(mem.calls.every((c) => c.url.startsWith(root))).toBe(true);
    const deep = `${root}${"a/".repeat(65)}file`;
    const deepMem = memoryAccess();
    deepMem.attach(deep);
    await expect(grantsWithRoles(deep, deepMem.options)).rejects.toThrow("64");
    const empty = memoryAccess();
    empty.attach(resource);
    empty.intercept((url) => (url === aclUrl ? new Response(null, { status: 200 }) : undefined));
    expect(await grantsWithRoles(resource, empty.options)).toEqual([]);
  });
  it("detects ACP from advertisement or content and refuses mixed documents/ancestors", async () => {
    for (const headers of [
      { link: `<${acrUrl}>; rel=acl, <${ACP}AccessControlResource>; rel=type` },
      { link: `<${acrUrl}>; rel="${ACP}accessControl"` },
    ]) {
      const mem = memoryAccess("acp");
      mem.heads.set(resource, headers);
      mem.put(acrUrl, await fixture("acp"));
      expect(await grantsWithRoles(resource, mem.options)).toHaveLength(1);
    }
    const mixed = memoryAccess();
    mixed.attach(resource, `${await fixture("wac")}\n${await fixture("acp")}`);
    await expect(grantsWithRoles(resource, mixed.options)).rejects.toThrow("Mixed");
    const ancestor = memoryAccess("acp");
    ancestor.attach(resource, await fixture("acp"));
    ancestor.attach(`${root}folder/`, await fixture("wac", `${root}folder/`));
    await expect(grantsWithRoles(resource, ancestor.options)).rejects.toThrow("Mixed ancestor");
    const advertised = memoryAccess();
    advertised.attach(resource);
    advertised.intercept((url) =>
      url === aclUrl
        ? new Response(null, {
            status: 404,
            headers: { link: `<${ACP}AccessControlResource>; rel=type` },
          })
        : undefined,
    );
    expect((await load(resource, advertised.options)).model).toBe("acp");
  });
});
describe("conditional refusal paths", () => {
  it("requires validators for replacements and copied defaults", async () => {
    const mem = memoryAccess();
    mem.attach(resource, await fixture("wac"));
    required(mem.docs.get(aclUrl)).etag = null;
    expect(
      (await setGrants([resource], [manager, selection()], { ...mem.options, webId: owner }))
        .failed[0]?.error,
    ).toMatchObject({ code: "precondition-required" });
    mem.docs.delete(aclUrl);
    const parent = `${root}folder/`;
    mem.attach(parent, await fixture("wac", parent, [manager], true));
    required(mem.docs.get(`${parent}.acl`)).etag = null;
    expect(
      (await setGrants([resource], [selection()], { ...mem.options, webId: owner })).failed[0]
        ?.error,
    ).toMatchObject({ code: "precondition-required" });
    expect(mem.writes()).toHaveLength(0);
  });
  it("refuses duplicate principals even when their source labels differ", async () => {
    const mem = memoryAccess();
    await expect(
      setGrants([resource], [manager, { ...manager, source: "different" }], {
        ...mem.options,
        webId: owner,
      }),
    ).rejects.toThrow("Duplicate");
    expect(mem.calls).toHaveLength(0);
  });
  it("detects stale ancestor/own discovery before any write", async () => {
    const mem = memoryAccess();
    mem.attach(resource, await fixture("wac"));
    let reads = 0;
    mem.intercept((url, init) => {
      if (url === aclUrl && init.method !== "HEAD" && init.method !== "PUT" && ++reads > 1)
        return new Response(required(mem.docs.get(aclUrl)).body, {
          headers: { etag: '"new"', "content-type": "text/turtle" },
        });
      return undefined;
    });
    expect(
      (await setGrants([resource], [manager, selection()], { ...mem.options, webId: owner }))
        .failed[0]?.error,
    ).toMatchObject({ code: "conflict" });
    expect(mem.writes()).toHaveLength(0);
  });
  it("stops a document's auxiliary writes after its first PUT fails", async () => {
    const mem = memoryAccess();
    const comments = `${root}comments/`;
    mem.attach(resource, await fixture("wac"));
    mem.attach(comments, await fixture("wac", comments));
    mem.intercept((url, init) =>
      url === aclUrl && init.method === "PUT" ? new Response(null, { status: 412 }) : undefined,
    );
    const result = await setGrants([resource], [manager, selection("commenter")], {
      ...mem.options,
      webId: owner,
      kind: "document",
      commentsContainer: comments,
    });
    expect(result.applied).toEqual([]);
    expect(mem.writes()).toHaveLength(1);
  });
  it("retains comment Write and refuses to remove it as Append", async () => {
    const mem = memoryAccess();
    const comments = `${root}comments/`;
    mem.attach(resource, await fixture("wac", resource, [manager, selection()]));
    mem.attach(comments, await fixture("wac", comments, [manager, selection("editor")]));
    const result = await setGrants([resource], [manager, selection()], {
      ...mem.options,
      webId: owner,
      commentsContainer: comments,
    });
    expect(result.failed[0]?.error).toMatchObject({ code: "unsupported" });
    expect(mem.writes()).toHaveLength(0);
  });
  it("checks serialization against requested access before persistence", async () => {
    const mem = memoryAccess();
    mem.attach(resource, await fixture("wac"));
    const real = roleRdf.readPolicy;
    let calls = 0;
    const spy = vi
      .spyOn(roleRdf, "readPolicy")
      .mockImplementation((...args) =>
        ++calls === 2 ? { grants: [], denials: [] } : real(...args),
      );
    try {
      expect(
        (await setGrants([resource], [manager, selection()], { ...mem.options, webId: owner }))
          .failed[0]?.error,
      ).toMatchObject({ code: "invalid-response" });
      expect(mem.writes()).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
describe("hostile policy shapes", () => {
  it("rejects malformed WAC and never uses foreign accessTo as a local grant", async () => {
    const mem = memoryAccess();
    const valid = await fixture("wac");
    mem.attach(resource, valid.replaceAll(`<${resource}>`, "<https://foreign.example/secret>"));
    expect(await grantsWithRoles(resource, mem.options)).toEqual([]);
    for (const body of [
      valid.replace(`${ACL}Read`, `${ACL}Unknown`),
      `${valid}\n<urn:s> <${ACL}unknown> <urn:o>.`,
      valid.replace(`<${owner}>`, '"literal"'),
      `${valid}\n<urn:g> { <urn:s> <urn:p> <urn:o>. }`,
    ]) {
      mem.attach(resource, body);
      if (body.includes("<urn:g>")) required(mem.docs.get(aclUrl)).type = "application/trig";
      await expect(grantsWithRoles(resource, mem.options)).rejects.toBeDefined();
    }
    const conditional = await parseRdf(valid, "text/turtle");
    nodeOf(conditional, `${ACL}mode`).add(`${ACL}origin`, "https://app.example/");
    mem.attach(resource, await serialize(conditional));
    await expect(grantsWithRoles(resource, mem.options)).rejects.toMatchObject({
      code: "unsupported",
    });
  });
  it.each([
    "deny",
    "noneOf",
    "extra",
    "conjoined",
    "special",
    "partial-acr",
    "control",
    "detached",
    "ambiguous",
    "unplaced",
  ])("rejects ACP %s", async (shape) => {
    const dataset = await acpDataset();
    const matcher = nodeOf(dataset, `${ACP}agent`);
    const policy = nodeOf(dataset, `${ACP}allow`);
    const rootNode = properties(required(roots(dataset)[0]), dataset);
    switch (shape) {
      case "deny":
        policy.add(`${ACP}deny`, `${ACL}Read`);
        break;
      case "noneOf":
        policy.terms(`${ACP}noneOf`).add(matcher as Term);
        break;
      case "extra":
        matcher.add("https://foreign.example/condition", "urn:condition");
        break;
      case "conjoined":
        matcher.add(`${ACP}client`, "urn:app");
        break;
      case "special":
        matcher.values(`${ACP}agent`).clear();
        matcher.add(`${ACP}agent`, `${ACP}OwnerAgent`);
        break;
      case "partial-acr": {
        const management = required(nodeOf(dataset, `${ACP}access`).nodes(`${ACP}access`)[0]);
        properties(management as Term, dataset)
          .values(`${ACP}allow`)
          .delete(`${ACL}Write`);
        break;
      }
      case "control":
        policy.add(`${ACP}allow`, `${ACL}Control`);
        break;
      case "detached":
        properties(nn("urn:detached"), dataset).add(`${ACP}agent`, owner);
        break;
      case "ambiguous":
        rootNode.add(`${ACP}resource`, "urn:other");
        break;
      case "unplaced":
        rootNode.values(`${ACP}resource`).clear();
        break;
    }
    const mem = memoryAccess("acp");
    mem.attach(resource, await serialize(dataset));
    await expect(grantsWithRoles(resource, mem.options)).rejects.toBeDefined();
    expect(mem.writes()).toHaveLength(0);
  });
  it("rejects invalid typed terms and unsupported neutral subjects", () => {
    const dataset = new Store();
    const p = properties(nn("urn:s"), dataset);
    p.terms("urn:p").add(DataFactory.literal("bad"));
    expect(() => [...p.values("urn:p")]).toThrow("IRI required");
    p.terms("urn:p").clear();
    p.add("urn:p", "urn:value");
    expect([...p.values("urn:p")]).toEqual(["urn:value"]);
    expect(() => subjectAgent({ kind: "owner" })).toThrow("richer");
    expect(() =>
      appendAcp(
        new Store(),
        resource,
        acrUrl,
        [{ agent: { type: "group", id: bob }, modes: new Set(["read"]) }],
        "css",
      ),
    ).toThrow("groups");
  });
  it("maps optional comment context conservatively", () => {
    expect(rolesToModes("commenter", "resource", {}).comments).toEqual([]);
    expect(
      modesToRole({ resource: ["read"], comments: ["write"], acr: [] }, "document", {
        commentsContainer: `${root}comments/`,
      }),
    ).toBe("commenter");
  });
});
it("refuses partial successful HTTP representations", async () => {
  const mem = memoryAccess();
  mem.attach(resource);
  mem.intercept((url) => (url === aclUrl ? new Response("", { status: 206 }) : undefined));
  await expect(grantsWithRoles(resource, mem.options)).rejects.toThrow("complete");
});
it("writes group, public and authenticated WAC rows without changing others", async () => {
  const mem = memoryAccess();
  mem.attach(resource, await fixture("wac"));
  const grants = [
    manager,
    selection("viewer", { type: "group", id: "urn:group" }),
    selection("viewer", { type: "public" }),
    selection("editor", { type: "authenticated" }),
  ];
  expect((await setGrants([resource], grants, { ...mem.options, webId: owner })).failed).toEqual(
    [],
  );
  expect((await grantsWithRoles(resource, mem.options)).map((g) => g.agent.type)).toEqual([
    "webid",
    "group",
    "public",
    "authenticated",
  ]);
  expect((await setGrants([resource], [manager], { ...mem.options, webId: owner })).failed).toEqual(
    [],
  );
});
it("reads ESS modes, multiple/any matchers, canonical typed roots and ACR-self controls", async () => {
  const dataset = new Store();
  appendAcp(
    dataset,
    resource,
    acrUrl,
    [{ agent: manager.agent, modes: new Set(["read", "write", "append", "control"]) }],
    "ess",
  );
  const existing = required(roots(dataset)[0]);
  const canonical = properties(nn(acrUrl), dataset);
  // Canonical ESS typed root can omit acp:resource.
  for (const q of [...dataset.match(existing as Term)]) {
    if (q.predicate.value !== `${ACP}resource`) canonical.terms(q.predicate.value).add(q.object);
    properties(existing as Term, dataset)
      .terms(q.predicate.value)
      .clear();
  }
  // Unrelated RDF annotations do not become access roots.
  properties(nn("urn:annotation"), dataset).add(`${RDF}type`, "urn:Annotation");
  const policy = properties(
    required(canonical.nodes(`${ACP}accessControl`)[0]).nodes(`${ACP}apply`)[0] as Term,
    dataset,
  );
  const publicMatcher = properties(DataFactory.blankNode(), dataset);
  publicMatcher.add(`${ACP}agent`, `${ACP}PublicAgent`);
  const ownerMatcher = required(policy.nodes(`${ACP}allOf`)[0]);
  policy.terms(`${ACP}allOf`).clear();
  policy.terms(`${ACP}allOf`).add(publicMatcher as Term);
  policy.terms(`${ACP}allOf`).add(ownerMatcher as Term);
  policy.terms(`${ACP}anyOf`).add(ownerMatcher as Term);
  policy.terms(`${ACP}allOf`).add(publicMatcher as Term);
  const mem = memoryAccess("acp");
  mem.attach(resource, await serialize(dataset));
  expect(await grantsWithRoles(resource, { ...mem.options, implementation: "ess" })).toEqual([
    { ...manager, source: acrUrl },
  ]);
  // A separate own-ACR root expresses management with ordinary accessControl.
  const self = properties(DataFactory.blankNode(), dataset);
  self.add(`${ACP}resource`, acrUrl);
  for (const value of canonical.terms(`${ACP}access`)) {
    const control = properties(DataFactory.blankNode(), dataset);
    control.terms(`${ACP}apply`).add(value);
    self.terms(`${ACP}accessControl`).add(control as Term);
  }
  canonical.terms(`${ACP}access`).clear();
  mem.attach(resource, await serialize(dataset));
  expect(await grantsWithRoles(resource, { ...mem.options, implementation: "ess" })).toHaveLength(
    1,
  );
  // Clearing a matcher or a management policy grants no access, never an owner.
  properties(ownerMatcher as Term, dataset)
    .values(`${ACP}agent`)
    .clear();
  const managementPolicy = properties(
    required(self.nodes(`${ACP}accessControl`)[0]).nodes(`${ACP}apply`)[0] as Term,
    dataset,
  );
  managementPolicy.values(`${ACP}allow`).clear();
  mem.attach(resource, await serialize(dataset));
  expect(await grantsWithRoles(resource, mem.options)).toEqual([]);
});
it("retains unrelated ACP targets and member policies when replacing resource controls", async () => {
  const dataset = await acpDataset();
  const rootNode = properties(required(roots(dataset)[0]), dataset);
  for (const control of rootNode.terms(`${ACP}accessControl`))
    rootNode.terms(`${ACP}memberAccessControl`).add(control);
  const foreign = properties(DataFactory.blankNode(), dataset);
  foreign.add(`${ACP}resource`, "https://foreign.example/resource");
  for (const control of rootNode.terms(`${ACP}accessControl`))
    foreign.terms(`${ACP}accessControl`).add(control);
  const mem = memoryAccess("acp");
  mem.attach(resource, await serialize(dataset));
  expect(
    (await setGrants([resource], [manager, selection()], { ...mem.options, webId: owner })).failed,
  ).toEqual([]);
  const after = await parseRdf(required(mem.docs.get(acrUrl)).body, "text/turtle");
  expect(after.match(null, nn(`${ACP}memberAccessControl`)).size).toBe(1);
  expect(after.match(null, nn(`${ACP}resource`), nn("https://foreign.example/resource")).size).toBe(
    1,
  );
});
it("copies only matching defaults, supports NSS legacy defaults, and leaves unknown parents alone", async () => {
  const mem = memoryAccess();
  const parent = `${root}folder/`;
  const body = `${await fixture("wac", parent, [manager], true)}\n${(await fixture("wac", parent, [selection()], false)).replaceAll("#authorization-", "#ownonly-")}`;
  mem.attach(resource);
  mem.attach(parent, body.replaceAll(`${ACL}default>`, `${ACL}defaultForNew>`));
  expect(
    (
      await setGrants([resource], [selection("editor")], {
        ...mem.options,
        webId: owner,
        implementation: "nss",
      })
    ).failed,
  ).toEqual([]);
  expect(mem.writes()).toHaveLength(1);
});
it("refuses ACP resource Control and treats policies without matchers as inert", async () => {
  const dataset = await acpDataset();
  const rootNode = properties(required(roots(dataset)[0]), dataset);
  const policy = properties(
    required(rootNode.nodes(`${ACP}accessControl`)[0]).nodes(`${ACP}apply`)[0] as Term,
    dataset,
  );
  policy.add(`${ACP}allow`, `${ACL}Control`);
  expect(() => readPolicy(dataset, resource, acrUrl, "acp", "css")).toThrow("own ACR");
  policy.values(`${ACP}allow`).delete(`${ACL}Control`);
  policy.terms(`${ACP}allOf`).clear();
  const mem = memoryAccess("acp");
  mem.attach(resource, await serialize(dataset));
  expect(await grantsWithRoles(resource, mem.options)).toEqual([]);
});
it("preserves inherited comments when an explicit resource role is removed", async () => {
  const mem = memoryAccess("acp");
  const comments = `${root}folder/comments/`;
  const parent = `${root}folder/`;
  mem.attach(resource, await fixture("acp", resource, [manager, selection()]));
  mem.attach(comments, await fixture("acp", comments));
  const data = await parseRdf(
    await fixture("acp", parent, [manager, selection()], true),
    "text/turtle",
  );
  // This inherited principal has only Append, independently of resource access.
  const policy = required([...data.match(null, nn(`${ACP}agent`), nn(bob))][0]).subject;
  for (const q of [...data.match(null, nn(`${ACP}allOf`), policy)]) {
    const p = properties(q.subject, data);
    p.values(`${ACP}allow`).clear();
    p.add(`${ACP}allow`, `${ACL}Append`);
  }
  mem.attach(parent, await serialize(data));
  const opts = { ...mem.options, webId: owner, commentsContainer: comments };
  const result = await setGrants([resource], [manager], opts);
  expect(result.failed).toEqual([]);
  expect(mem.writes()).toHaveLength(1);
  expect(mem.writes()[0]?.url).toBe(acrUrl);
});
it("rejects a writer that introduces an unrequested principal", async () => {
  const mem = memoryAccess();
  mem.attach(resource, await fixture("wac"));
  const real = roleRdf.readPolicy;
  let calls = 0;
  const spy = vi.spyOn(roleRdf, "readPolicy").mockImplementation((...args) => {
    const output = real(...args);
    if (++calls === 2)
      output.grants.push({
        ...required(output.grants[0]),
        who: [[{ kind: "agent", webId: "urn:unrequested" }]],
      });
    return output;
  });
  try {
    expect(
      (await setGrants([resource], [manager, selection()], { ...mem.options, webId: owner }))
        .failed[0]?.error,
    ).toMatchObject({ code: "invalid-response" });
    expect(mem.writes()).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

it("uses weak validators verbatim and refuses wildcard or malformed ETags", async () => {
  const mem = memoryAccess();
  mem.attach(resource, await fixture("wac"));
  required(mem.docs.get(aclUrl)).etag = 'W/"weak"';
  expect(
    (await setGrants([resource], [manager, selection()], { ...mem.options, webId: owner })).failed,
  ).toEqual([]);
  expect(new Headers(mem.writes()[0]?.init.headers).get("if-match")).toBe('W/"weak"');
  const other = memoryAccess();
  other.attach(resource, await fixture("wac"));
  required(other.docs.get(aclUrl)).etag = "*";
  expect(
    (await setGrants([resource], [manager, selection()], { ...other.options, webId: owner }))
      .failed[0]?.error,
  ).toMatchObject({ code: "precondition-required" });
  expect(other.writes()).toHaveLength(0);
});

it("ignores error representations when a missing ACL inherits", async () => {
  const mem = memoryAccess();
  mem.attach(resource);
  const parent = `${root}folder/`;
  mem.attach(parent, await fixture("wac", parent, [manager], true));
  mem.intercept((url) =>
    url === aclUrl
      ? new Response("Not found", { status: 404, headers: { "content-type": "text/html" } })
      : undefined,
  );
  expect(await grantsWithRoles(resource, mem.options)).toEqual([
    { ...manager, source: `${parent}.acl`, inherited: true },
  ]);
});
