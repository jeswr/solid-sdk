// AUTHORED-BY Codex GPT-6.1-Sol

import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, describe, expect, test, vi } from "vitest";
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
import * as client from "./client.js";
import { movePreservingAccess, readGrants } from "./index.js";

// Real memory data operations with the same advertised access-document seam as roles tests.
async function setup(sourceModel: "wac" | "acp" = "wac", destinationModel = sourceModel) {
  const storage = createMemoryStorage({ protocol: "solid", root });
  const source = (await storage.create(root, null, { kind: "container", name: "source" })).url;
  const target = (await storage.create(root, null, { kind: "container", name: "target" })).url;
  const access = memoryAccess(sourceModel);
  access.attach(root, await fixture(sourceModel, root, [manager], true));
  access.attach(target, await fixture(destinationModel, target, [manager], true));
  if (destinationModel !== sourceModel)
    access.advertise(target, `${target}.${destinationModel === "wac" ? "acl" : "acr"}`);
  if (destinationModel !== sourceModel) {
    access.put(
      `${target}.${destinationModel === "wac" ? "acl" : "acr"}`,
      await fixture(destinationModel, target, [manager], true),
    );
    // Keep the independent source model governing source children.
    access.attach(source, await fixture(sourceModel, source, [manager], true));
    // ACP walks to root; use no root document to avoid intentionally mixed ancestors.
    access.docs.delete(`${root}.${sourceModel === "wac" ? "acl" : "acr"}`);
  }
  const events: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (init.method === "HEAD") {
      const current = await storage.head(url, { ...(init.signal ? { signal: init.signal } : {}) });
      const model = url.startsWith(target) ? destinationModel : sourceModel;
      access.advertise(url, `${url}.${model === "wac" ? "acl" : "acr"}`);
      const response = await access.fetch(input, init);
      const headers = new Headers(response.headers);
      if (current.etag) headers.set("etag", current.etag);
      return new Response(null, { headers });
    }
    const response = await access.fetch(input, init);
    events.push(`${init.method === "PUT" ? "access-write" : "access-read"}:${url}`);
    return response;
  };
  vi.spyOn(storage, "move");
  const create = storage.create.bind(storage);
  vi.spyOn(storage, "create").mockImplementation(async (...args) => {
    const result = await create(...args);
    events.push(`placeholder:${result.url}`);
    if (result.url.startsWith(target)) expect(args[1]).toBe("");
    return result;
  });
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementation(async (...args) => {
    events.push(`content:${args[0]}`);
    return write(...args);
  });
  const remove = storage.delete.bind(storage);
  vi.spyOn(storage, "delete").mockImplementation(async (...args) => {
    events.push(`delete:${args[0]}`);
    await remove(...args);
    access.docs.delete(`${args[0]}.acl`);
    access.docs.delete(`${args[0]}.acr`);
  });
  async function item(
    name = "file",
    entries = [manager, selection()],
    container = false,
    parent = source,
  ) {
    const result = await storage.create(parent, container ? null : "secret", {
      name,
      ...(container ? { kind: "container" as const } : { contentType: "text/plain" }),
    });
    access.attach(result.url, await fixture(sourceModel, result.url, entries, container));
    return result.url;
  }
  const options = { fetch, root, webId: owner };
  return { storage, source, target, access, item, options, events };
}
const realMoveGrants = client.moveGrants;
afterEach(() => vi.restoreAllMocks());
async function ownBob(url: string, options: Parameters<typeof readGrants>[1]) {
  return (await readGrants(url, options)).grants.find(
    (g) => g.agent.type === "webid" && g.agent.id === bob && !g.inherited,
  );
}

