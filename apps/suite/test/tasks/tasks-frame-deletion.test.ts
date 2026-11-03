// AUTHORED-BY Codex GPT-6.1-Sol

import { AclResource } from "@solid/object";
import { describe, expect, it } from "vitest";
import { InboxAclRecoveryError } from "../../src/apps/tasks/lib/model/errors";
import { DataFactory, NS, node, Store, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { Pod, storage, webId } from "./pod";
import { frameStore } from "./tasks-frame-fixtures";

describe("project deletion boundaries and recovery", () => {
  it("removes ACLs before a tracker DELETE whose response is lost, then retries safely", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const folder = home.tracker.stateStore as string;
    pod.seed(`${home.url}.acl`, await serialize(new Store()));
    pod.seed(`${folder}.acl`, await serialize(new Store()));
    pod.intercept = (request) => {
      if (request.method === "DELETE" && request.url === home.url) {
        expect(pod.files.has(`${home.url}.acl`)).toBe(false);
        expect(pod.files.has(`${folder}.acl`)).toBe(false);
        pod.files.delete(home.url);
        throw new Error("Lost tracker DELETE response");
      }
    };
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 0 });
    const deletes = pod.requests.filter((request) => request.method === "DELETE");
    expect(deletes.map((request) => request.url)).toEqual([
      `${folder}.acl`,
      folder,
      `${home.url}.acl`,
      home.url,
    ]);
    pod.intercept = undefined;
    await frameStore(pod).deleteProject(home);
    expect(pod.files.has(`${home.url}.acl`)).toBe(false);
    expect((await store.createProject("Home")).url).toBe(home.url);
  });

  it("cleans up an orphaned tracker ACL on Retry, including a failed cleanup read", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    await store.deleteProject(home);
    pod.seed(`${home.url}.acl`, await serialize(new Store()));
    const folder = home.tracker.stateStore as string;
    pod.seed(`${folder}.acl`, await serialize(new Store()));
    pod.intercept = (request) =>
      request.url === `${home.url}.acl` && request.method === "GET"
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 503 });
    pod.intercept = undefined;
    await frameStore(pod).deleteProject(home);
    await frameStore(pod).deleteProject(home);
    expect(pod.files.has(`${home.url}.acl`)).toBe(false);
    expect(pod.files.has(`${folder}.acl`)).toBe(false);
  });

  it.each([
    "tracker",
    "folder",
  ])("skips the slug with a stale %s ACL without adopting its grants", async (kind) => {
    const pod = new Pod();
    const store = frameStore(pod);
    await store.bootstrapInbox();
    const url = `${store.projects}home.ttl`;
    const folder = `${store.projects}home/`;
    const acl = `${kind === "tracker" ? url : folder}.acl`;
    pod.seed(acl, await serialize(new Store()));
    pod.requests.length = 0;
    const created = await store.createProject("Home");
    expect(created.url).toBe(`${store.projects}home-2.ttl`);
    expect(pod.files.has(url)).toBe(false);
    expect(pod.files.has(folder)).toBe(false);
    expect(pod.files.has(acl)).toBe(true);
    expect(pod.requests.some((request) => request.url === acl && request.method !== "GET")).toBe(
      false,
    );
  });

  it("keeps a reserved slug fenced when an ACL appears before Retry", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    await store.bootstrapInbox();
    const acl = `${store.projects}home.ttl.acl`;
    pod.seed(acl, await serialize(new Store()));
    await expect(
      store.createProject("Home", false, {
        owner: "reserved",
        reservation: { name: "home", dataset: new Store() },
      }),
    ).rejects.toMatchObject({ status: 409, url: acl });
    expect(pod.files.has(`${store.projects}home-2.ttl`)).toBe(false);
  });

  it.each([
    "tracker",
    "folder",
  ])("conditionally replaces a stale Inbox %s ACL after verifying private access", async (kind) => {
    const pod = new Pod();
    const store = frameStore(pod);
    const url = `${store.projects}inbox${kind === "tracker" ? ".ttl" : "/"}`;
    const acl = `${url}.acl`;
    if (kind === "folder") await pod.emptyContainer(url);
    pod.seed(acl, await serialize(new Store()));
    const inbox = await store.bootstrapInbox();
    expect(inbox.tracker.title).toBe("Inbox");
    const rules = [...new AclResource(await pod.dataset(acl), DataFactory).authorizations];
    expect(rules).toHaveLength(1);
    const rule = rules[0];
    if (!rule) throw new Error("Missing Inbox owner policy");
    expect([...rule.agent]).toEqual([webId]);
    expect([...rule.mode].sort()).toEqual(
      ["Control", "Read", "Write"].map((mode) => `http://www.w3.org/ns/auth/acl#${mode}`),
    );
    expect(rule.accessTo).toBe(url);
    expect(rule.default).toBe(kind === "folder" ? url : undefined);
    expect(pod.privatePolicies.has(url)).toBe(true);
    expect(
      pod.requests
        .find((request) => request.url === acl && request.method === "PUT")
        ?.headers.get("If-Match"),
    ).toBe('"1"');
  });

  it("fails closed with a clear typed error when stale Inbox ACL privacy cannot be verified", async () => {
    const pod = new Pod();
    const inbox = `${storage}tasks/projects/inbox.ttl`;
    const acl = `${inbox}.acl`;
    pod.seed(acl, await serialize(new Store()));
    const store = new TaskStore({
      storage,
      webId,
      fetch: pod.fetch,
      typeIndex: false,
      ensurePrivateTasksAccess: async (url) => url !== inbox,
    });
    const error = await store.bootstrapInbox().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(InboxAclRecoveryError);
    expect(error).toMatchObject({
      status: 403,
      url: inbox,
      message: "Can't restore private access to your Inbox. Check its permissions and try again.",
    });
    expect(pod.files.get(acl)?.version).toBe(1);
    expect(pod.files.has(inbox)).toBe(false);
  });

  it.each([
    412, 503,
  ])("preserves the stale Inbox ACL when its conditional replacement fails (%s)", async (status) => {
    const pod = new Pod();
    const store = frameStore(pod);
    const acl = `${store.projects}inbox.ttl.acl`;
    pod.seed(acl, await serialize(new Store()));
    pod.intercept = (request) =>
      request.url === acl && request.method === "PUT" ? new Response(null, { status }) : undefined;
    await expect(store.bootstrapInbox()).rejects.toMatchObject({ status, url: acl });
    expect(pod.files.get(acl)?.version).toBe(1);
    expect(pod.files.has(`${store.projects}inbox.ttl`)).toBe(false);
  });

  it("rejects a Home member redirected to a Work task before deleting anything", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const work = await store.createProject("Work");
    const alias = await store.createTask(home, { title: "Alias", state: "open" });
    const target = await store.createTask(work, { title: "Keep", state: "open" });
    pod.intercept = (request) => {
      if (request.method !== "GET" || request.url !== alias.url) return undefined;
      const response = new Response(pod.files.get(target.url)?.body, {
        headers: { "Content-Type": "text/turtle", ETag: target.etag as string },
      });
      Object.defineProperty(response, "url", { value: target.url });
      return response;
    };
    pod.requests.length = 0;
    await expect(store.deleteProject(home)).rejects.toThrow();
    expect(pod.requests.filter((request) => request.method === "DELETE")).toEqual([]);
    expect(pod.files.has(target.url)).toBe(true);
    expect(pod.files.has(work.url)).toBe(true);
  });

  it("never reads or deletes forged members outside the exact task container", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const work = await store.createProject("Work");
    const task = await store.createTask(work, { title: "Private Work task", state: "open" });
    const container = home.tracker.stateStore as string;
    const invalid = [
      task.url,
      `${container}nested/task.ttl`,
      `${container}query.ttl?q=1`,
      `${container}fragment.ttl#it`,
      `${container}metadata.acl`,
      `${container}bad%2Ftask.ttl`,
      `${container}bad%5Ctask.ttl`,
      `${container}.ttl`,
      "https://evil.test/task.ttl",
      "mailto:someone@example.org",
      `${container}broken%xx.ttl`,
      `${container}empty-query.ttl?`,
      `${container}empty-fragment.ttl#`,
      `https://user:password@pod.test${new URL(container).pathname}task.ttl`,
    ];
    const dataset = await pod.dataset(container);
    for (const url of invalid) node(container, dataset).iris(`${NS.LDP}contains`).add(url);
    pod.seed(container, await serialize(dataset));
    pod.requests.length = 0;
    await store.deleteProject(home);
    expect(pod.requests.filter((request) => invalid.includes(request.url))).toEqual([]);
    expect(pod.files.has(task.url)).toBe(true);
    expect(pod.files.has(work.url)).toBe(true);
  });

  it("rejects stale tracker revisions before any destructive request", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const task = await store.createTask(home, { title: "Keep", state: "open" });
    await store.updateProject(home, (tracker) => {
      tracker.title = "Renamed elsewhere";
    });
    pod.requests.length = 0;
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 412 });
    expect(pod.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(pod.files.has(task.url)).toBe(true);
  });

  it("conditionally reserves even when a tracker changes between read and reservation", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const task = await store.createTask(home, { title: "Keep", state: "open" });
    pod.requests.length = 0;
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === home.url
        ? new Response(null, { status: 412 })
        : undefined;
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 412 });
    expect(pod.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(pod.files.has(task.url)).toBe(true);
  });

  it.each([
    "member",
    "container",
    "tracker",
  ])("resumes a failed %s deletion with a new store and the old caller revision", async (failure) => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const first = await store.createTask(home, { title: "First", state: "open" }, "first");
    const second = await store.createTask(home, { title: "Second", state: "open" }, "second");
    const failingUrl =
      failure === "member"
        ? second.url
        : failure === "container"
          ? home.tracker.stateStore
          : home.url;
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === failingUrl
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 503 });
    expect(pod.files.has(first.url)).toBe(false);
    expect(
      pod.requests
        .find((request) => request.method === "PUT" && request.body.includes("pending"))
        ?.headers.get("If-Match"),
    ).toBe(home.etag);
    const pending = await store.readProject(home.url);
    await expect(
      store.updateProject(pending, (tracker) => {
        tracker.title = "New";
      }),
    ).rejects.toMatchObject({ status: 412 });
    pod.intercept = undefined;
    await frameStore(pod).deleteProject(home);
    await frameStore(pod).deleteProject(home);
    expect(
      [home.url, first.url, second.url, home.tracker.stateStore].some((url) =>
        pod.files.has(url as string),
      ),
    ).toBe(false);
  });

  it("treats concurrent 404s on already removed tasks and containers as success", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const task = await store.createTask(home, { title: "Gone", state: "open" });
    pod.intercept = (request) => {
      if (
        request.method === "DELETE" &&
        [task.url, home.tracker.stateStore].includes(request.url)
      ) {
        pod.files.delete(request.url);
        return new Response(null, { status: 404 });
      }
    };
    await store.deleteProject(home);
    expect(pod.files.has(home.url)).toBe(false);
  });

  it("refuses recovery when a pending tracker's stateStore has changed", async () => {
    const pod = new Pod();
    const store = frameStore(pod);
    const home = await store.createProject("Home");
    const work = await store.createProject("Work");
    const task = await store.createTask(home, { title: "Interrupted", state: "open" });
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === task.url
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(store.deleteProject(home)).rejects.toMatchObject({ status: 503 });
    pod.intercept = undefined;
    const dataset = await pod.dataset(home.url);
    const stateStores = node(home.tracker.id, dataset).iris(`${NS.WF}stateStore`);
    stateStores.clear();
    stateStores.add(work.tracker.stateStore as string);
    pod.seed(home.url, await serialize(dataset));
    pod.requests.length = 0;
    await expect(frameStore(pod).deleteProject(home)).rejects.toMatchObject({ status: 412 });
    expect(pod.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(pod.files.has(task.url)).toBe(true);
    expect(pod.files.has(work.url)).toBe(true);
  });
});
