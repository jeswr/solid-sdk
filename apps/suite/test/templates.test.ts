// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { createRequire } from "node:module";
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from "@jeswr/suite-templates";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDocument } from "../src/apps/docs/lib/model/document";
import { serializeTurtle } from "../src/apps/docs/lib/model/rdf-io";
import { createDocsStore } from "../src/apps/docs/lib/model/store";
import { buildNote, createNotesStore } from "../src/apps/notes/lib/model";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { TaskStore } from "../src/apps/tasks/lib/model/store";
import { ensurePrivateIndexAccess, ensurePrivateTasksAccess } from "../src/apps/tasks/state/access";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { decodeRef } from "../src/lib/refs";
import type { PodSession } from "../src/lib/session/pod-session";
import { createFromTemplate } from "../src/lib/templates/create";
import { templatesForSession } from "../src/lib/templates/store";

const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
let session: PodSession;
beforeEach(async () => {
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.now(), { calendar: false }),
  });
  session = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: "Alice",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
});
afterEach(() => vi.unstubAllGlobals());
function builtin(id: string): BuiltinTemplate {
  const value = BUILTIN_TEMPLATES.find((template) => template.id === id);
  assert(value);
  return value;
}
function resource(href: string) {
  return decodeRef(href.split("/").at(-1) ?? "");
}
describe("suite template creation through real app models", () => {
  it("loads the demo user's template through the real SDK client and isolates session stores", async () => {
    const store = await templatesForSession(session);
    expect(await templatesForSession(session)).toBe(store);
    expect(await templatesForSession({ ...session })).not.toBe(store);
    const templates = await store.list("docs");
    expect(templates.map((item) => item.data.name)).toEqual(["Team standup"]);
    assert(templates[0]);
    expect((await store.content(templates[0])).body).toContain("Yesterday");
  });
  it.each([
    "docs-meeting-notes",
    "docs-project-brief",
    "docs-letter",
    "docs-resume",
  ])("imports %s as a real editable document", async (id) => {
    const href = await createFromTemplate(session, builtin(id));
    expect(href).toMatch(/^\/docs\/d\//);
    const doc = await createDocsStore({
      podRoot: session.storageUrl,
      webId: session.webId,
      fetchImpl: session.fetch,
    }).read(resource(href));
    expect(doc?.data.title).toBe(builtin(id).name);
    expect(doc?.data.body).toContain("<h1");
    expect(doc?.data.updateLog).toContain("/updates/");
  });
  it.each([
    "sheets-budget",
    "sheets-weekly-schedule",
    "sheets-invoice",
  ])("imports %s through the CSV grid converter", async (id) => {
    const href = await createFromTemplate(session, builtin(id));
    const workbook = await createWorkbookService({
      fetch: session.fetch,
      podRoot: session.storageUrl,
      webId: session.webId,
    }).open(resource(href));
    expect(workbook.metadata.title).toBe(builtin(id).name);
    expect(JSON.stringify(workbook.snapshot)).toContain(
      id === "sheets-budget" ? "Housing" : id === "sheets-invoice" ? "Service" : "Monday",
    );
  });
  it.each([
    "notes-checklist",
    "notes-journal",
  ])("imports %s through Markdown and the Notes editor schema", async (id) => {
    const href = await createFromTemplate(session, builtin(id));
    const note = await createNotesStore({
      fetch: session.fetch,
      podRoot: session.storageUrl,
      webId: session.webId,
    }).read(resource(href));
    expect(note?.title).toBe(builtin(id).name);
    expect(note?.body).toContain(id === "notes-checklist" ? 'data-type="taskList"' : "Gratitude");
  });
  it.each([
    "tasks-project-plan",
    "tasks-weekly-planner",
  ])("creates %s with named sections and task titles", async (id) => {
    const href = await createFromTemplate(session, builtin(id));
    const store = new TaskStore({
      storage: session.storageUrl,
      webId: session.webId,
      fetch: session.fetch,
      ensurePrivateTasksAccess: (url, owner) => ensurePrivateTasksAccess(session, url, owner),
      ensurePrivateIndexAccess: (url, owner) => ensurePrivateIndexAccess(session, url, owner),
    });
    const project = await store.readProject(resource(href));
    const template = builtin(id);
    assert(template.content.format === "tasks");
    expect(project.tracker.sections.map((item) => item.name)).toEqual(
      template.content.sections.map((item) => item.name),
    );
    expect(
      (await store.listTasks(project.tracker.stateStore ?? ""))
        .map((item) => item.task.title)
        .sort(),
    ).toEqual(template.content.sections.flatMap((item) => item.titles).sort());
  });
  it("round-trips saved Docs and Notes snapshots without changing their originals", async () => {
    const store = await templatesForSession(session);
    for (const app of ["docs", "notes"] as const) {
      const saved = await store.save({
        metadata: { name: "My starter", app, category: "Work" },
        content: async (url) => ({
          body: await serializeTurtle(
            app === "docs"
              ? buildDocument(url, { title: "Original title", body: "<h1>Reusable content</h1>" })
              : buildNote(url, {
                  title: "Original title",
                  body: "<p>Reusable note</p>",
                  labels: ["Ideas"],
                }),
          ),
          contentType: "text/turtle",
        }),
      });
      const original = await store.content(saved);
      const href = await createFromTemplate(session, saved, original);
      if (app === "docs")
        expect(
          (
            await createDocsStore({
              podRoot: session.storageUrl,
              webId: session.webId,
              fetchImpl: session.fetch,
            }).read(resource(href))
          )?.data.body,
        ).toContain("Reusable content");
      else
        expect(
          await createNotesStore({
            fetch: session.fetch,
            podRoot: session.storageUrl,
            webId: session.webId,
          }).read(resource(href)),
        ).toMatchObject({ title: "My starter", labels: ["Ideas"] });
      expect(await store.content(saved)).toEqual(original);
    }
  });
  it("opens a user template stored in the native Task RDF format", async () => {
    const { serializeTask } = await import("@jeswr/solid-task-model");
    const store = await templatesForSession(session);
    const template = await store.save({
      metadata: { name: "My task plan", app: "tasks", category: "Work" },
      content: async (url) => ({
        body: await serializeTask(url, { title: "Review the project", state: "open" }),
        contentType: "text/turtle",
      }),
    });
    const href = await createFromTemplate(session, template, await store.content(template));
    const taskStore = new TaskStore({
      storage: session.storageUrl,
      webId: session.webId,
      fetch: session.fetch,
    });
    const project = await taskStore.readProject(resource(href));
    expect(
      (await taskStore.listTasks(project.tracker.stateStore ?? "")).map((item) => item.task.title),
    ).toEqual(["Review the project"]);
  });
  it("round-trips a native Sheets snapshot", async () => {
    const source = await createFromTemplate(session, builtin("sheets-budget"));
    const service = createWorkbookService({
      fetch: session.fetch,
      podRoot: session.storageUrl,
      webId: session.webId,
    });
    const workbook = await service.open(resource(source));
    const store = await templatesForSession(session);
    const template = await store.save({
      metadata: { name: "My budget", app: "sheets", category: "Personal" },
      content: () => ({ body: JSON.stringify(workbook.snapshot), contentType: "application/json" }),
    });
    const href = await createFromTemplate(session, template, await store.content(template));
    const copy = await service.open(resource(href));
    expect(copy.snapshot.id).not.toBe(workbook.snapshot.id);
    expect(copy.metadata.title).toBe("My budget");
    expect(copy.snapshot.sheets).toEqual(workbook.snapshot.sheets);
  });
  it("rejects missing and malformed saved content", async () => {
    const store = await templatesForSession(session);
    for (const app of ["docs", "sheets", "notes"] as const) {
      const template = await store.save({
        metadata: { name: "Broken", app, category: "Work" },
        content: () => ({ body: "", contentType: "text/turtle" }),
      });
      await expect(createFromTemplate(session, template)).rejects.toThrow(
        "Missing template content",
      );
      await expect(
        createFromTemplate(session, template, await store.content(template)),
      ).rejects.toThrow();
    }
  });
});

it.each([
  "docs",
  "notes",
] as const)("copies %s images on save and instantiation after the source and template are deleted", async (app) => {
  const { prepareTemplateContent } = await import("../src/lib/templates/content");
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const { parseDocument } = await import("../src/apps/docs/lib/model/document");
  const { parseNote } = await import("../src/apps/notes/lib/model/note");
  const source = `${DEMO_ROOT}notes/media/source.png`;
  const bytes = new Uint8Array([137, 80, 78, 71]);
  expect(
    (
      await session.fetch(source, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: bytes,
      })
    ).ok,
  ).toBe(true);
  const originalStore =
    app === "docs"
      ? createDocsStore({
          podRoot: session.storageUrl,
          webId: session.webId,
          fetchImpl: session.fetch,
        })
      : createNotesStore({
          podRoot: session.storageUrl,
          webId: session.webId,
          fetch: session.fetch,
        });
  const sourceDocument = await originalStore.create({
    title: "Original picture document",
    body: `<p>Original content</p><img src="${source}">`,
  });
  const store = await templatesForSession(session);
  const saved = await store.save({
    metadata: { name: "Pictures", app, category: "Work" },
    content: async (resource, assets) =>
      prepareTemplateContent(
        session,
        app,
        resource,
        {
          body: await serializeTurtle(
            (app === "docs" ? buildDocument : buildNote)(resource, {
              title: "Pictures",
              body: `<p>First paragraph</p><p>Second &amp; last</p><img src="${source}" alt="A picture"><img src="${source}">`,
            }),
          ),
          contentType: "text/turtle",
        },
        assets,
      ),
  });
  expect(saved.data.previewText).toBe("First paragraph Second & last");
  const body = await store.content(saved);
  const dataset = await parseRdf(body.body, body.contentType, { baseIRI: saved.data.content });
  const snapshot =
    app === "docs"
      ? parseDocument(saved.data.content, dataset)
      : parseNote(saved.data.content, dataset, "active");
  assert(snapshot);
  const html = new window.DOMParser().parseFromString(snapshot.body, "text/html");
  const image = html.querySelector("img")?.getAttribute("src");
  assert(image);
  expect(image).not.toBe(source);
  await store.assertContains(image);
  expect(
    new Set([...html.querySelectorAll("img")].map((node) => node.getAttribute("src"))).size,
  ).toBe(1);
  expect([...new Uint8Array(await (await session.fetch(image)).arrayBuffer())]).toEqual([...bytes]);
  const original = await session.fetch(source, { method: "HEAD" });
  await session.fetch(source, {
    method: "DELETE",
    headers: { "if-match": original.headers.get("etag") ?? "" },
  });
  const sourceHead = await session.fetch(sourceDocument.url, { method: "HEAD" });
  await session.fetch(sourceDocument.url, {
    method: "DELETE",
    headers: { "if-match": sourceHead.headers.get("etag") ?? "" },
  });
  expect((await session.fetch(sourceDocument.url)).status).toBe(404);
  expect((await session.fetch(source)).status).toBe(404);
  const href = await createFromTemplate(session, saved, body);
  const derived =
    app === "docs"
      ? (
          await createDocsStore({
            podRoot: session.storageUrl,
            webId: session.webId,
            fetchImpl: session.fetch,
          }).read(resource(href))
        )?.data
      : await createNotesStore({
          podRoot: session.storageUrl,
          webId: session.webId,
          fetch: session.fetch,
        }).read(resource(href));
  assert(derived);
  const copied = new window.DOMParser()
    .parseFromString(derived.body, "text/html")
    .querySelector("img")
    ?.getAttribute("src");
  assert(copied);
  expect(copied).not.toBe(image);
  expect(copied).not.toContain("/templates/");
  await store.delete(saved);
  const templateImage = await session.fetch(image, { method: "HEAD" });
  await session.fetch(image, {
    method: "DELETE",
    headers: { "if-match": templateImage.headers.get("etag") ?? "" },
  });
  expect([...new Uint8Array(await (await session.fetch(copied)).arrayBuffer())]).toEqual([
    ...bytes,
  ]);
});