describe.each(["wac", "acp"] as const)("%s emulated moves", (model) => {
  test("keeps bob viewer and resource bytes under the returned name", async () => {
    const f = await setup(model);
    const from = await f.item();
    const result = await movePreservingAccess(f.storage, from, f.target, {
      ...f.options,
      name: "new name",
    });
    expect(result).toEqual({
      url: `${f.target}new%20name`,
      preserved: true,
      reapplied: [`${f.target}new%20name`],
      dropped: [],
    });
    expect(await ownBob(result.url, f.options)).toMatchObject({ role: "viewer" });
    expect(await (await f.storage.read(result.url)).text()).toBe("secret");
    await expect(f.storage.head(from)).rejects.toMatchObject({ code: "not-found" });
  });
  test("keeps folder/member scope and descendant grants by relative path", async () => {
    const f = await setup(model);
    const from = await f.item("tree", [manager, selection()], true);
    const nested = await f.item("nested", [manager], true, from);
    await f.item("child", [manager, selection()], false, nested);
    const result = await movePreservingAccess(f.storage, from, f.target, f.options);
    expect(result.reapplied).toEqual([
      `${f.target}tree/`,
      `${f.target}tree/nested/`,
      `${f.target}tree/nested/child`,
    ]);
    expect(await ownBob(result.url, { ...f.options, kind: "folder" })).toMatchObject({
      role: "viewer",
    });
    expect(await ownBob(`${result.url}nested/child`, f.options)).toMatchObject({ role: "viewer" });
  });
  test("does not copy inherited grants or materialise destination defaults", async () => {
    const f = await setup(model);
    f.access.attach(f.source, await fixture(model, f.source, [manager, selection()], true));
    f.access.attach(
      f.target,
      await fixture(model, f.target, [manager, selection("editor", { type: "public" })], true),
    );
    const from = (
      await f.storage.create(f.source, "secret", { name: "inherited", contentType: "text/plain" })
    ).url;
    expect(
      (await readGrants(from, f.options)).grants.some(
        (g) => g.inherited && g.agent.type === "webid" && g.agent.id === bob,
      ),
    ).toBe(true);
    const result = await movePreservingAccess(f.storage, from, f.target, f.options);
    expect(result.preserved).toBe(true);
    expect(result.dropped).toEqual([]);
    expect(await ownBob(result.url, f.options)).toBeUndefined();
    expect(f.access.docs.has(`${result.url}.${model === "wac" ? "acl" : "acr"}`)).toBe(false);
    const grants = (await readGrants(result.url, f.options)).grants;
    expect(grants.every((g) => g.inherited)).toBe(true);
    expect(grants.some((g) => g.agent.type === "public")).toBe(true);
  });
  test("restores original data and roles when an access PUT fails", async () => {
    const f = await setup(model);
    const from = await f.item();
    f.access.intercept((url, init) =>
      url.startsWith(f.target) && init.method === "PUT"
        ? new Response(null, { status: 500 })
        : undefined,
    );
    await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
      code: "conflict",
      step: "reapply",
      from,
      to: `${f.target}file`,
    });
    expect(await (await f.storage.read(from)).text()).toBe("secret");
    expect(await ownBob(from, f.options)).toMatchObject({ role: "viewer" });
    await expect(f.storage.head(`${f.target}file`)).rejects.toMatchObject({ code: "not-found" });
    expect(f.storage.move).not.toHaveBeenCalled();
  });
});

test("native LWS moves do not read or write access", async () => {
  const storage = createMemoryStorage({ protocol: "lws", root, moveResource: true });
  const from = (await storage.create(root, "secret", { contentType: "text/plain" })).url;
  const target = (await storage.create(root, null, { kind: "container" })).url;
  const fetch = vi.fn<typeof globalThis.fetch>();
  const result = await movePreservingAccess(storage, from, target, { fetch, webId: owner });
  expect(result).toEqual({ url: expect.any(String), preserved: true, reapplied: [], dropped: [] });
  expect(await (await storage.read(result.url)).text()).toBe("secret");
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  false,
  true,
])("unsupported WAC group on ACP destination: acceptReset %s", async (acceptReset) => {
  const f = await setup("wac", "acp");
  const group = selection("viewer", { type: "group", id: "https://groups.example/team" });
  const from = await f.item("group", [manager, group]);
  const move = movePreservingAccess(f.storage, from, f.target, { ...f.options, acceptReset });
  if (!acceptReset) {
    await expect(move).rejects.toMatchObject({ code: "unsupported", feature: "accessControl" });
    expect(f.storage.move).not.toHaveBeenCalled();
    expect(f.access.writes()).toEqual([]);
  } else {
    const result = await move;
    expect(result.preserved).toBe(false);
    expect(result.dropped).toEqual([
      {
        url: from,
        grant: { ...group, source: `${from}.acl` },
        reason: expect.stringContaining("Identity"),
      },
    ]);
    expect(
      (await readGrants(result.url, f.options)).grants.some((g) => g.agent.type === "group"),
    ).toBe(false);
  }
});

test("cap counts root and all members and refuses before access writes or moves", async () => {
  const f = await setup();
  const from = await f.item("large", [manager], true);
  for (let i = 0; i < 2000; i++)
    await f.storage.create(from, "", { name: String(i), contentType: "text/plain" });
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "unsupported",
    feature: "move",
  });
  expect(f.storage.move).not.toHaveBeenCalled();
  expect(f.access.writes()).toEqual([]);
});

test.each([
  null,
  "*",
  'W/"1"',
  '"one", "two"',
])("unusable move ETag %s refuses before any mutation", async (etag) => {
  const f = await setup();
  const from = await f.item();
  const head = await f.storage.head(from);
  vi.spyOn(f.storage, "head").mockResolvedValue({ ...head, etag });
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "precondition-required",
  });
  expect(f.storage.move).not.toHaveBeenCalled();
});

test("unknown native capability cannot bypass access; emulated LWS refuses", async () => {
  const storage = createMemoryStorage({ protocol: "lws", root, moveResource: true });
  storage.features.move.state = "unknown";
  const from = (await storage.create(root, "secret", { contentType: "text/plain" })).url;
  await expect(
    movePreservingAccess(storage, from, root, { fetch: vi.fn(), webId: owner }),
  ).rejects.toMatchObject({ code: "unsupported" });
});

