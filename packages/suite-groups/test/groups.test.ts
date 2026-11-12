// AUTHORED-BY Codex GPT-6.1-Sol

import { readWac } from "@jeswr/pod-access";
import {
  addGrant,
  type RoleGrant,
  readAccessModes,
  readGrants,
  removeGrant,
  setGrants,
} from "@jeswr/pod-access/roles";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_UNSUPPORTED, GroupDirectory, memberWebId } from "../src/index.js";

vi.mock("@jeswr/pod-access", () => ({ readWac: vi.fn() }));
vi.mock("@jeswr/pod-access/roles", async (original) => ({
  addGrant: vi.fn(),
  isGrantableTarget: (await original<typeof import("@jeswr/pod-access/roles")>()).isGrantableTarget,
  readAccessModes: vi.fn(),
  readGrants: vi.fn(),
  removeGrant: vi.fn(),
  setGrants: vi.fn(),
}));
// Role-level fixtures expand to the modes each role holds; raw-mode probes use real ACLs in
// owner-access.test.ts.
const MODES = {
  viewer: ["read"],
  commenter: ["read"],
  editor: ["append", "read", "write"],
  manager: ["append", "control", "read", "write"],
} as const;
const root = "https://pod.example/owner/";
const owner = "https://pod.example/profile#me";
const bob = "https://bob.example/#me";
const carol = "https://carol.example/#me";
const success = {
  applied: [],
  failed: [],
  notification: { requested: false, delivered: false as const },
};
let roles: Map<string, RoleGrant[]>;
function make() {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  Object.assign(storage.features.accessControl, { state: "available", detail: { model: "wac" } });
  const head = storage.head.bind(storage);
  vi.spyOn(storage, "head").mockImplementation(async (url, options) => ({
    ...(await head(url, options)),
    links: new Map([["acl", [{ target: `${url}.acl`, params: {} }]]]),
  }));
  const read = storage.readRdf.bind(storage);
  const accessGraph = new Store();
  SetFrom.subjectPredicate(
    new TermWrapper(`${root}.acl#rule`, accessGraph, DataFactory),
    "http://www.w3.org/ns/auth/acl#agentGroup",
    NamedNodeAs.string,
    NamedNodeFrom.string,
  ).add(`${root}groups/placeholder.ttl#this`);
  vi.spyOn(storage, "readRdf").mockImplementation(async (url, options) =>
    url.endsWith(".acl")
      ? { url, dataset: accessGraph, contentType: "text/turtle", etag: '"1"' }
      : read(url, options),
  );
  const notify = vi
    .fn()
    .mockResolvedValue({ delivered: true, inbox: "https://bob.example/inbox/" });
  return {
    storage,
    notify,
    directory: new GroupDirectory({ storage, fetch: vi.fn(), webId: owner }, notify),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  roles = new Map();
  vi.mocked(setGrants).mockImplementation(async (urls, grants) => {
    for (const url of urls) roles.set(url, grants);
    return success;
  });
  vi.mocked(readWac).mockImplementation((_dataset, url) => ({
    denials: [],
    grants: (roles.get(url) ?? [])
      .filter((grant) => !grant.inherited)
      .map((grant) => ({
        who: [
          [
            grant.agent.type === "group"
              ? { kind: "group", group: grant.agent.id }
              : { kind: "agent", webId: owner },
          ],
        ],
        modes: new Set(["read"]),
        appliesTo: "resource",
        except: [],
        source: { url: `${url}.acl`, node: "rule" },
      })),
  }));
  vi.mocked(readGrants).mockImplementation(async (url) => ({
    url,
    version: "version" as never,
    grants:
      roles.get(url) ??
      [...roles.entries()]
        .filter(([parent]) => parent.endsWith("/") && url.startsWith(parent))
        .sort(([a], [b]) => b.length - a.length)[0]?.[1]
        .map((grant) => ({ ...grant, inherited: true })) ??
      [],
  }));
  vi.mocked(readAccessModes).mockImplementation(async (url, options) => {
    const rows = (await readGrants(url, options)).grants.map((grant) => ({
      agent: grant.agent,
      modes: [...MODES[grant.role]],
    }));
    return { url, resource: rows, members: url.endsWith("/") ? rows : [], version: "v" as never };
  });
  vi.mocked(addGrant).mockImplementation(async (urls, grant) => {
    for (const url of urls) roles.set(url, [...(roles.get(url) ?? []), grant]);
    return success;
  });
  vi.mocked(removeGrant).mockImplementation(async (urls, agent) => {
    for (const url of urls)
      roles.set(
        url,
        (roles.get(url) ?? []).filter(
          (grant) => JSON.stringify(grant.agent) !== JSON.stringify(agent),
        ),
      );
    return success;
  });
});

