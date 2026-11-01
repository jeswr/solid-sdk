// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
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
import { ACL, ACP, serialize } from "../rdf.js";
import {
  type AgentRef,
  addGrant,
  type GrantSnapshot,
  grantsWithRoles,
  isRoleError,
  readGrants,
  removeGrant,
  setGrants,
} from "./index.js";
import { properties, roots } from "./rdf.js";

const other: AgentRef = { type: "webid", id: "https://other.example/#me" };
const nn = DataFactory.namedNode;
// Stable fixture subjects let us assert exact preservation of unrelated RDF statements.
const named = (body: string) => body.replace(/_:([\w-]+)/g, "<urn:fixture:$1>");

for (const model of ["wac", "acp"] as const)
  describe(`${model} optimistic grants`, () => {
    const suffix = model === "wac" ? ".acl" : ".acr";
    const endpoint = resource + suffix;
    it("round-trips snapshots through JSON, keeps the array API, and diffs idempotently", async () => {
      const mem = memoryAccess(model);
      mem.attach(resource, await fixture(model));
      const snapshot: GrantSnapshot = JSON.parse(
        JSON.stringify(await readGrants(resource, mem.options)),
      );
      expect(snapshot.url).toBe(resource);
      expect(snapshot.grants).toEqual(await grantsWithRoles(resource, mem.options));
      const opts = { ...mem.options, webId: owner, expected: snapshot };
      for (let i = 0; i < 2; i++) {
        expect((await setGrants([resource], snapshot.grants, opts)).failed).toEqual([]);
        expect(mem.writes()).toHaveLength(0);
      }
      expect((await setGrants([resource], [...snapshot.grants, selection()], opts)).failed).toEqual(
        [],
      );
      expect(new Headers(mem.writes()[0]?.init.headers).get("if-match")).toBe('"1"');
      const latest = await readGrants(resource, mem.options);
      expect(
        (await setGrants([resource], latest.grants, { ...opts, expected: latest })).failed,
      ).toEqual([]);
      expect(mem.writes()).toHaveLength(1);
      // A changed write consumes the baseline; replaying its stale token cannot replace fresh state.
      expect((await setGrants([resource], latest.grants, opts)).failed[0]?.error).toMatchObject({
        code: "conflict",
        url: resource,
      });
    });
    it("preserves a grant added by another client between reading and replacing", async () => {
      const mem = memoryAccess(model);
      mem.attach(resource, await fixture(model));
      const snapshot = await readGrants(resource, mem.options);
      const concurrent = await fixture(model, resource, [manager, selection("editor", other)]);
      mem.put(endpoint, concurrent, '"other"');
      const result = await setGrants([resource], [...snapshot.grants, selection()], {
        ...mem.options,
        webId: owner,
        expected: snapshot,
      });
      expect(result.applied).toEqual([]);
      expect(result.failed).toMatchObject([
        { url: resource, error: { code: "conflict", url: resource } },
      ]);
      expect(isRoleError(result.failed[0]?.error)).toBe(true);
      expect(mem.writes()).toHaveLength(0);
      expect(mem.docs.get(endpoint)?.body).toBe(concurrent);
    });
    it("distinguishes own absence from creation by another client and protects inherited sources", async () => {
      const mem = memoryAccess(model);
      const parent = `${root}folder/`;
      mem.attach(resource);
      mem.attach(parent, await fixture(model, parent, [manager], true));
      const snapshot = await readGrants(resource, mem.options);
      const desired = [...snapshot.grants, selection()];
      mem.attach(resource, await fixture(model, resource, [manager, selection("editor", other)]));
      expect(
        (await setGrants([resource], desired, { ...mem.options, webId: owner, expected: snapshot }))
          .failed[0]?.error,
      ).toMatchObject({ code: "conflict", url: resource });
      mem.docs.delete(endpoint);
      mem.put(
        parent + suffix,
        await fixture(model, parent, [manager, selection("viewer", other)], true),
        '"new-parent"',
      );
      expect(
        (await setGrants([resource], desired, { ...mem.options, webId: owner, expected: snapshot }))
          .failed[0]?.error,
      ).toMatchObject({ code: "conflict", url: resource });
      expect(mem.writes()).toHaveLength(0);
      const fresh = await readGrants(resource, mem.options);
      expect(
        (
          await setGrants([resource], [...fresh.grants, selection()], {
            ...mem.options,
            webId: owner,
            expected: fresh,
          })
        ).failed,
      ).toEqual([]);
      expect(new Headers(mem.writes()[0]?.init.headers).get("if-none-match")).toBe("*");
    });
    it("requires complete per-URL tokens, binds snapshots to their URL and projection options", async () => {
      const mem = memoryAccess(model);
      const second = `${root}second`;
      mem.attach(resource, await fixture(model));
      mem.attach(second, await fixture(model, second));
      const a = await readGrants(resource, mem.options);
      const b = await readGrants(second, mem.options);
      const options = { ...mem.options, webId: owner };
      expect(
        (await setGrants([second], [manager, selection()], { ...options, expected: a })).failed[0]
          ?.error,
      ).toMatchObject({ code: "conflict" });
      expect(
        (await setGrants([resource], [manager, selection()], { ...options, expected: {} }))
          .failed[0]?.error,
      ).toMatchObject({ code: "conflict" });
      expect(
        (await setGrants([resource], a.grants, { ...options, kind: "chatroom", expected: a }))
          .failed[0]?.error,
      ).toMatchObject({ code: "conflict" });
      expect(
        (
          await setGrants([resource, second], [manager, selection()], {
            ...options,
            expected: { [resource]: a.version, [second]: b.version },
          })
        ).failed,
      ).toEqual([]);
      expect(mem.writes()).toHaveLength(2);
    });
    it("retains the original validator when a writer races the final PUT", async () => {
      const mem = memoryAccess(model);
      mem.attach(resource, await fixture(model));
      const snapshot = await readGrants(resource, mem.options);
      const concurrent = await fixture(model, resource, [manager, selection("viewer", other)]);
      mem.intercept((url, init) => {
        if (url === endpoint && init.method === "PUT") mem.put(endpoint, concurrent, '"2"');
        return undefined;
      });
      const result = await setGrants([resource], [...snapshot.grants, selection()], {
        ...mem.options,
        webId: owner,
        expected: snapshot,
      });
      expect(result.failed[0]?.error).toMatchObject({ code: "conflict", url: resource });
      expect(new Headers(mem.writes()[0]?.init.headers).get("if-match")).toBe('"1"');
      expect(mem.docs.get(endpoint)?.body).toBe(concurrent);
    });
    it("adds one agent preserving every pre-existing statement, then replays without writing", async () => {
      const mem = memoryAccess(model);
      const body = named(await fixture(model, resource, [manager, selection("editor", other)]));
      mem.attach(resource, body);
      const before = await parseRdf(body, "text/turtle");
      const opts = { ...mem.options, webId: owner };
      expect(await addGrant([resource, resource], selection(), opts)).toMatchObject({
        applied: [resource],
        failed: [],
      });
      const after = await parseRdf(required(mem.docs.get(endpoint)).body, "text/turtle");
      expect([...before].every((q) => after.has(q))).toBe(true);
      const saved = required(mem.docs.get(endpoint)).body;
      for (let i = 0; i < 2; i++)
        expect((await addGrant([resource], selection(), opts)).failed).toEqual([]);
      expect(mem.writes()).toHaveLength(1);
      expect(mem.docs.get(endpoint)?.body).toBe(saved);
    });
    it("raises lower roles, never lowers higher ones, and removes symmetrically with no-op replay", async () => {
      const mem = memoryAccess(model);
      mem.attach(
        resource,
        await fixture(model, resource, [manager, selection(), selection("editor", other)]),
      );
      const options = { ...mem.options, webId: owner };
      for (const wanted of ["editor", "manager"] as const) {
        expect((await addGrant([resource], selection(wanted), options)).failed).toEqual([]);
        expect(
          (await grantsWithRoles(resource, mem.options)).find(
            (g) => "id" in g.agent && g.agent.id === bob,
          )?.role,
        ).toBe(wanted);
      }
      await addGrant([resource], selection("viewer"), options);
      expect(mem.writes()).toHaveLength(2);
      expect((await removeGrant([resource], selection().agent, options)).failed).toEqual([]);
      const grants = await grantsWithRoles(resource, mem.options);
      expect(grants.some((g) => "id" in g.agent && g.agent.id === bob)).toBe(false);
      expect(grants).toContainEqual({ ...selection("editor", other), source: endpoint });
      expect((await removeGrant([resource], selection().agent, options)).applied).toEqual([
        resource,
      ]);
      expect(mem.writes()).toHaveLength(3);
    });
    it.each([
      "add",
      "remove",
    ] as const)("reports typed %s conflicts without retries and preserves concurrent grants", async (operation) => {
      const mem = memoryAccess(model);
      const second = `${root}second`;
      mem.attach(resource, await fixture(model, resource, [manager, selection()]));
      mem.attach(second, await fixture(model, second, [manager, selection()]));
      const concurrent = await fixture(model, resource, [
        manager,
        selection(),
        selection("editor", other),
      ]);
      mem.intercept((url, init) => {
        if (url === endpoint && init.method === "PUT") mem.put(endpoint, concurrent, '"2"');
        return undefined;
      });
      const options = { ...mem.options, webId: owner };
      const result =
        operation === "add"
          ? await addGrant([resource, second], selection("editor"), options)
          : await removeGrant([resource, second], selection().agent, options);
      expect(result).toMatchObject({
        applied: [second],
        failed: [{ url: resource, error: { code: "conflict", url: resource } }],
      });
      expect(isRoleError(result.failed[0]?.error)).toBe(true);
      expect(mem.writes().filter((w) => w.url === endpoint)).toHaveLength(1);
      expect(mem.docs.get(endpoint)?.body).toBe(concurrent);
    });
    it("preflights expiry/purpose and batch lockout, and refuses inherited/unsupported identities", async () => {
      const mem = memoryAccess(model);
      const options = { ...mem.options, webId: owner };
      for (const extra of [{ expiresAt: new Date() }, { purpose: "" }])
        await expect(
          addGrant([resource], { ...selection(), ...extra }, options),
        ).rejects.toMatchObject({ code: "unsupported" });
      expect(mem.calls).toHaveLength(0);
      mem.attach(resource, await fixture(model));
      for (const grant of [
        { ...selection(), inherited: true },
        selection(
          "viewer",
          model === "wac" ? { type: "app", id: bob } : { type: "group", id: bob },
        ),
      ])
        expect((await addGrant([resource], grant, options)).failed).toHaveLength(1);
      await expect(removeGrant([resource], manager.agent, options)).rejects.toMatchObject({
        code: "owner-lockout",
      });
      expect(mem.writes()).toHaveLength(0);
      mem.docs.delete(endpoint);
      const parent = `${root}folder/`;
      mem.attach(parent, await fixture(model, parent, [manager, selection()], true));
      expect((await addGrant([resource], selection(), options)).applied).toEqual([resource]);
      expect(mem.writes()).toHaveLength(0);
      expect(
        (await removeGrant([resource], selection().agent, options)).failed[0]?.error,
      ).toMatchObject({ code: "inherited-grant" });
      expect((await addGrant([resource], selection("editor"), options)).failed).toEqual([]);
      expect(new Headers(mem.writes()[0]?.init.headers).get("if-none-match")).toBe("*");
    });
  });

