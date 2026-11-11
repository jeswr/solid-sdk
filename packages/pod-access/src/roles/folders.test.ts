// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { type AccessControl, AclResource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  bob,
  fixture,
  manager,
  memoryAccess,
  owner,
  required,
  root,
  selection,
} from "../../test/roles-helpers.js";
import { ACL, ACP, serialize } from "../rdf.js";
import { addGrant, isRoleError, readGrants, removeGrant, setGrants } from "./index.js";
import { appendAcp, properties, readPolicy, roots } from "./rdf.js";

const folder = `${root}folder/`;
const other = "https://other.example/#me";
for (const model of ["wac", "acp"] as const)
  describe(`${model} folder roles`, () => {
    const suffix = model === "wac" ? ".acl" : ".acr";
    async function setup(entries = [manager]) {
      const mem = memoryAccess(model);
      mem.attach(folder, await fixture(model, folder, entries, true));
      const options = { ...mem.options, kind: "folder" as const, webId: owner };
      return { mem, options };
    }
    async function graph(mem: ReturnType<typeof memoryAccess>) {
      return parseRdf(required(mem.docs.get(folder + suffix)).body, "text/turtle");
    }
    it("sets, lowers and removes person and public roles on both scopes, with conditional no-op replays", async () => {
      const { mem, options } = await setup();
      for (const role of ["editor", "viewer"] as const) {
        const grants = [manager, selection(role), selection(role, { type: "public" })];
        const expected = await readGrants(folder, options);
        expect((await setGrants([folder], grants, { ...options, expected })).failed).toEqual([]);
        const snapshot = await readGrants(folder, options);
        expect(snapshot.grants).toEqual(grants.map((g) => ({ ...g, source: folder + suffix })));
        const before = mem.writes().length;
        expect(
          (await setGrants([folder], snapshot.grants, { ...options, expected: snapshot })).failed,
        ).toEqual([]);
        expect(mem.writes()).toHaveLength(before);
        const dataset = await graph(mem);
        if (model === "wac") {
          for (const auth of new AclResource(dataset, DataFactory).authorizations) {
            if (
              (!auth.agent.has(bob) && !auth.agentClass.size) ||
              !properties(auth, dataset).iris(`${ACL}accessTo`).includes(folder)
            )
              continue;
            expect(properties(auth, dataset).iris(`${ACL}accessTo`)).toEqual([folder]);
            expect(properties(auth, dataset).iris(`${ACL}default`)).toEqual([folder]);
          }
        } else {
          const active = (control: AccessControl) =>
            [...control.apply].some((policy) =>
              [...policy.allOf].some((matcher) => matcher.agent.size > 0),
            );
          for (const acr of roots(dataset))
            expect([...acr.accessControl].filter(active).map((c) => c.value)).toEqual(
              [...acr.memberAccessControl].filter(active).map((c) => c.value),
            );
        }
      }
      expect(new Headers(mem.writes()[0]?.init.headers).get("if-match")).toBe('"1"');
      expect((await setGrants([folder], [manager], options)).failed).toEqual([]);
      expect((await readGrants(folder, options)).grants).toEqual([
        { ...manager, source: folder + suffix },
      ]);
      const policy = readPolicy(await graph(mem), folder, folder + suffix, model, "css");
      expect(
        policy.grants.every((g) =>
          g.who.every((c) => c.every((s) => s.kind === "agent" && s.webId === owner)),
        ),
      ).toBe(true);
    });
    it("adds, raises and removes only one principal on both scopes", async () => {
      const { mem, options } = await setup([
        manager,
        selection("viewer", { type: "webid", id: other }),
      ]);
      const before = (await readGrants(folder, options)).grants;
      for (const role of ["viewer", "editor"] as const)
        expect((await addGrant([folder], selection(role), options)).failed).toEqual([]);
      expect((await removeGrant([folder], { type: "webid", id: bob }, options)).failed).toEqual([]);
      expect((await readGrants(folder, options)).grants).toEqual(before);
      const policy = readPolicy(await graph(mem), folder, folder + suffix, model, "css");
      expect(
        policy.grants
          .flatMap((g) => g.who.flat())
          .some((s) => s.kind === "agent" && s.webId === bob),
      ).toBe(false);
      const count = mem.writes().length;
      expect((await removeGrant([folder], { type: "webid", id: bob }, options)).failed).toEqual([]);
      expect(mem.writes()).toHaveLength(count);
    });
    for (const scope of ["resource", "members", "different-modes"] as const)
      it(`refuses ${scope} partial folder scopes on read and every mutation without changing bytes`, async () => {
        const { mem, options } = await setup([manager, selection()]);
        const dataset = await graph(mem);
        if (model === "wac") {
          const auth = required(
            [...new AclResource(dataset, DataFactory).authorizations].find((a) => a.agent.has(bob)),
          );
          const node = properties(auth, dataset);
          node.values(`${ACL}${scope === "members" ? "accessTo" : "default"}`).clear();
          if (scope === "different-modes") {
            const member = properties(DataFactory.blankNode(), dataset);
            member.add("http://www.w3.org/1999/02/22-rdf-syntax-ns#type", `${ACL}Authorization`);
            member.add(`${ACL}default`, folder);
            member.add(`${ACL}agent`, bob);
            member.add(`${ACL}mode`, `${ACL}Write`);
          }
        } else {
          for (const acr of roots(dataset)) {
            const node = properties(acr, dataset);
            for (const control of acr.accessControl) {
              if (![...control.apply].some((p) => [...p.allOf].some((m) => m.agent.has(bob))))
                continue;
              node
                .terms(`${ACP}${scope === "members" ? "accessControl" : "memberAccessControl"}`)
                .delete(control);
              if (scope === "different-modes") {
                const extra = new Store();
                appendAcp(
                  extra,
                  folder,
                  folder + suffix,
                  [{ agent: { type: "webid", id: bob }, modes: new Set(["write"]) }],
                  "css",
                  true,
                );
                for (const root of roots(extra))
                  properties(root, extra).values(`${ACP}accessControl`).clear();
                for (const q of extra) dataset.add(q);
              }
            }
          }
        }
        const bytes = await serialize(dataset);
        mem.put(folder + suffix, bytes);
        await expect(readGrants(folder, options)).rejects.toMatchObject({
          code: "partial-scope",
          url: folder,
        });
        for (const result of [
          await setGrants([folder], [manager, selection()], options),
          await addGrant([folder], selection(), options),
          await removeGrant([folder], { type: "webid", id: bob }, options),
        ]) {
          expect(result.failed[0]?.error).toMatchObject({ code: "partial-scope" });
          expect(isRoleError(result.failed[0]?.error)).toBe(true);
        }
        expect(mem.writes()).toHaveLength(0);
        expect(mem.docs.get(folder + suffix)?.body).toBe(bytes);
        // A non-folder read keeps the previous direct-resource contract.
        await expect(readGrants(folder, mem.options)).resolves.toHaveProperty("grants");
      });
    for (const operation of ["set", "remove"] as const)
      it(`${operation} preserves shared principals, foreign targets and unrelated annotations in both scopes`, async () => {
        const { mem, options } = await setup([manager, selection("editor")]);
        const dataset = await graph(mem);
        const annotation = "https://example.org/annotation";
        const value = "https://example.org/unchanged";
        const foreign = `${root}unrelated/`;
        if (model === "wac") {
          const shared = required(
            [...new AclResource(dataset, DataFactory).authorizations].find((a) => a.agent.has(bob)),
          );
          const node = properties(shared, dataset);
          node.add(`${ACL}agent`, other);
          node.add(`${ACL}accessTo`, foreign);
          node.add(`${ACL}default`, foreign);
          node.add(annotation, value);
        } else {
          const shared = required(
            roots(dataset)
              .flatMap((acr) => [...acr.accessControl])
              .find((c) => [...c.apply].some((p) => [...p.allOf].some((m) => m.agent.has(bob)))),
          );
          const p = required([...shared.apply][0]);
          const matcher = required([...p.allOf][0]);
          properties(matcher, dataset).add(`${ACP}agent`, other);
          properties(p, dataset).add(annotation, value);
          properties(shared, dataset).add(annotation, value);
          const foreignRoot = properties(
            DataFactory.namedNode(`${folder + suffix}#foreign`),
            dataset,
          );
          foreignRoot.add(`${ACP}resource`, foreign);
          foreignRoot.terms(`${ACP}accessControl`).add(shared);
          foreignRoot.add(annotation, value);
        }
        // Compare meaning rather than blank-node labels or Turtle formatting.
        const meaning = (data: typeof dataset) => {
          const facts: string[] = [];
          if (model === "wac") {
            for (const auth of new AclResource(data, DataFactory).authorizations)
              for (const name of ["accessTo", "default"])
                for (const target of properties(auth, data).iris(ACL + name))
                  for (const agent of auth.agent)
                    for (const mode of auth.mode)
                      facts.push(JSON.stringify([target, name, agent, mode]));
          } else {
            for (const acr of roots(data))
              for (const [name, controls] of [
                ["accessTo", acr.accessControl],
                ["default", acr.memberAccessControl],
              ] as const)
                for (const control of controls)
                  for (const p of control.apply)
                    for (const matcher of p.allOf)
                      for (const agent of matcher.agent)
                        for (const mode of p.allow)
                          facts.push(JSON.stringify([acr.resource, name, agent, mode]));
          }
          return [...new Set(facts)]
            .filter(
              (fact) =>
                !(fact.includes(JSON.stringify(folder)) && fact.includes(JSON.stringify(bob))),
            )
            .sort();
        };
        const before = meaning(dataset);
        mem.put(folder + suffix, await serialize(dataset));
        const result =
          operation === "set"
            ? await setGrants(
                [folder],
                [manager, selection("editor", { type: "webid", id: other })],
                options,
              )
            : await removeGrant([folder], { type: "webid", id: bob }, options);
        expect(result.failed).toEqual([]);
        const after = await graph(mem);
        expect(meaning(after)).toEqual(before);
        expect(
          [...after.match(null, DataFactory.namedNode(annotation))].every(
            (q) => q.object.value === value,
          ),
        ).toBe(true);
        expect(after.match(null, DataFactory.namedNode(annotation)).size).toBeGreaterThanOrEqual(
          dataset.match(null, DataFactory.namedNode(annotation)).size,
        );
        expect((await readGrants(folder, options)).grants).toContainEqual({
          ...selection("editor", { type: "webid", id: other }),
          source: folder + suffix,
        });
      });
    it("keeps inherited folder grants immutable and writes only its own document on an addition", async () => {
      const mem = memoryAccess(model);
      mem.attach(folder);
      mem.attach(root, await fixture(model, root, [manager, selection()], true));
      const options = { ...mem.options, kind: "folder" as const, webId: owner };
      const inherited = await readGrants(folder, options);
      expect(inherited.grants.every((g) => g.inherited)).toBe(true);
      expect(
        (await removeGrant([folder], selection().agent, options)).failed[0]?.error,
      ).toMatchObject({ code: "inherited-grant" });
      const parentBytes = mem.docs.get(root + suffix)?.body;
      expect(
        (await addGrant([folder], selection("editor", { type: "webid", id: other }), options))
          .failed,
      ).toEqual([]);
      expect(mem.docs.get(root + suffix)?.body).toBe(parentBytes);
      expect(mem.writes().map((w) => w.url)).toEqual([folder + suffix]);
      expect((await readGrants(folder, options)).grants).toContainEqual({
        ...selection("editor", { type: "webid", id: other }),
        source: folder + suffix,
      });
    });
    it("refuses a stale folder snapshot even for unchanged selections", async () => {
      const { mem, options } = await setup();
      const expected = await readGrants(folder, options);
      mem.put(folder + suffix, required(mem.docs.get(folder + suffix)).body, '"new"');
      expect(
        (await setGrants([folder], expected.grants, { ...options, expected })).failed[0]?.error,
      ).toMatchObject({ code: "conflict" });
      expect(mem.writes()).toHaveLength(0);
    });
    it("preflights folder owner lockout before writing any URL", async () => {
      const { mem, options } = await setup();
      await expect(setGrants([folder], [selection()], options)).rejects.toMatchObject({
        code: "owner-lockout",
      });
      await expect(removeGrant([folder], manager.agent, options)).rejects.toMatchObject({
        code: "owner-lockout",
      });
      expect(mem.writes()).toHaveLength(0);
    });
    it("reports a folder ETag race without retry or mutation", async () => {
      const { mem, options } = await setup();
      const bytes = mem.docs.get(folder + suffix)?.body;
      mem.intercept((url, init) =>
        url === folder + suffix && init.method === "PUT"
          ? new Response(null, { status: 412 })
          : undefined,
      );
      const result = await addGrant([folder], selection("editor"), options);
      expect(result.failed[0]?.error).toMatchObject({ code: "conflict", url: folder });
      expect(mem.writes()).toHaveLength(1);
      expect(mem.docs.get(folder + suffix)?.body).toBe(bytes);
    });
  });

