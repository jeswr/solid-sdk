// AUTHORED-BY Codex GPT-6.1-Sol
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
function store(pod: Pod, extra = {}) {
  return new TaskStore({
    storage,
    webId,
    fetch: pod.fetch,
    now: () => now,
    uuid: () => "task-1",
    ...extra,
  });
}
afterEach(() => vi.restoreAllMocks());

describe("project discovery and first use", () => {
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
        DataFactory.namedNode(`${NS.SOLID}instance`),
        DataFactory.namedNode(`${projects}inbox/`),
      ).size,
    ).toBe(1);
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
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId);
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
  it("bootstraps privately even with a public-only profile; retains foreign registrations and finds aliases", async () => {
    const pod = new Pod();
    const publicUrl = `${storage}public.ttl`;
    pod.seed(`${storage}profile/card`, `<${webId}> <${NS.SOLID}publicTypeIndex> <${publicUrl}>.`);
    pod.seed(
      publicUrl,
      `<#public> a <${NS.SOLID}TypeRegistration>; <${NS.SOLID}forClass> <${NS.WF}Tracker>; <${NS.SOLID}instance> <${storage}public-project.ttl>. <#empty> a <${NS.SOLID}TypeRegistration>.`,
    );
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId);
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
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId);
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
    const index = new TypeIndex(new RdfIO(pod.fetch), storage, webId);
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
      new TypeIndex(new RdfIO(denied.fetch), storage, webId).register(desired),
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
    pod.intercept = () => new Response(null, { status: 201 });
    expect((await io.write(`${storage}new.ttl`, new Store(), { create: true })).etag).toBeNull();
    pod.intercept = undefined;
    await expect(io.container(`${storage}new/`)).resolves.toBeUndefined();
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
  it("propagates serializer errors", async () => {
    vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => {
      callback?.(new Error("Serializer failed"), "");
    });
    await expect(serialize(new Store())).rejects.toThrow("Serializer failed");
    const dataset = await parse(storage, `<${storage}> <${NS.DCT}title> <${storage}name>.`);
    expect(node(storage, dataset).text(`${NS.DCT}title`)).toBeUndefined();
  });
});