test("separate comments and unrepresentable folder scopes refuse before moving", async () => {
  const f = await setup();
  const from = await f.item();
  await expect(
    movePreservingAccess(f.storage, from, f.target, { ...f.options, commentsContainer: f.source }),
  ).rejects.toMatchObject({ code: "unsupported" });
  const folder = await f.item("folder", [manager], true);
  f.access.attach(folder, await fixture("wac", folder, [manager], false));
  await expect(movePreservingAccess(f.storage, folder, f.target, f.options)).rejects.toMatchObject({
    code: "partial-scope",
  });
  expect(f.storage.move).not.toHaveBeenCalled();
});

test("partial raw modes cannot be silently lost or widened through a projected role", async () => {
  const f = await setup();
  const from = await f.item();
  const body = await fixture("wac", from, [manager, selection("editor")]);
  f.access.attach(
    from,
    body.replaceAll("http://www.w3.org/ns/auth/acl#Read", "http://www.w3.org/ns/auth/acl#Append"),
  );
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(f.storage.move).not.toHaveBeenCalled();
});

test("destination and source scope are checked before access requests", async () => {
  const f = await setup();
  const from = await f.item();
  for (const [source, destination] of [
    [from, "https://foreign.example/"],
    ["https://foreign.example/file", f.target],
  ])
    await expect(
      movePreservingAccess(f.storage, source as string, destination as string, f.options),
    ).rejects.toMatchObject({ code: "scope" });
  expect(f.access.calls).toEqual([]);
});

test("a successful folder grant write is undone when a descendant fails", async () => {
  const f = await setup();
  const from = await f.item("tree", [manager, selection()], true);
  const child = await f.item("child", [manager, selection("editor")], false, from);
  f.access.intercept((url, init) =>
    url === `${f.target}tree/child.acl` && init.method === "PUT"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "reapply",
  });
  expect(await ownBob(from, { ...f.options, kind: "folder" })).toMatchObject({ role: "viewer" });
  expect(await ownBob(child, f.options)).toMatchObject({ role: "editor" });
  await expect(f.storage.head(`${f.target}tree/`)).rejects.toMatchObject({ code: "not-found" });
});

test("auxiliary ACL/ACR and advertised policy/metadata members are not role targets", async () => {
  const f = await setup();
  const from = await f.item("tree", [manager], true);
  for (const name of ["file.acl", "file.acr", "policy", "metadata"])
    await f.storage.create(from, "auxiliary", { name, contentType: "text/plain" });
  await f.item("file", [manager, selection()], false, from);
  const head = f.storage.head.bind(f.storage);
  vi.spyOn(f.storage, "head").mockImplementation(async (...args) => {
    const result = await head(...args);
    if (args[0] !== `${from}file`) return { ...result, metadataUrl: null };
    return {
      ...result,
      metadataUrl: `${from}metadata`,
      links: new Map([
        ["http://www.w3.org/ns/solid/acp#accessControl", [{ target: `${from}policy`, params: {} }]],
        ["describedby", [{ target: `${from}metadata`, params: {} }]],
      ]),
    };
  });
  const controller = new AbortController();
  const result = await movePreservingAccess(f.storage, from, f.target, {
    ...f.options,
    signal: controller.signal,
  });
  expect(result.reapplied).toEqual([`${f.target}tree/`, `${f.target}tree/file`]);
});

test.each([
  "duplicate",
  "self",
  "foreign-descendant",
])("%s listing refuses before moves", async (kind) => {
  const f = await setup();
  const from = await f.item("tree", [manager], true);
  const child = await f.item("child", [manager], false, from);
  const entries = await f.storage.list(from);
  const entry = entries.items[0];
  if (!entry) throw new Error("Missing child");
  vi.spyOn(f.storage, "listAll").mockImplementation(async function* () {
    if (kind === "duplicate") {
      yield entry;
      yield entry;
    } else yield { ...entry, url: kind === "self" ? from : child.replace("tree/", "elsewhere/") };
  });
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(f.storage.move).not.toHaveBeenCalled();
});

