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
/** Sections and flat views share rows and one roving focus cursor across the visible list. */
export function TaskList({
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
  const [active, setActive] = useState<string>();
  const [addingSection, setAddingSection] = useState(false);
  const [name, setName] = useState("");
  const sectionInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef<{ url: string; order: string[] } | undefined>(undefined);
  const visible = [
    ...(rows ?? groups?.unsectioned ?? []),
    ...(groups?.sections ?? [])
      .filter(({ section }) => !preferences.collapsedSections.includes(section.id))
      .flatMap(({ rows }) => rows),
  ];
  const activeUrl = visible.some((row) => row.task.url === active) ? active : visible[0]?.task.url;
  useLayoutEffect(() => {
    const previous = focused.current;
    if (!previous) return;
    const urls = visible.map((row) => row.task.url);
    if (urls.includes(previous.url)) {
      previous.order = urls;
      return;
    }
    focused.current = undefined;
    const current = document.activeElement;
    if (current instanceof HTMLElement && current !== document.body && current.isConnected) return;
    const index = previous.order.indexOf(previous.url);
    const next =
      [...previous.order.slice(index + 1), ...previous.order.slice(0, index).reverse()].find(
        (url) => urls.includes(url),
      ) ?? urls[0];
    if (next) {
      setActive(next);
      root.current?.querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(next)}"]`)?.focus();
    } else {
      const add =
        root.current?.querySelector<HTMLElement>(
          "[data-tsk-add]:not([hidden]) button, [data-tsk-add] input",
        ) ??
        root.current?.closest(".tsk-content")?.querySelector<HTMLElement>(".tsk-empty-add") ??
        document.querySelector<HTMLElement>(".tsk-primary-add");
      add?.focus();
    }
  });
  const renderRows = (rows: Row[], label: string) => (
    // biome-ignore lint/a11y/noRedundantRoles: explicit list role preserves Safari semantics when list markers are removed
    <ul role="list" aria-label={label} className="tsk-list">
      {rows.map((row) => (
        <TaskRow
          key={row.task.url}
          row={row}
          showProject={showProject}
          tabIndex={row.task.url === activeUrl ? 0 : -1}
          onFocus={() => setActive(row.task.url)}
          onMove={(direction) => {
            const index = visible.findIndex((item) => item.task.url === row.task.url);
            const next = visible[Math.max(0, Math.min(visible.length - 1, index + direction))];
            if (next) {
              setActive(next.task.url);
              root.current
                ?.querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(next.task.url)}"]`)
                ?.focus();
            }
          }}
        />
      ))}
    </ul>
  );
  return (
    <div
      ref={root}
      className="tsk-task-list"
      onFocusCapture={(event) => {
        const element = event.target as HTMLElement;
        const row = element.closest<HTMLElement>("[data-tsk-row]");
        if (row?.dataset.tskRow)
          focused.current = {
            url: row.dataset.tskRow,
            order: visible.map((row) => row.task.url),
          };
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget;
        if (
          next instanceof HTMLElement &&
          !event.currentTarget.contains(next) &&
          !next.closest('[role="menu"], [role="alertdialog"]')
        )
          focused.current = undefined;
      }}
    >
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
