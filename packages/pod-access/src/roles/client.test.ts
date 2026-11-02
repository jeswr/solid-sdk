// AUTHORED-BY Codex

import { parseRdf } from "@jeswr/fetch-rdf";
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
import { ACL, serialize } from "../rdf.js";
import { grantsWithRoles, isRoleError, setGrants } from "./index.js";
import { properties } from "./rdf.js";

for (const model of ["wac", "acp"] as const)
  describe(`${model} role client`, () => {
    const suffix = model === "wac" ? ".acl" : ".acr";
    it("reads own grants including anonymous and authenticated identities, with no rounding", async () => {
      const mem = memoryAccess(model);
      const entries = [
        manager,
        selection(),
        selection("editor", { type: "public" }),
        selection("viewer", { type: "authenticated" }),
        selection(
          "viewer",
          model === "wac"
            ? { type: "group", id: "https://group.example/#g" }
            : { type: "app", id: "https://app.example/" },
        ),
      ];
      mem.attach(resource, await fixture(model, resource, entries));
      const rows = await grantsWithRoles(resource, mem.options);
      expect(rows).toEqual(entries.map((g) => ({ ...g, source: resource + suffix })));
      expect(mem.writes()).toHaveLength(0);
    });
    it("applies full-set diffs conditionally and becomes a no-op, including empty batches", async () => {
      const mem = memoryAccess(model);
      mem.attach(resource, await fixture(model));
      const opts = { ...mem.options, webId: owner, notify: true, message: "Welcome" };
      expect(await setGrants([resource, resource], [manager, selection("editor")], opts)).toEqual({
        applied: [resource],
        failed: [],
        notification: { requested: true, message: "Welcome", delivered: false },
      });
      expect(new Headers(mem.writes()[0]?.init.headers).get("if-match")).toBe('"1"');
      expect(
        (await grantsWithRoles(resource, mem.options)).find(
          (g) => g.agent.type === "webid" && g.agent.id === bob,
        )?.role,
      ).toBe("editor");
      expect((await setGrants([resource], [manager, selection("editor")], opts)).failed).toEqual(
        [],
      );
      expect(mem.writes()).toHaveLength(1);
      await setGrants([resource], [manager, selection()], opts);
      await setGrants([resource], [manager], opts);
      expect(await grantsWithRoles(resource, mem.options)).toEqual([
        { ...manager, source: resource + suffix },
      ]);
      expect((await setGrants([], [], opts)).applied).toEqual([]);
    });
    it("reads inheritance and retains it when creating own access", async () => {
      const mem = memoryAccess(model);
      const parent = `${root}folder/`;
      mem.attach(resource);
      mem.attach(
        parent,
        await fixture(model, parent, [manager, selection("viewer", { type: "public" })], true),
      );
      const inherited = await grantsWithRoles(resource, mem.options);
      expect(inherited).toEqual(
        [manager, selection("viewer", { type: "public" })].map((g) => ({
          ...g,
          inherited: true,
          source: parent + suffix,
        })),
      );
      const grants = [...inherited, selection("editor")];
      expect(
        (await setGrants([resource], grants, { ...mem.options, webId: owner })).failed,
      ).toEqual([]);
      expect(new Headers(mem.writes()[0]?.init.headers).get("if-none-match")).toBe("*");
      expect(
        (await grantsWithRoles(resource, mem.options)).some((g) => g.agent.type === "public"),
      ).toBe(true);
      // Reapply identical explicit selection; copied WAC defaults survive after creation.
      const same = grants;
      expect((await setGrants([resource], same, { ...mem.options, webId: owner })).failed).toEqual(
        [],
      );
      expect(mem.writes()).toHaveLength(1);
      expect(mem.docs.get(parent + suffix)?.etag).toBe('"1"');
    });
    it("refuses self lockout across the whole batch before writing an earlier URL", async () => {
      const mem = memoryAccess(model);
      const second = `${root}second`;
      mem.attach(resource);
      mem.attach(`${root}folder/`, await fixture(model, `${root}folder/`, [manager], true));
      mem.attach(second, await fixture(model, second));
      await expect(
        setGrants([resource, second], [selection()], { ...mem.options, webId: owner }),
      ).rejects.toMatchObject({ code: "owner-lockout", url: second });
      await expect(
        setGrants([second], [selection()], { ...mem.options, webId: owner }),
      ).rejects.toMatchObject({ code: "owner-lockout" });
      expect(mem.writes()).toHaveLength(0);
    });
    it("reports 412 per URL, stops further writes there, and continues the batch", async () => {
      const mem = memoryAccess(model);
      const second = `${root}second`;
      mem.attach(resource, await fixture(model));
      mem.attach(second, await fixture(model, second));
      mem.intercept((url, init) =>
        url === resource + suffix && init.method === "PUT"
          ? new Response(null, { status: 412 })
          : undefined,
      );
      const result = await setGrants([resource, second], [manager, selection()], {
        ...mem.options,
        webId: owner,
      });
      expect(result.applied).toEqual([second]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({
        url: resource,
        error: { code: "conflict", url: resource },
      });
      expect(isRoleError(result.failed[0]?.error)).toBe(true);
    });
    it("rejects expiry and purpose before any I/O", async () => {
      const mem = memoryAccess(model);
      for (const extra of [{ expiresAt: new Date() }, { purpose: "" }])
        await expect(
          setGrants([resource], [{ ...manager, ...extra }], { ...mem.options, webId: owner }),
        ).rejects.toMatchObject({ code: "unsupported", feature: "accessControl" });
      expect(mem.calls).toHaveLength(0);
    });
    it("refuses inherited mutations and unsupported identity forms without writes", async () => {
      const mem = memoryAccess(model);
      mem.attach(resource, await fixture(model));
      for (const entry of [
        { ...selection(), inherited: true },
        selection(
          "viewer",
          model === "wac" ? { type: "app", id: bob } : { type: "group", id: bob },
        ),
      ]) {
        const result = await setGrants([resource], [manager, entry], {
          ...mem.options,
          webId: owner,
        });
        expect(result.applied).toEqual([]);
        expect(result.failed).toHaveLength(1);
      }
      expect(mem.writes()).toHaveLength(0);
    });
  });
describe("WAC scope and comments", () => {
  it("stops at the nearest existing ACL even when it supplies no defaults", async () => {
    const mem = memoryAccess();
    mem.attach(resource);
    mem.attach(`${root}folder/`, await fixture("wac", `${root}folder/`, [manager]));
    mem.attach(root, await fixture("wac", root, [manager], true));
    expect(await grantsWithRoles(resource, mem.options)).toEqual([]);
    expect(mem.calls.some((c) => c.url === root)).toBe(false);
  });
  it("retains shared agents, unrelated foreign targets, defaults, and metadata during a diff", async () => {
    const mem = memoryAccess();
    const dataset = await parseRdf(
      await fixture("wac", resource, [manager, selection("editor")]),
      "text/turtle",
      { baseIRI: `${resource}.acl` },
    );
    const auth = [
      ...dataset.match(null, DataFactory.namedNode(`${ACL}agent`), DataFactory.namedNode(bob)),
    ][0]?.subject;
    const node = properties(required(auth), dataset);
    node.add(`${ACL}agent`, "https://other.example/#me");
    node.add(`${ACL}accessTo`, "https://foreign.example/secret");
    node.add(`${ACL}default`, resource);
    node.add("https://example.org/annotation", "https://example.org/value");
    mem.attach(resource, await serialize(dataset));
    const grants = [
      manager,
      selection(),
      selection("editor", { type: "webid", id: "https://other.example/#me" }),
    ];
    expect((await setGrants([resource], grants, { ...mem.options, webId: owner })).failed).toEqual(
      [],
    );
    const after = await parseRdf(required(mem.docs.get(`${resource}.acl`)).body, "text/turtle");
    expect(properties(required(auth), after).iris(`${ACL}accessTo`)).toContain(
      "https://foreign.example/secret",
    );
    expect(properties(required(auth), after).iris(`${ACL}default`)).toContain(resource);
    expect(
      after.match(null, DataFactory.namedNode("https://example.org/annotation")).size,
    ).toBeGreaterThan(0);
    expect((await setGrants([resource], grants, { ...mem.options, webId: owner })).failed).toEqual(
      [],
    );
    expect(mem.writes()).toHaveLength(1);
  });
  it("creates a folder ACL retaining effective defaults for descendants", async () => {
    const mem = memoryAccess();
    const folder = `${root}folder/`;
    mem.attach(folder);
    mem.attach(root, await fixture("wac", root, [manager], true));
    expect(
      (await setGrants([folder], [selection()], { ...mem.options, webId: owner, kind: "folder" }))
        .failed,
    ).toEqual([]);
    const dataset = await parseRdf(required(mem.docs.get(`${folder}.acl`)).body, "text/turtle");
    expect(
      dataset.match(null, DataFactory.namedNode(`${ACL}default`), DataFactory.namedNode(folder))
        .size,
    ).toBeGreaterThan(0);
  });
  it("grants and revokes document commenter on the separate container, without second-apply churn", async () => {
    const mem = memoryAccess();
    const comments = `${root}comments/`;
    mem.attach(resource, await fixture("wac"));
    mem.attach(comments, await fixture("wac", comments));
    const opts = {
      ...mem.options,
      webId: owner,
      kind: "document" as const,
      commentsContainer: comments,
    };
    expect((await setGrants([resource], [manager, selection("commenter")], opts)).failed).toEqual(
      [],
    );
    expect(
      (await grantsWithRoles(resource, opts)).find(
        (g) => g.agent.type === "webid" && g.agent.id === bob,
      )?.role,
    ).toBe("commenter");
    expect(mem.writes()).toHaveLength(2);
    await setGrants([resource], [manager, selection("commenter")], opts);
    expect(mem.writes()).toHaveLength(2);
    expect((await setGrants([resource], [manager, selection()], opts)).failed).toEqual([]);
    expect(
      (await grantsWithRoles(resource, opts)).find(
        (g) => g.agent.type === "webid" && g.agent.id === bob,
      )?.role,
    ).toBe("viewer");
    const missing = await setGrants([resource], [manager, selection("commenter")], {
      ...mem.options,
      webId: owner,
      kind: "document",
    });
    expect(missing.failed[0]?.error).toMatchObject({ code: "comments-container-required" });
  });
  it("uses Read+Append for chatroom editors and preserves explicit partial access by refusing edits", async () => {
    const mem = memoryAccess();
    mem.attach(resource, await fixture("wac"));
    const opts = { ...mem.options, webId: owner, kind: "chatroom" as const };
    await setGrants([resource], [manager, selection("editor")], opts);
    expect(
      (await grantsWithRoles(resource, opts)).find(
        (g) => g.agent.type === "webid" && g.agent.id === bob,
      )?.role,
    ).toBe("editor");
    expect(
      (await grantsWithRoles(resource, mem.options)).some(
        (g) => g.agent.type === "webid" && g.agent.id === bob,
      ),
    ).toBe(false);
    expect(
      (await setGrants([resource], [manager], { ...mem.options, webId: owner })).failed[0]?.error,
    ).toMatchObject({ code: "unsupported" });
  });
});

it("attributes inherited document comments to their governing ACL and keeps round trips unchanged", async () => {
  const mem = memoryAccess();
  const parent = `${root}threads/`;
  const comments = `${parent}comments/`;
  mem.attach(resource, await fixture("wac", resource, [manager, selection()]));
  mem.attach(comments);
  const dataset = await parseRdf(
    await fixture("wac", parent, [manager, selection()], true),
    "text/turtle",
  );
  const bobAuth = required(
    [...dataset.match(null, DataFactory.namedNode(`${ACL}agent`), DataFactory.namedNode(bob))][0],
  ).subject;
  properties(bobAuth, dataset).values(`${ACL}mode`).clear();
  properties(bobAuth, dataset).add(`${ACL}mode`, `${ACL}Append`);
  mem.attach(parent, await serialize(dataset));
  const options = {
    ...mem.options,
    webId: owner,
    kind: "document" as const,
    commentsContainer: comments,
  };
  const grants = await grantsWithRoles(resource, options);
  expect(grants.find((g) => g.agent.type === "webid" && g.agent.id === bob)).toEqual({
    ...selection("commenter"),
    inherited: true,
    source: `${parent}.acl`,
  });
  expect((await setGrants([resource], grants, options)).failed).toEqual([]);
  expect(mem.writes()).toHaveLength(0);
  expect(
    (await setGrants([resource], [manager, selection()], options)).failed[0]?.error,
  ).toMatchObject({ code: "inherited-grant" });
  expect(mem.writes()).toHaveLength(0);
});