test("abort during listing starts no access writes or moves", async () => {
  const f = await setup();
  const from = await f.item("tree", [manager], true);
  await f.item("child", [manager], false, from);
  const entry = (await f.storage.list(from)).items[0];
  if (!entry) throw new Error("Missing child");
  const controller = new AbortController();
  vi.spyOn(f.storage, "listAll").mockImplementation(async function* (_url, opts) {
    expect(opts?.signal).toBe(controller.signal);
    controller.abort();
    yield entry;
  });
  await expect(
    movePreservingAccess(f.storage, from, f.target, { ...f.options, signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(f.storage.move).not.toHaveBeenCalled();
});

test("the exact 2000-resource boundary succeeds", async () => {
  const f = await setup();
  const from = await f.item("large", [manager], true);
  for (let i = 0; i < 1999; i++)
    await f.storage.create(from, "", { name: String(i), contentType: "text/plain" });
  // Isolate the traversal boundary from 2000 independent HTTP role plans.
  vi.spyOn(client, "moveGrants").mockImplementation(async (url) => ({
    grants: [],
    ownUrl: `${url}.acl`,
    ownEtag: undefined,
    resourceEtag: (await f.storage.head(url)).etag,
  }));
  vi.spyOn(client, "planMoveGrants").mockResolvedValue();
  vi.spyOn(client, "setGrants").mockImplementation(async (urls) => ({
    applied: urls,
    failed: [],
    notification: { requested: false, delivered: false },
  }));
  const result = await movePreservingAccess(f.storage, from, f.target, f.options);
  expect(result.reapplied).toHaveLength(0);
  expect(result.preserved).toBe(true);
}, 60_000);

test.each([
  "purpose",
  "expiresAt",
] as const)("a conditional %s grant is never made unconditional", async (field) => {
  const f = await setup();
  const from = await f.item();
  const grant = {
    ...selection(),
    [field]: field === "purpose" ? "https://example.org/work" : new Date("2027-01-01Z"),
  };
  const original = await client.moveGrants(from, f.options);
  vi.spyOn(client, "moveGrants").mockImplementation(async (url, opts) =>
    url === from ? { ...original, grants: [manager, grant] } : realMoveGrants(url, opts),
  );
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "unsupported",
    feature: "accessControl",
  });
  expect(f.storage.move).not.toHaveBeenCalled();
  const result = await movePreservingAccess(f.storage, from, f.target, {
    ...f.options,
    acceptReset: true,
  });
  expect(result.preserved).toBe(false);
  expect(result.dropped[0]?.grant).toEqual(grant);
  expect(await ownBob(result.url, f.options)).toBeUndefined();
});

test("role mapping refusals propagate before moving", async () => {
  const f = await setup();
  const from = await f.item();
  vi.spyOn(client, "moveGrants").mockResolvedValue({
    ...(await client.moveGrants(from, f.options)),
    grants: [manager, selection("commenter")],
  });
  await expect(
    movePreservingAccess(f.storage, from, f.target, { ...f.options, kind: "document" }),
  ).rejects.toMatchObject({ code: "comments-container-required" });
  expect(f.storage.move).not.toHaveBeenCalled();
});

test("manager lockout is not accepted as a reset", async () => {
  const f = await setup();
  const from = await f.item();
  vi.spyOn(client, "moveGrants").mockResolvedValue({
    ...(await client.moveGrants(from, f.options)),
    grants: [selection()],
  });
  vi.mocked(f.storage.create).mockClear();
  await expect(
    movePreservingAccess(f.storage, from, f.target, { ...f.options, acceptReset: true }),
  ).rejects.toMatchObject({ code: "owner-lockout" });
  expect(f.storage.move).not.toHaveBeenCalled();
  expect(f.storage.create).not.toHaveBeenCalled();
  expect(f.storage.write).not.toHaveBeenCalled();
  expect(f.access.writes()).toEqual([]);
});

test("internal own snapshots support default resource kind and ESS ACR management", async () => {
  const f = await setup();
  const from = await f.item();
  expect((await client.moveGrants(from, f.options)).grants).toHaveLength(2);
  const { writeAcp } = await import("../index.js");
  const { policy, grant } = await import("../../test/helpers.js");
  const body = await writeAcp(
    policy(
      grant([[{ kind: "agent", webId: owner }]], {
        modes: new Set(["read", "write", "append", "control"]),
      }),
    ),
    from,
    `${from}.acr`,
    "ess",
  );
  const ess = memoryAccess("acp");
  ess.attach(from, body);
  // ESS ACR-management declarations are projected back to a manager role.
  expect(
    (await client.moveGrants(from, { ...ess.options, implementation: "ess" })).grants[0]?.role,
  ).toBe("manager");
});

describe.each(["wac", "acp"] as const)("%s staging safety", (model) => {
  test("orders empty placeholder, own access write/read-back, content, then source deletion", async () => {
    const f = await setup(model);
    const from = await f.item("tree", [manager, selection()], true);
    const child = await f.item("child", [manager, selection()], false, from);
    const result = await movePreservingAccess(f.storage, from, f.target, f.options);
    const suffix = model === "wac" ? ".acl" : ".acr";
    for (const url of [result.url, `${result.url}child`]) {
      const created = f.events.indexOf(`placeholder:${url}`);
      const accessWrite = f.events.indexOf(`access-write:${url}${suffix}`);
      const readBack = f.events.indexOf(`access-read:${url}${suffix}`, accessWrite + 1);
      const next = f.events.indexOf(
        url === result.url ? `placeholder:${url}child` : `content:${url}`,
      );
      expect(created).toBeGreaterThan(-1);
      expect(accessWrite).toBeGreaterThan(created);
      expect(readBack).toBeGreaterThan(accessWrite);
      expect(next).toBeGreaterThan(readBack);
    }
    expect(f.events.indexOf(`delete:${child}`)).toBeGreaterThan(
      f.events.indexOf(`content:${result.url}child`),
    );
    expect(f.events.indexOf(`delete:${from}`)).toBeGreaterThan(f.events.indexOf(`delete:${child}`));
    expect(f.storage.move).not.toHaveBeenCalled();
    const deletion = vi.mocked(f.storage.delete).mock.calls.find(([url]) => url === child);
    expect(deletion?.[1]?.ifMatch).toMatch(/^"/);
  });

  test.each([
    false,
    true,
  ])("destination without caller Control refuses before any write (own absent %s)", async (absent) => {
    const f = await setup(model);
    const from = await f.item();
    if (absent) f.access.docs.delete(`${from}.${model === "wac" ? "acl" : "acr"}`);
    f.access.attach(f.target, await fixture(model, f.target, [selection()], true));
    f.access.attach(root, await fixture(model, root, [selection()], true));
    vi.mocked(f.storage.create).mockClear();
    await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
      code: "owner-lockout",
    });
    expect(f.storage.create).not.toHaveBeenCalled();
    expect(f.storage.write).not.toHaveBeenCalled();
    expect(f.storage.delete).not.toHaveBeenCalled();
    expect(f.access.writes()).toEqual([]);
  });

  test.each([
    "change",
    "appear",
    "disappear",
  ])("source own access %s after content aborts with source intact", async (change) => {
    const f = await setup(model);
    const from = await f.item();
    const endpoint = `${from}.${model === "wac" ? "acl" : "acr"}`;
    if (change === "appear") f.access.docs.delete(endpoint);
    const changed = await fixture(model, from, [manager, selection("editor")]);
    const write = required(vi.mocked(f.storage.write).getMockImplementation());
    vi.spyOn(f.storage, "write").mockImplementationOnce(async (...args) => {
      const result = await write(...args);
      if (change === "disappear") f.access.docs.delete(endpoint);
      else f.access.put(endpoint, changed, '"changed"');
      return result;
    });
    await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
      code: "conflict",
      step: "reapply",
      cause: { code: "conflict" },
    });
    expect(await (await f.storage.read(from)).text()).toBe("secret");
    await expect(f.storage.head(`${f.target}file`)).rejects.toMatchObject({ code: "not-found" });
    expect(vi.mocked(f.storage.delete).mock.calls.every(([url]) => url.startsWith(f.target))).toBe(
      true,
    );
  });

  test("an access change during placeholder creation aborts before access reapplication or content", async () => {
    const f = await setup(model);
    const from = await f.item();
    const endpoint = `${from}.${model === "wac" ? "acl" : "acr"}`;
    const doc = required(f.access.docs.get(endpoint));
    const create = required(vi.mocked(f.storage.create).getMockImplementation());
    vi.spyOn(f.storage, "create").mockImplementationOnce(async (...args) => {
      const result = await create(...args);
      f.access.put(endpoint, doc.body, '"new"');
      return result;
    });
    await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
      step: "reapply",
      cause: { code: "conflict" },
    });
    expect(f.access.writes()).toEqual([]);
    expect(f.storage.write).not.toHaveBeenCalled();
    expect(await (await f.storage.read(from)).text()).toBe("secret");
  });

  test("ACL read-back mismatch refuses content and cleans up", async () => {
    const f = await setup(model);
    const from = await f.item();
    const wrong = await fixture(model, `${f.target}file`, [manager]);
    f.access.intercept((url, init) => {
      if (url === `${f.target}file.${model === "wac" ? "acl" : "acr"}` && init.method === "PUT")
        return new Response(null, { status: 204 }); // Server acknowledges but does not persist.
      if (url === `${f.target}file.${model === "wac" ? "acl" : "acr"}` && init.method !== "HEAD")
        return new Response(wrong, { headers: { "content-type": "text/turtle", etag: '"wrong"' } });
      return undefined;
    });
    await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
      step: "reapply",
    });
    expect(f.storage.write).not.toHaveBeenCalled();
    await expect(f.storage.head(`${f.target}file`)).rejects.toMatchObject({ code: "not-found" });
  });

  test("cleanup failure retains a protected copy and both causes", async () => {
    const f = await setup(model);
    const from = await f.item();
    const original = new Error("content unavailable");
    const cleanup = new Error("cannot clean up");
    vi.spyOn(f.storage, "write").mockRejectedValueOnce(original);
    vi.spyOn(f.storage, "delete").mockRejectedValueOnce(cleanup);
    await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
      step: "rollback-failed",
      from,
      to: `${f.target}file`,
      cause: { errors: [original, cleanup] },
    });
    expect(await ownBob(`${f.target}file`, f.options)).toMatchObject({ role: "viewer" });
    expect(await (await f.storage.read(from)).text()).toBe("secret");
  });

  test("failure during source deletion retains all verified copies and never recreates data", async () => {
    const f = await setup(model);
    const from = await f.item("tree", [manager, selection()], true);
    const child = await f.item("child", [manager, selection()], false, from);
    const remove = required(vi.mocked(f.storage.delete).getMockImplementation());
    vi.spyOn(f.storage, "delete").mockImplementation(async (...args) => {
      if (args[0] === from) throw new Error("delete failed");
      return remove(...args);
    });
    await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
      step: "source-delete",
      from,
      to: `${f.target}tree/`,
      url: `${f.target}tree/`,
    });
    expect(await ownBob(`${f.target}tree/child`, f.options)).toMatchObject({ role: "viewer" });
    expect(await (await f.storage.read(`${f.target}tree/child`)).text()).toBe("secret");
    await expect(f.storage.head(child)).rejects.toMatchObject({ code: "not-found" });
    expect((await f.storage.head(from)).kind).toBe("container");
    expect(vi.mocked(f.storage.delete).mock.calls.every(([url]) => url.startsWith(from))).toBe(
      true,
    );
    expect(f.storage.move).not.toHaveBeenCalled();
  });
});

