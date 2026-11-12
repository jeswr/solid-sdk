// AUTHORED-BY Codex GPT-6.1-Sol
import type { BuiltinTemplate, TemplateBody, UserTemplate } from "@jeswr/suite-templates";
import { encodeRef } from "../refs";
import type { PodSession } from "../session/pod-session";
import { importTemplateImages } from "./content";
export type SuiteTemplate = BuiltinTemplate | UserTemplate;
/** App-specific conversion stays with the app's own models and import paths. */
export async function createFromTemplate(
  session: PodSession,
  template: SuiteTemplate,
  content?: TemplateBody,
): Promise<string> {
  const name = template.source === "builtin" ? template.name : template.data.name;
  if (template.app === "docs") {
    const { importDocument } = await import("../../apps/docs/editor/import-document");
    let body: string;
    let extension: string;
    if (template.source === "builtin" && template.content.format === "markdown") {
      body = template.content.markdown;
      extension = "md";
    } else {
      if (!content) throw new Error("Missing template content");
      const { parseRdf } = await import("@jeswr/fetch-rdf");
      const { parseDocument } = await import("../../apps/docs/lib/model/document");
      if (template.source !== "user") throw new Error("Invalid document template");
      const doc = parseDocument(
        template.data.content,
        await parseRdf(content.body, content.contentType, { baseIRI: template.data.content }),
      );
      if (!doc) throw new Error("Invalid document template");
      body = doc.body;
      extension = "html";
    }
    const result = await importDocument(
      new File([body], `${name}.${extension}`),
      session,
      () => {},
      template.source === "user"
        ? { prepare: (json, upload) => importTemplateImages(session, json, upload) }
        : {},
    );
    return `/docs/d/${encodeRef(result.url)}`;
  }
  if (template.app === "sheets") {
    const { createWorkbookService } = await import("../../apps/sheets/lib/workbook");
    const service = createWorkbookService({
      fetch: session.fetch,
      podRoot: session.storageUrl,
      webId: session.webId,
    });
    if (template.source === "builtin" && template.content.format === "grid") {
      const { gridToCsv } = await import("../../apps/sheets/lib/model/grid");
      const columns = [...(template.content.rows[0] ?? [])];
      const rows = template.content.rows.slice(1).map((row) => [...row]);
      const result = await service.createFromCsv({
        title: name,
        csv: gridToCsv({ columns, rows }),
      });
      return `/sheets/s/${encodeRef(result.container)}`;
    }
    if (!content) throw new Error("Missing template content");
    const { deserializeSnapshot } = await import("../../apps/sheets/lib/model/snapshot");
    const result = await service.create({
      title: name,
      snapshot: deserializeSnapshot(content.body),
    });
    return `/sheets/s/${encodeRef(result.container)}`;
  }
  if (template.app === "notes") {
    const { createNotesStore, parseNote } = await import("../../apps/notes/lib/model");
    const store = createNotesStore({
      fetch: session.fetch,
      podRoot: session.storageUrl,
      webId: session.webId,
    });
    let body: string;
    let labels: string[] = [];
    if (template.source === "builtin" && template.content.format === "markdown") {
      const { markdownToDocs } = await import("../../apps/docs/lib/markdown");
      const { generateHTML } = await import("@tiptap/react");
      const { notesExtensions } = await import("../../apps/notes/editor/extensions");
      body = generateHTML(
        markdownToDocs(template.content.markdown),
        notesExtensions(session.fetch, session.storageUrl),
      );
    } else {
      if (!content || template.source !== "user") throw new Error("Missing template content");
      const { parseRdf } = await import("@jeswr/fetch-rdf");
      const note = parseNote(
        template.data.content,
        await parseRdf(content.body, content.contentType, { baseIRI: template.data.content }),
        "active",
      );
      if (!note) throw new Error("Invalid note template");
      body = note.body;
      labels = note.labels;
    }
    if (template.source === "user") {
      const { generateHTML, generateJSON } = await import("@tiptap/react");
      const { notesExtensions } = await import("../../apps/notes/editor/extensions");
      const { baseExtensions } = await import("../../apps/docs/editor/extensions");
      const extensions = notesExtensions(session.fetch, session.storageUrl);
      body = generateHTML(
        await importTemplateImages(
          session,
          generateJSON(body, baseExtensions(session.fetch)),
          (data, type) => store.uploadImage(new Blob([data], { type })),
        ),
        extensions,
      );
    }
    const result = await store.create({ title: name, body, labels });
    return `/notes/n/${encodeRef(result.url)}`;
  }
  const { TaskStore } = await import("../../apps/tasks/lib/model/store");
  const { ensurePrivateTasksAccess, ensurePrivateIndexAccess } = await import(
    "../../apps/tasks/state/access"
  );
  const store = new TaskStore({
    storage: session.storageUrl,
    webId: session.webId,
    fetch: session.fetch,
    ensurePrivateTasksAccess: (url, owner) => ensurePrivateTasksAccess(session, url, owner),
    ensurePrivateIndexAccess: (url, owner) => ensurePrivateIndexAccess(session, url, owner),
  });
  let sections: readonly { name: string; titles: readonly string[] }[];
  if (template.source === "builtin" && template.content.format === "tasks")
    sections = template.content.sections;
  else {
    if (!content || template.source !== "user") throw new Error("Missing template content");
    const { parseTaskTtl } = await import("@jeswr/solid-task-model");
    const task = await parseTaskTtl(template.data.content, content.body, content.contentType);
    if (task) sections = [{ name: "Tasks", titles: [task.title ?? name] }];
    else {
      const { parseRdf } = await import("@jeswr/fetch-rdf");
      const { DataFactory } = await import("n3");
      const { TaskTracker } = await import("../../apps/tasks/lib/model/tracker");
      const dataset = await parseRdf(content.body, content.contentType, {
        baseIRI: template.data.content,
      });
      const tracker = new TaskTracker(`${template.data.content}#this`, dataset, DataFactory);
      if (!tracker.isTracker || !tracker.stateStore) throw new Error("Invalid task template");
      const { templatesForSession } = await import("./store");
      await (await templatesForSession(session)).assertContains(tracker.stateStore);
      const tasks = await store.listTasks(tracker.stateStore, { strict: true });
      sections = tracker.sections.map((section) => ({
        name: section.name,
        titles: tasks
          .filter((item) => item.task.types.has(section.id))
          .map((item) => item.task.title ?? "Untitled task"),
      }));
      const unsectioned = tasks.filter(
        (item) => !tracker.sections.some((section) => item.task.types.has(section.id)),
      );
      if (unsectioned.length)
        sections = [
          ...sections,
          { name: "Tasks", titles: unsectioned.map((item) => item.task.title ?? "Untitled task") },
        ];
    }
  }
  let project = await store.createProject(name);
  try {
    for (const section of sections) {
      project = await store.updateProject(project, (tracker) => {
        tracker.defineCategory("Section", section.name, tracker.sections.length + 1);
      });
      const category = project.tracker.sections.find((item) => item.name === section.name);
      for (const [index, title] of section.titles.entries())
        await store.createTask(project, {
          title,
          state: "open",
          categoryTypes: category ? [category.id] : [],
          rank: index + 1,
        });
    }
    return `/tasks/p/${encodeRef(project.url)}`;
  } catch (error) {
    await store.deleteProject(project).catch(() => {});
    throw error;
  }
}
