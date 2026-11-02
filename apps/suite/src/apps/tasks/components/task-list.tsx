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
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { DropContainer } from "../lib/dnd/types";
import type { StoredProject } from "../lib/model/store";
import type { Category } from "../lib/model/tracker";
import type { ProjectGroups, Row } from "../lib/views/project-groups";
import { focusAddTask } from "../state/add-focus";
import { TaskListFocus, useTaskListFocus } from "../state/list-focus";
import { useTasksPreferences } from "../state/preferences";
import { useTasks } from "../state/tasks-context";
import { AddTaskRow } from "./add-task-row";
import { useDropTarget } from "./dnd/use-task-drag";
import { TaskRow } from "./task-row";

/** A drop zone appending to a section (or No section): the add row in lists. */
export function SectionEnd({
  project,
  sectionId,
  className,
  children,
}: {
  project: StoredProject;
  sectionId?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  const drop = useDropTarget(`section-end:${project.url}#${sectionId ?? ""}`, {
    kind: "section-end",
    projectUrl: project.url,
    sectionId,
  });
  return (
    <div ref={drop.ref} className={className} data-drop-over={drop.over || undefined}>
      {children}
    </div>
  );
}

export function SectionHeader({
  project,
  section,
  count,
  first,
  last,
  board = false,
}: {
  project: StoredProject;
  section: Category;
  count: number;
  first: boolean;
  last: boolean;
  /** Board columns cannot collapse and move left/right. */
  board?: boolean;
}) {
  const { preferences, dispatch } = useTasksPreferences();
  const tasks = useTasks();
  const root = useRef<HTMLDivElement | null>(null);
  const collapsed = !board && preferences.collapsedSections.includes(section.id);
  const drop = useDropTarget(`section-start:${project.url}#${section.id}`, {
    kind: "section-start",
    projectUrl: project.url,
    sectionId: section.id,
  });
  const rename = () =>
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLButtonElement>(".suite-editable")?.click(),
    );
  return (
    <div
      className="tsk-section-header"
      data-drop-over={drop.over || undefined}
      ref={(node) => {
        root.current = node;
        drop.ref(node);
      }}
    >
      {!board && (
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
      )}
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
            {board ? "Move section left" : "Move section up"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={last}
            onSelect={() => {
              void tasks.moveSection(project, section.id, "down");
            }}
          >
            {board ? "Move section right" : "Move section down"}
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
  container,
}: {
  project?: StoredProject | undefined;
  groups?: ProjectGroups | undefined;
  rows?: Row[] | undefined;
  showProject?: boolean | undefined;
  hideAddTaskTrigger?: boolean;
  /** Drag-and-drop container for `rows`; project groups derive theirs per section. */
  container?: DropContainer | undefined;
}) {
  const { preferences } = useTasksPreferences();
  const { addSection } = useTasks();
  const focus = useTaskListFocus();
  const [addingSection, setAddingSection] = useState(false);
  const [name, setName] = useState("");
  const sectionInput = useRef<HTMLInputElement>(null);
  // A group can collapse without rerendering the persistent focus owner.
  useLayoutEffect(() => focus?.refresh());
  const renderRows = (rows: Row[], label: string, container: DropContainer | undefined) => (
    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the native table implements a grid with row selection and independent cell controls.
    <table role="grid" aria-multiselectable="true" aria-label={label} className="tsk-list">
      <tbody>
        {rows.map((row) => (
          <TaskRow
            key={row.task.url}
            row={row}
            showProject={showProject}
            tabIndex={row.task.url === focus?.activeUrl ? 0 : -1}
            onFocus={() => focus?.onFocus(row.task.url)}
            onMove={(direction) => focus?.onMove(row.task.url, direction)}
            container={container}
          />
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="tsk-task-list">
      {renderRows(
        rows ?? groups?.unsectioned ?? [],
        "Tasks",
        rows || !project ? container : { kind: "section", projectUrl: project.url },
      )}
      {project && (
        <SectionEnd project={project}>
          <AddTaskRow project={project} hideTrigger={hideAddTaskTrigger} />
        </SectionEnd>
      )}
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
                {renderRows(rows, section.name, {
                  kind: "section",
                  projectUrl: project.url,
                  sectionId: section.id,
                })}
                <SectionEnd project={project} sectionId={section.id}>
                  <AddTaskRow project={project} sectionId={section.id} />
                </SectionEnd>
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