test.each([
  "before",
  "snapshot",
  "placeholder",
  "access",
  "content",
])("abort at %s cleans up before deletion", async (when) => {
  const f = await setup();
  const from = await f.item();
  const controller = new AbortController();
  if (when === "before") controller.abort();
  if (when === "snapshot" || when === "access")
    f.access.intercept((url, init) => {
      if (when === "snapshot" || (url.startsWith(f.target) && init.method === "PUT"))
        controller.abort();
      return undefined;
    });
  if (when === "placeholder") {
    const create = required(vi.mocked(f.storage.create).getMockImplementation());
    vi.spyOn(f.storage, "create").mockImplementationOnce(async (...args) => {
      const result = await create(...args);
      controller.abort();
      return result;
    });
  }
  if (when === "content") {
    const write = required(vi.mocked(f.storage.write).getMockImplementation());
    vi.spyOn(f.storage, "write").mockImplementationOnce(async (...args) => {
      const result = await write(...args);
      controller.abort();
      return result;
    });
  }
  await expect(
    movePreservingAccess(f.storage, from, f.target, { ...f.options, signal: controller.signal }),
  ).rejects.toMatchObject(
    ["before", "snapshot"].includes(when) ? { name: "AbortError" } : { step: "reapply" },
  );
  expect(await (await f.storage.read(from)).text()).toBe("secret");
  await expect(f.storage.head(`${f.target}file`)).rejects.toMatchObject({ code: "not-found" });
});