it("binds the token to comments discovery and governing validators", async () => {
  const mem = memoryAccess();
  const comments = `${root}comments/`;
  mem.attach(resource, await fixture("wac"));
  mem.attach(comments, await fixture("wac", comments));
  const options = {
    ...mem.options,
    webId: owner,
    commentsContainer: comments,
    kind: "document" as const,
  };
  const snapshot = await readGrants(resource, options);
  mem.put(`${comments}.acl`, await fixture("wac", comments), '"new"');
  expect(
    (
      await setGrants([resource], [...snapshot.grants, selection("commenter")], {
        ...options,
        expected: snapshot,
      })
    ).failed[0]?.error,
  ).toMatchObject({ code: "conflict", url: resource });
  expect(mem.writes()).toHaveLength(0);
});

for (const model of ["wac", "acp"] as const)
  it(`${model} changes only one commenter's resource and comments permissions`, async () => {
    const mem = memoryAccess(model);
    const comments = `${root}comments/`;
    const suffix = model === "wac" ? ".acl" : ".acr";
    mem.attach(resource, await fixture(model, resource, [manager, selection("editor", other)]));
    mem.attach(comments, await fixture(model, comments, [manager, selection("editor", other)]));
    const options = {
      ...mem.options,
      webId: owner,
      commentsContainer: comments,
      kind: "document" as const,
    };
    expect((await addGrant([resource], selection("commenter"), options)).failed).toEqual([]);
    expect(mem.writes()).toHaveLength(2);
    expect((await addGrant([resource], selection("commenter"), options)).failed).toEqual([]);
    expect(mem.writes()).toHaveLength(2);
    expect((await removeGrant([resource], selection().agent, options)).failed).toEqual([]);
    expect(mem.writes()).toHaveLength(4);
    for (const target of [resource, comments]) {
      expect(await grantsWithRoles(target, mem.options)).toContainEqual({
        ...selection("editor", other),
        source: target + suffix,
      });
      expect(
        (await grantsWithRoles(target, mem.options)).some(
          (g) => "id" in g.agent && g.agent.id === bob,
        ),
      ).toBe(false);
    }
  });

