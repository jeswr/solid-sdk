// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyError, ModelError } from "../../src/apps/tasks/lib/model/errors";
import { RdfIO, requireEtag } from "../../src/apps/tasks/lib/model/io";
import { DataFactory, NS, node, parse, Store, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
import { TypeIndex } from "../../src/apps/tasks/lib/model/type-index";
import { now, Pod, storage, webId } from "./pod";

const projects = `${storage}tasks/projects/`;
const indexUrl = `${storage}settings/privateTypeIndex.ttl`;
const initializationState = `${NS.SCHEDULING}initializationState`;
const initializationOwner = `${NS.SCHEDULING}initializationOwner`;
const cleanupResources = `${NS.SCHEDULING}cleanupResources`;
const cleanupEtag = `${NS.SCHEDULING}cleanupEtag`;
function store(pod: Pod, extra = {}) {
  return new TaskStore({
    storage,
    webId,
    fetch: pod.fetch,
    ensurePrivateIndexAccess: pod.ensurePrivateIndexAccess,
    now: () => now,
    uuid: () => "task-1",
    ...extra,
  });
}
afterEach(() => vi.restoreAllMocks());

describe("project discovery and first use", () => {
  it.each([
    "container",
    "registration",
  ])("compensates failed %s creation and reuses the project slug on retry", async (failure) => {
    const pod = new Pod();
    const tasks = store(pod);
    const url = `${projects}home.ttl`;
    pod.intercept = (request) =>
      request.method === "PUT" &&
      request.url === (failure === "container" ? `${projects}home/` : indexUrl)
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(tasks.createProject("Home")).rejects.toMatchObject({ status: 503 });
    expect(pod.files.has(url)).toBe(false);
    expect(await tasks.listProjects()).toEqual([]);
    expect(
      pod.requests
        .find((request) => request.method === "DELETE" && request.url === url)
        ?.headers.get("If-Match"),
    ).toBe('"2"');
    pod.intercept = undefined;
    // A new model instance also reuses the identity after compensation.
    expect((await store(pod).createProject("Home")).url).toBe(url);
    expect((await tasks.listProjects()).map((project) => project.url)).toEqual([url]);
    expect(await new RdfIO(pod.fetch).list(`${projects}home/`)).toEqual([]);
  });
  it("blocks the same project reservation until recoverable compensation succeeds", async () => {
    const pod = new Pod();
    const tasks = store(pod, { typeIndex: false });
    const url = `${projects}home.ttl`;
    pod.intercept = (request) =>
      request.method === "DELETE" ||
      (request.method === "PUT" && request.url === `${projects}home/`)
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(tasks.createProject("Home")).rejects.toThrow(AggregateError);
    const reservations = () =>
      pod
        .mutations()
        .filter(
          (request) =>
            request.method === "PUT" &&
            request.url.endsWith(".ttl") &&
            request.headers.get("If-None-Match") === "*",
        );
    await expect(tasks.createProject("Home")).rejects.toMatchObject({ status: 503 });
    expect(reservations()).toHaveLength(1);
    expect((await tasks.createProject("Unrelated")).tracker.title).toBe("Unrelated");
    pod.intercept = undefined;
    expect((await tasks.createProject("Home")).url).toBe(url);
    expect(reservations().map((request) => request.url)).toEqual([
      url,
      `${projects}unrelated.ttl`,
      url,
    ]);
  });
  it("does not compensate over concurrent edits and accepts an already removed tracker", async () => {
    const pod = new Pod();
    const tasks = store(pod, { typeIndex: false });
    const url = `${projects}home.ttl`;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === `${projects}home/`) {
        pod.seed(url, `<#this> a <${NS.WF}Tracker>; <${NS.DCT}title> "Concurrent".`);
        return new Response(null, { status: 503 });
      }
      return undefined;
    };
    await expect(tasks.createProject("Home")).rejects.toMatchObject({ status: 503 });
    expect((await tasks.readProject(url)).tracker.title).toBe("Concurrent");
    pod.intercept = undefined;
    expect((await tasks.createProject("Another")).tracker.title).toBe("Another");
    expect((await tasks.createProject("Home")).url).toBe(`${projects}home-2.ttl`);
    expect((await tasks.readProject(url)).tracker.title).toBe("Concurrent");
    pod.intercept = (request) =>
      request.method === "DELETE" ? new Response(null, { status: 404 }) : undefined;
    pod.files.delete(url);
    expect((await tasks.createProject("Home")).url).toBe(url);
  });
  it.each([
    "registration",
    "finalization",
  ])("preserves an Inbox adopted during the creator's failed %s", async (phase) => {
    const pod = new Pod();
    const url = `${projects}inbox.ttl`;
    const container = `${projects}inbox/`;
    await new TypeIndex(
      new RdfIO(pod.fetch),
      storage,
      webId,
      pod.ensurePrivateIndexAccess,
    ).register([]);
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    let blocked = false;
    let failRegistration = phase === "registration";
    const creatorFetch: typeof fetch = async (input, init) => {
      const target = String(input);
      if (init?.method === "PUT" && target === indexUrl) {
        if (!blocked) {
          blocked = true;
          entered.resolve();
          await released.promise;
        }
        if (failRegistration) {
          failRegistration = false;
          return new Response(null, { status: 503 });
        }
      }
      return pod.fetch(input, init);
    };
    const creator = store(pod, { fetch: creatorFetch });
    const creation = creator.bootstrapInbox();
    const failed =
      phase === "registration"
        ? expect(creation).rejects.toMatchObject({ status: 503 })
        : expect(creation).resolves.toMatchObject({ url });
    await entered.promise;
    const previousTracker = pod.files.get(url)?.body;
    const previousContainer = pod.files.get(container)?.body;
    const adopter = store(pod);
    let adopted: Awaited<ReturnType<TaskStore["bootstrapInbox"]>>;
    try {
      adopted = await adopter.bootstrapInbox();
      expect(adopted.tracker.title).toBe("Inbox");
      expect(pod.files.get(url)?.body).not.toBe(previousTracker);
      expect(pod.files.get(container)?.body).toBe(previousContainer);
    } finally {
      released.resolve();
    }
    await failed;
    expect(pod.files.has(url)).toBe(true);
    expect(pod.files.has(container)).toBe(true);
    expect((await adopter.readProject(url)).tracker.title).toBe(adopted.tracker.title);
    expect(
      (await adopter.createTask(adopted, { title: "Survives", state: "open" })).task.title,
    ).toBe("Survives");
    // Stale compensation is retired and cannot block another project.
    expect((await creator.createProject("Another")).tracker.title).toBe("Another");
    expect(pod.files.has(url)).toBe(true);
    expect(pod.files.has(container)).toBe(true);
  });
  it.each([
    "claim",
    "finalization",
  ])("retries a conditional Inbox %s conflict and preserves the concurrent revision", async (phase) => {
    const pod = new Pod();
    const tasks = store(pod, { typeIndex: false });
    const inbox = await tasks.bootstrapInbox();
    let writes = 0;
    let conflicted = false;
    pod.intercept = async (request) => {
      if (request.url === inbox.url && request.method === "PUT") {
        writes++;
        if (writes === (phase === "claim" ? 1 : 2)) {
          conflicted = true;
          const dataset = await pod.dataset(inbox.url);
          node(inbox.tracker.id, dataset).setText(`${NS.DCT}title`, "Adopted elsewhere");
          pod.seed(inbox.url, await serialize(dataset));
        }
      }
      return undefined;
    };
    const adopted = await tasks.bootstrapInbox();
    expect(conflicted).toBe(true);
    expect(adopted.tracker.title).toBe("Adopted elsewhere");
    expect(adopted.tracker.modified?.getTime()).toBeGreaterThan(
      inbox.tracker.modified?.getTime() as number,
    );
    expect(pod.mutations().some((request) => request.method === "DELETE")).toBe(false);
  });
  it("resumes active cleanup and fences delayed deletes from the previous owner", async () => {
    const pod = new Pod();
    pod.contentEtags = true;
    const url = `${projects}inbox.ttl`;
    const container = `${projects}inbox/`;
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const creator = store(pod, {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT" && String(input) === indexUrl)
          return new Response(null, { status: 503 });
        if (init?.method === "DELETE" && String(input) === container) {
          entered.resolve();
          await released.promise;
        }
        return pod.fetch(input, init);
      },
    });
    const failed = expect(creator.bootstrapInbox()).rejects.toMatchObject({ status: 503 });
    await entered.promise;
    const previousContainer = pod.files.get(container)?.body;
    const adopter = store(pod);
    try {
      const adopted = await adopter.bootstrapInbox();
      expect(pod.files.has(url)).toBe(true);
      expect(pod.files.get(container)?.body).not.toBe(previousContainer);
      expect((await adopter.createTask(adopted, { title: "Safe", state: "open" })).task.title).toBe(
        "Safe",
      );
    } finally {
      released.resolve();
    }
    await failed;
    expect(pod.files.has(url)).toBe(true);
    expect(pod.files.has(container)).toBe(true);
    const adopted = await adopter.bootstrapInbox();
    expect((await adopter.listTasks(adopted.tracker.stateStore as string))[0]?.task.title).toBe(
      "Safe",
    );
  });
  it.each([
    "container",
    "tracker",
  ])("resumes interrupted %s deletion after discarding the original store", async (phase) => {
    const pod = new Pod();
    pod.omitPutEtags = true;
    const url = `${projects}inbox.ttl`;
    const container = `${projects}inbox/`;
    pod.intercept = (request) =>
      (request.method === "PUT" && request.url === indexUrl) ||
      (request.method === "DELETE" && request.url === (phase === "container" ? container : url))
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(store(pod).bootstrapInbox()).rejects.toThrow(AggregateError);
    const dataset = await pod.dataset(url);
    const marker = node(`${url}#this`, dataset);
    expect(marker.text(initializationState)).toBe("cleanup");
    expect(marker.text(initializationOwner)).toBeTruthy();
    expect([...marker.iris(cleanupResources)]).toEqual([container]);
    expect(node(container, dataset).text(cleanupEtag)).toBe('"1"');
    const markerEtag = `"${pod.files.get(url)?.version}"`;
    const start = pod.requests.length;
    pod.intercept = undefined;
    const restarted = store(pod);
    const inbox = await restarted.bootstrapInbox();
    const recovery = pod.requests.slice(start);
    const claim = recovery.find((request) => request.url === url && request.method === "PUT");
    expect(claim?.headers.get("If-Match")).toBe(markerEtag);
    const claimed = await parse(url, claim?.body as string);
    expect(node(`${url}#this`, claimed).text(initializationOwner)).not.toBe(
      marker.text(initializationOwner),
    );
    expect(recovery.findIndex((request) => request.method === "DELETE")).toBeGreaterThan(
      recovery.indexOf(claim as (typeof recovery)[number]),
    );
    expect(
      recovery
        .filter((request) => request.method === "DELETE")
        .map((request) => [request.url, request.headers.get("If-Match")]),
    ).toEqual([
      [container, '"1"'],
      [url, '"3"'],
    ]);
    expect(inbox.url).toBe(url);
    expect(node(inbox.tracker.id, inbox.dataset).text(initializationState)).toBeUndefined();
    expect(
      (await restarted.createTask(inbox, { title: "Recovered", state: "open" })).task.title,
    ).toBe("Recovered");
  });
  it("preserves adoption that wins the restarted cleanup's conditional marker claim", async () => {
    const pod = new Pod();
    const url = `${projects}inbox.ttl`;
    const container = `${projects}inbox/`;
    pod.intercept = (request) =>
      (request.method === "PUT" && request.url === indexUrl) || request.method === "DELETE"
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(store(pod).bootstrapInbox()).rejects.toThrow(AggregateError);
    let adopted = false;
    const start = pod.requests.length;
    pod.intercept = async (request) => {
      if (!adopted && request.method === "PUT" && request.url === url) {
        adopted = true;
        const dataset = await pod.dataset(url);
        const marker = node(`${url}#this`, dataset);
        marker.clear(initializationState);
        marker.setText(initializationOwner, "another-owner");
        marker.setText(`${NS.DCT}title`, "Adopted");
        pod.seed(url, await serialize(dataset));
      }
      return undefined;
    };
    const inbox = await store(pod).bootstrapInbox();
    expect(inbox.tracker.title).toBe("Adopted");
    expect(pod.files.has(container)).toBe(true);
    expect(pod.requests.slice(start).filter((request) => request.method === "DELETE")).toEqual([]);
  });
  it.each([
    "owner",
    "resource",
    "validator",
  ])("rejects a persisted cleanup marker with invalid %s before deleting resources", async (field) => {
    const pod = new Pod();
    const url = `${projects}inbox.ttl`;
    const container = `${projects}inbox/`;
    const tasks = store(pod, { typeIndex: false });
    const inbox = await tasks.bootstrapInbox();
    const dataset = new Store([...inbox.dataset]);
    const marker = node(inbox.tracker.id, dataset);
    marker.setText(initializationState, "cleanup");
    if (field !== "owner") marker.setText(initializationOwner, "cleanup-owner");
    const target = field === "resource" ? `${storage}unrelated/` : container;
    marker.iris(cleanupResources).add(target);
    if (field !== "validator") node(target, dataset).setText(cleanupEtag, '"1"');
    pod.seed(url, await serialize(dataset));
    const start = pod.requests.length;
    const bootstrap = store(pod, { typeIndex: false }).bootstrapInbox();
    if (field === "validator") await expect(bootstrap).rejects.toThrow("ETag");
    else await expect(bootstrap).rejects.toMatchObject({ status: 412 });
    expect(pod.requests.slice(start).filter((request) => request.method !== "GET")).toEqual([]);
    expect(pod.files.has(container)).toBe(true);
  });
  it("resumes cleanup that starts between the Inbox lookup and the adoption read", async () => {
    const pod = new Pod();
    const tasks = store(pod, { typeIndex: false });
    const inbox = await tasks.bootstrapInbox();
    const container = inbox.tracker.stateStore as string;
    let reads = 0;
    pod.intercept = async (request) => {
      if (request.method === "GET" && request.url === inbox.url && ++reads === 2) {
        const dataset = await pod.dataset(inbox.url);
        const marker = node(inbox.tracker.id, dataset);
        marker.setText(initializationState, "cleanup");
        marker.setText(initializationOwner, "another-cleaner");
        marker.iris(cleanupResources).add(container);
        node(container, dataset).setText(cleanupEtag, '"1"');
        pod.seed(inbox.url, await serialize(dataset));
      }
      return undefined;
    };
    const recovered = await tasks.bootstrapInbox();
    expect(recovered.tracker.title).toBe("Inbox");
    expect(node(recovered.tracker.id, recovered.dataset).text(initializationState)).toBeUndefined();
    expect(
      pod.requests.some((request) => request.method === "DELETE" && request.url === container),
    ).toBe(true);
  });
  it("adopts an existing Inbox without a modification timestamp", async () => {
    const pod = new Pod();
    const url = `${projects}inbox.ttl`;
    const tasks = store(pod, { typeIndex: false });
    await tasks.bootstrapInbox();
    const dataset = await pod.dataset(url);
    node(`${url}#this`, dataset).clear(`${NS.DCT}modified`);
    pod.seed(url, await serialize(dataset));
    expect((await tasks.bootstrapInbox()).tracker.modified).toEqual(new Date(now.getTime() + 1));
  });
  it("creates and adopts projects when all successful PUTs omit ETags", async () => {
    const pod = new Pod();
    pod.omitPutEtags = true;
    const tasks = store(pod);
    const project = await tasks.createProject("Home");
    expect(project.etag).toBeTruthy();
    const inbox = await tasks.bootstrapInbox();
    const adopted = await store(pod).bootstrapInbox();
    expect(adopted.tracker.id).toBe(inbox.tracker.id);
    expect((await tasks.createTask(project, { title: "Works", state: "open" })).etag).toBeTruthy();
    expect(
      pod
        .mutations()
        .filter((request) => request.url.endsWith("/") && request.headers.has("If-Match")),
    ).toEqual([]);
    expect(await new RdfIO(pod.fetch).list(project.tracker.stateStore as string)).toHaveLength(1);
  });
  it("compensates with read-back validators when successful PUTs omit ETags", async () => {
    const pod = new Pod();
    pod.omitPutEtags = true;
    const tasks = store(pod);
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === indexUrl
        ? new Response(null, { status: 503 })
        : undefined;
    await expect(tasks.createProject("Home")).rejects.toMatchObject({ status: 503 });
    expect(pod.files.has(`${projects}home.ttl`)).toBe(false);
    expect(pod.files.has(`${projects}home/`)).toBe(false);
    pod.intercept = undefined;
    expect((await tasks.createProject("Home")).url).toBe(`${projects}home.ttl`);
  });
  it("creates and updates scheduled tasks after blank-node relabelling without PUT ETags", async () => {
    const pod = new Pod();
    pod.omitPutEtags = true;
    const tasks = store(pod, { typeIndex: false });
    const project = await tasks.bootstrapInbox();
    const created = await tasks.createTask(project, {
      title: "Scheduled",
      state: "open",
      dueDate: now,
      recurrence: { frequency: "DAILY", interval: 1 },
      reminders: [{ offset: "-PT15M" }],
    });
    expect(created.etag).toBe('"1"');
    expect(created.task.recurrence).toMatchObject({ frequency: "DAILY", interval: 1 });
    expect(created.task.reminders).toMatchObject([{ offset: "-PT15M" }]);
    // Parsing the persisted bytes again allocates fresh blank-node labels.
    expect((await pod.dataset(created.url)).equals(created.dataset)).toBe(false);
    const updated = await tasks.updateTask(created, (task) => {
      task.title = "Updated schedule";
      task.recurrence = { frequency: "WEEKLY", interval: 2 };
      task.reminders = [{ offset: "-PT30M" }];
    });
    expect(updated.etag).toBe('"2"');
    const read = await tasks.readTask(created.url);
    expect(read.task.title).toBe("Updated schedule");
    expect(read.task.recurrence).toMatchObject({ frequency: "WEEKLY", interval: 2 });
    expect(read.task.reminders).toMatchObject([{ offset: "-PT30M" }]);
    expect(
      pod
        .mutations()
        .filter((request) => request.url === created.url)
        .map((request) => [request.headers.get("If-None-Match"), request.headers.get("If-Match")]),
    ).toEqual([
      ["*", null],
      [null, created.etag],
    ]);
  });
  it("rejects a changed named identity in scheduled-task validator read-back", async () => {
    const pod = new Pod();
    pod.omitPutEtags = true;
    const tasks = store(pod, { typeIndex: false });
    const project = await tasks.bootstrapInbox();
    const url = `${projects}inbox/task-1.ttl`;
    pod.intercept = async (request) => {
      if (request.method === "GET" && request.url === url) {
        const dataset = await pod.dataset(url);
        node(`${url}#it`, dataset).setIri(`${NS.WF}tracker`, `${projects}other.ttl#this`);
        pod.seed(url, await serialize(dataset));
      }
      return undefined;
    };
    await expect(
      tasks.createTask(project, {
        title: "Scheduled",
        state: "open",
        dueDate: now,
        recurrence: { frequency: "DAILY", interval: 1 },
        reminders: [{ offset: "-PT15M" }],
      }),
    ).rejects.toMatchObject({ status: 412 });
  });
  it.each([
    404, 412, 503,
  ])("handles container cleanup %s without deleting an edited container", async (status) => {
    const pod = new Pod();
    const tasks = store(pod);
    const url = `${projects}home.ttl`;
    const container = `${projects}home/`;
    let deleteCount = 0;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === indexUrl)
        return new Response(null, { status: 503 });
      if (request.method === "DELETE" && request.url === container) {
        deleteCount++;
        if (status === 404) pod.files.delete(container);
        if (status === 412)
          pod.seed(
            container,
            `<${container}> a <${NS.LDP}BasicContainer>; <${NS.DCT}title> "Edited".`,
          );
        return new Response(null, { status });
      }
      return undefined;
    };
    const failed = tasks.createProject("Home");
    if (status === 503) await expect(failed).rejects.toThrow(AggregateError);
    else await expect(failed).rejects.toMatchObject({ status: 503 });
    expect(pod.files.has(url)).toBe(status === 503);
    pod.intercept = undefined;
    expect((await tasks.createProject("Home")).tracker.title).toBe("Home");
    expect(deleteCount).toBe(1);
    if (status === 412)
      expect(node(container, await pod.dataset(container)).text(`${NS.DCT}title`)).toBe("Edited");
  });
  it("retires stale tracker deletion after compensation has acquired its cleanup fence", async () => {
    const pod = new Pod();
    const tasks = store(pod);
    const url = `${projects}home.ttl`;
    let deletions = 0;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === indexUrl)
        return new Response(null, { status: 503 });
      if (request.method === "DELETE" && request.url === url) {
        deletions++;
        pod.seed(url, `<#this> a <${NS.WF}Tracker>; <${NS.DCT}title> "Adopted".`);
      }
      return undefined;
    };
    await expect(tasks.createProject("Home")).rejects.toMatchObject({ status: 503 });
    pod.intercept = undefined;
    expect((await tasks.createProject("Another")).tracker.title).toBe("Another");
    expect((await tasks.createProject("Home")).url).toBe(`${projects}home-2.ttl`);
    expect(deletions).toBe(1);
    expect((await tasks.readProject(url)).tracker.title).toBe("Adopted");
  });
  it("creates the Inbox, its hierarchy and private Type Index registrations idempotently", async () => {
    const pod = new Pod();
    const tasks = store(pod);
    expect(tasks.projects).toBe(projects);
    expect(await tasks.listProjects()).toEqual([]);
    const inbox = await tasks.bootstrapInbox();
    expect(inbox.url).toBe(`${projects}inbox.ttl`);
    expect(inbox.tracker.title).toBe("Inbox");
    expect(inbox.tracker.stateStore).toBe(`${projects}inbox/`);
    expect(inbox.tracker.groupMembers).toEqual([webId]);
    expect(pod.files.has(`${storage}tasks/`)).toBe(true);
    expect(pod.files.has(`${projects}inbox/`)).toBe(true);
    const registrations = await pod.dataset(indexUrl);
    expect(registrations.match(null, DataFactory.namedNode(`${NS.SOLID}forClass`)).size).toBe(2);
    expect(
      registrations.match(
        null,
        DataFactory.namedNode(`${NS.SOLID}instanceContainer`),
        DataFactory.namedNode(`${projects}inbox/`),
      ).size,
    ).toBe(1);
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId, pod.ensurePrivateIndexAccess);
    expect(await index.locations(`${NS.WF}Task`)).toEqual([
      { forClass: `${NS.WF}Task`, location: `${projects}inbox/`, kind: "instanceContainer" },
    ]);
    expect(registrations.match(null, DataFactory.namedNode(`${NS.SOLID}instance`)).size).toBe(0);
    expect(
      registrations.match(
        null,
        DataFactory.namedNode(`${NS.SOLID}instanceContainer`),
        DataFactory.namedNode(projects),
      ).size,
    ).toBe(1);
    expect([...node(indexUrl, registrations).types]).toEqual([
      `${NS.SOLID}TypeIndex`,
      `${NS.SOLID}UnlistedDocument`,
    ]);
    const before = pod.files.get(indexUrl)?.version;
    const again = await tasks.bootstrapInbox();
    expect(again.tracker.id).toBe(inbox.tracker.id);
    expect(pod.files.get(indexUrl)?.version).toBe(before);
    expect((await tasks.listProjects()).map((project) => project.tracker.title)).toEqual(["Inbox"]);
    for (const request of pod.mutations())
      expect(request.headers.has("If-Match") || request.headers.get("If-None-Match") === "*").toBe(
        true,
      );
  });
  it("uses deterministic slugs and retries a concurrent project reservation", async () => {
    const pod = new Pod();
    const tasks = store(pod);
    expect((await tasks.createProject("Café home")).url).toBe(`${projects}cafe-home.ttl`);
    expect((await tasks.createProject("Café home")).url).toBe(`${projects}cafe-home-2.ttl`);
    let raced = false;
    pod.intercept = (request) => {
      if (!raced && request.method === "PUT" && request.url === `${projects}work.ttl`) {
        raced = true;
        return new Response(null, { status: 412 });
      }
      return undefined;
    };
    expect((await tasks.createProject("Work")).url).toBe(`${projects}work-2.ttl`);
    await expect(tasks.createProject(" ")).rejects.toThrow("title");
    pod.intercept = (request) =>
      request.method === "PUT" && request.url.endsWith(".ttl")
        ? new Response(null, { status: 403 })
        : undefined;
    await expect(tasks.createProject("Forbidden")).rejects.toMatchObject({ status: 403 });
  });
  it("bounds slug conflicts", async () => {
    const pod = new Pod();
    pod.intercept = (request) =>
      request.method === "PUT" && request.url.endsWith(".ttl")
        ? new Response(null, { status: 412 })
        : undefined;
    await expect(store(pod).createProject("Collision")).rejects.toMatchObject({ status: 409 });
    expect(pod.mutations().filter((request) => request.url.endsWith(".ttl"))).toHaveLength(100);
  });
  it("repairs a concurrently created Inbox and propagates other failures", async () => {
    const pod = new Pod();
    let raced = false;
    pod.intercept = async (request) => {
      if (!raced && request.url === `${projects}inbox.ttl` && request.method === "PUT") {
        raced = true;
        const { dataset } = createTracker(request.url, "Inbox", `${projects}inbox/`, [webId], now);
        pod.seed(request.url, await serialize(dataset));
        return new Response(null, { status: 412 });
      }
      return undefined;
    };
    expect((await store(pod).bootstrapInbox()).tracker.title).toBe("Inbox");
    const invalid = new Pod();
    invalid.seed(`${projects}inbox.ttl`, `<#this> a <${NS.WF}Tracker>.`);
    await expect(store(invalid).bootstrapInbox()).rejects.toThrow("stateStore");
    const conflicting = new Pod();
    conflicting.intercept = (request) =>
      request.method === "PUT" && request.url === `${projects}inbox.ttl`
        ? new Response(null, { status: 412 })
        : undefined;
    await expect(store(conflicting).bootstrapInbox()).rejects.toMatchObject({ status: 412 });
    expect(
      conflicting.mutations().filter((request) => request.url.endsWith("inbox.ttl")),
    ).toHaveLength(3);
    const denied = new Pod();
    denied.intercept = (request) =>
      request.method === "PUT" && request.url.endsWith(".ttl")
        ? new Response(null, { status: 403 })
        : undefined;
    await expect(store(denied).bootstrapInbox()).rejects.toMatchObject({ status: 403 });
  });
  it("discovers Issues projects via direct and container registrations, deduplicates and preserves archived metadata", async () => {
    const pod = new Pod();
    const tasks = store(pod);
    const home = await tasks.createProject("Home");
    const team = `${storage}issues/team.ttl`;
    const teamDataset = createTracker(
      team,
      "Team",
      `${storage}issues/state/`,
      [webId],
      now,
    ).dataset;
    node(`${team}#this`, teamDataset).setIri(`${NS.WF}issueClass`, `${storage}workflow#Issue`);
    pod.seed(team, await serialize(teamDataset));
    const foreign = `${storage}foreign/`;
    await pod.emptyContainer(foreign);
    const archive = createTracker(`${foreign}archive.ttl`, "Archived", foreign, [], now);
    archive.tracker.position = -1;
    archive.tracker.archivedAt = now;
    pod.seed(`${foreign}archive.ttl`, await serialize(archive.dataset));
    pod.seed(`${projects}stray.ttl`, `<#it> a <${NS.WF}Task>.`);
    pod.seed(`${projects}readme.txt`, "not RDF");
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId, pod.ensurePrivateIndexAccess);
    await index.register([
      { forClass: `${NS.WF}Tracker`, location: `${team}#this`, kind: "instance" },
      { forClass: `${NS.WF}Tracker`, location: foreign, kind: "instanceContainer" },
      { forClass: `${NS.WF}Tracker`, location: `${home.url}#this`, kind: "instance" },
    ]);
    const all = await tasks.listProjects();
    expect(all.map((project) => project.tracker.title)).toEqual(["Archived", "Home", "Team"]);
    expect(all[0]?.tracker.archivedAt).toEqual(now);
    expect(all[2]?.tracker.issueClass).toBe(`${storage}workflow#Issue`);
    expect((await tasks.readProject(`${team}#this`)).url).toBe(team);
    await expect(tasks.readProject(`${projects}stray.ttl`)).rejects.toThrow("wf:Tracker");
    const changed = await tasks.updateProject(home, (tracker) => {
      tracker.title = "Renamed";
      tracker.description = "Keep slug";
      tracker.defineCategory("Section", "Doing", 2);
      tracker.defineCategory("Label", "bills");
      tracker.setGroupMembers([webId, `${storage}bob#me`]);
      tracker.archivedAt = now;
    });
    expect(changed.url).toBe(home.url);
    expect(changed.tracker.modified).toEqual(now);
    expect(changed.tracker.sections[0]?.name).toBe("Doing");
    expect(changed.tracker.groupMembers).toHaveLength(2);
    expect(home.tracker.title).toBe("Home");
    await expect(
      tasks.updateProject(home, (tracker) => {
        tracker.title = "Stale";
      }),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      tasks.updateProject(changed, (tracker) => {
        tracker.title = "";
      }),
    ).rejects.toThrow("title");
  });
  it("supports listing and bootstrap when Type Index is disabled", async () => {
    const pod = new Pod();
    const tasks = store(pod, { typeIndex: false });
    await tasks.bootstrapInbox();
    expect(await tasks.listProjects()).toHaveLength(1);
    expect(
      pod.requests.some(
        (request) => request.url.includes("profile/") || request.url.includes("TypeIndex"),
      ),
    ).toBe(false);
  });
});
describe("task conditional CRUD", () => {
  it("uses final response identities for redirected tasks, projects and container listings", async () => {
    const pod = new Pod();
    const tasks = store(pod, { typeIndex: false });
    const home = `${storage}canonical/home.ttl`;
    const container = `${storage}canonical/tasks/`;
    const taskUrl = `${container}item.ttl`;
    const projectAlias = `${projects}home.ttl`;
    const taskAlias = `${projects}home/item.ttl`;
    const containerAlias = `${projects}home/`;
    await pod.emptyContainer(`${storage}canonical/`);
    await pod.emptyContainer(container);
    pod.seed(
      home,
      `<#this> a <${NS.WF}Tracker>; <${NS.DCT}title> "Home"; <${NS.WF}stateStore> <tasks/>.`,
    );
    pod.seed(taskUrl, `<#it> a <${NS.WF}Task>, <${NS.WF}Open>; <${NS.DCT}title> "Task".`);
    const redirects = new Map([
      [
        projects,
        {
          url: `${storage}canonical/projects/`,
          body: `<> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <${projectAlias}>.`,
        },
      ],
      [projectAlias, { url: home, body: pod.files.get(home)?.body as string }],
      [
        containerAlias,
        {
          url: container,
          body: `<> a <${NS.LDP}BasicContainer>; <${NS.LDP}contains> <${taskAlias}>.`,
        },
      ],
      [taskAlias, { url: taskUrl, body: pod.files.get(taskUrl)?.body as string }],
    ]);
    pod.intercept = (request) => {
      const redirect = redirects.get(request.url);
      if (!redirect) return undefined;
      if (request.method === "PUT") return new Response(null, { status: 412 });
      const response = new Response(redirect.body, {
        headers: {
          "Content-Type": "text/turtle",
          ETag: '"1"',
        },
      });
      Object.defineProperty(response, "url", { value: redirect.url });
      return response;
    };
    const io = new RdfIO(pod.fetch);
    expect((await io.read(projectAlias)).url).toBe(home);
    await expect(io.container(containerAlias)).resolves.toBeUndefined();
    expect(await io.list(containerAlias)).toEqual([taskAlias]);
    const project = await tasks.readProject(projectAlias);
    expect(project.url).toBe(home);
    expect(project.tracker.id).toBe(`${home}#this`);
    expect((await tasks.listProjects()).map((item) => item.tracker.id)).toEqual([`${home}#this`]);
    const task = await tasks.readTask(taskAlias);
    expect(task.url).toBe(taskUrl);
    expect(task.task.id).toBe(`${taskUrl}#it`);
    expect((await tasks.listTasks(containerAlias)).map((item) => item.task.id)).toEqual([
      `${taskUrl}#it`,
    ]);
    const updated = await tasks.updateTask(task, (item) => {
      item.title = "Updated";
    });
    expect(updated.url).toBe(taskUrl);
    expect((await tasks.readTask(taskUrl)).task.title).toBe("Updated");
    const updatedProject = await tasks.updateProject(project, (item) => {
      item.title = "Renamed";
    });
    expect(updatedProject.url).toBe(home);
    await tasks.deleteTask(updated);
    expect(
      pod
        .mutations()
        .filter((request) => request.method === "DELETE")
        .map((request) => request.url),
    ).toEqual([taskUrl]);
  });
  it("clears all-day markers on due-date edits and rejects conflicting persisted dates", async () => {
    const pod = new Pod();
    const tasks = store(pod);
    const home = await tasks.createProject("Home");
    let task = await tasks.createTask(home, {
      title: "All day",
      state: "open",
      dueDate: new Date(2026, 10, 1),
      allDay: "2026-11-01",
    });
    task = await tasks.updateTask(task, (item) => {
      item.dueDate = new Date(2026, 10, 3, 9);
    });
    expect(task.task.allDay).toBeUndefined();
    expect((await tasks.readTask(task.url)).task.dueDate).toEqual(new Date(2026, 10, 3, 9));
    expect((await tasks.readTask(task.url)).task.allDay).toBeUndefined();
    task = await tasks.updateTask(task, (item) => {
      item.allDay = "2026-11-04";
    });
    expect(task.task.dueDate).toEqual(new Date(2026, 10, 4));
    task = await tasks.updateTask(task, (item) => {
      item.dueDate = undefined;
    });
    expect(task.task.dueDate).toBeUndefined();
    expect(task.task.allDay).toBeUndefined();
    const before = pod.mutations().length;
    await expect(
      tasks.updateTask(task, (item) => {
        item.allDay = "2026-11-01";
        node(item.id, item.dataset).setDate(`${NS.WF}dateDue`, new Date(2026, 10, 3));
      }),
    ).rejects.toThrow("disagree");
    expect(pod.mutations()).toHaveLength(before);
  });
  it("writes, reads, edits and deletes tasks using retained validators", async () => {
    const pod = new Pod();
    const tasks = store(pod);
    const home = await tasks.createProject("Home");
    expect(await tasks.listTasks(home.tracker.stateStore as string)).toEqual([]);
    const task = await tasks.createTask(home, {
      title: "Rent",
      description: "Initial",
      state: "open",
      dueDate: now,
      allDay: "2026-10-25",
      priority: "high",
    });
    expect(task.url).toBe(`${projects}home/task-1.ttl`);
    expect(task.task.project).toBe(home.tracker.id);
    expect(task.task.created).toEqual(now);
    const foreign = await pod.dataset(task.url);
    node(task.task.id, foreign).setText(`${NS.DCT}source`, "foreign app metadata");
    pod.seed(task.url, await serialize(foreign));
    const read = await tasks.readTask(`${task.url}#it`);
    expect(read.task.title).toBe("Rent");
    pod.seed(`${projects}home/stray.ttl`, `<#it> <${NS.DCT}title> "Other".`);
    pod.seed(`${projects}home/readme.txt`, "not RDF");
    await pod.emptyContainer(`${projects}home/nested/`);
    expect(await tasks.listTasks(home.tracker.stateStore as string)).toHaveLength(1);
    const updated = await tasks.updateTask(read, (item) => {
      item.title = "Pay rent";
      item.description = "Updated";
      item.assignee = webId;
      item.state = "closed";
      item.endedAt = now;
      item.rank = 2;
      item.parent = `${task.url}#parent`;
      item.types.add(`${home.url}#section-doing`);
    });
    expect(updated.task.state).toBe("closed");
    expect(updated.task.endedAt).toEqual(now);
    expect(node(updated.task.id, updated.dataset).text(`${NS.DCT}source`)).toBe(
      "foreign app metadata",
    );
    expect(node(updated.task.id, updated.dataset).text(`${NS.DCT}description`)).toBe("Updated");
    expect(read.task.title).toBe("Rent");
    const reopened = await tasks.updateTask(updated, (item) => {
      item.state = "open";
    });
    expect(reopened.task.endedAt).toBeUndefined();
    await expect(
      tasks.updateTask(read, (item) => {
        item.title = "Stale";
      }),
    ).rejects.toMatchObject({ status: 412 });
    await expect(tasks.deleteTask(read)).rejects.toMatchObject({ status: 412 });
    await tasks.deleteTask(reopened);
    expect(pod.files.has(task.url)).toBe(false);
    await expect(tasks.readTask(`${projects}home/stray.ttl`)).rejects.toThrow("wf:Task");
    const mutations = pod.mutations().filter((request) => request.url === task.url);
    expect(mutations[0]?.headers.get("If-None-Match")).toBe("*");
    expect(
      mutations.slice(1).every((request) => /^"\d+"$/.test(request.headers.get("If-Match") ?? "")),
    ).toBe(true);
  });
  it("rejects absent stores, unsafe identifiers, invalid edits and missing ETags before writing", async () => {
    const pod = new Pod();
    const tasks = store(pod);
    const home = await tasks.createProject("Home");
    const task = await tasks.createTask(home, {
      title: "Rent",
      state: "open",
      created: new Date("2020-01-01"),
    });
    expect(task.task.created).toEqual(new Date("2020-01-01"));
    const before = pod.mutations().length;
    await expect(
      tasks.updateTask(task, (item) => {
        item.title = "";
      }),
    ).rejects.toThrow("title");
    await expect(
      tasks.updateTask(task, (item) => {
        item.types.clear();
      }),
    ).rejects.toThrow("wf:Task");
    await expect(
      tasks.updateTask({ ...task, etag: null }, (item) => {
        item.title = "Missing tag";
      }),
    ).rejects.toThrow("ETag");
    await expect(tasks.deleteTask({ ...task, etag: null })).rejects.toThrow("ETag");
    await expect(
      store(pod, { uuid: () => "../evil" }).createTask(home, { title: "No", state: "open" }),
    ).rejects.toThrow("identifier");
    home.tracker.stateStore = undefined;
    await expect(tasks.createTask(home, { title: "No", state: "open" })).rejects.toThrow(
      "stateStore",
    );
    home.tracker.stateStore = `${projects}home.ttl`;
    await expect(tasks.createTask(home, { title: "No", state: "open" })).rejects.toThrow(
      "stateStore",
    );
    expect(pod.mutations()).toHaveLength(before);
  });
  it("uses default clock and UUID seams", async () => {
    const pod = new Pod();
    const tasks = new TaskStore({ storage, webId, fetch: pod.fetch, typeIndex: false });
    const home = await tasks.createProject("Home");
    const task = await tasks.createTask(home, { title: "Generated", state: "open" });
    expect(task.url).toMatch(/[a-f\d-]{36}\.ttl$/);
    expect(task.task.created?.getTime()).toBeGreaterThan(Date.now() - 10000);
  });
});
describe("Type Index merge and bootstrap", () => {
  const desired = [
    { forClass: `${NS.WF}Tracker`, location: projects, kind: "instanceContainer" as const },
  ];
  it("fails closed without an ACL/ACP verifier before creating or linking an index", async () => {
    const pod = new Pod();
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId);
    await expect(index.register(desired)).rejects.toThrow("ACL/ACP access verifier");
    expect(pod.mutations()).toEqual([]);
  });
  it("protects the empty index before linking or registering, then rechecks linked indexes", async () => {
    const pod = new Pod();
    const anonymous = (url: string) =>
      pod.privatePolicies.has(url)
        ? Promise.resolve(new Response(null, { status: 403 }))
        : pod.fetch(url);
    let checks = 0;
    const protect = vi.fn(async (url: string, owner: string) => {
      expect(owner).toBe(webId);
      if (checks++ === 0) {
        expect((await anonymous(url)).status).toBe(200);
        expect(
          node(webId, await pod.dataset(`${storage}profile/card`)).iri(
            `${NS.SOLID}privateTypeIndex`,
          ),
        ).toBeUndefined();
        expect(
          (await pod.dataset(url)).match(null, DataFactory.namedNode(`${NS.SOLID}forClass`)).size,
        ).toBe(0);
        await pod.ensurePrivateIndexAccess(url, owner);
      }
      return (await anonymous(url)).status === 403;
    });
    pod.intercept = (request) => {
      if (
        request.method === "PUT" &&
        (request.url === `${storage}profile/card` ||
          (request.url === indexUrl && request.headers.has("If-Match")))
      )
        expect(pod.privatePolicies.has(indexUrl)).toBe(true);
      return undefined;
    };
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId, protect);
    await index.register(desired);
    expect((await anonymous(indexUrl)).status).toBe(403);
    await index.register(desired);
    expect(protect).toHaveBeenCalledTimes(2);
    // Public/inherited access after a policy change must block even an idempotent registration.
    pod.privatePolicies.clear();
    const writes = pod.mutations().length;
    await expect(index.register(desired)).rejects.toMatchObject({ status: 403 });
    expect(pod.mutations()).toHaveLength(writes);
  });
  it.each([
    "new",
    "linked",
    "raced",
  ])("does not link or populate a %s index with unverified effective access", async (state) => {
    const pod = new Pod();
    const empty = `<${indexUrl}> a <${NS.SOLID}TypeIndex>, <${NS.SOLID}UnlistedDocument>.`;
    if (state === "linked") {
      pod.seed(indexUrl, empty);
      pod.seed(`${storage}profile/card`, `<${webId}> <${NS.SOLID}privateTypeIndex> <${indexUrl}>.`);
    }
    if (state === "raced")
      pod.intercept = (request) => {
        if (request.method === "PUT" && request.url === indexUrl) {
          pod.seed(indexUrl, empty);
          return new Response(null, { status: 412 });
        }
        return undefined;
      };
    const verify = vi.fn(async () => false);
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId, verify);
    await expect(index.register(desired)).rejects.toMatchObject({ status: 403 });
    expect(verify).toHaveBeenCalledOnce();
    expect(
      (await pod.dataset(indexUrl)).match(null, DataFactory.namedNode(`${NS.SOLID}forClass`)).size,
    ).toBe(0);
    expect(pod.mutations().some((request) => request.url === `${storage}profile/card`)).toBe(false);
    expect(
      pod
        .mutations()
        .some((request) => request.url === indexUrl && request.headers.has("If-Match")),
    ).toBe(false);
  });
  it("propagates unreadable access policy failures without linking the empty index", async () => {
    const pod = new Pod();
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId, async () => {
      throw new ModelError(403, `${indexUrl}.acl`);
    });
    await expect(index.register(desired)).rejects.toMatchObject({
      status: 403,
      url: `${indexUrl}.acl`,
    });
    expect(
      node(webId, await pod.dataset(`${storage}profile/card`)).iri(`${NS.SOLID}privateTypeIndex`),
    ).toBeUndefined();
  });
  it("bootstraps privately even with a public-only profile; retains foreign registrations and finds aliases", async () => {
    const pod = new Pod();
    const publicUrl = `${storage}public.ttl`;
    pod.seed(`${storage}profile/card`, `<${webId}> <${NS.SOLID}publicTypeIndex> <${publicUrl}>.`);
    pod.seed(
      publicUrl,
      `<#public> a <${NS.SOLID}TypeRegistration>; <${NS.SOLID}forClass> <${NS.WF}Tracker>; <${NS.SOLID}instance> <${storage}public-project.ttl>. <#empty> a <${NS.SOLID}TypeRegistration>.`,
    );
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId, pod.ensurePrivateIndexAccess);
    await index.register(desired);
    expect((await index.locations(`${NS.WF}Tracker`)).map((reg) => reg.location)).toEqual([
      projects,
      `${storage}public-project.ttl`,
    ]);
    const data = await pod.dataset(indexUrl);
    node(`${indexUrl}#empty`, data).types.add(`${NS.SOLID}TypeRegistration`);
    const legacy = node(`${indexUrl}#legacy`, data);
    legacy.types.add(`${NS.SOLID}TypeRegistration`);
    legacy.setIri(`${NS.SOLID}forClass`, "https://w3id.org/jeswr/sectors/scheduling#Task");
    legacy.setIri(`${NS.SOLID}instance`, `${storage}legacy/`);
    pod.seed(indexUrl, await serialize(data));
    await index.register([
      { forClass: `${NS.SCHEDULING}Task`, kind: "instance", location: `${storage}legacy/` },
    ]);
    expect(await index.locations(`${NS.SCHEDULING}Task`)).toEqual([
      { forClass: `${NS.SCHEDULING}Task`, kind: "instance", location: `${storage}legacy/` },
    ]);
    expect(
      (await pod.dataset(indexUrl)).match(null, DataFactory.namedNode(`${NS.SOLID}forClass`)).size,
    ).toBe(2);
    pod.files.delete(publicUrl);
    expect(await index.locations(`${NS.WF}Tracker`)).toHaveLength(1);
  });
  it("re-reads and merges 412 writes without losing concurrent registrations", async () => {
    const pod = new Pod();
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId, pod.ensurePrivateIndexAccess);
    await index.register(desired);
    let conflict = false;
    pod.intercept = async (request) => {
      if (request.url === indexUrl && request.method === "PUT" && !conflict) {
        conflict = true;
        const dataset = await pod.dataset(indexUrl);
        const foreign = node(`${indexUrl}#foreign`, dataset);
        foreign.types.add(`${NS.SOLID}TypeRegistration`);
        foreign.setIri(`${NS.SOLID}forClass`, `${NS.WF}Task`);
        foreign.setIri(`${NS.SOLID}instance`, `${storage}other/`);
        pod.seed(indexUrl, await serialize(dataset));
        return new Response(null, { status: 412 });
      }
      return undefined;
    };
    await index.register([
      { forClass: `${NS.WF}Task`, location: `${projects}home/`, kind: "instance" },
    ]);
    expect(await index.locations(`${NS.WF}Task`)).toHaveLength(2);
    pod.intercept = (request) =>
      request.url === indexUrl && request.method === "PUT"
        ? new Response(null, { status: 412 })
        : undefined;
    await expect(
      index.register([{ forClass: `${NS.WF}Task`, location: `${projects}new/`, kind: "instance" }]),
    ).rejects.toMatchObject({ status: 412 });
  });
  it("handles a create race, retries a stale profile link, and propagates unreadable index errors", async () => {
    const pod = new Pod();
    let profileConflict = false;
    let indexRace = false;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === indexUrl && !indexRace) {
        indexRace = true;
        pod.seed(indexUrl, `<${indexUrl}> a <${NS.SOLID}TypeIndex>.`);
        return new Response(null, { status: 412 });
      }
      if (
        request.method === "PUT" &&
        request.url === `${storage}profile/card` &&
        !profileConflict
      ) {
        profileConflict = true;
        return new Response(null, { status: 412 });
      }
      return undefined;
    };
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId, pod.ensurePrivateIndexAccess);
    await index.register(desired);
    expect(await index.locations(`${NS.WF}Tracker`)).toHaveLength(1);
    pod.intercept = (request) =>
      request.url === indexUrl ? new Response(null, { status: 403 }) : undefined;
    await expect(index.register(desired)).rejects.toMatchObject({ status: 403 });
    await expect(index.locations(`${NS.WF}Tracker`)).rejects.toMatchObject({ status: 403 });
    const denied = new Pod();
    denied.intercept = (request) =>
      request.method === "PUT" && request.url === indexUrl
        ? new Response(null, { status: 403 })
        : undefined;
    await expect(
      new TypeIndex(
        new RdfIO(denied.fetch),
        storage,
        webId,
        denied.ensurePrivateIndexAccess,
      ).register(desired),
    ).rejects.toMatchObject({ status: 403 });
  });
});
describe("transport failures and typed classification", () => {
  it("exposes A-7 categories and structured write validators", () => {
    for (const [status, category] of [
      [401, "reauth"],
      [403, "forbidden"],
      [404, "not-found"],
      [410, "not-found"],
      [412, "conflict"],
      [409, "name-taken"],
      [413, "too-large"],
      [429, "unreachable"],
      [507, "quota"],
      [500, "unreachable"],
      [400, "unknown"],
      [0, "unreachable"],
    ] as const) {
      const error = new ModelError(status, storage);
      expect(error.category).toBe(category);
      expect(classifyError({ status })).toBe(status === 0 ? "unknown" : category);
    }
    expect(classifyError({ code: "unsupported" })).toBe("unsupported");
    expect(classifyError({ code: "network" }, false)).toBe("offline");
    expect(classifyError({ code: "scope" })).toBe("unknown");
    expect(classifyError(null)).toBe("unknown");
    expect(classifyError({})).toBe("unknown");
    for (const etag of [null, "", "*", 'W/"1"', '"bad\n"', "invalid"])
      expect(() => requireEtag(etag)).toThrow("ETag");
    expect(requireEtag('"valid"')).toBe('"valid"');
    expect(new ModelError(412, storage, '"remote"').etag).toBe('"remote"');
  });
  it("retains absent response ETags and rejects failed/non-RDF reads without inventing empty data", async () => {
    const pod = new Pod();
    const io = new RdfIO(pod.fetch);
    await expect(io.read(`${storage}missing.ttl`)).rejects.toMatchObject({ status: 404 });
    expect(await io.optional(`${storage}missing.ttl`)).toBeUndefined();
    pod.intercept = () => new Response(null, { status: 403 });
    await expect(io.optional(storage)).rejects.toMatchObject({ status: 403 });
    pod.omitPutEtags = true;
    pod.intercept = undefined;
    expect((await io.write(`${storage}new.ttl`, new Store(), { create: true })).etag).toBe('"1"');
    pod.files.set(`${storage}no-etag.ttl`, { body: "", version: 1, etag: null });
    expect((await io.read(`${storage}no-etag.ttl`)).etag).toBeNull();
    pod.intercept = undefined;
    expect((await io.container(`${storage}new/`))?.url).toBe(`${storage}new/`);
    pod.seed(`${storage}file/`, `<${storage}file/> <${NS.DCT}title> "Not a container".`);
    await expect(io.container(`${storage}file/`)).rejects.toThrow("LDP container");
    pod.seed(`${storage}generic/`, `<${storage}generic/> a <${NS.LDP}Container>.`);
    await expect(io.container(`${storage}generic/`)).resolves.toBeUndefined();
    pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 403 }) : undefined;
    await expect(io.container(`${storage}denied/`)).rejects.toMatchObject({ status: 403 });
    const broken = new RdfIO(async () => {
      throw new TypeError("Network failed");
    });
    await expect(
      broken.write(`${storage}new.ttl`, new Store(), { create: true }),
    ).rejects.toMatchObject({ status: 0, code: "network" });
    await expect(broken.read(storage)).rejects.toMatchObject({ status: 0 });
    const invalidResponse = new Response("");
    Object.defineProperty(invalidResponse, "headers", {
      get() {
        throw new Error("Unexpected response failure");
      },
    });
    await expect(new RdfIO(async () => invalidResponse).read(storage)).rejects.toThrow(
      "Unexpected response failure",
    );
  });
  it.each([
    409, 412,
  ])("accepts a container created concurrently before a %s response", async (status) => {
    const pod = new Pod();
    const url = `${storage}raced/`;
    pod.intercept = async (request) => {
      if (request.method === "PUT" && request.url === url) {
        await pod.emptyContainer(url);
        return new Response(null, { status });
      }
      return undefined;
    };
    expect(await new RdfIO(pod.fetch).container(url)).toBeUndefined();
    expect(pod.files.has(url)).toBe(true);
  });
  it("preserves a missing-parent conflict and rejects a raced non-container", async () => {
    const pod = new Pod();
    const io = new RdfIO(pod.fetch);
    await expect(io.container(`${storage}missing/child/`)).rejects.toMatchObject({ status: 409 });
    pod.intercept = (request) => {
      if (request.method === "PUT") {
        pod.seed(request.url, `<${request.url}> <${NS.DCT}title> "Other".`);
        return new Response(null, { status: 412 });
      }
      return undefined;
    };
    await expect(io.container(`${storage}raced/`)).rejects.toThrow("LDP container");
  });
  it.each([
    "document",
    "container",
    "nonempty container",
  ])("rejects ownership loss during validator read-back for a %s", async (kind) => {
    const pod = new Pod();
    pod.omitPutEtags = true;
    const url = `${storage}${kind === "document" ? "owned.ttl" : "owned/"}`;
    pod.intercept = async (request) => {
      if (request.method === "GET" && request.url === url) {
        if (kind === "document") pod.seed(url, `<${url}> <${NS.DCT}title> "Other writer".`);
        else if (kind === "container") pod.seed(url, `<${url}> <${NS.DCT}title> "Replaced".`);
        else pod.seed(`${url}other.ttl`, `<#it> a <${NS.WF}Task>.`);
      }
      return undefined;
    };
    const io = new RdfIO(pod.fetch);
    const dataset = new Store();
    if (kind !== "document") node(url, dataset).types.add(`${NS.LDP}BasicContainer`);
    const creation = io.write(url, dataset, { create: true });
    await expect(creation).rejects.toMatchObject({ status: 412 });
    expect(
      pod
        .mutations()
        .some((request) => request.method === "DELETE" || request.headers.has("If-Match")),
    ).toBe(false);
  });
  it("propagates serializer errors", async () => {
    vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => {
      callback?.(new Error("Serializer failed"), "");
    });
    await expect(serialize(new Store())).rejects.toThrow("Serializer failed");
    const dataset = await parse(storage, `<${storage}> <${NS.DCT}title> <${storage}name>.`);
    expect(node(storage, dataset).text(`${NS.DCT}title`)).toBeUndefined();
  });
});
