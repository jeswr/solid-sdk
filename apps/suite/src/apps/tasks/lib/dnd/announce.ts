// AUTHORED-BY Claude Opus 5.5
/** Live-region copy for every drag phase and keyboard move (06-tasks §4.4). */

import type { StoredProject } from "../model/store";
import { dateFromDayKey, shortDayLabel } from "../views/days";
import type { TaskView } from "../views/types";
import type { DropPlan, DropTarget, ProjectName } from "./types";

export function projectNames(projects: readonly StoredProject[]): ProjectName[] {
  return projects.map((project) => ({
    url: project.url,
    title: project.tracker.title ?? "",
    sections: project.tracker.sections,
  }));
}

const quoted = (title: string) => `'${title}'`;

export function sectionLabel(
  projects: readonly ProjectName[],
  projectUrl: string,
  sectionId: string | undefined,
): string {
  const project = projects.find((item) => item.url === projectUrl);
  return project?.sections.find((section) => section.id === sectionId)?.name ?? "No section";
}

const projectLabel = (projects: readonly ProjectName[], url: string) =>
  projects.find((project) => project.url === url)?.title || "Project";

const dayLabel = (dayKey: string) => shortDayLabel(dateFromDayKey(dayKey));

const titleOf = (views: readonly TaskView[], match: (view: TaskView) => boolean) =>
  quoted(views.find(match)?.title ?? "a task");

export function pickupMessage(task: TaskView): string {
  return `Picked up ${quoted(task.title)}.`;
}

export function cancelMessage(task: TaskView): string {
  return `Cancelled moving ${quoted(task.title)}.`;
}

export function overMessage(
  task: TaskView,
  target: DropTarget | undefined,
  views: readonly TaskView[],
  projects: readonly ProjectName[],
): string {
  const name = quoted(task.title);
  if (!target) return `${name} is not over a drop target.`;
  switch (target.kind) {
    case "project":
      return `${name} is over ${projectLabel(projects, target.projectUrl)}.`;
    case "day":
      return `${name} is over ${dayLabel(target.dayKey)}.`;
    case "section":
      return `${name} is over ${sectionLabel(projects, target.projectUrl, target.sectionId)}.`;
    case "task": {
      if (target.container.kind === "day")
        return target.container.dayKey
          ? `${name} is over ${dayLabel(target.container.dayKey)}.`
          : `${name} is not over a drop target.`;
      const over = titleOf(views, (view) => view.url === target.url);
      return target.placement === "child"
        ? `${name} would become a sub-task of ${over}.`
        : `${name} is ${target.placement} ${over}.`;
    }
  }
}

/** Announced on drop while the write is in flight; the outcome follows when it settles. */
export function movingMessage(task: TaskView): string {
  return `Moving ${quoted(task.title)}…`;
}

/** The outcome when a planned move rolled back or could not be written. */
export function failedMessage(task: TaskView): string {
  return `Couldn't move ${quoted(task.title)}.`;
}

/**
 * The outcome of a written plan. A sorted list (`manual` false) shows no
 * manual order, so its section moves name no position.
 */
export function dropMessage(
  task: TaskView,
  plan: DropPlan,
  views: readonly TaskView[],
  projects: readonly ProjectName[],
  manual = true,
): string {
  const name = quoted(task.title);
  switch (plan.kind) {
    case "none":
      return `${name} was dropped in its original place.`;
    case "project":
      return `Moved ${name} to ${projectLabel(projects, plan.projectUrl)}.`;
    case "reschedule":
      return `Moved ${name} to ${dayLabel(plan.dayKey)}.`;
    case "position": {
      if (plan.parentId) {
        const parent = titleOf(views, (view) => view.id === plan.parentId);
        return plan.parentChanged
          ? `Made ${name} a sub-task of ${parent}.`
          : `Moved ${name} to position ${plan.index} under ${parent}.`;
      }
      const section = sectionLabel(projects, plan.projectUrl, plan.sectionId);
      return manual
        ? `Moved ${name} to ${section}, position ${plan.index}.`
        : `Moved ${name} to ${section}.`;
    }
  }
}

/** The §7 toast for a section change, or undefined when the section stayed the same. */
export function sectionToast(plan: DropPlan, projects: readonly ProjectName[]): string | undefined {
  return plan.kind === "position" && plan.sectionChanged
    ? `Moved to ${sectionLabel(projects, plan.projectUrl, plan.sectionId)}`
    : undefined;
}