test("explicit WAC-Allow denial at destination refuses even with a manager row", async () => {
  const f = await setup();
  const from = await f.item();
  const head = f.storage.head.bind(f.storage);
  vi.spyOn(f.storage, "head").mockImplementation(async (...args) => {
    const current = await head(...args);
    return args[0] === f.target
      ? { ...current, allow: { read: true, write: true, append: true, control: false } }
      : current;
  });
  vi.mocked(f.storage.create).mockClear();
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(f.storage.create).not.toHaveBeenCalled();
});

test("an empty own selection still requires destination management", async () => {
  const f = await setup();
  const from = await f.item("empty", []);
  f.access.attach(f.target, await fixture("wac", f.target, [selection()], true));
  vi.mocked(f.storage.create).mockClear();
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "owner-lockout",
  });
  expect(f.storage.create).not.toHaveBeenCalled();
});

test.each([
  "root",
  "destination",
  "cycle",
])("refuses invalid %s move before writing", async (kind) => {
  const f = await setup();
  const from = await f.item("tree", [manager], true);
  vi.mocked(f.storage.create).mockClear();
  await expect(
    movePreservingAccess(
      f.storage,
      kind === "root" ? root : from,
      kind === "cycle" ? from : kind === "destination" ? f.target.slice(0, -1) : f.target,
      f.options,
    ),
  ).rejects.toMatchObject({ code: kind === "cycle" ? "conflict" : "unsupported" });
  expect(f.storage.create).not.toHaveBeenCalled();
});

test.each([
  "",
  ".",
  "..",
  "a/b",
  "a\\b",
  "\u0001",
  "\u0080",
])("rejects unsafe explicit name %j", async (name) => {
  const f = await setup();
  const from = await f.item();
  await expect(
    movePreservingAccess(f.storage, from, f.target, { ...f.options, name }),
  ).rejects.toMatchObject({ code: "bad-request" });
});

test.each([
  "container",
  "roles",
])("source %s change during preflight is a conflict before writes", async (where) => {
  const f = await setup();
  const from = await f.item("tree", [manager], true);
  if (where === "container") {
    const readRdf = f.storage.readRdf.bind(f.storage);
    vi.spyOn(f.storage, "readRdf").mockImplementationOnce(async (...args) => ({
      ...(await readRdf(...args)),
      etag: '"changed"',
    }));
  } else {
    vi.spyOn(client, "moveGrants").mockResolvedValueOnce({
      ...(await client.moveGrants(from, { ...f.options, kind: "folder" })),
      resourceEtag: '"changed"',
    });
  }
  vi.mocked(f.storage.create).mockClear();
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "conflict",
  });
  expect(f.storage.create).not.toHaveBeenCalled();
});

test("unexpected create Location is cleaned up without writing content", async () => {
  const f = await setup();
  const from = await f.item();
  const create = required(vi.mocked(f.storage.create).getMockImplementation());
  vi.spyOn(f.storage, "create").mockImplementationOnce((url, body, opts) =>
    create(url, body, { ...opts, name: "different" }),
  );
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "reapply",
    cause: { code: "conflict" },
  });
  expect(f.storage.write).not.toHaveBeenCalled();
  await expect(f.storage.head(`${f.target}different`)).rejects.toMatchObject({ code: "not-found" });
});

