// AUTHORED-BY Codex GPT-6.1-Sol
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Parser, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { NS, node } from "../../src/apps/tasks/lib/model/rdf";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import {
  TasksSharingAdapter,
  tasksShareCapabilities,
} from "../../src/apps/tasks/lib/share/adapter";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import { WacSharingAdapter } from "../../src/shell/share/wac-adapter";

const root = "https://alice.demo.pod/";
const owner = `${root}profile#me`;
const bob = "https://bob.example/profile#me";
const ACL = "http://www.w3.org/ns/auth/acl#";
async function fixture() {
  const pod = createDemoPod({ root });
  const store = new TaskStore({
    storage: root,
    webId: owner,
    fetch: pod.fetch,
    typeIndex: false,
    ensurePrivateTasksAccess: async () => true,
  });
  const project = await store.createProject("Home");
  const notice = vi.fn();
  const cache = new TasksCache(store, vi.fn(), owner, notice);
  await cache.start();
  await cache.loadTasks(project);
  const folder = project.tracker.stateStore as string;
  const requests: { url: string; init: RequestInit }[] = [];
  let intercept:
    | ((url: string, init: RequestInit) => Promise<Response | undefined> | Response | undefined)
    | undefined;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    return (await intercept?.(String(input), init)) ?? pod.fetch(input, init);
  };
  const ensurePrivate = vi.fn(async (_url: string, _owner: string) => true);
  const syncMembers = vi.fn(async (webId: string, granted: boolean) => {
    if (!(await cache.syncProjectMember(project, webId, granted)))
      throw new Error("Members sync failed");
  });
  const options = {
    fetch,
    webId: owner,
    trackerUrl: project.url,
    folderUrl: folder,
    projectsContainer: store.projects,
    ensurePrivate,
    syncMembers,
  };
  const adapter = new TasksSharingAdapter(options);
  const load = () => adapter.load(project.url, new AbortController().signal);
  const grants = async (url: string) => {
    const response = await pod.fetch(`${url}.acl`);
    const dataset = new Store(new Parser({ baseIRI: `${url}.acl` }).parse(await response.text()));
    return [...new AclResource(dataset, DataFactory).authorizations].map((grant) => ({
      agents: [...grant.agent],
      modes: [...grant.mode],
      accessTo: grant.accessTo,
      defaults: grant.default,
    }));
  };
  return {
    pod,
    store,
    project,
    folder,
    requests,
    options,
    adapter,
    load,
    grants,
    ensurePrivate,
    syncMembers,
    cache,
    notice,
    intercept: (next: typeof intercept) => {
      intercept = next;
    },
  };
}
const puts = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.requests.filter((request) => request.init.method === "PUT");