it("instantiates a multi-task tracker from an LWS-located template collection", async () => {
  const { createMemoryStorage } = await import("@jeswr/storage-client/memory");
  const { createTemplateStore, TEMPLATE_CLASS } = await import("@jeswr/suite-templates");
  const stores = await import("../src/lib/templates/store");
  const { createTracker } = await import("../src/apps/tasks/lib/model/tracker");
  const { createTask } = await import("../src/apps/tasks/lib/model/task");
  const { serialize } = await import("../src/apps/tasks/lib/model/rdf");
  const memory = createMemoryStorage({ protocol: "lws", root: DEMO_ROOT });
  const collection = await memory.create(DEMO_ROOT, null, {
    name: "server-assigned-collection",
    kind: "container",
    links: [{ rel: "type", target: TEMPLATE_CLASS }],
  });
  const state = await memory.create(collection.url, null, {
    name: "task-state",
    kind: "container",
  });
  await session.fetch(state.url, {
    method: "PUT",
    headers: { link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' },
    body: "",
  });
  let section = "";
  const store = createTemplateStore({ storage: memory, ensurePrivateAccess: async () => true });
  const saved = await store.save({
    metadata: { name: "Team plan", app: "tasks", category: "Work" },
    content: async (url) => {
      const { dataset, tracker } = createTracker(
        url,
        "Team plan",
        state.url,
        [session.webId],
        new Date(),
      );
      tracker.defineCategory("Section", "Milestones", 1);
      section = tracker.sections[0]?.id ?? "";
      return { body: await serialize(dataset), contentType: "text/turtle" };
    },
  });
  for (const [index, title] of [
    "First milestone",
    "Second milestone",
    "Unsectioned task",
  ].entries()) {
    const url = `${state.url}${index}.ttl`;
    await session.fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await serialize(
        createTask(url, { title, state: "open", categoryTypes: index < 2 ? [section] : [] }),
      ),
    });
  }
  const scoped = vi.spyOn(store, "assertContains");
  const mocked = vi.spyOn(stores, "templatesForSession").mockResolvedValue(store);
  try {
    const href = await createFromTemplate(session, saved, await store.content(saved));
    expect(scoped).toHaveBeenCalledWith(state.url);
    const tasks = new TaskStore({
      storage: session.storageUrl,
      webId: session.webId,
      fetch: session.fetch,
    });
    const project = await tasks.readProject(resource(href));
    expect(project.tracker.sections.map((item) => item.name)).toEqual(["Milestones", "Tasks"]);
    expect(
      (await tasks.listTasks(project.tracker.stateStore ?? ""))
        .map((item) => item.task.title)
        .sort(),
    ).toEqual(["First milestone", "Second milestone", "Unsectioned task"]);
  } finally {
    mocked.mockRestore();
  }
});
it("derives Sheets previews from cell content rather than titles or snapshot identifiers", async () => {
  const { prepareTemplateContent } = await import("../src/lib/templates/content");
  const body = {
    body: JSON.stringify({
      id: "private-id",
      sheets: {
        first: {
          name: "Title",
          cellData: { 0: { 0: { v: "Monthly budget" }, 1: { v: 100 }, 2: { v: null } } },
        },
      },
    }),
    contentType: "application/json",
  };
  expect(
    (
      await prepareTemplateContent(session, "sheets", `${DEMO_ROOT}templates/content`, body, {
        copyImages: async (value) => value,
      })
    ).previewText,
  ).toBe("Monthly budget 100");
});
// AUTHORED-BY Claude Opus 5.5 (test below)
it("keeps Notes formatting through a user template's save and instantiation", async () => {
  const { prepareTemplateContent } = await import("../src/lib/templates/content");
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const { parseNote } = await import("../src/apps/notes/lib/model/note");
  const html =
    "<h2>Plan</h2><p><strong>Bold</strong> and <em>soft</em> <code>code</code> " +
    '<a href="https://example.org/">link</a></p><ul><li><p>Bullet</p></li></ul>' +
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>';
  const store = await templatesForSession(session);
  const saved = await store.save({
    metadata: { name: "Formatted", app: "notes", category: "Work" },
    content: async (url, assets) =>
      prepareTemplateContent(
        session,
        "notes",
        url,
        {
          body: await serializeTurtle(buildNote(url, { title: "Formatted", body: html })),
          contentType: "text/turtle",
        },
        assets,
      ),
  });
  const content = await store.content(saved);
  const snapshot = parseNote(
    saved.data.content,
    await parseRdf(content.body, content.contentType, { baseIRI: saved.data.content }),
    "active",
  );
  const href = await createFromTemplate(session, saved, content);
  const derived = await createNotesStore({
    podRoot: session.storageUrl,
    webId: session.webId,
    fetch: session.fetch,
  }).read(resource(href));
  for (const body of [snapshot?.body, derived?.body]) {
    assert(body);
    const parsed = new window.DOMParser().parseFromString(body, "text/html");
    expect(parsed.querySelector("h2")?.textContent).toBe("Plan");
    expect(parsed.querySelector("strong")?.textContent).toBe("Bold");
    expect(parsed.querySelector("em")?.textContent).toBe("soft");
    expect(parsed.querySelector("code")?.textContent).toBe("code");
    expect(parsed.querySelector("a")?.getAttribute("href")).toBe("https://example.org/");
    expect(parsed.querySelector("ul:not([data-type]) li")?.textContent).toBe("Bullet");
    expect(parsed.querySelector('li[data-type="taskItem"]')?.getAttribute("data-checked")).toBe(
      "true",
    );
  }
  expect(saved.data.previewText).toBe("Plan Bold and soft code link Bullet Done");
});