test.each([
  "etag",
  "type",
])("GET %s is checked before creating the placeholder", async (changed) => {
  const f = await setup();
  const from = await f.item();
  const read = f.storage.read.bind(f.storage);
  vi.spyOn(f.storage, "read").mockImplementationOnce(async (...args) => ({
    ...(await read(...args)),
    ...(changed === "etag" ? { etag: '"changed"' } : { contentType: "invalid type" }),
  }));
  vi.mocked(f.storage.create).mockClear();
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "reapply",
    cause: { code: changed === "etag" ? "conflict" : "invalid-response" },
  });
  expect(f.storage.create).not.toHaveBeenCalled();
  expect(f.storage.write).not.toHaveBeenCalled();
});

test("missing GET media type refuses; HEAD media type is optional and null body copies empty", async () => {
  const f = await setup();
  const from = await f.item();
  const read = f.storage.read.bind(f.storage);
  vi.spyOn(f.storage, "read").mockImplementationOnce(async (...args) => ({
    ...(await read(...args)),
    contentType: null,
  }));
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "reapply",
    cause: { code: "invalid-response" },
  });
  const head = f.storage.head.bind(f.storage);
  vi.spyOn(f.storage, "head").mockImplementationOnce(async (...args) => ({
    ...(await head(...args)),
    contentType: null,
  }));
  vi.mocked(f.storage.read).mockImplementationOnce(async (...args) => ({
    ...(await read(...args)),
    body: null,
  }));
  const result = await movePreservingAccess(f.storage, from, f.target, f.options);
  expect(await (await f.storage.read(result.url)).text()).toBe("");
});

test.each([
  "absent",
  "different",
])("own access %s on the second verification refuses content", async (change) => {
  const f = await setup();
  const from = await f.item();
  vi.spyOn(client, "moveGrants").mockImplementation(async (url, opts) => {
    const current = await realMoveGrants(url, opts);
    return url.startsWith(f.target)
      ? { ...current, ...(change === "absent" ? { ownEtag: undefined } : { grants: [manager] }) }
      : current;
  });
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "reapply",
  });
  expect(f.storage.write).not.toHaveBeenCalled();
});

test.each([
  "management",
  "own-grants",
])("destination %s changing after content aborts before source deletion", async (change) => {
  const f = await setup();
  const from = await f.item();
  const write = required(vi.mocked(f.storage.write).getMockImplementation());
  vi.spyOn(f.storage, "write").mockImplementationOnce(async (...args) => {
    const result = await write(...args);
    f.access.attach(
      args[0],
      await fixture(
        "wac",
        args[0],
        change === "management" ? [selection()] : [manager, selection("editor")],
      ),
    );
    return result;
  });
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "reapply",
    cause: { code: "conflict" },
  });
  expect(await (await f.storage.read(from)).text()).toBe("secret");
});

test("source bytes and auxiliary changes after staging both prevent deletion", async () => {
  for (const auxiliary of [false, true]) {
    const f = await setup();
    const from = await f.item("tree", [manager], true);
    const child = await f.item("child", [manager, selection()], false, from);
    const aux = await f.storage.create(from, "metadata", {
      name: "child.acl",
      contentType: "text/plain",
    });
    const write = required(vi.mocked(f.storage.write).getMockImplementation());
    vi.spyOn(f.storage, "write").mockImplementation(async (...args) => {
      const result = await write(...args);
      if (args[0].startsWith(f.target)) {
        const url = auxiliary ? aux.url : child;
        await write(url, "changed", {
          contentType: "text/plain",
          ifMatch: (await f.storage.head(url)).etag as string,
        });
      }
      return result;
    });
    await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
      step: "reapply",
      cause: { code: "conflict" },
    });
    expect(vi.mocked(f.storage.delete).mock.calls.every(([url]) => url.startsWith(f.target))).toBe(
      true,
    );
    vi.restoreAllMocks();
  }
});

test("auto-deleted source auxiliaries are skipped; other deletion failures stop", async () => {
  for (const code of ["not-found", "server"] as const) {
    const f = await setup();
    const from = await f.item("tree", [manager], true);
    const child = await f.item("child", [manager], false, from);
    const aux = await f.storage.create(from, "policy", {
      name: "child.acl",
      contentType: "text/plain",
    });
    const remove = required(vi.mocked(f.storage.delete).getMockImplementation());
    vi.spyOn(f.storage, "delete").mockImplementation(async (...args) => {
      if (args[0] === aux.url) throw new StorageError(code, { url: aux.url, method: "DELETE" });
      await remove(...args);
      if (args[0] === child) await remove(aux.url, { ifMatch: aux.etag as string });
    });
    const move = movePreservingAccess(f.storage, from, f.target, f.options);
    if (code === "not-found") expect((await move).preserved).toBe(true);
    else
      await expect(move).rejects.toMatchObject({
        step: "source-delete",
        cause: { code: "server" },
      });
    vi.restoreAllMocks();
  }
});

