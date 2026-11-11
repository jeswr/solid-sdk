// AUTHORED-BY Claude Opus 5.5
import { positionForDrop } from "../views/positions";
import { compareTasks, taskSection } from "../views/project-groups";
import { taskDayKey } from "../views/today";
import type { TaskView } from "../views/types";
import type { DropPlan, DropTarget, PlanOptions, PositionPatch } from "./types";

const NONE: DropPlan = { kind: "none" };

/**
 * The tasks a listing shows; position maths and announcements count only
 * these, so "position 2" means the second visible row.
 */
export function visibleTasks(views: readonly TaskView[], showCompleted: boolean): TaskView[] {
  return views.filter((task) => showCompleted || task.state === "open");
}

/** The rendered direct parent: open and in the same project, at any depth. */
export function effectiveParent(task: TaskView, views: readonly TaskView[]): TaskView | undefined {
  if (!task.parentId) return undefined;
  return views.find(
    (view) =>
      view.id === task.parentId &&
      view.projectUrl === task.projectUrl &&
      view.state === "open" &&
      view.id !== task.id,
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
  return { projectUrl: task.projectUrl, sectionId: taskSection(task, views), parent };
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

/** Pass every task of the project: completed sub-tasks still make their parent a parent. */
const hasChildren = (task: TaskView, all: readonly TaskView[]) =>
  all.some((view) => view.parentId === task.id);

/**
 * One nesting level (06-tasks §4.6): a parent is open and top-level; a parent
 * cannot nest. `all` is every task of the project, closed ones included.
 */
export function canNest(active: TaskView, parent: TaskView, all: readonly TaskView[]): boolean {
  return (
    parent.url !== active.url &&
    parent.projectUrl === active.projectUrl &&
    parent.state === "open" &&
    !parent.parentId &&
    !hasChildren(active, all)
  );
}

/** "Make sub-task of…" choices: every visible valid parent except the current one. */
export function nestCandidates(
  active: TaskView,
  views: readonly TaskView[],
  all: readonly TaskView[] = views,
): TaskView[] {
  return views
    .filter((view) => view.id !== active.parentId && canNest(active, view, all))
    .sort(compareTasks("manual"));
}

/**
 * A sorted list shows no manual order, so a drop on a row means "into the
 * section that row renders in" (appended in manual order); day rows keep theirs.
 */
export function sortedTarget(target: DropTarget): DropTarget {
  if (target.kind !== "task" || target.container.kind !== "section") return target;
  return {
    kind: "section",
    projectUrl: target.container.projectUrl,
    sectionId: target.container.sectionId,
    at: "end",
  };
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
 * reorder/section drops. In a sorted list (`manual: false`) only section,
 * project and day moves apply.
 */
export function planDrop(
  active: TaskView,
  dropTarget: DropTarget,
  views: readonly TaskView[],
  { all = views, manual = true }: PlanOptions = {},
): DropPlan {
  const target = manual ? dropTarget : sortedTarget(dropTarget);
  switch (target.kind) {
    case "project":
      return target.projectUrl === active.projectUrl
        ? NONE
        : { kind: "project", url: active.url, projectUrl: target.projectUrl };
    case "day":
      return dayPlan(active, target.dayKey);
    case "section": {
      if (target.projectUrl !== active.projectUrl) return NONE;
      // Re-ranking within its own section would change nothing a sorted list shows.
      if (!manual && levelOf(active, views).sectionId === target.sectionId) return NONE;
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
      // A subtree cannot be dropped among its own descendants at any depth.
      const seen = new Set<string>();
      let ancestor: TaskView | undefined = over;
      while (ancestor && !seen.has(ancestor.id)) {
        if (ancestor.id === active.id) return NONE;
        seen.add(ancestor.id);
        ancestor = all.find((task) => task.id === ancestor?.parentId);
      }
      if (target.placement === "child" && canNest(active, over, all)) {
        const level = { projectUrl: over.projectUrl, sectionId: over.sectionId, parent: over };
        const count = members(level, views).filter((view) => view.url !== active.url).length;
        return planAt(active, level, count, views);
      }
      let anchor = over;
      let after = target.placement !== "before";
      let level = levelOf(over, views);
      if (level.parent) {
        // Preserve the existing drag policy for tasks that have children.
        if (hasChildren(active, all)) {
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

/** Keyboard "Move up/down" (and Alt+↑/↓) within the rendered level; manual order only. */
export function planMove(
  active: TaskView,
  direction: -1 | 1,
  views: readonly TaskView[],
  { manual = true }: PlanOptions = {},
): DropPlan {
  if (!manual) return NONE;
  const level = levelOf(active, views);
  const all = members(level, views);
  const destination = all.findIndex((view) => view.url === active.url) + direction;
  if (destination < 0 || destination >= all.length) return NONE;
  return planAt(active, level, destination, views);
}

/**
 * Move up/down as a drop anchored to the neighbour row ("before" it going up,
 * "after" it going down). `planDrop` with it equals `planMove`, but it stays
 * idempotent: once the task sits there, planning it again yields none.
 */
export function moveTarget(
  active: TaskView,
  direction: -1 | 1,
  views: readonly TaskView[],
  { manual = true }: PlanOptions = {},
): DropTarget | undefined {
  const level = levelOf(active, views);
  const all = members(level, views);
  const at = all.findIndex((view) => view.url === active.url);
  const neighbour = all[at + direction];
  if (!manual || at < 0 || !neighbour) return undefined;
  return {
    kind: "task",
    url: neighbour.url,
    container: { kind: "section", projectUrl: level.projectUrl, sectionId: level.sectionId },
    placement: direction < 0 ? "before" : "after",
  };
}

/**
 * Whether the planned task already sits where `plan` puts it, in the visible
 * rows `views`: the same rendered level and 1-based slot, or the same day.
 * Project moves change the task's URL, so they never match here.
 */
export function isPlaced(plan: DropPlan, views: readonly TaskView[]): boolean {
  if (plan.kind === "none" || plan.kind === "project") return false;
  const task = views.find((view) => view.url === plan.url);
  if (!task) return false;
  if (plan.kind === "reschedule") return taskDayKey(task) === plan.dayKey;
  const level = levelOf(task, views);
  return (
    level.projectUrl === plan.projectUrl &&
    level.sectionId === plan.sectionId &&
    level.parent?.id === plan.parentId &&
    members(level, views).findIndex((view) => view.url === task.url) + 1 === plan.index
  );
}

/** "Move to section…" appends to the chosen section; undefined means No section. */
export function planToSection(
  active: TaskView,
  sectionId: string | undefined,
  views: readonly TaskView[],
  options: PlanOptions = {},
): DropPlan {
  return planDrop(
    active,
    { kind: "section", projectUrl: active.projectUrl, sectionId, at: "end" },
    views,
    options,
  );
}

/** "Make sub-task of…": the last child of `parent`. */
export function planNest(
  active: TaskView,
  parent: TaskView,
  views: readonly TaskView[],
  options: PlanOptions = {},
): DropPlan {
  if (!canNest(active, parent, options.all ?? views)) return NONE;
  return planDrop(
    active,
    {
      kind: "task",
      url: parent.url,
      container: { kind: "section", projectUrl: parent.projectUrl },
      placement: "child",
    },
    views,
    { ...options, manual: true },
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

/**
 * The order to write renumber patches so that every intermediate stored state
 * keeps the siblings' order, even if a write fails or the tab closes midway:
 * rows whose rank falls (or that had none) in ascending order, then the rest
 * in descending order. Patches come from siblings in manual order, numbered 1…n;
 * a row already at its number needs no write.
 */
export function renumberWriteOrder(
  patches: readonly PositionPatch[],
  rankOf: (url: string) => number | undefined,
): PositionPatch[] {
  const falls = (patch: PositionPatch) => {
    const rank = rankOf(patch.url);
    return rank === undefined || !Number.isFinite(rank) || patch.position < rank;
  };
  const pending = patches.filter((patch) => rankOf(patch.url) !== patch.position);
  return [
    ...pending.filter(falls).toSorted((a, b) => a.position - b.position),
    ...pending.filter((patch) => !falls(patch)).toSorted((a, b) => b.position - a.position),
  ];
}
