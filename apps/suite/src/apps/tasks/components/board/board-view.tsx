// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EditableText,
  ErrorState,
  IconButton,
  Input,
  LoadingSkeleton,
  renderAsync,
} from "@jeswr/suite-ui";
import { Ellipsis, GripVertical, Plus, Repeat2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { type BoardGrouping, boardLanes, inLane, type Swimlane } from "../../lib/board/swimlanes";
import { formatDue, isOverdue } from "../../lib/format/due";
import { classifyError } from "../../lib/model/errors";
import type { StoredProject } from "../../lib/model/store";
import type { Category } from "../../lib/model/tracker";
import { labelColour } from "../../lib/views/label-colours";
import { projectGroups, type Row } from "../../lib/views/project-groups";
import type { TaskView } from "../../lib/views/types";
import { completeTask, deleteTask } from "../../state/actions";
import { useNow } from "../../state/clock";
import { TaskListFocus } from "../../state/list-focus";
import { useTasksPreferences } from "../../state/preferences";
import { useTasks } from "../../state/tasks-context";
import { AddTaskRow } from "../add-task-row";
import { AssigneeAvatar } from "../assignee-avatar";
import { useTaskDrag } from "../dnd/use-task-drag";
import { LabelChip } from "../label-chip";
import { LabelFilterBar } from "../label-filter-bar";
import { MoveMenuItems } from "../move-menu";
import { ProjectDot } from "../project-dot";
import { TaskCheck, useCompleting } from "../task-check";
import { SectionEnd, SectionHeader } from "../task-list";
import { TaskProgress } from "../tree-controls";
import { ProjectError } from "../views/project-error";
import "./board.css";

function BoardCard({
  task,
  project,
  sectionId,
  lane,
}: {
  task: TaskView;
  project: StoredProject;
  sectionId: string | undefined;
  lane?: Swimlane | undefined;
}) {
  const tasks = useTasks();
  const now = useNow();
  const pathname = usePathname();
  const params = useSearchParams();
  const pending = !tasks.tasks[task.projectUrl]?.items.find((item) => item.url === task.url)?.etag;
  const completing = useCompleting(task);
  const drag = useTaskDrag(
    task,
    { kind: "section", projectUrl: project.url, sectionId, lane },
    { disabled: pending || completing },
  );
  const query = new URLSearchParams(params.toString());
  query.set("task", encodeRef(task.url));
  const href = `${pathname}?${query}`;
  const labels = project.tracker.labels.filter((label) => task.labelIds.includes(label.id));
  return (
    <li
      ref={drag.ref}
      className="tsk-card"
      data-task-url={task.url}
      data-priority={task.priority}
      data-dragging={drag.dragging || undefined}
      data-drop={drag.hint}
      data-closed={task.state === "closed" || completing || undefined}
      data-completing={completing || undefined}
      {...drag.pointer}
      {...drag.touch}
    >
      <AssigneeAvatar task={task} />
      <div className="tsk-card-top">
        {drag.handle && (
          <button
            type="button"
            className="tsk-drag-handle tsk-card-handle"
            {...drag.handle}
            aria-label={`Move '${task.title}'`}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        )}
        <TaskCheck task={task} pending={pending} completing={completing} tabIndex={0} />
        <Link className="tsk-card-title" href={href} draggable={false}>
          {task.title}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={`Actions for '${task.title}'`}
              variant="ghost"
              data-tsk-row={task.url}
            >
              <Ellipsis size={18} aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem asChild>
              <Link href={href}>Edit</Link>
            </DropdownMenuItem>
            {task.state === "open" && (
              <DropdownMenuItem
                disabled={pending || completing}
                onSelect={() => {
                  void completeTask(task, tasks, { animate: true });
                }}
              >
                Complete
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={pending || completing}
              onSelect={() => {
                void deleteTask(task, tasks);
              }}
            >
              Delete
            </DropdownMenuItem>
            <MoveMenuItems task={task} disabled={pending || completing} nesting={false} flat />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="tsk-meta">
        {(task.due || task.allDay) && (
          <span className="tsk-due" data-overdue={isOverdue(task, now) || undefined}>
            {formatDue(task, now)}
          </span>
        )}
        {task.recurring && (
          <span title="Recurring task">
            <Repeat2 size={14} aria-label="Recurring task" />
          </span>
        )}
        <TaskProgress tasks={tasks.views} id={task.id} />
        {labels.slice(0, 3).map((label) => (
          <LabelChip
            key={label.id}
            name={label.name}
            colour={labelColour(label.name, tasks.projects)}
          />
        ))}
        {labels.length > 3 && <span>+{labels.length - 3}</span>}
        {task.priority < 4 && <span className="tsk-sr-only">Priority P{task.priority}</span>}
      </div>
    </li>
  );
}

function BoardColumn({
  project,
  section,
  rows,
  count,
  first,
  last,
  lane,
  bodyOnly = false,
  headerOnly = false,
}: {
  project: StoredProject;
  section: Category | undefined;
  rows: Row[];
  count: number;
  first: boolean;
  last: boolean;
  lane?: Swimlane | undefined;
  bodyOnly?: boolean;
  headerOnly?: boolean;
}) {
  const heading = useId();
  return (
    <section
      className="tsk-board-column"
      aria-label={section?.name ?? (bodyOnly ? "No section" : undefined)}
      aria-labelledby={section || bodyOnly ? undefined : heading}
    >
      {!bodyOnly &&
        (section ? (
          <SectionHeader
            project={project}
            section={section}
            count={count}
            first={first}
            last={last}
            board
          />
        ) : (
          <div className="tsk-section-header">
            <h2 id={heading} className="tsk-board-heading">
              No section
            </h2>
            <span className="tsk-count">{count}</span>
          </div>
        ))}
      {!headerOnly && (
        <SectionEnd
          project={project}
          sectionId={section?.id}
          lane={lane}
          className="tsk-board-body"
        >
          <ol className="tsk-board-cards" aria-label={`${section?.name ?? "No section"} tasks`}>
            {rows.map((row) => (
              <BoardCard
                key={row.task.url}
                task={row.task}
                project={project}
                sectionId={section?.id}
                lane={lane}
              />
            ))}
          </ol>
        </SectionEnd>
      )}
      {!bodyOnly && <AddTaskRow project={project} sectionId={section?.id} />}
    </section>
  );
}

function AddColumn({ project }: { project: StoredProject }) {
  const { addSection } = useTasks();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  return (
    <div className="tsk-board-column tsk-board-add">
      {adding ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void addSection(project, name);
            setName("");
            setAdding(false);
          }}
        >
          <Input
            ref={field}
            aria-label="Section name"
            placeholder="Section name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
          />
        </form>
      ) : (
        <button
          type="button"
          className="tsk-add-section"
          onClick={() => {
            setAdding(true);
            requestAnimationFrame(() => field.current?.focus());
          }}
        >
          <Plus size={16} aria-hidden="true" />
          Add section
        </button>
      )}
    </div>
  );
}

