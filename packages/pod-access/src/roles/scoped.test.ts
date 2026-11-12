// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
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
import { readGrants, readScopedGrants, setScopedGrants } from "./index.js";
import * as roleRdf from "./rdf.js";
import { properties, roots } from "./rdf.js";

const folder = `${root}folder/`;
const other = "https://other.example/#me";
const own = (grant: ReturnType<typeof selection>, source: string) => ({ ...grant, source });

for (const model of ["wac", "acp"] as const)
  describe(`${model} folder and contents roles`, () => {
    const suffix = model === "wac" ? ".acl" : ".acr";
    const source = folder + suffix;
    async function setup(entries = [manager, selection()]) {
      const mem = memoryAccess(model);
      mem.attach(folder, await fixture(model, folder, entries, true));
      const options = { ...mem.options, kind: "folder" as const, webId: owner };
      return { mem, options };
    }
    async function graph(mem: ReturnType<typeof memoryAccess>) {
      return parseRdf(required(mem.docs.get(source)).body, "text/turtle");
    }
    async function split(
      mem: ReturnType<typeof memoryAccess>,
      options: object,
      extra: ReturnType<typeof selection>[] = [],
    ) {
      const expected = await readScopedGrants(folder, options as never);
      const result = await setScopedGrants(
        folder,
        {
          folder: [manager, selection("viewer"), ...extra],
          contents: [manager, selection("editor"), ...extra],
        },
        { ...(options as never), expected },
      );
      expect(result.failed).toEqual([]);
      return mem;
    }

    it("shows, splits and re-joins folder and contents access", async () => {
      const { mem, options } = await setup();
      const before = await readScopedGrants(folder, options);
      expect(before.folder).toEqual([own(manager, source), own(selection(), source)]);
      expect(before.contents).toEqual(before.folder);
      await split(mem, options);
      const after = await readScopedGrants(folder, options);
      expect(after.folder).toEqual([own(manager, source), own(selection("viewer"), source)]);
      expect(after.contents).toEqual([own(manager, source), own(selection("editor"), source)]);
      // The single-role editor still refuses what it cannot show.
      await expect(readGrants(folder, options)).rejects.toMatchObject({ code: "partial-scope" });
      if (model === "wac") {
        const rules = [...new AclResource(await graph(mem), DataFactory).authorizations].filter(
          (auth) => auth.agent.has(bob),
        );
        expect(
          rules
            .map((auth) => {
              // replaceWac leaves the split original rule with no targets; it grants nothing.
              const node = properties(auth, auth.dataset);
              return [node.iris(`${ACL}accessTo`), node.iris(`${ACL}default`), auth.mode.size];
            })
            .filter(
              ([accessTo, defaults]) =>
                (accessTo as string[]).length + (defaults as string[]).length,
            )
            .sort((a, b) => String(a).localeCompare(String(b))),
        ).toEqual([
          [[], [folder], 3],
          [[folder], [], 1],
        ]);
      }
      // Equal roles on both scopes write one shared rule, and the single-role editor works again.
      const expected = await readScopedGrants(folder, options);
      expect(
        (
          await setScopedGrants(
            folder,
            { folder: [manager, selection("editor")], contents: [manager, selection("editor")] },
            { ...options, expected },
          )
        ).failed,
      ).toEqual([]);
      expect((await readGrants(folder, options)).grants).toEqual([
        own(manager, source),
        own(selection("editor"), source),
      ]);
    });

    it("grants contents-only and folder-only access and removes a principal from one scope", async () => {
      const { mem, options } = await setup([manager]);
      const people = selection("viewer", { type: "webid", id: other });
      expect(
        (
          await setScopedGrants(
            folder,
            { folder: [manager, people], contents: [manager, selection("editor")] },
            options,
          )
        ).failed,
      ).toEqual([]);
      let read = await readScopedGrants(folder, options);
      expect(read.folder).toEqual([own(manager, source), own(people, source)]);
      expect(read.contents).toEqual([own(manager, source), own(selection("editor"), source)]);
      expect(
        (
          await setScopedGrants(
            folder,
            { folder: [manager, people], contents: [manager] },
            { ...options, expected: read },
          )
        ).failed,
      ).toEqual([]);
      read = await readScopedGrants(folder, options);
      expect(read.contents).toEqual([own(manager, source)]);
      expect(read.folder).toEqual([own(manager, source), own(people, source)]);
      expect(mem.writes()).toHaveLength(2);
    });

    it("writes nothing for an unchanged selection and refuses a stale one", async () => {
      const { mem, options } = await setup();
      const read = await readScopedGrants(folder, options);
      const unchanged = { folder: read.folder, contents: read.contents };
      expect(
        (await setScopedGrants(folder, unchanged, { ...options, expected: read })).applied,
      ).toEqual([folder]);
      expect(mem.writes()).toHaveLength(0);
      mem.put(source, required(mem.docs.get(source)).body, '"new"');
      expect(
        (await setScopedGrants(folder, unchanged, { ...options, expected: read })).failed[0]?.error,
      ).toMatchObject({ code: "conflict" });
      expect(
        (await setScopedGrants(folder, unchanged, { ...options, expected: { ...read, url: root } }))
          .failed[0]?.error,
      ).toMatchObject({ code: "conflict" });
      expect(mem.writes()).toHaveLength(0);
    });

    it.each([
      "folder",
      "contents",
    ] as const)("refuses to drop the caller's Control from the %s before writing", async (scope) => {
      const { mem, options } = await setup();
      const keep = [manager, selection()];
      await expect(
        setScopedGrants(
          folder,
          { folder: keep, contents: keep, [scope]: [selection("editor")] },
          options,
        ),
      ).rejects.toMatchObject({ code: "owner-lockout" });
      expect(mem.writes()).toHaveLength(0);
    });

    it("refuses other kinds, dialects, comments, inherited-only folders and odd selections", async () => {
      const { mem, options } = await setup();
      const keep = { folder: [manager], contents: [manager] };
      for (const [url, extra] of [
        [folder, { kind: "resource" as const }],
        [`${root}file`, {}],
        [folder, { implementation: "ess" as const }],
        [folder, { commentsContainer: `${root}comments/` }],
      ] as const) {
        await expect(readScopedGrants(url, { ...options, ...extra })).rejects.toMatchObject({
          code: "unsupported",
        });
        expect(
          (await setScopedGrants(url, keep, { ...options, ...extra })).failed[0]?.error,
        ).toMatchObject({ code: "unsupported" });
      }
      const fail = async (selection: Parameters<typeof setScopedGrants>[1]) =>
        (await setScopedGrants(folder, selection, options)).failed[0]?.error;
      expect(
        await fail({
          folder: [manager, { ...manager, inherited: true, source: root }],
          contents: [manager],
        }),
      ).toMatchObject({ code: "inherited-grant" });
      // Malformed selections are refused before any request, like setGrants.
      const requests = mem.calls.length;
      for (const [chosen, code] of [
        [{ folder: [manager, manager], contents: [manager] }, "invalid-response"],
        [
          { folder: [manager], contents: [manager, { ...selection(), purpose: "x" }] },
          "unsupported",
        ],
        [{ folder: [manager, selection("commenter")], contents: [manager] }, "unsupported"],
      ] as const)
        await expect(setScopedGrants(folder, chosen, options)).rejects.toMatchObject({ code });
      expect(mem.calls.length).toBe(requests);
      expect(
        await fail({
          folder: [
            manager,
            selection(
              "viewer",
              model === "wac" ? { type: "app", id: other } : { type: "group", id: other },
            ),
          ],
          contents: [manager],
        }),
      ).toMatchObject({ code: "unsupported" });
      expect(mem.writes()).toHaveLength(0);
      // A folder that only inherits has one set of rules for both scopes.
      const inherits = memoryAccess(model);
      inherits.attach(folder);
      inherits.attach(root, await fixture(model, root, [manager, selection()], true));
      const inheritedOptions = { ...inherits.options, kind: "folder" as const, webId: owner };
      const read = await readScopedGrants(folder, inheritedOptions);
      expect(read.folder.every((g) => g.inherited && g.source === root + suffix)).toBe(true);
      expect(read.contents).toEqual(read.folder);
      expect(
        (await setScopedGrants(folder, read, inheritedOptions)).failed[0]?.error,
      ).toMatchObject({ code: "unsupported" });
    });

    it("refuses to drop permissions that no role can express", async () => {
      const { mem, options } = await setup([manager]);
      const dataset = await graph(mem);
      const extra = memoryAccess(model);
      extra.attach(folder, await fixture(model, folder, [manager], true));
      if (model === "wac") {
        const node = properties(DataFactory.blankNode(), dataset);
        node.add("http://www.w3.org/1999/02/22-rdf-syntax-ns#type", `${ACL}Authorization`);
        node.add(`${ACL}default`, folder);
        node.add(`${ACL}agent`, bob);
        node.add(`${ACL}mode`, `${ACL}Append`);
      } else {
        const { appendAcp } = await import("./rdf.js");
        appendAcp(
          dataset,
          folder,
          source,
          [{ agent: selection().agent, modes: new Set(["append"]) }],
          "css",
          "only",
        );
      }
      mem.put(source, await serialize(dataset));
      const read = await readScopedGrants(folder, options);
      expect(read.contents).toEqual([own(manager, source)]);
      expect(
        (await setScopedGrants(folder, { folder: [manager], contents: [manager] }, options))
          .failed[0]?.error,
      ).toMatchObject({ code: "unsupported" });
      expect(mem.writes()).toHaveLength(0);
    });

    it("requires a valid access document ETag", async () => {
      const { mem, options } = await setup();
      mem.put(source, required(mem.docs.get(source)).body, null);
      expect(
        (await setScopedGrants(folder, { folder: [manager], contents: [manager] }, options))
          .failed[0]?.error,
      ).toMatchObject({ code: "precondition-required" });
      expect(mem.writes()).toHaveLength(0);
    });

    it("keeps unrelated principals and rules when splitting one principal", async () => {
      const { mem, options } = await setup([
        manager,
        selection(),
        selection("viewer", { type: "webid", id: other }),
      ]);
      await split(mem, options, [selection("viewer", { type: "webid", id: other })]);
      const read = await readScopedGrants(folder, options);
      for (const scope of [read.folder, read.contents])
        expect(scope).toContainEqual(
          own(selection("viewer", { type: "webid", id: other }), source),
        );
      // Re-joining the split principal restores one role per person for the plain editor.
      const again = await readScopedGrants(folder, options);
      const joined = [manager, selection(), selection("viewer", { type: "webid", id: other })];
      expect(
        (
          await setScopedGrants(
            folder,
            { folder: joined, contents: joined },
            { ...options, expected: again },
          )
        ).failed,
      ).toEqual([]);
      const plain = (await readGrants(folder, options)).grants;
      expect(plain).toHaveLength(joined.length);
      expect(plain).toEqual(expect.arrayContaining(joined.map((g) => own(g, source))));
    });
  });