test("listed container ACL is removed only after its protected children", async () => {
  const f = await setup();
  const from = await f.item("tree", [manager], true);
  const child = await f.item("child", [manager], false, from);
  const aux = await f.storage.create(from, "policy", { name: ".acl", contentType: "text/plain" });
  const result = await movePreservingAccess(f.storage, from, f.target, f.options);
  expect(result.preserved).toBe(true);
  expect(f.events.indexOf(`delete:${aux.url}`)).toBeGreaterThan(
    f.events.indexOf(`delete:${child}`),
  );
  expect(f.events.indexOf(`delete:${from}`)).toBeGreaterThan(f.events.indexOf(`delete:${aux.url}`));
});

test("refuses auxiliary placement that would remove source access before its resource", async () => {
  const f = await setup();
  const from = await f.item("tree", [manager], true);
  const child = await f.item("child", [manager], false, from);
  const nested = await f.item("nested", [manager], true, from);
  const aux = await f.storage.create(nested, "policy", { name: "own", contentType: "text/plain" });
  f.access.put(aux.url, await fixture("wac", child, [manager]));
  f.access.intercept((url, init) =>
    url === child && init.method === "HEAD"
      ? new Response(null, { headers: { link: `<${aux.url}>; rel="acl"` } })
      : undefined,
  );
  const head = f.storage.head.bind(f.storage);
  vi.spyOn(f.storage, "head").mockImplementation(async (...args) => {
    const result = await head(...args);
    return args[0] === child
      ? { ...result, links: new Map([["acl", [{ target: aux.url, params: {} }]]]) }
      : result;
  });
  vi.mocked(f.storage.create).mockClear();
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "unsupported",
    message: expect.stringContaining("safely ordered"),
  });
  expect(f.storage.create).not.toHaveBeenCalled();
});

test("an empty own ACP document is installed before content instead of becoming absent", async () => {
  const f = await setup("acp");
  const from = await f.item("empty", []);
  const result = await movePreservingAccess(f.storage, from, f.target, f.options);
  expect(result.reapplied).toEqual([result.url]);
  expect((await client.moveGrants(result.url, f.options)).ownEtag).toMatch(/^"/);
  const accessWrite = f.events.indexOf(`access-write:${result.url}.acr`);
  expect(accessWrite).toBeGreaterThan(f.events.indexOf(`placeholder:${result.url}`));
  expect(f.events.indexOf(`content:${result.url}`)).toBeGreaterThan(accessWrite);
  expect((await readGrants(result.url, f.options)).grants.every((g) => g.inherited)).toBe(true);
});

test("an ambiguous content commit retains the protected copy when its old validator cannot clean it", async () => {
  const f = await setup();
  const from = await f.item();
  const write = required(vi.mocked(f.storage.write).getMockImplementation());
  vi.spyOn(f.storage, "write").mockImplementationOnce(async (...args) => {
    await write(...args);
    throw new Error("lost write acknowledgement");
  });
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "rollback-failed",
    from,
    to: `${f.target}file`,
    cause: {
      errors: [expect.any(Error), expect.objectContaining({ code: "precondition-failed" })],
    },
  });
  expect(await ownBob(`${f.target}file`, f.options)).toMatchObject({ role: "viewer" });
  expect(await (await f.storage.read(`${f.target}file`)).text()).toBe("secret");
  expect(await (await f.storage.read(from)).text()).toBe("secret");
});

test("cleanup continues after a child failure and retains its protected ancestor", async () => {
  const f = await setup();
  const from = await f.item("tree", [manager, selection()], true);
  await f.item("a", [manager, selection()], false, from);
  await f.item("b", [manager, selection()], false, from);
  const original = new Error("last copy failed");
  const write = required(vi.mocked(f.storage.write).getMockImplementation());
  vi.spyOn(f.storage, "write").mockImplementation(async (...args) => {
    if (args[0] === `${f.target}tree/b`) throw original;
    return write(...args);
  });
  const remove = required(vi.mocked(f.storage.delete).getMockImplementation());
  vi.spyOn(f.storage, "delete").mockImplementation(async (...args) => {
    if (args[0] === `${f.target}tree/b`) throw new Error("cannot clean b");
    return remove(...args);
  });
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "rollback-failed",
    cause: { errors: [original, expect.any(Error), expect.objectContaining({ code: "conflict" })] },
  });
  await expect(f.storage.head(`${f.target}tree/a`)).rejects.toMatchObject({ code: "not-found" });
  expect(await ownBob(`${f.target}tree/`, { ...f.options, kind: "folder" })).toMatchObject({
    role: "viewer",
  });
  expect(await ownBob(`${f.target}tree/b`, f.options)).toMatchObject({ role: "viewer" });
  expect(await (await f.storage.read(`${from}a`)).text()).toBe("secret");
  expect(await (await f.storage.read(`${from}b`)).text()).toBe("secret");
});

test.each([
  null,
  'W/"1"',
  "*",
])("unusable own-document ETag %s refuses before any write", async (etag) => {
  const f = await setup();
  const from = await f.item();
  const doc = required(f.access.docs.get(`${from}.acl`));
  f.access.put(`${from}.acl`, doc.body, etag);
  vi.mocked(f.storage.create).mockClear();
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    code: "precondition-required",
  });
  expect(f.storage.create).not.toHaveBeenCalled();
  expect(f.access.writes()).toEqual([]);
});
