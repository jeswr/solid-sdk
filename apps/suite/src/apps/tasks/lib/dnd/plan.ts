// AUTHORED-BY Claude Opus 5.5
import { positionForDrop } from "../views/positions";
import { compareTasks } from "../views/project-groups";
import { taskDayKey } from "../views/today";
import type { TaskView } from "../views/types";
import type { DropPlan, DropTarget } from "./types";

const NONE: DropPlan = { kind: "none" };

/**
 * The tasks a listing shows; position maths and announcements count only
 * these, so "position 2" means the second visible row.
 */
export function visibleTasks(views: readonly TaskView[], showCompleted: boolean): TaskView[] {
  return views.filter((task) => showCompleted || task.state === "open");
}

/** The rendered parent (06-tasks §4.6): an open top-level task of the same project. */
export function effectiveParent(task: TaskView, views: readonly TaskView[]): TaskView | undefined {
  if (!task.parentId) return undefined;
  return views.find(
    (view) =>
      view.id === task.parentId &&
      view.projectUrl === task.projectUrl &&
      view.state === "open" &&
      !view.parentId,
  );
}

interface Level {
  projectUrl: string;
  sectionId: string | undefined;
  parent: TaskView | undefined;
}

/** Children render in their parent's section, mirroring `projectGroups`. */
function levelOf(task: TaskView, views: readonly TaskView[]): Level {
  const parent = effectiveParent(task, views);
  return { projectUrl: task.projectUrl, sectionId: (parent ?? task).sectionId, parent };
}

function sameLevel(a: Level, b: Level): boolean {
  return (
    a.projectUrl === b.projectUrl &&
    a.parent?.id === b.parent?.id &&
    (a.parent !== undefined || a.sectionId === b.sectionId)
  );
}

function members(level: Level, views: readonly TaskView[]): TaskView[] {
  return views
    .filter((view) => sameLevel(levelOf(view, views), level))
    .sort(compareTasks("manual"));
}

const hasChildren = (task: TaskView, views: readonly TaskView[]) =>
  views.some((view) => view.parentId === task.id);

/** One nesting level (06-tasks §4.6): a parent is open and top-level; a parent cannot nest. */
export function canNest(active: TaskView, parent: TaskView, views: readonly TaskView[]): boolean {
  return (
    parent.url !== active.url &&
    parent.projectUrl === active.projectUrl &&
    parent.state === "open" &&
    !parent.parentId &&
    !hasChildren(active, views)
  );
}

/** "Make sub-task of…" choices: every valid parent except the current one. */
export function nestCandidates(active: TaskView, views: readonly TaskView[]): TaskView[] {
  return views
    .filter((view) => view.id !== active.parentId && canNest(active, view, views))
    .sort(compareTasks("manual"));
}

/** Index addresses the destination level after removing the moving row. */
function planAt(
  active: TaskView,
  level: Level,
  index: number,
  views: readonly TaskView[],
): DropPlan {
  const all = members(level, views);
  const current = levelOf(active, views);
  if (sameLevel(current, level) && all.findIndex((view) => view.url === active.url) === index)
    return NONE;
  const siblings = all.filter((view) => view.url !== active.url);
  const { position, renumber = [] } = positionForDrop(siblings, index);
  return {
    kind: "position",
    url: active.url,
    projectUrl: level.projectUrl,
    sectionId: level.sectionId,
    parentId: level.parent?.id,
    // A child's own section class is left alone; it renders under its parent.
    sectionChanged: level.parent === undefined && level.sectionId !== active.sectionId,
    parentChanged: current.parent?.id !== level.parent?.id,
    position,
    renumber,
    index: index + 1,
  };
}

function dayPlan(active: TaskView, dayKey: string): DropPlan {
  return taskDayKey(active) === dayKey ? NONE : { kind: "reschedule", url: active.url, dayKey };
}

/**
 * Map one drop onto a write (06-tasks §4.4). `views` are the visible tasks
 * of the listing (see `visibleTasks`); the active task must be among them for
 * reorder/section drops.
 */
export function planDrop(
  active: TaskView,
  target: DropTarget,
  views: readonly TaskView[],
): DropPlan {
  switch (target.kind) {
    case "project":
      return target.projectUrl === active.projectUrl
        ? NONE
        : { kind: "project", url: active.url, projectUrl: target.projectUrl };
    case "day":
      return dayPlan(active, target.dayKey);
    case "section": {
      if (target.projectUrl !== active.projectUrl) return NONE;
      const level = {
        projectUrl: target.projectUrl,
        sectionId: target.sectionId,
        parent: undefined,
      };
      const count = members(level, views).filter((view) => view.url !== active.url).length;
      return planAt(active, level, target.at === "start" ? 0 : count, views);
    }
    case "task": {
      if (target.url === active.url) return NONE;
      if (target.container.kind === "day")
        return target.container.dayKey ? dayPlan(active, target.container.dayKey) : NONE;
      const over = views.find((view) => view.url === target.url);
      if (!over || over.projectUrl !== active.projectUrl) return NONE;
      if (target.placement === "child" && canNest(active, over, views)) {
        const level = { projectUrl: over.projectUrl, sectionId: over.sectionId, parent: over };
        const count = members(level, views).filter((view) => view.url !== active.url).length;
        return planAt(active, level, count, views);
      }
      let anchor = over;
      let after = target.placement !== "before";
      let level = levelOf(over, views);
      if (level.parent) {
        // A row cannot land among its own children; a parent stays top-level.
        if (level.parent.id === active.id) return NONE;
        if (hasChildren(active, views)) {
          anchor = level.parent;
          after = true;
          level = levelOf(anchor, views);
        }
      }
      const siblings = members(level, views).filter((view) => view.url !== active.url);
      const index = siblings.findIndex((view) => view.url === anchor.url) + (after ? 1 : 0);
      return planAt(active, level, index, views);
    }
  }
}

/** Keyboard "Move up/down" (and Alt+↑/↓) within the rendered level. */
export function planMove(
  active: TaskView,
  direction: -1 | 1,
  views: readonly TaskView[],
): DropPlan {
  const level = levelOf(active, views);
  const all = members(level, views);
  const destination = all.findIndex((view) => view.url === active.url) + direction;
  if (destination < 0 || destination >= all.length) return NONE;
  return planAt(active, level, destination, views);
}

/** "Move to section…" appends to the chosen section; undefined means No section. */
export function planToSection(
  active: TaskView,
  sectionId: string | undefined,
  views: readonly TaskView[],
): DropPlan {
  return planDrop(
    active,
    { kind: "section", projectUrl: active.projectUrl, sectionId, at: "end" },
    views,
  );
}

/** "Make sub-task of…": the last child of `parent`. */
export function planNest(active: TaskView, parent: TaskView, views: readonly TaskView[]): DropPlan {
  if (!canNest(active, parent, views)) return NONE;
  return planDrop(
    active,
    {
      kind: "task",
      url: parent.url,
      container: { kind: "section", projectUrl: parent.projectUrl },
      placement: "child",
    },
    views,
  );
}

/** "Promote to task": directly after the former parent, in its section. */
export function planPromote(active: TaskView, views: readonly TaskView[]): DropPlan {
  const parent = effectiveParent(active, views);
  if (!parent) return NONE;
  const level = levelOf(parent, views);
  const siblings = members(level, views).filter((view) => view.url !== active.url);
  return planAt(active, level, siblings.findIndex((view) => view.url === parent.url) + 1, views);
}
