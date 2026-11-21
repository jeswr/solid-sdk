// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  toast,
} from "@jeswr/suite-ui";
import { usePathname } from "next/navigation";
import { dropMessage, failedMessage, projectNames, sectionToast } from "../lib/dnd/announce";
import {
  effectiveParent,
  moveTarget,
  nestCandidates,
  planDrop,
  planMove,
  planNest,
  planPromote,
  planToSection,
  visibleTasks,
} from "../lib/dnd/plan";
import type { DropPlan, PlanOptions } from "../lib/dnd/types";
import { isIssuesProject } from "../lib/issues/model";
import type { TaskView } from "../lib/views/types";
import { announceRetries, applyDropPlan, replanner } from "../state/drop-actions";
import { useTaskListFocus } from "../state/list-focus";
import { useTasksPreferences } from "../state/preferences";
import { useTasks } from "../state/tasks-context";

const NO_SECTION = "__none";

type Plan = (task: TaskView, views: readonly TaskView[], options: PlanOptions) => DropPlan;
/** Plans one move from a task, its listing's visible rows and the project context. */
export interface Planner extends Plan {
  /**
   * Fixes a relative move to an absolute target when first planned, so a
   * Retry that finds the task already moved plans nothing instead of moving it again.
   */
  anchor?: (task: TaskView, views: readonly TaskView[], options: PlanOptions) => Plan;
}
const relative = (direction: -1 | 1): Planner =>
  Object.assign(
    (task: TaskView, views: readonly TaskView[], options: PlanOptions) =>
      planMove(task, direction, views, options),
    {
      anchor: (task: TaskView, views: readonly TaskView[], options: PlanOptions): Plan => {
        const target = moveTarget(task, direction, views, options);
        return (fresh, rows, current) =>
          target ? planDrop(fresh, target, rows, current) : { kind: "none" };
      },
    },
  );
export const moveUp = relative(-1);
export const moveDown = relative(1);

/** The keyboard equivalents of every drag (06-tasks §4.4), for row and card ⋯ menus. */
export function useTaskMoves(task: TaskView, flat = false) {
  const tasks = useTasks();
  const focus = useTaskListFocus();
  const pathname = usePathname();
  const { preferences } = useTasksPreferences();
  // A list sorted by due date, priority or name offers no manual reordering.
  const manual = (preferences.sort[pathname] ?? "manual") === "manual";
  const all = tasks.views.filter((view) => view.projectUrl === task.projectUrl);
  const options: PlanOptions = { all, manual, flat };
  const views = visibleTasks(all, preferences.showCompletedInProject);
  const issue = tasks.projects.some(
    (project) => project.url === task.projectUrl && isIssuesProject(project),
  );
  const plan = (make: Planner): DropPlan => (issue ? { kind: "none" } : make(task, views, options));
  /** Announces the outcome once the write settles; Retry plans again from fresh state. */
  const run = (relativeMake: Planner) => {
    if (issue) return Promise.resolve(false);
    const make = relativeMake.anchor?.(task, views, options) ?? relativeMake;
    const first = make(task, views, options);
    if (first.kind === "none") return Promise.resolve(false);
    const names = projectNames(tasks.projects);
    const message = dropMessage(task, first, views, names, manual, flat);
    const showCompleted = preferences.showCompletedInProject;
    const replan = replanner(tasks.cache, task.url, (fresh, project) =>
      make(fresh, visibleTasks(project, showCompleted), { all: project, manual, flat }),
    );
    const retried = announceRetries(tasks.cache, {
      task,
      plan: first,
      message,
      showCompleted,
      flat,
      describe: (plan) =>
        dropMessage(task, plan, tasks.cache.getSnapshot().views, names, manual, flat),
      announce: (text) => focus?.announce(text),
    });
    return applyDropPlan(first, tasks, replan, retried).then((written) => {
      focus?.announce(written ? message : failedMessage(task));
      const moved = written && sectionToast(first, names);
      if (moved) toast.success(moved);
      return written;
    });
  };
  return { views, options, manual, plan, run };
}

export function MoveMenuItems({
  task,
  disabled,
  reorder = true,
  nesting = reorder,
  flat = false,
}: {
  task: TaskView;
  disabled: boolean;
  /** Smart views order by date: they offer only the project/section moves. */
  reorder?: boolean;
  /** Rows offer Make sub-task of…/Promote to task; board cards do not. */
  nesting?: boolean;
  /** Board ordering is flat even when a card has an RDF parent. */
  flat?: boolean;
}) {
  const tasks = useTasks();
  const moves = useTaskMoves(task, flat);
  const project = tasks.projects.find((item) => item.url === task.projectUrl);
  const up = moves.plan(moveUp);
  const down = moves.plan(moveDown);
  const parents = nesting ? nestCandidates(task, moves.views, moves.options.all) : [];
  const parent = nesting ? effectiveParent(task, moves.views) : undefined;
  const section = (parent ?? task).sectionId;
  if (project && isIssuesProject(project)) return null;
  return (
    <>
      <DropdownMenuSeparator />
      {reorder && moves.manual && (
        <>
          <DropdownMenuItem
            disabled={disabled || up.kind === "none"}
            onSelect={() => {
              void moves.run(moveUp);
            }}
          >
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled || down.kind === "none"}
            onSelect={() => {
              void moves.run(moveDown);
            }}
          >
            Move down
          </DropdownMenuItem>
        </>
      )}
      {project && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled}>Move to section…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent aria-label="Move to section">
            <DropdownMenuRadioGroup
              value={section ?? NO_SECTION}
              onValueChange={(value) => {
                const sectionId = value === NO_SECTION ? undefined : value;
                void moves.run((fresh, views, options) =>
                  planToSection(fresh, sectionId, views, options),
                );
              }}
            >
              {[{ id: NO_SECTION, name: "No section" }, ...project.tracker.sections].map(
                (option) => (
                  <DropdownMenuRadioItem key={option.id} value={option.id}>
                    {option.name}
                  </DropdownMenuRadioItem>
                ),
              )}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={disabled}>Move to project…</DropdownMenuSubTrigger>
        <DropdownMenuSubContent aria-label="Move to project">
          <DropdownMenuRadioGroup
            value={task.projectUrl}
            onValueChange={(url) => {
              if (url !== task.projectUrl)
                void moves.run((fresh) => ({ kind: "project", url: fresh.url, projectUrl: url }));
            }}
          >
            {tasks.projects.map((item) => (
              <DropdownMenuRadioItem key={item.url} value={item.url}>
                {item.tracker.title || "Project"}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {parents.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled}>Make sub-task of…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent aria-label="Make sub-task of">
            {parents.map((candidate) => (
              <DropdownMenuItem
                key={candidate.url}
                onSelect={() => {
                  void moves.run((fresh, views, options) =>
                    planNest(fresh, candidate, views, options),
                  );
                }}
              >
                {candidate.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {parent && (
        <DropdownMenuItem
          disabled={disabled}
          onSelect={() => {
            void moves.run((fresh, views) => planPromote(fresh, views));
          }}
        >
          Promote to task
        </DropdownMenuItem>
      )}
    </>
  );
}