describe("group storage and membership", () => {
  it("keeps labels separate, creates typed vCard groups and conditionally preserves unrelated RDF", async () => {
    const { directory, storage } = make();
    expect(await directory.list()).toEqual([]);
    const group = await directory.create("  Friends  ", [bob, bob]);
    expect(group).toMatchObject({ name: "Friends", members: [bob], family: false });
    expect(group.id).toContain(`${root}groups/`);
    const doc = group.id.split("#")[0] as string;
    const current = await storage.readRdf(doc);
    // An independent foreign statement survives every membership edit.
    const { ContactGroup } = await import("@jeswr/solid-task-model/contacts");
    const foreign = new ContactGroup(`${doc}#other`, current.dataset, DataFactory).mark();
    foreign.name = "Unrelated";
    await storage.writeRdf(doc, current.dataset, { ifMatch: current.etag as string });
    await directory.rename(group.id, "Club");
    await directory.addMember(group.id, carol);
    await directory.removeMember(group.id, bob);
    expect(await directory.list()).toEqual([{ ...group, name: "Club", members: [carol] }]);
    expect(
      new ContactGroup(`${doc}#other`, (await storage.readRdf(doc)).dataset, DataFactory).name,
    ).toBe("Unrelated");
    expect(setGrants).toHaveBeenCalledWith(
      [`${root}groups/`],
      expect.arrayContaining([
        expect.objectContaining({ agent: { type: "public" }, role: "viewer" }),
      ]),
      expect.objectContaining({ ownOnly: true, model: "wac" }),
    );
  });
  it("marks exactly one Family group in private settings", async () => {
    const { directory, storage } = make();
    const first = await directory.create("One");
    const second = await directory.create("Two");
    await directory.setFamily(first.id);
    await directory.setFamily(second.id);
    expect(
      (await directory.list()).filter((group) => group.family).map((group) => group.id),
    ).toEqual([second.id]);
    expect((await storage.read(`${root}settings/group-sharing/state.json`)).contentType).toBe(
      "application/json",
    );
    expect(setGrants).toHaveBeenCalledWith(
      [`${root}settings/group-sharing/`],
      [expect.objectContaining({ agent: { type: "webid", id: owner } })],
      expect.anything(),
    );
  });
  it.each(["", " ", "x".repeat(161)])("rejects invalid name %j", async (name) => {
    const { directory } = make();
    expect(() => directory.create(name)).toThrow();
    expect(() => directory.rename(`${root}groups/a.ttl#this`, name)).toThrow();
  });
  it.each([
    "mailto:x@y.example",
    "javascript:alert(1)",
    "https://u:p@example/#me",
    " https://bob.example/#me",
    "https://bob.example/#bad name",
    "https://bob.example/<x>",
    "not a url",
  ])("rejects member %s", (value) => {
    expect(() => memberWebId(value)).toThrow();
  });
  it.each([
    "https://outside.example/a.ttl#this",
    `${root}contacts/groups/a.ttl#this`,
    `${root}groups/a.ttl#other`,
    `${root}groups/a.ttl?q#this`,
    `${root}groups/%2e.ttl#this`,
  ])("rejects foreign/private group %s", (id) => {
    const { directory } = make();
    expect(() => directory.rename(id, "name")).toThrow();
    expect(() => directory.setFamily(id)).toThrow();
  });
  it.each(["acp", "odrl-grants", "none"])("rejects %s before I/O", (model) => {
    const { storage } = make();
    Object.assign(storage.features.accessControl, { detail: { model } });
    expect(() => new GroupDirectory({ storage, fetch: vi.fn(), webId: owner })).toThrow(
      GROUP_UNSUPPORTED,
    );
  });
  it("rejects unknown capabilities and LWS", () => {
    const { storage } = make();
    Object.assign(storage.features.accessControl, { state: "unknown" });
    expect(() => new GroupDirectory({ storage, fetch: vi.fn(), webId: owner })).toThrow(
      GROUP_UNSUPPORTED,
    );
    expect(
      () =>
        new GroupDirectory({
          storage: createMemoryStorage({ root, protocol: "lws" }),
          fetch: vi.fn(),
          webId: owner,
        }),
    ).toThrow(GROUP_UNSUPPORTED);
  });
  it("surfaces failed ACL provisioning without writing a group", async () => {
    const { directory } = make();
    vi.mocked(setGrants).mockResolvedValueOnce({
      ...success,
      failed: [{ url: root, error: new Error("Denied") }],
    });
    await expect(directory.create("X")).rejects.toThrow("Denied");
    expect(await directory.list()).toEqual([]);
  });
  it("does not overwrite a group whose ETag changed", async () => {
    const { directory, storage } = make();
    const group = await directory.create("X");
    const write = storage.writeRdf.bind(storage);
    vi.spyOn(storage, "writeRdf").mockImplementationOnce(async (url, dataset, opts) => {
      await write(url, dataset, opts);
      return write(url, dataset, opts);
    });
    await expect(directory.rename(group.id, "Y")).rejects.toMatchObject({
      code: "precondition-failed",
    });
    await directory.addMember(group.id, bob);
    expect((await directory.list())[0]?.members).toEqual([bob]);
  });
});