it("splits shared WAC principals while retaining defaults, foreign targets, and annotations", async () => {
  const mem = memoryAccess();
  const data = await parseRdf(
    await fixture("wac", resource, [manager, selection()]),
    "text/turtle",
  );
  const auth = required([...data.match(null, nn(`${ACL}agent`), nn(bob))][0]).subject;
  const rule = properties(auth, data);
  rule.add(`${ACL}agent`, other.id);
  rule.add(`${ACL}default`, resource);
  rule.add(`${ACL}accessTo`, "urn:foreign");
  rule.add("urn:annotation", "urn:value");
  mem.attach(resource, await serialize(data));
  const options = { ...mem.options, webId: owner };
  expect((await addGrant([resource], selection("editor"), options)).failed).toEqual([]);
  expect((await removeGrant([resource], selection().agent, options)).failed).toEqual([]);
  const after = await parseRdf(required(mem.docs.get(`${resource}.acl`)).body, "text/turtle");
  expect([...data.match(auth)].every((q) => after.has(q))).toBe(false); // accessTo was split locally
  expect(properties(auth, after).iris(`${ACL}default`)).toContain(resource);
  expect(properties(auth, after).iris(`${ACL}accessTo`)).toContain("urn:foreign");
  expect(properties(auth, after).iris("urn:annotation")).toEqual(["urn:value"]);
  expect(await grantsWithRoles(resource, mem.options)).toContainEqual({
    ...selection("viewer", other),
    source: `${resource}.acl`,
  });
});

