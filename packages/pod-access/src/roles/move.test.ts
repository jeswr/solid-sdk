// AUTHORED-BY Codex GPT-6.1-Sol

import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  bob,
  fixture,
  manager,
  memoryAccess,
  owner,
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
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (init.method === "HEAD") {
      await storage.head(url, { ...(init.signal ? { signal: init.signal } : {}) });
      const model = url.startsWith(target) ? destinationModel : sourceModel;
      access.advertise(url, `${url}.${model === "wac" ? "acl" : "acr"}`);
    }
    return access.fetch(input, init);
  };
  const move = storage.move.bind(storage);
  vi.spyOn(storage, "move").mockImplementation(async (from, to, opts) => {
    const result = await move(from, to, opts);
    // Emulated Solid moves discard ACL/ACR documents, including all descendant documents.
    for (const url of access.docs.keys())
      if (
        url === `${from}.acl` ||
        url === `${from}.acr` ||
        (from.endsWith("/") && url.startsWith(from))
      )
        access.docs.delete(url);
    return result;
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
  return { storage, source, target, access, item, options };
}
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
    expect(f.storage.move).toHaveBeenCalledTimes(2);
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

test("setGrants throw and rollback move failure retain both URLs and both causes", async () => {
  const f = await setup();
  const from = await f.item();
  const error = new Error("set failed");
  vi.spyOn(client, "setGrants").mockRejectedValue(error);
  vi.mocked(f.storage.move).mockRejectedValueOnce(new Error("copy failed"));
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toThrow(
    "copy failed",
  );
  const move = vi.mocked(f.storage.move).getMockImplementation();
  if (!move) throw new Error("Missing move seam");
  vi.mocked(f.storage.move)
    .mockImplementationOnce(move)
    .mockRejectedValueOnce(new Error("cannot return"));
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "rollback-failed",
    from,
    to: `${f.target}file`,
    cause: { errors: [error, expect.any(Error)] },
  });
  expect(await (await f.storage.read(`${f.target}file`)).text()).toBe("secret");
});

test("rollback restore failure is distinct and names the returned original location", async () => {
  const f = await setup();
  const from = await f.item();
  vi.spyOn(client, "setGrants").mockRejectedValue(new Error("access down"));
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "rollback-failed",
    from,
    to: `${f.target}file`,
    url: from,
  });
  expect(await (await f.storage.read(from)).text()).toBe("secret");
});

test.each([
  "before",
  "snapshot",
  "after-move",
  "after-write",
])("abort %s is respected; recovery ignores the spent signal", async (when) => {
  const f = await setup();
  const from = await f.item();
  const controller = new AbortController();
  if (when === "before") controller.abort();
  if (when === "snapshot")
    f.access.intercept(() => {
      controller.abort();
      return undefined;
    });
  if (when === "after-move") {
    const move = vi.mocked(f.storage.move).getMockImplementation();
    if (!move) throw new Error("Missing seam");
    vi.mocked(f.storage.move).mockImplementationOnce(async (...args) => {
      const result = await move(...args);
      controller.abort();
      return result;
    });
  }
  if (when === "after-write")
    f.access.intercept((url, init) => {
      if (url.startsWith(f.target) && init.method === "PUT") controller.abort();
      return undefined;
    });
  await expect(
    movePreservingAccess(f.storage, from, f.target, { ...f.options, signal: controller.signal }),
  ).rejects.toMatchObject(when.startsWith("after") ? { step: "reapply" } : { name: "AbortError" });
  expect(await (await f.storage.read(from)).text()).toBe("secret");
  if (when.startsWith("after"))
    expect(await ownBob(from, f.options)).toMatchObject({ role: "viewer" });
  else expect(f.storage.move).not.toHaveBeenCalled();
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
  vi.spyOn(client, "moveGrants").mockResolvedValue([]);
  vi.spyOn(client, "planMoveGrants").mockResolvedValue();
  vi.spyOn(client, "setGrants").mockImplementation(async (urls) => ({
    applied: urls,
    failed: [],
    notification: { requested: false, delivered: false },
  }));
  const result = await movePreservingAccess(f.storage, from, f.target, f.options);
  expect(result.reapplied).toHaveLength(2000);
  expect(result.preserved).toBe(true);
});

test("an unexpected rollback Location is a rollback failure with the actual location", async () => {
  const f = await setup();
  const from = await f.item();
  const move = vi.mocked(f.storage.move).getMockImplementation();
  if (!move) throw new Error("Missing move seam");
  vi.mocked(f.storage.move)
    .mockImplementationOnce(move)
    .mockImplementationOnce((url, to, opts) => move(url, to, { ...opts, name: "different" }));
  vi.spyOn(client, "setGrants").mockRejectedValue(new Error("no access"));
  await expect(movePreservingAccess(f.storage, from, f.target, f.options)).rejects.toMatchObject({
    step: "rollback-failed",
    from,
    to: `${f.target}file`,
    url: `${f.source}different`,
  });
  expect(await (await f.storage.read(`${f.source}different`)).text()).toBe("secret");
});

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
  vi.spyOn(client, "moveGrants").mockResolvedValue([manager, grant]);
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
  vi.spyOn(client, "moveGrants").mockResolvedValue([manager, selection("commenter")]);
  await expect(
    movePreservingAccess(f.storage, from, f.target, { ...f.options, kind: "document" }),
  ).rejects.toMatchObject({ code: "comments-container-required" });
  expect(f.storage.move).not.toHaveBeenCalled();
});

test("manager lockout is not accepted as a reset", async () => {
  const f = await setup();
  const from = await f.item();
  vi.spyOn(client, "moveGrants").mockResolvedValue([selection()]);
  await expect(
    movePreservingAccess(f.storage, from, f.target, { ...f.options, acceptReset: true }),
  ).rejects.toMatchObject({ code: "owner-lockout" });
  expect(f.storage.move).not.toHaveBeenCalled();
});

test("ownOnly full-set removes unwanted explicit grants instead of materialising ancestors", async () => {
  const f = await setup();
  const from = await f.item();
  const move = vi.mocked(f.storage.move).getMockImplementation();
  if (!move) throw new Error("Missing move seam");
  vi.mocked(f.storage.move).mockImplementationOnce(async (...args) => {
    const result = await move(...args);
    f.access.attach(
      result.url,
      await fixture("wac", result.url, [manager, selection("editor", { type: "public" })]),
    );
    return result;
  });
  const result = await movePreservingAccess(f.storage, from, f.target, f.options);
  expect(
    (await readGrants(result.url, f.options)).grants.some((g) => g.agent.type === "public"),
  ).toBe(false);
  expect(await ownBob(result.url, f.options)).toMatchObject({ role: "viewer" });
});

test("internal own snapshots support default resource kind and ESS ACR management", async () => {
  const f = await setup();
  const from = await f.item();
  expect(await client.moveGrants(from, f.options)).toHaveLength(2);
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
  expect((await client.moveGrants(from, { ...ess.options, implementation: "ess" }))[0]?.role).toBe(
    "manager",
  );
});