it("keeps ACP ancestor grants read-only and visible in both scopes", async () => {
  const mem = memoryAccess("acp");
  mem.attach(
    root,
    await fixture("acp", root, [manager, selection("viewer", { type: "webid", id: other })], true),
  );
  mem.attach(folder, await fixture("acp", folder, [manager, selection()], true));
  const options = { ...mem.options, kind: "folder" as const, webId: owner };
  const read = await readScopedGrants(folder, options);
  for (const scope of [read.folder, read.contents])
    expect(scope).toContainEqual({
      ...selection("viewer", { type: "webid", id: other }),
      inherited: true,
      source: `${root}.acr`,
    });
  const parent = mem.docs.get(`${root}.acr`)?.body;
  const keep = (role: "viewer" | "editor") => [
    ...read.folder.filter((g) => g.inherited),
    manager,
    selection(role),
  ];
  expect(
    (
      await setScopedGrants(
        folder,
        { folder: keep("viewer"), contents: keep("editor") },
        {
          ...options,
          expected: read,
        },
      )
    ).failed,
  ).toEqual([]);
  expect(mem.docs.get(`${root}.acr`)?.body).toBe(parent);
  expect(mem.writes().map((w) => w.url)).toEqual([`${folder}.acr`]);
  const after = await readScopedGrants(folder, options);
  expect(after.contents).toContainEqual({ ...selection("editor"), source: `${folder}.acr` });
  expect(
    roots(await parseRdf(required(mem.docs.get(`${folder}.acr`)).body, "text/turtle")).length,
  ).toBeGreaterThan(0);
});