for (const model of ["wac", "acp"] as const)
  it(`${model} converges after an auxiliary conflict interrupts either single-agent operation`, async () => {
    const mem = memoryAccess(model);
    const suffix = model === "wac" ? ".acl" : ".acr";
    const endpoint = resource + suffix;
    const comments = `${root}comments/`;
    mem.attach(resource, await fixture(model));
    mem.attach(comments, await fixture(model, comments));
    const options = { ...mem.options, webId: owner, commentsContainer: comments };
    let failComments = true;
    mem.intercept((url, init) =>
      url === comments + suffix && init.method === "PUT" && failComments
        ? new Response(null, { status: 412 })
        : undefined,
    );
    expect(
      (await addGrant([resource], selection("commenter"), options)).failed[0]?.error,
    ).toMatchObject({ code: "conflict" });
    failComments = false;
    expect((await addGrant([resource], selection("commenter"), options)).failed).toEqual([]);
    expect(mem.writes().filter((w) => w.url === endpoint)).toHaveLength(1);
    failComments = true;
    expect(
      (await removeGrant([resource], selection().agent, options)).failed[0]?.error,
    ).toMatchObject({ code: "conflict" });
    failComments = false;
    expect((await removeGrant([resource], selection().agent, options)).failed).toEqual([]);
    expect(mem.writes().filter((w) => w.url === endpoint)).toHaveLength(2);
    const count = mem.writes().length;
    expect((await removeGrant([resource], selection().agent, options)).failed).toEqual([]);
    expect(mem.writes()).toHaveLength(count);
    expect(
      (await grantsWithRoles(comments, mem.options)).some(
        (g) => "id" in g.agent && g.agent.id === bob,
      ),
    ).toBe(false);
  });

