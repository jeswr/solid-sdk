// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "../../src/apps/tasks/lib/model/rdf";
import type { StoredProject, StoredTask } from "../../src/apps/tasks/lib/model/store";
import { createTask, type TaskDetails, TaskItem } from "../../src/apps/tasks/lib/model/task";
import { createTracker } from "../../src/apps/tasks/lib/model/tracker";
import { type TaskView, toTaskView } from "../../src/apps/tasks/lib/views/types";
import { now, storage, webId } from "./pod";

export function project(title = "Home"): StoredProject {
  const url = `${storage}tasks/projects/${title.toLowerCase()}.ttl`;
  return {
    url,
    etag: '"1"',
    ...createTracker(url, title, `${url.slice(0, -4)}/`, [webId], now),
  };
}

export function storedTask(title: string, details: Partial<TaskDetails> = {}): StoredTask {
  const url = `${storage}tasks/projects/home/${encodeURIComponent(title)}.ttl`;
  const dataset = createTask(url, { title, state: "open", ...details });
  return { url, etag: '"1"', dataset, task: new TaskItem(`${url}#it`, dataset, DataFactory) };
}

export function view(title: string, overrides: Partial<TaskView> = {}): TaskView {
  return { ...toTaskView(storedTask(title), project()), ...overrides };
}
