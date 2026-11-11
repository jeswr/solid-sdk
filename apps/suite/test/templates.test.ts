// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { File as NodeFile } from "node:buffer";
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