it("splits shared ACP matchers and policies without altering member, foreign, or other-agent access", async () => {
  const mem = memoryAccess("acp");
  const data = await parseRdf(
    named(await fixture("acp", resource, [manager, selection("manager")])),
    "text/turtle",
  );
  const acr = properties(required(roots(data)[0]) as Term, data);
  const matcher = properties(
    required([...data.match(null, nn(`${ACP}agent`), nn(bob))][0]).subject,
    data,
  );
  matcher.add(`${ACP}agent`, other.id);
  for (const control of acr.terms(`${ACP}accessControl`))
    acr.terms(`${ACP}memberAccessControl`).add(control);
  for (const policy of acr.terms(`${ACP}access`)) acr.terms(`${ACP}memberAccess`).add(policy);
  const foreign = properties(nn("urn:foreign-acr"), data);
  foreign.add(`${ACP}resource`, "urn:foreign");
  for (const control of acr.terms(`${ACP}accessControl`))
    foreign.terms(`${ACP}accessControl`).add(control);
  const bobPolicy = required([...data.match(null, nn(`${ACP}allOf`), matcher as Term)][0]).subject;
  properties(bobPolicy, data).add("urn:annotation", "urn:value");
  // AnyOf plus an allOf public matcher exercises intersection and shared paths.
  const p = properties(bobPolicy, data);
  p.terms(`${ACP}allOf`).delete(matcher as Term);
  p.terms(`${ACP}anyOf`).add(matcher as Term);
  const publicMatcher = properties(nn("urn:public-matcher"), data);
  publicMatcher.add(`${ACP}agent`, `${ACP}PublicAgent`);
  p.terms(`${ACP}allOf`).add(publicMatcher as Term);
  mem.attach(resource, await serialize(data));
  expect(
    (await removeGrant([resource], selection().agent, { ...mem.options, webId: owner })).failed,
  ).toEqual([]);
  const after = await parseRdf(required(mem.docs.get(`${resource}.acr`)).body, "text/turtle");
  expect([...data.match(matcher as Term)].every((q) => after.has(q))).toBe(true);
  expect([...data.match(bobPolicy)].every((q) => after.has(q))).toBe(true);
  expect([...data.match(nn("urn:foreign-acr"))].every((q) => after.has(q))).toBe(true);
  expect(await grantsWithRoles(resource, mem.options)).toContainEqual({
    ...selection("manager", other),
    source: `${resource}.acr`,
  });
  expect(
    (await grantsWithRoles(resource, mem.options)).some(
      (g) => "id" in g.agent && g.agent.id === bob,
    ),
  ).toBe(false);
});

it.each<AgentRef>([
  { type: "app", id: "https://client.example/" },
  { type: "public" },
  { type: "authenticated" },
])("removes only the selected ACP $type principal", async (agent) => {
  const mem = memoryAccess("acp");
  mem.attach(
    resource,
    await fixture("acp", resource, [
      manager,
      selection("editor", agent),
      selection("viewer", other),
    ]),
  );
  expect((await removeGrant([resource], agent, { ...mem.options, webId: owner })).failed).toEqual(
    [],
  );
  expect(await grantsWithRoles(resource, mem.options)).toEqual([
    { ...manager, source: `${resource}.acr` },
    { ...selection("viewer", other), source: `${resource}.acr` },
  ]);
});

it("keeps inherited comments while removing direct Read, and refuses to discard comments Write", async () => {
  const comments = `${root}discussion/comments/`;
  const parent = `${root}discussion/`;
  const mem = memoryAccess();
  mem.attach(resource, await fixture("wac", resource, [manager, selection()]));
  mem.attach(comments);
  const inherited = await parseRdf(
    await fixture("wac", parent, [manager, selection()], true),
    "text/turtle",
  );
  const auth = required([...inherited.match(null, nn(`${ACL}agent`), nn(bob))][0]).subject;
  properties(auth, inherited).values(`${ACL}mode`).clear();
  properties(auth, inherited).add(`${ACL}mode`, `${ACL}Append`);
  mem.attach(parent, await serialize(inherited));
  const options = { ...mem.options, webId: owner, commentsContainer: comments };
  expect((await removeGrant([resource], selection().agent, options)).failed).toEqual([]);
  expect(mem.writes()).toHaveLength(1);
  expect(mem.writes()[0]?.url).toBe(`${resource}.acl`);
  const own = memoryAccess();
  own.attach(resource, await fixture("wac", resource, [manager, selection()]));
  own.attach(comments, await fixture("wac", comments, [manager, selection("editor")]));
  expect(
    (await removeGrant([resource], selection().agent, { ...options, fetch: own.fetch })).failed[0]
      ?.error,
  ).toMatchObject({ code: "unsupported", url: comments });
  expect(own.writes()).toHaveLength(0);
});

it("adds only resource Read when the selected agent already has comments Append", async () => {
  const mem = memoryAccess();
  const comments = `${root}comments/`;
  mem.attach(resource, await fixture("wac"));
  const data = await parseRdf(
    await fixture("wac", comments, [manager, selection()]),
    "text/turtle",
  );
  const auth = required([...data.match(null, nn(`${ACL}agent`), nn(bob))][0]).subject;
  properties(auth, data).values(`${ACL}mode`).clear();
  properties(auth, data).add(`${ACL}mode`, `${ACL}Append`);
  mem.attach(comments, await serialize(data));
  const options = { ...mem.options, webId: owner, commentsContainer: comments };
  expect((await addGrant([resource], selection("commenter"), options)).failed).toEqual([]);
  expect(mem.writes()).toHaveLength(1);
  expect(mem.writes()[0]?.url).toBe(`${resource}.acl`);
});
