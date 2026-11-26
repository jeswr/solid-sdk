import { AclResource } from "@solid/object";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { TasksSharingAdapter } from "../../src/apps/tasks/lib/share/adapter";
import { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { createDemoPod } from "../../src/lib/demo-pod/pod";

const root = "https://alice.demo.pod/";
const owner = `${root}profile#me`;
const bob = "https://bob.example/profile#me";
const _ACL = "http://www.w3.org/ns/auth/acl#";
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
  const failures = vi.fn();
  const cache = new TasksCache(store, failures, owner, notice);
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
    if (!(await cache.syncProjectMember(project, webId, granted, { silent: true })))
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
    failures,
    intercept: (next: typeof intercept) => {
      intercept = next;
    },
  };
}
const carol = "https://carol.example/profile#me";
const loses = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.intercept((url, init) => {
    if (url === `${f.project.url}.acl` && init.method === "PUT") throw new Error("Lost");
  });

describe("Tasks sharing pending marker", () => {
  it("lets a revoke of another person proceed while a grant is unconfirmed", async () => {
    const f = await fixture();
    await f.adapter.setPerson(f.project.url, carol, "editor");
    loses(f);
    await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toBeDefined();
    f.intercept(undefined);
    await f.adapter.setPerson(f.project.url, carol, null);
    expect((await f.grants(f.folder)).some((g) => g.agents.includes(carol))).toBe(false);
    expect((await f.grants(f.folder)).some((g) => g.agents.includes(bob))).toBe(false);
    expect((await f.grants(f.project.url)).some((g) => g.agents.includes(carol))).toBe(false);
  });

  it("clears the marker when the tracker ACL moved to a different people set", async () => {
    const f = await fixture();
    await f.load();
    loses(f);
    await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toBeDefined();
    f.intercept(undefined);
    const other = new TasksSharingAdapter({ ...f.options });
    await other.setPerson(f.project.url, carol, "viewer");
    await f.adapter.setPerson(f.project.url, carol, null);
    expect((await f.load()).pendingAccess).toBe(false);
  });

  it("does not block a revoke when the settle read fails member sync", async () => {
    const f = await fixture();
    await f.adapter.setPerson(f.project.url, carol, "viewer");
    loses(f);
    await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toBeDefined();
    f.intercept(undefined);
    f.syncMembers.mockRejectedValue(new Error("down"));
    // The revoke commits; only the member-list repair is reported, never a "network" lock.
    await expect(f.adapter.setPerson(f.project.url, carol, null)).rejects.toMatchObject({
      code: "members-sync",
    });
    expect((await f.grants(f.project.url)).some((g) => g.agents.includes(carol))).toBe(false);
  });

  it("treats a definite 4xx on the tracker PUT as not applied", async () => {
    const f = await fixture();
    await f.load();
    f.intercept((url, init) =>
      url === `${f.project.url}.acl` && init.method === "PUT"
        ? new Response(null, { status: 413 })
        : undefined,
    );
    await expect(f.adapter.setPerson(f.project.url, bob, "editor")).rejects.toMatchObject({
      code: "unsupported",
    });
    f.intercept(undefined);
    expect((await f.load()).pendingAccess).toBe(false);
    await f.adapter.setPerson(f.project.url, carol, "viewer");
  });
});
