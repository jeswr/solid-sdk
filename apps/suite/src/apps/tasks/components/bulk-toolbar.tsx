// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Toolbar,
  type ToolbarAction,
} from "@jeswr/suite-ui";
import { CalendarDays, Check, Flag, FolderInput, Tag, Trash2, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { unionLabels } from "../lib/model/tracker";
import type { PriorityLevel } from "../lib/views/types";
import {
  completeTasks,
  deleteTasks,
  labelTasks,
  moveTasksToProject,
  prioritizeTasks,
  rescheduleMany,
} from "../state/bulk-actions";
import { useTaskListFocus } from "../state/list-focus";
import { useTasks } from "../state/tasks-context";
import { ReschedulePopover } from "./views/reschedule-popover";
import "./selection.css";

type Panel = "due" | "priority" | "project" | "labels" | "delete";

/**
 * The multi-select Toolbar (06-tasks §4.5): "{N} selected" and one bulk write
 * per action, four in flight, one summary toast. Sticky above the list on
 * wider screens, fixed above the tab bar on phones.
 */
export function BulkToolbar() {
  const tasks = useTasks();
  const focus = useTaskListFocus();
  const [panel, setPanel] = useState<Panel>();
  const root = useRef<HTMLDivElement>(null);
  if (!focus?.selection.size) return null;
  const urls = focus.selectedUrls();
  // Unsaved rows have no validator yet; they join once their first write lands.
  const selected = tasks.views.filter(
    (view) =>
      urls.has(view.url) &&
      tasks.tasks[view.projectUrl]?.items.some((item) => item.url === view.url && item.etag),
  );
  if (!selected.length) return null;
  const count = selected.length;
  const focusActiveRow = () =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(focus.activeUrl ?? "")}"]`)
        ?.focus(),
    );
  const done = () => {
    setPanel(undefined);
    focus.clearSelection();
    focusActiveRow();
  };
  const restoreFocus = () =>
    requestAnimationFrame(() =>
      (
        root.current?.querySelector<HTMLElement>('[role="toolbar"] button[tabindex="0"]') ??
        document.querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(focus.activeUrl ?? "")}"]`)
      )?.focus(),
    );
  const labels = [...unionLabels(tasks.projects.map((project) => project.tracker))].sort(
    ([a], [b]) => a.localeCompare(b),
  );
  const hasLabel = (name: string) =>
    selected.every((view) =>
      tasks.projects
        .find((project) => project.url === view.projectUrl)
        ?.tracker.labels.some(
          (label) => label.name.toLowerCase() === name && view.labelIds.includes(label.id),
        ),
    );
  const actions: ToolbarAction[] = [
    {
      id: "complete",
      label: "Complete",
      icon: <Check size={16} />,
      onSelect: () => {
        const views = selected;
        done();
        void completeTasks(views, tasks);
      },
    },
    { id: "due", label: "Due", icon: <CalendarDays size={16} />, onSelect: () => setPanel("due") },
    {
      id: "priority",
      label: "Priority",
      icon: <Flag size={16} />,
      onSelect: () => setPanel("priority"),
    },
    {
      id: "project",
      label: "Move to project",
      icon: <FolderInput size={16} />,
      onSelect: () => setPanel("project"),
    },
    {
      id: "labels",
      label: "Labels",
      icon: <Tag size={16} />,
      disabled: labels.length === 0,
      onSelect: () => setPanel("labels"),
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 size={16} />,
      onSelect: () => {
        if (count > 1) setPanel("delete");
        else {
          deleteTasks(selected, tasks);
          done();
        }
      },
    },
    { id: "clear", label: "Clear", icon: <X size={16} />, onSelect: () => done() },
  ];
  const menu = (id: Panel, label: string, content: ReactNode) => (
    <Popover open={panel === id} onOpenChange={(open) => !open && setPanel(undefined)}>
      <PopoverAnchor asChild>
        <span className="tsk-bulk-anchor" />
      </PopoverAnchor>
      <PopoverContent
        aria-label={label}
        align="start"
        className="tsk-bulk-panel"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        {content}
      </PopoverContent>
    </Popover>
  );
  return (
    <section className="tsk-bulk" aria-label="Selected tasks" ref={root}>
      <p className="tsk-bulk-count" role="status">
        {count} selected
      </p>
      <Toolbar label="Bulk actions" actions={actions} />
      <ReschedulePopover
        open={panel === "due"}
        onOpenChange={(open) => !open && setPanel(undefined)}
        onCloseFocus={restoreFocus}
        onSelect={(dayKey) => {
          const views = selected;
          done();
          void rescheduleMany(views, dayKey, tasks);
        }}
      >
        <span className="tsk-bulk-anchor" />
      </ReschedulePopover>
      {menu(
        "priority",
        "Priority",
        ([1, 2, 3, 4] as PriorityLevel[]).map((level) => (
          <Button
            key={level}
            type="button"
            variant="ghost"
            onClick={() => {
              const views = selected;
              done();
              void prioritizeTasks(views, level, tasks);
            }}
          >
            <Flag size={16} aria-hidden="true" className="tsk-flag" data-priority={level} />
            {`P${level}`}
          </Button>
        )),
      )}
      {menu(
        "project",
        "Move to project",
        tasks.projects.map((project) => (
          <Button
            key={project.url}
            type="button"
            variant="ghost"
            onClick={() => {
              const views = selected;
              done();
              void moveTasksToProject(views, project, tasks);
            }}
          >
            {project.tracker.title || "Project"}
          </Button>
        )),
      )}
      {menu(
        "labels",
        "Labels",
        labels.map(([key, categories]) => {
          const checked = hasLabel(key);
          const name = categories[0]?.name ?? key;
          return (
            <Button
              key={key}
              type="button"
              variant="ghost"
              aria-pressed={checked}
              onClick={() => {
                const views = selected;
                done();
                void labelTasks(views, name, !checked, tasks);
              }}
            >
              {checked && <Check size={16} aria-hidden="true" />}@{name}
            </Button>
          );
        }),
      )}
      <AlertDialog open={panel === "delete"} onOpenChange={(open) => !open && setPanel(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {count} tasks? This can't be undone.</AlertDialogTitle>
            <AlertDialogDescription>
              The tasks are removed when the Undo notice closes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const views = selected;
                done();
                deleteTasks(views, tasks);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