describe("sharing, invitations and Family", () => {
  it.each([
    "viewer",
    "editor",
    "manager",
  ] as const)("refuses existing settings with foreign %s access before trusting space URLs or sending notices", async (role) => {
    const { directory, storage, notify } = make();
    const group = await directory.create("Family", [bob]);
    await directory.setFamily(group.id);
    const url = `${root}settings/group-sharing/state.json`;
    const current = await storage.read(url);
    await storage.write(
      url,
      JSON.stringify({
        family: group.id,
        notices: [],
        spaces: { [JSON.stringify([group.id, "calendar"])]: [root] },
      }),
      { contentType: "application/json", ifMatch: current.etag as string },
    );
    roles.set(url, [
      { agent: { type: "webid", id: owner }, role: "manager", source: "", inherited: false },
      { agent: { type: "webid", id: bob }, role, source: "", inherited: false },
    ]);
    await expect(directory.list()).rejects.toThrow("settings must be owner-only");
    await expect(
      directory.setupFamily(group.id, [
        {
          key: "calendar",
          role: "editor",
          create: vi.fn(),
        },
      ]),
    ).rejects.toThrow("settings must be owner-only");
    await expect(directory.notifyOnce(group.id, group.id, "Invite")).rejects.toThrow("owner-only");
    expect(addGrant).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it("shares all backing resources before attempting one notification per member", async () => {
    const { directory, notify } = make();
    const group = await directory.create("Team", [bob]);
    const file = `${root}tracker.ttl`;
    const folder = `${root}tasks/`;
    await directory.share(group.id, [file, folder, file], "editor");
    expect(addGrant).toHaveBeenCalledTimes(2);
    expect(addGrant).toHaveBeenLastCalledWith(
      [folder],
      expect.objectContaining({ agent: { type: "group", id: group.id } }),
      expect.objectContaining({ kind: "folder" }),
    );
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      bob,
      expect.objectContaining({ type: "Announce", object: file }),
    );
    await directory.share(group.id, [file, folder], "editor");
    expect(notify).toHaveBeenCalledTimes(1);
    await expect(directory.share(group.id, [], "viewer")).rejects.toThrow("Choose a resource");
  });
  it("does not notify when one of multiple resource grants fails", async () => {
    const { directory, notify } = make();
    const group = await directory.create("Team", [bob]);
    vi.mocked(addGrant)
      .mockResolvedValueOnce({ updated: [root], failed: [] } as never)
      .mockResolvedValueOnce({ updated: [], failed: [{ error: new Error("Denied") }] } as never);
    await expect(
      directory.share(group.id, [`${root}drive/`, `${root}file`], "viewer"),
    ).rejects.toThrow("Denied");
    expect(notify).not.toHaveBeenCalled();
  });
  it("writes a symbolic group grant and notifies each member only once across retries", async () => {
    const { directory, notify, storage } = make();
    const group = await directory.create("Team", [owner, bob, carol]);
    const file = await storage.create(root, "hello", {
      name: "file.txt",
      contentType: "text/plain",
    });
    await directory.share(group.id, file.url, "editor");
    await directory.share(group.id, file.url, "editor");
    expect(addGrant).toHaveBeenCalledWith(
      [file.url],
      expect.objectContaining({ agent: { type: "group", id: group.id }, role: "editor" }),
      expect.objectContaining({ model: "wac" }),
    );
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      bob,
      expect.objectContaining({ type: "Announce", object: file.url, actor: owner }),
    );
  });
  it("resumes stored Family spaces without recreating them and invites new members once", async () => {
    const { directory, notify, storage } = make();
    const group = await directory.create("Family", [bob]);
    const file = await storage.create(root, "space", {
      name: "space.txt",
      contentType: "text/plain",
    });
    const create = vi.fn().mockResolvedValue([file.url]);
    await directory.setupFamily(group.id, [{ key: "calendar", role: "viewer", create }]);
    await directory.setupFamily(group.id, [{ key: "calendar", role: "viewer", create }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    await directory.addMember(group.id, carol);
    await directory.setupFamily(group.id, []);
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("returns notification delivery failures without undoing access or sending again", async () => {
    const { directory, notify } = make();
    const group = await directory.create("Team", [bob]);
    notify.mockResolvedValue({ delivered: false, inbox: null, reason: "network" });
    expect(await directory.notifyOnce(group.id, group.id, "Invite")).toMatchObject([
      { delivered: false },
    ]);
    expect(await directory.notifyOnce(group.id, group.id, "Invite")).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("refuses unknown groups and a failed share before notification", async () => {
    const { directory, notify } = make();
    const absent = `${root}groups/absent.ttl#this`;
    await expect(directory.share(absent, `${root}file`, "viewer")).rejects.toThrow(
      "Group not found",
    );
    await expect(directory.notifyOnce(absent, root, "Invite")).rejects.toThrow("Group not found");
    const group = await directory.create("X", [bob]);
    vi.mocked(addGrant).mockResolvedValue({
      ...success,
      failed: [{ url: root, error: new Error("No access") }],
    });
    await expect(directory.share(group.id, `${root}file`, "viewer")).rejects.toThrow("No access");
    expect(notify).not.toHaveBeenCalled();
    await expect(
      directory.setupFamily(group.id, [
        { key: "x", role: "viewer", create: async () => [`${root}space/`] },
      ]),
    ).rejects.toThrow("No access");
  });
  it("surfaces a space factory failure and retains Family marking", async () => {
    const { directory, notify } = make();
    const group = await directory.create("X");
    await expect(
      directory.setupFamily(group.id, [
        {
          key: "x",
          role: "editor",
          create: async () => {
            throw new Error("Factory failed");
          },
        },
      ]),
    ).rejects.toThrow("Factory failed");
    expect((await directory.list())[0]?.family).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("reviewed group deletion", () => {
  it("lists direct grants, ignores inherited duplicates, removes grants before deleting", async () => {
    const { directory, storage } = make();
    const group = await directory.create("X");
    const file = await storage.create(root, "data", {
      name: "file.txt",
      contentType: "text/plain",
    });
    roles.set(file.url, [
      { agent: { type: "group", id: group.id }, role: "viewer", inherited: false, source: "" },
    ]);
    roles.set(root, [
      { agent: { type: "group", id: group.id }, role: "viewer", inherited: true, source: "" },
    ]);
    const review = await directory.grants(group.id);
    expect(review.resources).toEqual([file.url]);
    const remove = vi.spyOn(storage, "delete");
    await directory.delete(review);
    expect(removeGrant).toHaveBeenCalledWith(
      [file.url],
      { type: "group", id: group.id },
      expect.anything(),
    );
    expect(remove).toHaveBeenCalledWith(
      group.id.split("#")[0],
      expect.objectContaining({ ifMatch: expect.any(String) }),
    );
    expect(await directory.list()).toEqual([]);
  });
  it("blocks changed reviews, unreadable policies and partial revoke failures", async () => {
    const { directory, storage } = make();
    const group = await directory.create("X");
    const review = await directory.grants(group.id);
    roles.set(root, [
      { agent: { type: "group", id: group.id }, role: "viewer", inherited: false, source: "" },
    ]);
    await expect(directory.delete(review)).rejects.toThrow("grants changed");
    vi.mocked(readWac).mockImplementationOnce(() => {
      throw new Error("Unreadable");
    });
    await expect(directory.grants(group.id)).rejects.toThrow("Unreadable");
    const next = await directory.grants(group.id);
    vi.mocked(removeGrant).mockResolvedValueOnce({
      ...success,
      failed: [{ url: root, error: new Error("Revoke failed") }],
    });
    await expect(directory.delete(next)).rejects.toThrow("Revoke failed");
    expect(await storage.readRdf(group.id.split("#")[0] as string)).toBeDefined();
  });
  it("clears Family on deletion", async () => {
    const { directory } = make();
    const group = await directory.create("Family");
    await directory.setFamily(group.id);
    await directory.delete(await directory.grants(group.id));
    expect(await directory.list()).toEqual([]);
  });
  it("propagates listing errors", async () => {
    const { directory, storage } = make();
    const group = await directory.create("X");
    vi.spyOn(storage, "listAll").mockImplementation(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("Listing failed")) }),
    }));
    await expect(directory.grants(group.id)).rejects.toThrow("Listing failed");
  });
});

describe("failure and scan boundaries", () => {
  it("supports the default notifier without doing delivery during a read", async () => {
    const { storage } = make();
    const directory = new GroupDirectory({ storage, fetch: vi.fn(), webId: owner });
    expect(await directory.list()).toEqual([]);
  });
  it.each([null, 'W/"weak"', "*"])("refuses an unusable group validator %s", async (validator) => {
    const { directory, storage } = make();
    const group = await directory.create("X");
    const read = storage.readRdf.bind(storage);
    vi.spyOn(storage, "readRdf").mockImplementationOnce(async (url) => ({
      ...(await read(url)),
      etag: validator,
    }));
    await expect(directory.rename(group.id, "Y")).rejects.toThrow("strong ETag");
  });
  it("refuses invalid RDF groups in list and edit", async () => {
    const { directory, storage } = make();
    const group = await directory.create("X");
    const url = group.id.split("#")[0] as string;
    const read = await storage.readRdf(url);
    await storage.write(url, "", { contentType: "text/turtle", ifMatch: read.etag as string });
    await expect(directory.list()).rejects.toThrow("unreadable");
    await expect(directory.rename(group.id, "Y")).rejects.toThrow("unreadable");
    await expect(directory.setFamily(group.id)).rejects.toThrow("unreadable");
  });
  it.each([
    null,
    [],
    {},
    { notices: "x", spaces: {} },
    { notices: [1], spaces: {} },
    { notices: [], spaces: null },
    { notices: [], spaces: { x: [1] } },
    { notices: [], spaces: { x: "url" } },
    { notices: [], spaces: {}, family: 2 },
  ])("refuses invalid settings %j", async (data) => {
    const { directory, storage } = make();
    const group = await directory.create("X");
    await directory.setFamily(group.id);
    const url = `${root}settings/group-sharing/state.json`;
    const read = await storage.read(url);
    await storage.write(url, JSON.stringify(data), {
      contentType: "application/json",
      ifMatch: read.etag as string,
    });
    await expect(directory.list()).rejects.toThrow("Group settings are unreadable");
  });
  it("propagates unreadable settings, container observations and creation failures", async () => {
    const { directory, storage } = make();
    vi.spyOn(storage, "read").mockRejectedValueOnce(new Error("Settings denied"));
    await expect(directory.list()).rejects.toThrow("Settings denied");
    vi.spyOn(storage, "head").mockRejectedValueOnce(new Error("Head denied"));
    await expect(directory.create("X")).rejects.toThrow("Head denied");
    vi.spyOn(storage, "create").mockRejectedValueOnce(new Error("Create denied"));
    await expect(directory.create("X")).rejects.toThrow("Create denied");
    vi.spyOn(storage, "head").mockRejectedValueOnce(new Error("List denied"));
    await expect(directory.list()).rejects.toThrow("List denied");
  });
  it("observes another tab's successful container creation", async () => {
    const { directory, storage } = make();
    const create = storage.create.bind(storage);
    vi.spyOn(storage, "create").mockImplementationOnce(async (parent, body, options) => {
      await create(parent, body, options);
      throw new StorageError("conflict", { url: parent, method: "PUT" });
    });
    expect(await directory.create("X")).toMatchObject({ name: "X" });
  });
  it("skips non-group children and access documents and ignores duplicate scan entries", async () => {
    const { directory, storage } = make();
    const group = await directory.create("X");
    await storage.create(directory.container, "label", {
      name: "readme.txt",
      contentType: "text/plain",
    });
    await storage.create(directory.container, null, { name: "nested", kind: "container" });
    expect(await directory.list()).toHaveLength(1);
    const original = storage.listAll.bind(storage);
    vi.spyOn(storage, "listAll").mockImplementation(async function* (url, options) {
      yield* original(url, options);
      if (url === root) {
        yield {
          url: root,
          kind: "container",
          contentType: null,
          size: null,
          modified: null,
          types: [],
        };
        yield {
          url: `${root}foreign.acl`,
          kind: "resource",
          contentType: null,
          size: null,
          modified: null,
          types: [],
        };
      }
    });
    expect(await directory.grants(group.id)).toEqual({ group: group.id, resources: [] });
  });
  it("refuses scans with foreign members or a resource budget overflow", async () => {
    const { directory, storage } = make();
    const group = await directory.create("X");
    const rootHead = await storage.head(root);
    vi.spyOn(storage, "head").mockImplementation(async (url) => ({ ...rootHead, url }));
    const entry = (url: string) => ({
      url,
      kind: "resource" as const,
      contentType: null,
      size: null,
      modified: null,
      types: [],
    });
    vi.spyOn(storage, "listAll").mockImplementation(async function* () {
      yield entry("https://outside.example/file");
    });
    await expect(directory.grants(group.id)).rejects.toThrow("scan is incomplete");
    vi.spyOn(storage, "listAll").mockImplementation(async function* () {
      for (let i = 0; i < 2001; i++) yield entry(`${root}file-${i}.txt`);
    });
    await expect(directory.grants(group.id)).rejects.toThrow("scan is incomplete");
  });
  it("limits group listings", async () => {
    const { directory, storage } = make();
    await directory.create("X");
    const read = (await storage.readRdf((await directory.list())[0]?.id.split("#")[0] as string))
      .dataset;
    vi.spyOn(storage, "listAll").mockImplementation(async function* () {
      for (let i = 0; i < 501; i++)
        yield {
          url: `${directory.container}g-${i}.ttl`,
          kind: "resource",
          contentType: null,
          size: null,
          modified: null,
          types: [],
        };
    });
    const { buildGroup } = await import("@jeswr/solid-task-model/contacts");
    vi.spyOn(storage, "readRdf").mockImplementation(async (url) => ({
      url,
      dataset: buildGroup(url, { name: "Group" }),
      etag: '"1"',
      contentType: "text/turtle",
    }));
    void read;
    await expect(directory.list()).rejects.toThrow("Too many groups");
  });
});

it("claims an invitation before delivery across independent clients", async () => {
  const { directory, storage, notify } = make();
  const group = await directory.create("Family", [bob]);
  await directory.setFamily(group.id);
  const other = new GroupDirectory({ storage, fetch: vi.fn(), webId: owner }, notify);
  const results = await Promise.allSettled([
    directory.notifyOnce(group.id, group.id, "Invite"),
    other.notifyOnce(group.id, group.id, "Invite"),
  ]);
  expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  expect(notify).toHaveBeenCalledTimes(1);
});

it("refuses absent, ambiguous and off-pod access links", async () => {
  for (const links of [
    new Map(),
    new Map([["acl", []]]),
    new Map([["acl", [{ target: "https://foreign.example/.acl", params: {} }]]]),
  ]) {
    const { directory, storage } = make();
    const group = await directory.create("X");
    const head = await storage.head(root);
    vi.spyOn(storage, "head").mockResolvedValue({ ...head, links });
    await expect(directory.grants(group.id)).rejects.toThrow("scan is incomplete");
  }
});
it("skips absent own ACLs but propagates forbidden reads and unsupported graphs", async () => {
  const { directory, storage } = make();
  const group = await directory.create("X");
  vi.spyOn(storage, "readRdf").mockRejectedValueOnce(
    new StorageError("not-found", { url: `${root}.acl`, method: "GET" }),
  );
  expect(await directory.grants(group.id)).toEqual({ group: group.id, resources: [] });
  vi.spyOn(storage, "readRdf").mockRejectedValueOnce(new Error("Forbidden ACL"));
  await expect(directory.grants(group.id)).rejects.toThrow("Forbidden ACL");
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const dataset = await parseRdf(
    "<https://pod.example/r> <http://www.w3.org/ns/solid/acp#access> <https://pod.example/p>.",
    "text/turtle",
  );
  vi.spyOn(storage, "readRdf").mockResolvedValueOnce({
    url: `${root}.acl`,
    dataset,
    etag: '"1"',
    contentType: "text/turtle",
  });
  await expect(directory.grants(group.id)).rejects.toThrow("Unsupported access document");
  roles.set(root, [
    { agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" },
    {
      agent: { type: "group", id: `${root}groups/other.ttl#this` },
      role: "viewer",
      inherited: false,
      source: "",
    },
  ]);
  expect(await directory.grants(group.id)).toEqual({ group: group.id, resources: [] });
});

it("verifies owner-only access through the nearest existing ancestor", async () => {
  const { ownerOnlyAccess } = await import("../src/owner-access.js");
  const { storage } = make();
  const session = { storage, fetch: vi.fn(), webId: owner };
  const manager: RoleGrant = {
    agent: { type: "webid", id: owner },
    role: "manager",
    inherited: false,
    source: "",
  };
  roles.set(root, [manager]);
  expect(await ownerOnlyAccess(session, `${root}missing/nested/file.ttl`)).toBe(true);
  roles.set(root, []);
  expect(await ownerOnlyAccess(session, root)).toBe(false);
  roles.set(root, [{ ...manager, agent: { type: "public" } }]);
  expect(await ownerOnlyAccess(session, root)).toBe(false);
  roles.set(root, [{ ...manager, agent: { type: "webid", id: bob } }]);
  expect(await ownerOnlyAccess(session, root)).toBe(false);
  roles.set(root, [{ ...manager, role: "viewer" }]);
  expect(await ownerOnlyAccess(session, root)).toBe(false);
  vi.spyOn(storage, "head").mockRejectedValueOnce(new Error("Denied"));
  await expect(ownerOnlyAccess(session, root)).rejects.toThrow("Denied");
  vi.spyOn(storage, "head").mockRejectedValueOnce(
    new StorageError("not-found", { url: root, method: "HEAD" }),
  );
  await expect(ownerOnlyAccess(session, root)).rejects.toMatchObject({ code: "not-found" });
});

it("verifies owner-only access on an existing resource", async () => {
  const { ownerOnlyAccess } = await import("../src/owner-access.js");
  const { storage } = make();
  const file = await storage.create(root, "x", { name: "private.txt", contentType: "text/plain" });
  roles.set(file.url, [
    { agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" },
  ]);
  expect(await ownerOnlyAccess({ storage, fetch: vi.fn(), webId: owner }, file.url)).toBe(true);
});

it("snapshots a deletion review before awaiting the mutation queue", async () => {
  const { directory } = make();
  const first = await directory.create("A");
  const second = await directory.create("B");
  const review = await directory.grants(first.id);
  const pending = directory.delete(review);
  review.group = second.id;
  await pending;
  expect((await directory.list()).map((group) => group.id)).toEqual([second.id]);
});

it("refuses to publish a pre-existing nonempty private groups container", async () => {
  const { directory, storage } = make();
  const folder = await storage.create(root, null, { name: "groups", kind: "container" });
  await storage.create(folder.url, "private labels", {
    name: "labels.txt",
    contentType: "text/plain",
  });
  await expect(directory.create("Public team", [bob])).rejects.toThrow(
    "Private contact labels won't be published",
  );
  expect(setGrants).not.toHaveBeenCalled();
  expect(await (await storage.read(`${folder.url}labels.txt`)).text()).toBe("private labels");
});
it("refuses private, unmanaged and foreign-writable membership documents", async () => {
  const { directory } = make();
  const group = await directory.create("Family");
  const url = group.id.split("#")[0] as string;
  const manager: RoleGrant = {
    agent: { type: "webid", id: owner },
    role: "manager",
    inherited: false,
    source: "",
  };
  const publicRead: RoleGrant = {
    agent: { type: "public" },
    role: "viewer",
    inherited: false,
    source: "",
  };
  for (const grants of [
    [manager],
    [publicRead],
    [publicRead, { ...manager, role: "viewer" as const }],
    [publicRead, { ...manager, agent: { type: "webid" as const, id: bob } }],
    [
      manager,
      publicRead,
      { ...manager, agent: { type: "webid" as const, id: bob }, role: "editor" as const },
    ],
    [manager, publicRead, { ...manager, agent: { type: "group" as const, id: group.id } }],
  ]) {
    roles.set(url, grants);
    await expect(directory.list()).rejects.toThrow("owner-only changes");
    await expect(directory.rename(group.id, "Changed")).rejects.toThrow("owner-only changes");
    await expect(directory.setFamily(group.id)).rejects.toThrow("owner-only changes");
    await expect(directory.share(group.id, `${root}file`, "viewer")).rejects.toThrow(
      "owner-only changes",
    );
  }
  expect(addGrant).not.toHaveBeenCalled();
});
it("checks a newly created group's own access before returning it", async () => {
  const { directory } = make();
  const original = vi.mocked(readGrants).getMockImplementation();
  vi.mocked(readGrants).mockImplementation(async (url, options) =>
    url.endsWith(".ttl")
      ? { url, version: "test" as never, grants: [] }
      : ((await original?.(url, options)) as Awaited<ReturnType<typeof readGrants>>),
  );
  await expect(directory.create("New group")).rejects.toThrow("owner-only changes");
});

describe("group grant limits and receipt pruning (review round 1)", () => {
  const state = `${root}settings/group-sharing/state.json`;
  async function notices(storage: ReturnType<typeof make>["storage"]) {
    return JSON.parse(await (await storage.read(state)).text()).notices as string[];
  }
  it.each([
    "manager",
    "commenter",
  ] as const)("refuses %s group access before any read or grant", async (role) => {
    const { directory, notify } = make();
    const group = await directory.create("Team", [bob]);
    await expect(
      directory.share(group.id, `${root}file`, role as unknown as "viewer"),
    ).rejects.toThrow("Viewer or Editor access only");
    await expect(
      directory.setupFamily(group.id, [
        { key: "x", role: role as unknown as "viewer", create: vi.fn() },
      ]),
    ).rejects.toThrow("Viewer or Editor access only");
    expect((await directory.list())[0]?.family).toBe(false);
    expect(addGrant).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it.each([
    root,
    root.slice(0, -1),
    `${root}settings/`,
    `${root}settings/group-sharing/state.json`,
    `${root}SETTINGS/x`,
    `${root}groups/`,
    `${root}groups/a.ttl`,
    `${root}Groups/a.ttl`,
    `${root}file.acl`,
    "https://outside.example/file",
  ])("refuses the reserved or foreign target %s for shares and new Family spaces", async (target) => {
    const { directory, notify, storage } = make();
    const group = await directory.create("Team", [bob]);
    await expect(directory.share(group.id, [`${root}file`, target], "viewer")).rejects.toThrow(
      "Choose a specific item",
    );
    await expect(
      directory.setupFamily(group.id, [
        { key: "x", role: "editor", create: async () => [`${root}space/`, target] },
      ]),
    ).rejects.toThrow("Choose a specific item");
    // The refused factory output is never stored for resumption.
    expect(JSON.parse(await (await storage.read(state)).text()).spaces).toEqual({});
    expect(addGrant).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it("prunes a removed member's receipts, keeps others, and re-invites them after re-adding", async () => {
    const { directory, storage, notify } = make();
    const group = await directory.create("Team", [bob, carol]);
    const other = await directory.create("Other", [bob]);
    await directory.notifyOnce(group.id, group.id, "Invite");
    await directory.notifyOnce(other.id, other.id, "Invite");
    expect(await notices(storage)).toHaveLength(3);
    await directory.removeMember(group.id, bob);
    expect((await notices(storage)).map((key) => JSON.parse(key).slice(0, 2))).toEqual([
      [group.id, carol],
      [other.id, bob],
    ]);
    // Nothing left to prune: no settings write.
    const write = vi.spyOn(storage, "write");
    await directory.removeMember(group.id, bob);
    expect(write.mock.calls.filter(([url]) => url === state)).toEqual([]);
    await directory.addMember(group.id, bob);
    await directory.notifyOnce(group.id, group.id, "Invite");
    expect(notify).toHaveBeenCalledTimes(4);
  });
  it("does not create settings just to prune receipts", async () => {
    const { directory, storage } = make();
    const group = await directory.create("Team", [bob]);
    await directory.removeMember(group.id, bob);
    await expect(storage.read(state)).rejects.toMatchObject({ code: "not-found" });
  });
  it("prunes a deleted group's receipts and keeps malformed entries unmatched", async () => {
    const { directory, storage } = make();
    const group = await directory.create("Team", [bob]);
    const other = await directory.create("Other", [bob]);
    await directory.notifyOnce(group.id, group.id, "Invite");
    await directory.notifyOnce(other.id, other.id, "Invite");
    const current = await storage.read(state);
    const data = JSON.parse(await current.text());
    data.notices.push("not json", "{}");
    await storage.write(state, JSON.stringify(data), {
      contentType: "application/json",
      ifMatch: current.etag as string,
    });
    await directory.removeMember(group.id, carol);
    await directory.delete(await directory.grants(group.id));
    expect(await notices(storage)).toEqual([
      JSON.stringify([other.id, bob, other.id]),
      "not json",
      "{}",
    ]);
  });
  it("caps receipts at the newest NOTICE_LIMIT, dropping the oldest", async () => {
    const { NOTICE_LIMIT } = await import("../src/index.js");
    const { directory, storage, notify } = make();
    const group = await directory.create("Team", [bob]);
    await directory.setFamily(group.id);
    const current = await storage.read(state);
    const data = JSON.parse(await current.text());
    data.notices = Array.from({ length: NOTICE_LIMIT }, (_, i) =>
      JSON.stringify([group.id, bob, `${root}old-${i}`]),
    );
    await storage.write(state, JSON.stringify(data), {
      contentType: "application/json",
      ifMatch: current.etag as string,
    });
    await directory.notifyOnce(group.id, `${root}new`, "Shared");
    const kept = await notices(storage);
    expect(kept).toHaveLength(NOTICE_LIMIT);
    expect(kept[0]).toBe(JSON.stringify([group.id, bob, `${root}old-1`]));
    expect(kept.at(-1)).toBe(JSON.stringify([group.id, bob, `${root}new`]));
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

function plantDuringProvisioning(storage: ReturnType<typeof make>["storage"], folder: string) {
  const original = vi.mocked(setGrants).getMockImplementation();
  let planted = false;
  vi.mocked(setGrants).mockImplementation(async (urls, grants, options) => {
    if (urls[0] === folder && !planted) {
      planted = true;
      // Written after the safety check, before the permission rewrite lands.
      await storage.create(folder, JSON.stringify({ notices: [], spaces: { x: [`${root}x`] } }), {
        name: "state.json",
        contentType: "application/json",
      });
    }
    return (original as NonNullable<typeof original>)(urls, grants, options);
  });
}
it("deletes settings planted while an unsafe settings folder is secured and never trusts them", async () => {
  const { directory, storage, notify } = make();
  const group = await directory.create("Family", [bob]);
  const folder = `${root}settings/group-sharing/`;
  // No owner management yet (the mocked pod grants nothing): the folder is not owner-only.
  plantDuringProvisioning(storage, folder);
  await expect(directory.setFamily(group.id)).rejects.toThrow("others could write it");
  await expect(storage.read(`${folder}state.json`)).rejects.toMatchObject({ code: "not-found" });
  // The retry starts from empty settings, not from the planted spaces.
  await directory.setFamily(group.id);
  expect(JSON.parse(await (await storage.read(`${folder}state.json`)).text()).spaces).toEqual({});
  expect(notify).not.toHaveBeenCalled();
});
it("refuses settings another tab writes while an owner-only settings folder is re-secured", async () => {
  const { directory, storage } = make();
  const group = await directory.create("Family", [bob]);
  const folder = `${root}settings/group-sharing/`;
  roles.set(folder, [
    { agent: { type: "webid", id: owner }, role: "manager", inherited: false, source: "" },
  ]);
  // Only a writer the owner-only folder admits (the owner's other tab) can win this race; the
  // write is kept and this call asks for a reload instead of overwriting it.
  plantDuringProvisioning(storage, folder);
  await expect(directory.setFamily(group.id)).rejects.toThrow(
    "changed while they were being secured",
  );
  expect((await storage.read(`${folder}state.json`)).contentType).toBe("application/json");
});

it("never deletes access or metadata documents listed in a folder being secured", async () => {
  const { directory, storage } = make();
  const group = await directory.create("Family", [bob]);
  const folder = `${root}settings/group-sharing/`;
  const listAll = storage.listAll.bind(storage);
  let secured = false;
  vi.spyOn(storage, "listAll").mockImplementation(async function* (url, options) {
    yield* listAll(url, options);
    if (url === folder && secured)
      yield {
        url: `${folder}.acl`,
        kind: "resource" as const,
        contentType: null,
        size: null,
        modified: null,
        types: [],
      };
  });
  const original = vi.mocked(setGrants).getMockImplementation();
  vi.mocked(setGrants).mockImplementation(async (urls, grants, options) => {
    if (urls[0] === folder) secured = true;
    return (original as NonNullable<typeof original>)(urls, grants, options);
  });
  const remove = vi.spyOn(storage, "delete");
  await directory.setFamily(group.id);
  expect(remove).not.toHaveBeenCalled();
});