describe("Tasks named sharing", () => {
  it("reconciles members and assignments after a committed tracker revoke loses its response", async () => {
    const f = await fixture();
    await f.adapter.setPerson(f.project.url, bob, "editor");
    const task = await f.cache.createTask(f.project, { title: "Assigned", assignee: bob });
    if (!task) throw new Error("Missing task");
    let lost = false;
    f.intercept(async (url, init) => {
      if (url === `${f.project.url}.acl` && init.method === "PUT" && !lost) {
        lost = true;
        await f.pod.fetch(url, init);
        throw new Error("Lost tracker PUT response");
      }
    });
    await expect(f.adapter.setPerson(f.project.url, bob, null)).rejects.toBeDefined();
    expect((await f.store.readProject(f.project.url)).tracker.groupMembers).not.toContain(bob);
    expect((await f.store.readTask(task.url)).task.assignee).toBeUndefined();
    expect(f.notice).toHaveBeenCalledExactlyOnceWith("Unassigned 1 tasks");
    expect((await f.grants(f.folder)).some((grant) => grant.agents.includes(bob))).toBe(false);
    f.intercept(undefined);
    await f.load();
    expect(f.notice).toHaveBeenCalledOnce();
  });

  it("syncs a committed grant even when folder widening returns 412, then repairs on load", async () => {
    const f = await fixture();
    await f.load();
    let folderWrites = 0;
    f.intercept((url, init) =>
      url === `${f.folder}.acl` && init.method === "PUT" && ++folderWrites === 2
        ? new Response(null, { status: 412 })
        : undefined,
    );
    await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await f.store.readProject(f.project.url)).tracker.groupMembers).toContain(bob);
    expect((await f.grants(f.folder)).some((grant) => grant.agents.includes(bob))).toBe(false);
    f.intercept(undefined);
    const fresh = new TasksSharingAdapter(f.options);
    await fresh.load(f.project.url, new AbortController().signal);
    expect((await f.grants(f.folder)).find((grant) => grant.agents.includes(bob))?.modes).toContain(
      `${ACL}Write`,
    );
  });

  it("repairs an interrupted revoke on the next load with a fresh adapter", async () => {
    const f = await fixture();
    await f.adapter.setPerson(f.project.url, bob, "editor");
    const task = await f.cache.createTask(f.project, { title: "Assigned", assignee: bob });
    if (!task) throw new Error("Missing task");
    let lost = false;
    f.intercept(async (url, init) => {
      if (url === `${f.project.url}.acl` && init.method === "PUT") {
        await f.pod.fetch(url, init);
        lost = true;
        throw new Error("Lost response");
      }
      if (lost) return new Response(null, { status: 503 });
    });
    await expect(f.adapter.setPerson(f.project.url, bob, null)).rejects.toBeDefined();
    expect((await f.store.readProject(f.project.url)).tracker.groupMembers).toContain(bob);
    f.intercept(undefined);
    // Also repair a pre-existing folder grant left by an interrupted older client.
    await installAcl(f, f.folder, [
      { webId: owner, owner: true },
      { webId: bob, editor: true },
    ]);
    await new TasksSharingAdapter(f.options).load(f.project.url, new AbortController().signal);
    expect((await f.grants(f.folder)).some((grant) => grant.agents.includes(bob))).toBe(false);
    expect((await f.store.readProject(f.project.url)).tracker.groupMembers).not.toContain(bob);
    expect((await f.store.readTask(task.url)).task.assignee).toBeUndefined();
    expect(f.notice).toHaveBeenCalledExactlyOnceWith("Unassigned 1 tasks");
  });

  it("never grants another tracker owner's folder Control during narrowing", async () => {
    const f = await fixture();
    await installAcl(f, f.project.url, [
      { webId: owner, owner: true },
      { webId: bob, owner: true },
    ]);
    await installAcl(f, f.folder, [{ webId: owner, owner: true }]);
    f.requests.length = 0;
    f.intercept((url, init) =>
      url === `${f.project.url}.acl` && init.method === "PUT"
        ? new Response(null, { status: 412 })
        : undefined,
    );
    await expect(
      f.adapter.setPerson(f.project.url, "https://carol.test/#me", "viewer"),
    ).rejects.toMatchObject({ code: "conflict" });
    for (const request of puts(f).filter((request) => request.url === `${f.folder}.acl`)) {
      const dataset = new Store(new Parser().parse(String(request.init.body)));
      const grants = [...new AclResource(dataset, DataFactory).authorizations];
      expect(grants.some((grant) => [...grant.agent].includes(bob))).toBe(false);
      expect(
        grants.some(
          (grant) => [...grant.agent].includes(owner) && [...grant.mode].includes(`${ACL}Control`),
        ),
      ).toBe(true);
    }
    f.intercept(undefined);
    await f.adapter.setPerson(f.project.url, "https://carol.test/#me", "viewer");
    expect((await f.grants(f.folder)).find((grant) => grant.agents.includes(bob))?.modes).toContain(
      `${ACL}Control`,
    );
  });

  it("does not widen the folder or sync members when a sharee loads access", async () => {
    const f = await fixture();
    await f.adapter.setPerson(f.project.url, bob, "editor");
    await installAcl(f, f.folder, [{ webId: owner, owner: true }]);
    f.requests.length = 0;
    f.syncMembers.mockClear();
    await new TasksSharingAdapter({ ...f.options, webId: bob }).load(
      f.project.url,
      new AbortController().signal,
    );
    expect(puts(f)).toEqual([]);
    expect(f.syncMembers).not.toHaveBeenCalled();
  });

  it("creates a missing folder ACL to match tracker grants only when the owner loads", async () => {
    const f = await fixture();
    await installAcl(f, f.project.url, [
      { webId: owner, owner: true },
      { webId: bob, editor: true },
    ]);
    f.requests.length = 0;
    await f.load();
    expect(puts(f).map((request) => request.url)).toEqual([`${f.folder}.acl`]);
    expect(new Headers(puts(f)[0]?.init.headers).get("if-none-match")).toBe("*");
    expect((await f.grants(f.folder)).find((grant) => grant.agents.includes(bob))?.modes).toContain(
      `${ACL}Write`,
    );
    expect((await f.store.readProject(f.project.url)).tracker.groupMembers).toContain(bob);
    f.requests.length = 0;
    f.syncMembers.mockClear();
    await f.load();
    expect(puts(f)).toEqual([]);
    expect(f.syncMembers).not.toHaveBeenCalled();
  });

  it("narrows an outdated editor folder grant to the tracker's viewer role on load", async () => {
    const f = await fixture();
    await f.adapter.setPerson(f.project.url, bob, "editor");
    await installAcl(f, f.project.url, [{ webId: owner, owner: true }, { webId: bob }]);
    f.requests.length = 0;
    await f.load();
    expect(puts(f).map((request) => request.url)).toEqual([`${f.folder}.acl`]);
    expect((await f.grants(f.folder)).find((grant) => grant.agents.includes(bob))?.modes).toEqual([
      `${ACL}Read`,
    ]);
  });

  it("keeps removals retryable when the folder cannot yet be narrowed", async () => {
    const f = await fixture();
    await f.adapter.setPerson(f.project.url, bob, "editor");
    const task = await f.cache.createTask(f.project, { title: "Assigned", assignee: bob });
    if (!task) throw new Error("Missing task");
    await installAcl(f, f.project.url, [{ webId: owner, owner: true }]);
    f.syncMembers.mockClear();
    f.intercept((url, init) =>
      url === `${f.folder}.acl` && init.method === "PUT"
        ? new Response(null, { status: 412 })
        : undefined,
    );
    await expect(f.load()).rejects.toMatchObject({ code: "conflict" });
    expect(f.syncMembers).not.toHaveBeenCalled();
    f.intercept(undefined);
    await f.load();
    expect((await f.store.readTask(task.url)).task.assignee).toBeUndefined();
    expect((await f.store.readProject(f.project.url)).tracker.groupMembers).not.toContain(bob);
    expect(f.notice).toHaveBeenCalledExactlyOnceWith("Unassigned 1 tasks");
  });

  it("bootstraps only a verified private tracker, conditionally", async () => {
    const f = await fixture();
    expect(await f.load()).toMatchObject({
      canManage: true,
      people: [{ webId: owner, role: "owner" }],
    });
    expect(puts(f)).toHaveLength(1);
    expect(new Headers(puts(f)[0]?.init.headers).get("if-none-match")).toBe("*");
    expect(f.ensurePrivate).toHaveBeenCalledWith(f.project.url, owner);
    expect(tasksShareCapabilities).toMatchObject({
      publicLinks: false,
      notifyAgents: false,
      accessRequests: false,
    });
  });
  it("does not bootstrap when privacy is unavailable", async () => {
    const f = await fixture();
    f.ensurePrivate.mockResolvedValue(false);
    await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
    expect(puts(f)).toEqual([]);
  });
  it.each([
    "viewer",
    "editor",
  ] as const)("grants %s with folder → tracker → folder, owner Control and conditional headers", async (role) => {
    const f = await fixture();
    await f.load();
    f.requests.length = 0;
    await f.adapter.setPerson(f.project.url, bob, role);
    expect(puts(f).map((request) => request.url)).toEqual([
      `${f.folder}.acl`,
      `${f.project.url}.acl`,
      `${f.folder}.acl`,
    ]);
    expect(new Headers(puts(f)[0]?.init.headers).get("if-none-match")).toBe("*");
    for (const request of puts(f)) {
      expect(
        new Headers(request.init.headers).has("if-match") ||
          new Headers(request.init.headers).get("if-none-match") === "*",
      ).toBe(true);
      const dataset = new Store(new Parser().parse(String(request.init.body)));
      const owners = [...new AclResource(dataset, DataFactory).authorizations].filter((grant) =>
        [...grant.agent].includes(owner),
      );
      expect(owners.some((grant) => [...grant.mode].includes(`${ACL}Control`))).toBe(true);
    }
    const grant = (await f.grants(f.folder)).find((grant) => grant.agents.includes(bob));
    expect(grant?.accessTo).toBe(f.folder);
    expect(grant?.defaults).toBe(f.folder);
    expect(grant?.modes.includes(`${ACL}Write`)).toBe(role === "editor");
    expect(f.syncMembers).toHaveBeenCalledWith(bob, true);
    expect(await f.load()).toMatchObject({
      people: expect.arrayContaining([{ webId: bob, role }]),
    });
  });
  it.each([
    "viewer",
    null,
  ] as const)("narrows editor to %s before touching the tracker", async (role) => {
    const f = await fixture();
    await f.adapter.setPerson(f.project.url, bob, "editor");
    f.requests.length = 0;
    await f.adapter.setPerson(f.project.url, bob, role);
    const first = puts(f)[0];
    const dataset = new Store(new Parser().parse(String(first?.init.body)));
    const rules = [...new AclResource(dataset, DataFactory).authorizations].filter((grant) =>
      [...grant.agent].includes(bob),
    );
    expect(rules.some((grant) => [...grant.mode].includes(`${ACL}Write`))).toBe(false);
    expect(rules.length).toBe(role ? 1 : 0);
    expect(f.syncMembers).toHaveBeenLastCalledWith(bob, role !== null);
  });
  it.each([0, 1, 2])("fails closed at write %s, including lost responses", async (step) => {
    const f = await fixture();
    await f.adapter.setPerson(f.project.url, bob, "editor");
    f.requests.length = 0;
    let writes = 0;
    f.intercept(async (url, init) => {
      if (init.method === "PUT" && writes++ === step) {
        await f.pod.fetch(url, init);
        throw new Error("Lost response");
      }
      return undefined;
    });
    await expect(f.adapter.setPerson(f.project.url, bob, null)).rejects.toBeDefined();
    expect((await f.grants(f.folder)).some((grant) => grant.agents.includes(bob))).toBe(false);
    expect(
      (await f.grants(f.folder)).some(
        (grant) => grant.agents.includes(owner) && grant.modes.includes(`${ACL}Control`),
      ),
    ).toBe(true);
    f.intercept(undefined);
    await f.adapter.setPerson(f.project.url, bob, null);
    expect(f.syncMembers).toHaveBeenLastCalledWith(bob, false);
  });
  it.each([403, 404, 500])("does not bootstrap on tracker HEAD %s", async (status) => {
    const f = await fixture();
    f.intercept((url, init) =>
      url === f.project.url && init.method === "HEAD" ? new Response(null, { status }) : undefined,
    );
    await expect(f.load()).rejects.toBeDefined();
    expect(puts(f)).toEqual([]);
  });
  it("rejects unsupported ACL links and missing ETags", async () => {
    const f = await fixture();
    await f.load();
    f.intercept((url, init) =>
      init.method === "HEAD" && url === f.project.url
        ? new Response(null, { headers: { link: '<https://evil.test/acl>; rel="acl"' } })
        : undefined,
    );
    await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
    f.intercept(async (url, init) => {
      if (url !== `${f.project.url}.acl` || init.method === "PUT") return;
      const response = await f.pod.fetch(url, init);
      response.headers.delete("etag");
      return response;
    });
    await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
  });
  it("rejects owner changes, unsupported roles, general grants and durations before writes", async () => {
    const f = await fixture();
    await f.load();
    f.requests.length = 0;
    await expect(f.adapter.setPerson(f.project.url, owner, null)).rejects.toMatchObject({
      code: "forbidden",
    });
    for (const role of ["manager", "commenter"] as const)
      await expect(f.adapter.setPerson(f.project.url, bob, role)).rejects.toMatchObject({
        code: "unsupported",
      });
    await expect(
      f.adapter.setPerson(f.project.url, "javascript:alert(1)", "editor"),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      f.adapter.setPerson(f.project.url, bob, "editor", { expires: new Date() }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      f.adapter.setPerson(f.project.url, bob, "editor", { purpose: "test" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(f.adapter.setGeneral()).rejects.toMatchObject({ code: "unsupported" });
    expect(puts(f)).toEqual([]);
  });
  it.each([
    "https://other.test/x",
    "https://u:p@alice.demo.pod/x",
    "https://alice.demo.pod/x?q=1",
    "https://alice.demo.pod/x#it",
    "https://alice.demo.pod/",
  ])("rejects invalid tracker %s", async (trackerUrl) => {
    const f = await fixture();
    const adapter = new TasksSharingAdapter({ ...f.options, trackerUrl });
    await expect(adapter.load(trackerUrl, new AbortController().signal)).rejects.toMatchObject({
      code: "unsupported",
    });
  });
  it("rejects wrong binding and folder scope", async () => {
    const f = await fixture();
    await expect(f.adapter.load(root, new AbortController().signal)).rejects.toBeDefined();
    for (const folderUrl of ["https://elsewhere.test/folder/", "https://alice.demo.pod/file"])
      await expect(
        new TasksSharingAdapter({ ...f.options, folderUrl }).load(
          f.project.url,
          new AbortController().signal,
        ),
      ).rejects.toBeDefined();
  });
  it("reports conditional conflicts and sync errors; the queue remains usable", async () => {
    const f = await fixture();
    await f.load();
    f.intercept((_url, init) =>
      init.method === "PUT" ? new Response(null, { status: 412 }) : undefined,
    );
    await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toMatchObject({
      code: "conflict",
    });
    f.intercept(undefined);
    f.syncMembers.mockRejectedValueOnce(new Error("members unavailable"));
    await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toMatchObject({
      code: "members-sync",
      message: "Access was saved, but the project's member list wasn't updated.",
    });
    expect((await f.grants(f.folder)).find((grant) => grant.agents.includes(bob))?.modes).toContain(
      `${ACL}Write`,
    );
    await f.adapter.setPerson(f.project.url, bob, "editor");
  });
  it("rejects unverified folder creation and malformed or public ACLs", async () => {
    const f = await fixture();
    await f.load();
    f.ensurePrivate.mockResolvedValue(false);
    await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
    f.ensurePrivate.mockResolvedValue(true);
    await f.adapter.setPerson(f.project.url, bob, "viewer");
    const dataset = new Store();
    const grant = new Authorization(DataFactory.blankNode(), dataset, DataFactory);
    grant.type.add(`${ACL}Authorization`);
    grant.accessTo = f.project.url;
    grant.agentClass.add("http://xmlns.com/foaf/0.1/Agent");
    grant.mode.add(`${ACL}Read`);
    const body = await new Promise<string>((resolve, reject) => {
      const writer = new Writer();
      writer.addQuads([...dataset]);
      writer.end((err, body) => (err ? reject(err) : resolve(body)));
    });
    const response = await f.pod.fetch(`${f.project.url}.acl`);
    await f.pod.fetch(`${f.project.url}.acl`, {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
        "if-match": response.headers.get("etag") as string,
      },
      body,
    });
    await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
  });
});

async function installAcl(
  f: Awaited<ReturnType<typeof fixture>>,
  resource: string,
  people: { webId: string; owner?: boolean; editor?: boolean }[],
  defaults = true,
) {
  const dataset = new Store();
  for (const person of people) {
    const grant = new Authorization(DataFactory.blankNode(), dataset, DataFactory);
    grant.type.add(`${ACL}Authorization`);
    grant.accessTo = resource;
    if (resource.endsWith("/") && defaults) grant.default = resource;
    grant.agent.add(person.webId);
    grant.mode.add(`${ACL}Read`);
    if (person.owner || person.editor) grant.mode.add(`${ACL}Write`);
    if (person.owner) grant.mode.add(`${ACL}Control`);
  }
  const writer = new Writer();
  writer.addQuads([...dataset]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
  const previous = await f.pod.fetch(`${resource}.acl`);
  await f.pod.fetch(`${resource}.acl`, {
    method: "PUT",
    headers: {
      "content-type": "text/turtle",
      ...(previous.ok
        ? { "if-match": previous.headers.get("etag") as string }
        : { "if-none-match": "*" }),
    },
    body,
  });
}
it("checks tracker privacy independently and refuses an already shared folder before bootstrap", async () => {
  const f = await fixture();
  f.ensurePrivate.mockImplementation(async (url: string) => url === f.folder);
  await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
  expect(puts(f)).toEqual([]);
  f.ensurePrivate.mockResolvedValue(true);
  await installAcl(f, f.folder, [
    { webId: owner, owner: true },
    { webId: bob, owner: true },
  ]);
  await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
  await installAcl(f, f.folder, [{ webId: owner, owner: true }]);
  expect(await f.load()).toMatchObject({ canManage: true });
});
it("rejects invalid IRIs, absent ACL links, unsupported folder defaults and forbidden ACL GETs", async () => {
  const f = await fixture();
  await expect(
    new TasksSharingAdapter({ ...f.options, trackerUrl: "javascript:alert(1)" }).load(
      "javascript:alert(1)",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "unsupported" });
  f.intercept((_url, init) => (init.method === "HEAD" ? new Response() : undefined));
  await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
  f.intercept((url) =>
    url === `${f.project.url}.acl` ? new Response(null, { status: 403 }) : undefined,
  );
  await expect(f.load()).rejects.toMatchObject({ code: "forbidden" });
  f.intercept(undefined);
  await installAcl(f, f.folder, [{ webId: owner, owner: true }], false);
  await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
});
it("requires Control on both resources and rechecks privacy before folder creation", async () => {
  const f = await fixture();
  await f.load();
  const recipient = new TasksSharingAdapter({ ...f.options, webId: bob });
  await expect(
    recipient.setPerson(f.project.url, "https://carol.test/#me", "viewer"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await installAcl(f, f.folder, [{ webId: owner }]);
  await expect(f.adapter.setPerson(f.project.url, bob, "viewer")).rejects.toMatchObject({
    code: "forbidden",
  });
  const previous = await f.pod.fetch(`${f.folder}.acl`);
  await f.pod.fetch(`${f.folder}.acl`, {
    method: "DELETE",
    headers: { "if-match": previous.headers.get("etag") as string },
  });
  let checks = 0;
  f.ensurePrivate.mockImplementation(async () => ++checks === 1);
  await expect(f.adapter.setPerson(f.project.url, bob, "viewer")).rejects.toMatchObject({
    code: "unsupported",
  });
});
it("intersects mismatched folder grants before expanding them again", async () => {
  const f = await fixture();
  await f.adapter.setPerson(f.project.url, bob, "editor");
  for (const present of [false, true]) {
    await installAcl(f, f.folder, [
      { webId: owner, owner: true },
      ...(present ? [{ webId: bob }] : []),
    ]);
    f.requests.length = 0;
    await f.adapter.setPerson(f.project.url, bob, "editor");
    const dataset = new Store(new Parser().parse(String(puts(f)[0]?.init.body)));
    const rules = [...new AclResource(dataset, DataFactory).authorizations];
    expect(rules.map((grant) => [...grant.agent])).toEqual(present ? [[owner], [bob]] : [[owner]]);
    expect(
      rules.filter((grant) => [...grant.agent].includes(bob)).map((grant) => [...grant.mode]),
    ).toEqual(present ? [[`${ACL}Read`]] : []);
    expect((await f.grants(f.folder)).find((grant) => grant.agents.includes(bob))?.modes).toEqual([
      `${ACL}Read`,
      `${ACL}Write`,
    ]);
    expect(await f.load()).toMatchObject({
      people: expect.arrayContaining([{ webId: bob, role: "editor" }]),
    });
  }
});
it.each([
  "control",
  "read-only",
  "public",
] as const)("refuses to expand the folder after tracker access becomes %s", async (failure) => {
  const f = await fixture();
  await f.load();
  f.requests.length = 0;
  const state = {
    people: [{ webId: owner, role: "owner" as const }],
    general: { mode: "restricted" as const },
    canManage: true,
  };
  const loading = vi
    .spyOn(WacSharingAdapter.prototype, "load")
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({
      ...state,
      ...(failure === "control"
        ? { canManage: false }
        : failure === "read-only"
          ? { readOnly: "forbidden" as const }
          : { general: { mode: "link" as const } }),
    });
  const changing = vi.spyOn(WacSharingAdapter.prototype, "setPerson").mockResolvedValueOnce();
  try {
    await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(puts(f)).toHaveLength(1);
  } finally {
    loading.mockRestore();
    changing.mockRestore();
  }
});

it("refuses tampered stateStore in both the adapter binding and freshly read tracker", async () => {
  const f = await fixture();
  const other = new TasksSharingAdapter({ ...f.options, folderUrl: `${root}drive/` });
  await expect(other.setPerson(f.project.url, bob, "editor")).rejects.toMatchObject({
    code: "unsupported",
  });
  await f.store.updateProject(f.project, (tracker) => {
    tracker.stateStore = `${root}drive/`;
  });
  f.requests.length = 0;
  await expect(f.load()).rejects.toMatchObject({ code: "unsupported" });
  await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(puts(f)).toEqual([]);
});
it("refuses an owned tracker outside the direct projects container", async () => {
  const f = await fixture();
  const trackerUrl = `${f.store.projects}nested/home.ttl`;
  const adapter = new TasksSharingAdapter({
    ...f.options,
    trackerUrl,
    folderUrl: trackerUrl.replace(/\.ttl$/, "/"),
  });
  await expect(adapter.load(trackerUrl, new AbortController().signal)).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(f.requests).toEqual([]);
});
it("keeps folder-only Control holders by refusing to rewrite their ACL", async () => {
  const f = await fixture();
  await f.load();
  await installAcl(f, f.folder, [
    { webId: owner, owner: true },
    { webId: bob, owner: true },
  ]);
  f.requests.length = 0;
  await expect(
    f.adapter.setPerson(f.project.url, "https://carol.test/#me", "viewer"),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(puts(f)).toEqual([]);
  expect((await f.grants(f.folder)).find((grant) => grant.agents.includes(bob))?.modes).toContain(
    `${ACL}Control`,
  );
});

it("rejects documents that cease to be trackers before writing access", async () => {
  const f = await fixture();
  await f.store.updateProject(f.project, (tracker) => {
    node(tracker.id, tracker.dataset).types.delete(`${NS.WF}Tracker`);
  });
  f.requests.length = 0;
  await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(puts(f)).toEqual([]);
});
