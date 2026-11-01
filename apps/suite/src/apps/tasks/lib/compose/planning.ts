// AUTHORED-BY Codex GPT-6.1-Sol

import type { NewTask } from "../../state/tasks-cache";
import type { StoredProject } from "../model/store";
import { unionLabels } from "../model/tracker";
import { priorityValue } from "../views/types";
import { splitPaste } from "./paste";
import { type ComposeContext, type ComposeResult, parseQuickAdd } from "./quick-add";

export function composeContext(
  projects: readonly StoredProject[],
  defaults: ComposeContext["defaults"],
  now: Date,
  tz: string,
  locale: "en-GB" | "en-US" = "en-GB",
): ComposeContext {
  const active = projects.filter((project) => !project.tracker.archivedAt);
  return {
    projects: active.map((project) => ({ url: project.url, title: project.tracker.title ?? "" })),
    labels: [...unionLabels(active.map((project) => project.tracker)).values()].flatMap((labels) =>
      labels.slice(0, 1).map((label) => label.name),
    ),
    ...(defaults ? { defaults } : {}),
    now,
    tz,
    locale,
  };
}

/** Only absent names are materialised in the target tracker; casing retains its identity. */
export function missingLabels(project: StoredProject, names: readonly string[]): string[] {
  const known = new Set(project.tracker.labels.map((label) => label.name.toLowerCase()));
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
}

/** Run after ensureLabels, so every type refers to the target tracker. */
export function taskSubmission(
  result: ComposeResult,
  project: StoredProject,
  parent?: string,
): NewTask {
  const labelIds = result.labels.map(({ name }) => {
    const label = project.tracker.labels.find(
      (label) => label.name.toLowerCase() === name.toLowerCase(),
    );
    if (!label) throw new Error(`Label @${name} has not been saved`);
    return label.id;
  });
  return {
    title: result.title,
    due: result.due?.date,
    allDay: result.due?.allDay,
    recurrence: result.recurrence,
    priority: priorityValue(result.priority),
    reminders: result.reminders,
    sectionId: project.tracker.sections.some((section) => section.id === result.sectionId)
      ? result.sectionId
      : undefined,
    labelIds,
    parent,
  };
}

export interface PasteEntry {
  result: ComposeResult;
  /** Index in this flattened list; every parent precedes its children. */
  parentIndex?: number;
}
export function planPaste(text: string, ctx: ComposeContext): PasteEntry[] {
  const entries: PasteEntry[] = [];
  for (const task of splitPaste(text)) {
    const parentIndex = entries.length;
    entries.push({ result: parseQuickAdd(task.title, ctx) });
    for (const child of task.children)
      entries.push({ result: parseQuickAdd(child, ctx), parentIndex });
  }
  return entries;
}