it("has no members-only form for ESS management", async () => {
  const { Store } = await import("n3");
  const { appendAcp } = await import("./rdf.js");
  expect(() => appendAcp(new Store(), folder, `${folder}.acr`, [], "ess", "only")).toThrow(
    expect.objectContaining({ code: "unsupported" }),
  );
});

it("checks the serialized folder and contents rules against the plan before writing", async () => {
  const mem = memoryAccess("wac");
  mem.attach(folder, await fixture("wac", folder, [manager], true));
  const options = { ...mem.options, kind: "folder" as const, webId: owner };
  const real = roleRdf.readPolicy;
  let calls = 0;
  const spy = vi
    .spyOn(roleRdf, "readPolicy")
    .mockImplementation((...args) => (++calls === 2 ? { grants: [], denials: [] } : real(...args)));
  try {
    expect(
      (
        await setScopedGrants(
          folder,
          { folder: [manager], contents: [manager, selection()] },
          options,
        )
      ).failed[0]?.error,
    ).toMatchObject({ code: "invalid-response" });
    expect(mem.writes()).toHaveLength(0);
    // An emitted rule for someone the plan never named is refused too.
    calls = 0;
    spy.mockImplementation((...args) => {
      const policy = real(...args);
      if (++calls !== 2) return policy;
      const [first] = policy.grants;
      return {
        ...policy,
        grants: [
          ...policy.grants,
          { ...(first as NonNullable<typeof first>), who: [[{ kind: "agent", webId: other }]] },
        ],
      };
    });
    expect(
      (
        await setScopedGrants(
          folder,
          { folder: [manager], contents: [manager, selection()] },
          options,
        )
      ).failed[0]?.error,
    ).toMatchObject({ code: "invalid-response" });
    expect(mem.writes()).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

it("keeps a direct ACP grant when the selection lists only that person's inherited role", async () => {
  const mem = memoryAccess("acp");
  const person = selection("viewer", { type: "webid", id: other });
  mem.attach(root, await fixture("acp", root, [manager, person], true));
  mem.attach(folder, await fixture("acp", folder, [manager, person], true));
  const options = { ...mem.options, kind: "folder" as const, webId: owner };
  const read = await readScopedGrants(folder, options);
  const inheritedOnly = read.folder.filter(
    (g) => g.inherited || g.agent.type !== "webid" || g.agent.id !== other,
  );
  const result = await setScopedGrants(
    folder,
    { folder: inheritedOnly, contents: [...inheritedOnly, selection("editor")] },
    { ...options, expected: read },
  );
  expect(result.failed).toEqual([]);
  const after = await readScopedGrants(folder, options);
  for (const scope of [after.folder, after.contents])
    expect(scope).toContainEqual({ ...person, source: `${folder}.acr` });
});

it("writes ACP contents-only and folder-only controls on the folder's own resource", async () => {
  const mem = memoryAccess("acp");
  mem.attach(folder, await fixture("acp", folder, [manager, selection()], true));
  const options = { ...mem.options, kind: "folder" as const, webId: owner };
  const people = selection("viewer", { type: "webid", id: other });
  expect(
    (
      await setScopedGrants(
        folder,
        { folder: [manager, selection()], contents: [manager, people] },
        options,
      )
    ).failed,
  ).toEqual([]);
  const dataset = await parseRdf(required(mem.docs.get(`${folder}.acr`)).body, "text/turtle");
  const placements = (agent: string) =>
    roots(dataset).flatMap((acr) =>
      (["accessControl", "memberAccessControl"] as const).flatMap((name) =>
        [...acr[name]]
          .filter((control) =>
            [...control.apply].some((policy) =>
              [...policy.allOf].some((matcher) => matcher.agent.has(agent)),
            ),
          )
          .map(() => [properties(acr, dataset).iris(`${ACP}resource`)[0], name]),
      ),
    );
  expect(placements(bob)).toEqual([[folder, "accessControl"]]);
  expect(placements(other)).toEqual([[folder, "memberAccessControl"]]);
  expect(
    placements(owner)
      .map(([, name]) => name)
      .sort(),
  ).toEqual(["accessControl", "memberAccessControl"]);
});

it("lets a caller who inherits ACP Control drop their own direct Control on one scope", async () => {
  const mem = memoryAccess("acp");
  mem.attach(root, await fixture("acp", root, [manager], true));
  mem.attach(folder, await fixture("acp", folder, [manager, selection()], true));
  const options = { ...mem.options, kind: "folder" as const, webId: owner };
  const read = await readScopedGrants(folder, options);
  const inherited = read.folder.filter((g) => g.inherited);
  expect(inherited).toHaveLength(1);
  expect(
    (
      await setScopedGrants(
        folder,
        {
          folder: [...inherited, manager, selection()],
          // Listing the inherited row would keep the direct one (as setGrants does), so omit it.
          contents: [selection()],
        },
        { ...options, expected: read },
      )
    ).failed,
  ).toEqual([]);
  const after = await readScopedGrants(folder, options);
  expect(after.contents.filter((g) => !g.inherited)).toEqual([
    { ...selection(), source: `${folder}.acr` },
  ]);
  // Without that inherited Control, the same change is a lockout.
  const alone = memoryAccess("acp");
  alone.attach(folder, await fixture("acp", folder, [manager, selection()], true));
  await expect(
    setScopedGrants(
      folder,
      { folder: [manager, selection()], contents: [selection()] },
      { ...alone.options, kind: "folder" as const, webId: owner },
    ),
  ).rejects.toMatchObject({ code: "owner-lockout" });
});

it("refuses to write when the folder's access changed between reading and writing", async () => {
  const mem = memoryAccess("wac");
  mem.attach(folder, await fixture("wac", folder, [manager, selection()], true));
  const options = { ...mem.options, kind: "folder" as const, webId: owner };
  let reads = 0;
  mem.intercept((url, init) => {
    // The second GET (applyBatch's revalidation) sees a newer version.
    if (url === `${folder}.acl` && (init.method ?? "GET") === "GET" && ++reads === 2)
      mem.put(url, required(mem.docs.get(url)).body, '"2"');
    return undefined;
  });
  const result = await setScopedGrants(
    folder,
    { folder: [manager, selection()], contents: [manager, selection("editor")] },
    options,
  );
  expect(result.failed[0]?.error).toMatchObject({ code: "conflict" });
  expect(mem.writes()).toHaveLength(0);
});