it("compares ESS folder resource/member modes independently of own-ACR management", async () => {
  const mem = memoryAccess("acp");
  const dataset = new Store();
  appendAcp(
    dataset,
    folder,
    `${folder}.acr`,
    [{ agent: manager.agent, modes: new Set(["read", "write", "append", "control"]) }],
    "ess",
    true,
  );
  mem.attach(folder, await serialize(dataset));
  const options = {
    ...mem.options,
    kind: "folder" as const,
    implementation: "ess" as const,
    webId: owner,
  };
  expect((await readGrants(folder, options)).grants).toEqual([
    { ...manager, source: `${folder}.acr` },
  ]);
  expect((await addGrant([folder], selection("editor"), options)).failed).toEqual([]);
  expect((await removeGrant([folder], { type: "webid", id: bob }, options)).failed).toEqual([]);
  expect((await readGrants(folder, options)).grants).toEqual([
    { ...manager, source: `${folder}.acr` },
  ]);
});

it("removes ESS folder member-management paths along with matching resource/member access", async () => {
  const mem = memoryAccess("acp");
  const dataset = new Store();
  appendAcp(
    dataset,
    folder,
    `${folder}.acr`,
    [manager.agent, selection().agent].map((agent) => ({
      agent,
      modes: new Set(["read", "write", "append", "control"] as const),
    })),
    "ess",
    true,
  );
  const root = required(roots(dataset)[0]);
  const node = properties(root, dataset);
  for (const p of node.nodes(`${ACP}access`)) node.terms(`${ACP}memberAccess`).add(p);
  mem.attach(folder, await serialize(dataset));
  const options = {
    ...mem.options,
    kind: "folder" as const,
    implementation: "ess" as const,
    webId: owner,
  };
  expect((await setGrants([folder], [manager], options)).failed).toEqual([]);
  const after = await parseRdf(required(mem.docs.get(`${folder}.acr`)).body, "text/turtle");
  expect(
    readPolicy(after, folder, `${folder}.acr`, "acp", "ess")
      .grants.flatMap((g) => g.who.flat())
      .some((s) => s.kind === "agent" && s.webId === bob),
  ).toBe(false);
  expect((await readGrants(folder, options)).grants).toEqual([
    { ...manager, source: `${folder}.acr` },
  ]);
});

it("removes NSS legacy defaults for a folder without leaving inherited access behind", async () => {
  const mem = memoryAccess();
  const dataset = await parseRdf(
    await fixture("wac", folder, [manager, selection()], true),
    "text/turtle",
  );
  for (const auth of new AclResource(dataset, DataFactory).authorizations) {
    const node = properties(auth, dataset);
    node.values(`${ACL}default`).clear();
    node.add(`${ACL}defaultForNew`, folder);
  }
  mem.attach(folder, await serialize(dataset));
  const options = {
    ...mem.options,
    kind: "folder" as const,
    implementation: "nss" as const,
    webId: owner,
  };
  expect((await removeGrant([folder], selection().agent, options)).failed).toEqual([]);
  expect((await readGrants(folder, options)).grants).toEqual([
    { ...manager, source: `${folder}.acl` },
  ]);
});