/**
 * Project board (06-tasks §2.5): one column per section in position order,
 * a leading No section column when needed, drag between columns (section)
 * and within one (position); cards' ⋯ menus carry the keyboard moves.
 */
export function BoardView({ projectUrl }: { projectUrl: string }) {
  const tasks = useTasks();
  const { preferences, dispatch } = useTasksPreferences();
  const grouping = preferences.boardGrouping[encodeRef(projectUrl)] ?? "none";
  const project = tasks.projects.find((item) => item.url === projectUrl);
  const load = tasks.tasks[projectUrl];
  const title =
    project?.tracker.title ??
    preferences.sharedProjects.find((shared) => shared.url === projectUrl)?.title ??
    "Project";
  useEffect(() => {
    if (project) void tasks.cache.loadTasks(project);
  }, [project, tasks.cache]);
  useEffect(() => {
    document.title = `${title} board · Tasks · Solid Suite`;
  }, [title]);
  const groups = projectGroups(
    tasks.views.filter((task) => task.projectUrl === projectUrl),
    project?.tracker.sections ?? [],
    "manual",
    preferences.showCompletedInProject,
    true,
  );
  const unsectioned = groups.unsectioned;
  const showNoSection = unsectioned.length > 0 || groups.sections.length === 0;
  const columns = [
    ...(showNoSection
      ? [
          {
            section: undefined,
            rows: unsectioned,
            openCount: unsectioned.filter((row) => row.task.state === "open").length,
          },
        ]
      : []),
    ...groups.sections,
  ];
  return (
    <TaskListFocus className="tsk-content tsk-board-view">
      <header className="tsk-view-header">
        <h1>
          {project && <ProjectDot colour={project.tracker.color} />}
          {project ? (
            <EditableText
              label="Project name"
              value={title}
              validate={(value) => (value.trim() ? undefined : "A name is required")}
              onCommit={(value) => {
                void tasks.renameProject(project, value);
              }}
            />
          ) : (
            title
          )}
        </h1>
        <label className="tsk-board-group">
          Group rows by
          <select
            value={grouping}
            onChange={(event) =>
              dispatch({
                type: "boardGrouping",
                viewId: encodeRef(projectUrl),
                value: event.target.value as BoardGrouping,
              })
            }
          >
            <option value="none">None</option>
            <option value="priority">Priority</option>
            <option value="assignee">Assignee</option>
            <option value="label">Label</option>
          </select>
        </label>
      </header>
      <LabelFilterBar projectUrl={projectUrl} />
      {renderAsync({
        loading:
          tasks.status === "loading" ||
          (project && (!load || (load.status === "loading" && !load.items.length))) ? (
            <LoadingSkeleton preset="grid" count={6} />
          ) : undefined,
        error:
          load?.status === "error" ? (
            <ProjectError
              error={load.error}
              retry={() => {
                void tasks.cache.retryProject(projectUrl);
              }}
            >
              {classifyError(load.error) === "forbidden" && (
                <>
                  <p>You no longer have access to {title}</p>
                  <p>Ask the owner to share this project</p>
                </>
              )}
            </ProjectError>
          ) : !project && tasks.status === "ready" ? (
            <ErrorState error="not-found" />
          ) : undefined,
        children: project ? (
          <div className="tsk-board" data-grouped={grouping !== "none" || undefined}>
            <div className="tsk-board-columns">
              {columns.map(({ section, rows, openCount }, index) => (
                <BoardColumn
                  key={section?.id ?? "none"}
                  project={project}
                  section={section}
                  rows={rows}
                  count={openCount}
                  first={!section || section.id === groups.sections[0]?.section.id}
                  last={index === columns.length - 1}
                  headerOnly={grouping !== "none"}
                />
              ))}
              <AddColumn project={project} />
            </div>
            {grouping !== "none" &&
              boardLanes(
                columns.flatMap((column) => column.rows.map((row) => row.task)),
                grouping,
                project.tracker.labels,
                project.tracker.groupMembers,
              ).map(({ lane, name }) => (
                <section
                  className="tsk-swimlane"
                  key={`${lane?.group}:${lane?.value}`}
                  aria-label={name}
                >
                  <h2>{name}</h2>
                  <div className="tsk-board-columns">
                    {columns.map(({ section, rows, openCount }) => (
                      <BoardColumn
                        key={section?.id ?? "none"}
                        project={project}
                        section={section}
                        rows={rows.filter((row) => lane && inLane(row.task, lane))}
                        count={openCount}
                        first={false}
                        last={false}
                        lane={lane}
                        bodyOnly
                      />
                    ))}
                  </div>
                </section>
              ))}
          </div>
        ) : null,
      })}
    </TaskListFocus>
  );
}
