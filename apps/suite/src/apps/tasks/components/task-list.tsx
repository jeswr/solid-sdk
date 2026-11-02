// AUTHORED-BY Codex GPT-6
"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EditableText,
  IconButton,
  Input,
} from "@jeswr/suite-ui";
import { ChevronDown, ChevronRight, Ellipsis, Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { StoredProject } from "../lib/model/store";
import type { Category } from "../lib/model/tracker";
import type { ProjectGroups, Row } from "../lib/views/project-groups";
import { focusAddTask } from "../state/add-focus";
import { TaskListFocus, useTaskListFocus } from "../state/list-focus";
import { useTasksPreferences } from "../state/preferences";
import { useTasks } from "../state/tasks-context";
import { AddTaskRow } from "./add-task-row";
import { TaskRow } from "./task-row";

function SectionHeader({
  project,
  section,
  count,
  first,
  last,
}: {
  project: StoredProject;
  section: Category;
  count: number;
  first: boolean;
  last: boolean;
}) {
  const { preferences, dispatch } = useTasksPreferences();
  const tasks = useTasks();
  const root = useRef<HTMLDivElement>(null);
  const collapsed = preferences.collapsedSections.includes(section.id);
  const rename = () =>
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLButtonElement>(".suite-editable")?.click(),
    );
  return (
    <div className="tsk-section-header" ref={root}>
      <IconButton
        label={`${collapsed ? "Expand" : "Collapse"} ${section.name}`}
        variant="ghost"
        aria-expanded={!collapsed}
        onClick={() => dispatch({ type: "collapse", sectionId: section.id })}
      >
        {collapsed ? (
          <ChevronRight size={16} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} aria-hidden="true" />
        )}
      </IconButton>
      <EditableText
        label="Section name"
        value={section.name}
        validate={(value) => (value.trim() ? undefined : "A name is required")}
        onCommit={(value) => {
          void tasks.renameSection(project, section.id, value);
        }}
      />
      <span className="tsk-count">{count}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Section actions for ${section.name}`} variant="ghost">
            <Ellipsis size={18} aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={rename}>Rename</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              if (collapsed) dispatch({ type: "collapse", sectionId: section.id });
              requestAnimationFrame(() => focusAddTask(section.id));
            }}
          >
            Add task
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={first}
            onSelect={() => {
              void tasks.moveSection(project, section.id, "up");
            }}
          >
            Move section up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={last}
            onSelect={() => {
              void tasks.moveSection(project, section.id, "down");
            }}
          >
            Move section down
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void tasks.deleteSection(project, section.id);
            }}
          >
            Delete section
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
export function TaskList(props: Parameters<typeof TaskListBody>[0]) {
  const focus = useTaskListFocus();
  return focus ? (
    <TaskListBody {...props} />
  ) : (
    <TaskListFocus>
      <TaskListBody {...props} />
    </TaskListFocus>
  );
}

/** Sections and flat views share rows and one roving focus cursor across the visible list. */
function TaskListBody({
  project,
  groups,
  rows,
  showProject = false,
  hideAddTaskTrigger = false,
}: {
  project?: StoredProject | undefined;
  groups?: ProjectGroups | undefined;
  rows?: Row[] | undefined;
  showProject?: boolean | undefined;
  hideAddTaskTrigger?: boolean;
}) {
  const { preferences } = useTasksPreferences();
  const { addSection } = useTasks();
  const focus = useTaskListFocus();
  const [addingSection, setAddingSection] = useState(false);
  const [name, setName] = useState("");
  const sectionInput = useRef<HTMLInputElement>(null);
  // A group can collapse without rerendering the persistent focus owner.
  useLayoutEffect(() => focus?.refresh());
  const renderRows = (rows: Row[], label: string) => (
    // biome-ignore lint/a11y/noRedundantRoles: explicit list role preserves Safari semantics when list markers are removed
    <ul role="list" aria-label={label} className="tsk-list">
      {rows.map((row) => (
        <TaskRow
          key={row.task.url}
          row={row}
          showProject={showProject}
          tabIndex={row.task.url === focus?.activeUrl ? 0 : -1}
          onFocus={() => focus?.onFocus(row.task.url)}
          onMove={(direction) => focus?.onMove(row.task.url, direction)}
        />
      ))}
    </ul>
  );
  return (
    <div className="tsk-task-list">
      {renderRows(rows ?? groups?.unsectioned ?? [], "Tasks")}
      {project && <AddTaskRow project={project} hideTrigger={hideAddTaskTrigger} />}
      {project &&
        groups?.sections.map(({ section, rows, openCount }, index) => (
          <section className="tsk-section" key={section.id} aria-label={section.name}>
            <SectionHeader
              project={project}
              section={section}
              count={openCount}
              first={index === 0}
              last={index === groups.sections.length - 1}
            />
            {!preferences.collapsedSections.includes(section.id) && (
              <>
                {renderRows(rows, section.name)}
                <AddTaskRow project={project} sectionId={section.id} />
              </>
            )}
          </section>
        ))}
      {project &&
        (addingSection ? (
          <form
            className="tsk-new-section"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) {
                void addSection(project, name);
                setName("");
                setAddingSection(false);
              }
            }}
          >
            <Input
              ref={sectionInput}
              aria-label="Section name"
              placeholder="Section name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAddingSection(false);
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
              setAddingSection(true);
              requestAnimationFrame(() => sectionInput.current?.focus());
            }}
          >
            <Plus size={16} aria-hidden="true" />
            Add section
          </button>
        ))}
    </div>
  );
}
