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
import { dropMessage, projectNames, sectionToast } from "../lib/dnd/announce";
import {
  effectiveParent,
  nestCandidates,
  planMove,
  planNest,
  planPromote,
  planToSection,
  visibleTasks,
} from "../lib/dnd/plan";
import type { DropPlan } from "../lib/dnd/types";
import type { TaskView } from "../lib/views/types";
import { applyDropPlan } from "../state/drop-actions";
import { useTaskListFocus } from "../state/list-focus";
import { useTasksPreferences } from "../state/preferences";
import { useTasks } from "../state/tasks-context";

const NO_SECTION = "__none";

/** The keyboard equivalents of every drag (06-tasks §4.4), for row and card ⋯ menus. */
export function useTaskMoves(task: TaskView) {
  const tasks = useTasks();
  const focus = useTaskListFocus();
  const { preferences } = useTasksPreferences();
  const views = visibleTasks(
    tasks.views.filter((view) => view.projectUrl === task.projectUrl),
    preferences.showCompletedInProject,
  );
  const run = (plan: DropPlan) => {
    if (plan.kind === "none") return Promise.resolve(false);
    const names = projectNames(tasks.projects);
    const message = dropMessage(task, plan, views, names);
    return applyDropPlan(plan, tasks).then((written) => {
      if (written) {
        focus?.announce(message);
        const moved = sectionToast(plan, names);
        if (moved) toast.success(moved);
      }
      return written;
    });
  };
  return {
    views,
    run,
    up: () => planMove(task, -1, views),
    down: () => planMove(task, 1, views),
  };
}

export function MoveMenuItems({
  task,
  disabled,
  reorder = true,
  nesting = reorder,
}: {
  task: TaskView;
  disabled: boolean;
  /** Smart views order by date: they offer only the project/section moves. */
  reorder?: boolean;
  /** Rows offer Make sub-task of…/Promote to task; board cards do not. */
  nesting?: boolean;
}) {
  const tasks = useTasks();
  const moves = useTaskMoves(task);
  const project = tasks.projects.find((item) => item.url === task.projectUrl);
  const up = moves.up();
  const down = moves.down();
  const parents = nesting ? nestCandidates(task, moves.views) : [];
  const parent = nesting ? effectiveParent(task, moves.views) : undefined;
  const section = (parent ?? task).sectionId;
  return (
    <>
      <DropdownMenuSeparator />
      {reorder && (
        <>
          <DropdownMenuItem
            disabled={disabled || up.kind === "none"}
            onSelect={() => {
              void moves.run(up);
            }}
          >
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled || down.kind === "none"}
            onSelect={() => {
              void moves.run(down);
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
                void moves.run(
                  planToSection(task, value === NO_SECTION ? undefined : value, moves.views),
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
                void moves.run({ kind: "project", url: task.url, projectUrl: url });
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
                  void moves.run(planNest(task, candidate, moves.views));
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
            void moves.run(planPromote(task, moves.views));
          }}
        >
          Promote to task
        </DropdownMenuItem>
      )}
    </>
  );
}
