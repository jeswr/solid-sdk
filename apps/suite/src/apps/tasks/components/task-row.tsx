// AUTHORED-BY Codex GPT-6.1-Sol
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EditableText,
  IconButton,
} from "@jeswr/suite-ui";
import { Bell, CalendarDays, Ellipsis, GripVertical, Pencil, Repeat2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import type { DropContainer } from "../lib/dnd/types";
import { formatDue, isOverdue } from "../lib/format/due";
import { addDays, localDayKey } from "../lib/views/days";
import type { Row } from "../lib/views/project-groups";
import { priorityValue } from "../lib/views/types";
import { completeTask, deleteTask } from "../state/actions";
import { completeTasks } from "../state/bulk-actions";
import { useNow } from "../state/clock";
import { useTaskListFocus } from "../state/list-focus";
import { useTasksShortcuts } from "../state/shortcuts";
import { useTasks } from "../state/tasks-context";
import { reopenTask, rescheduleTasks } from "../state/view-actions";
import { AssigneeAvatar } from "./assignee-avatar";
import { useTaskDrag } from "./dnd/use-task-drag";
import { MoveMenuItems, moveDown, moveUp, useTaskMoves } from "./move-menu";
import { RowProperties } from "./row-properties";
import { TaskCheck, useCompleting } from "./task-check";
import { ReschedulePopover } from "./views/reschedule-popover";
import "./views/views.css";
import "./selection.css";
export interface TaskRowProps {
  row: Row;
  showProject?: boolean | undefined;
  tabIndex: number;
  onFocus: () => void;
  onMove: (direction: -1 | 1) => void;
  /** Where the row renders, for drag and drop; omitted rows cannot be dragged. */
  container?: DropContainer | undefined;
}
export function TaskRow({
  row: { task, depth, orphanParentTitle },
  showProject,
  tabIndex,
  onFocus,
  onMove,
  container,
}: TaskRowProps) {
  const tasks = useTasks();
  const completing = useCompleting(task);
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmForever, setConfirmForever] = useState(false);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<"labels" | "repeat">();
  const rowElement = useRef<HTMLTableRowElement>(null);
  const titleWasFocused = useRef(false);
  const focus = useTaskListFocus();
  const focusRow = () => requestAnimationFrame(() => rowElement.current?.focus());
  useLayoutEffect(() => {
    if (editing) rowElement.current?.querySelector<HTMLButtonElement>(".suite-editable")?.click();
  }, [editing]);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [slow, setSlow] = useState(false);
  const saving = tasks.saving.includes(task.url);
  useEffect(() => {
    setSlow(false);
    if (!saving) return;
    const timer = setTimeout(() => setSlow(true), 600);
    return () => clearTimeout(timer);
  }, [saving]);
  const query = new URLSearchParams(params.toString());
  query.set("task", encodeRef(task.url));
  const href = `${pathname}?${query}`;
  const children = tasks.views.filter((child) => child.parentId === task.id);
  const labels =
    tasks.projects
      .find((project) => project.url === task.projectUrl)
      ?.tracker.labels.filter((label) => task.labelIds.includes(label.id)) ?? [];
  const pending = !tasks.tasks[task.projectUrl]?.items.find((item) => item.url === task.url)?.etag;
  const now = useNow();
  const moves = useTaskMoves(task);
  const toggleSelected = () => {
    if (!focus) return;
    focus.toggleSelection(task.url);
    focus.announce(
      focus.selection.has(task.url) ? `Deselected '${task.title}'` : `Selected '${task.title}'`,
    );
  };
  /** A long-press selects; the click its release may fire must not open the task. */
  const longPressed = useRef(0);
  const drag = useTaskDrag(task, container, {
    disabled: pending || completing || editing,
    // A sorted list has no manual order: its rows accept only section moves, never nesting.
    allowChild: container?.kind === "section" && moves.manual,
    onLongPress: focus
      ? () => {
          longPressed.current = Date.now();
          toggleSelected();
        }
      : undefined,
  });
  const { ref: dragRef } = drag;
  const rowRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      rowElement.current = node;
      dragRef(node);
    },
    [dragRef],
  );
  const selecting = (focus?.selection.size ?? 0) > 0;
  const selected = focus?.selection.has(task.url) ?? false;
  const hasMeta = Boolean(
    task.due ||
      task.allDay ||
      task.recurring ||
      task.hasReminders ||
      children.length ||
      orphanParentTitle ||
      labels.length ||
      (showProject && task.projectTitle) ||
      task.completedAt ||
      task.derivedFrom ||
      task.assignee,
  );
  const selectedTasks = () => {
    if (!focus?.selection.size) return [];
    const selected = focus?.selectedUrls();
    return tasks.views.filter(
      (view) =>
        selected?.has(view.url) &&
        view.state === "open" &&
        tasks.tasks[view.projectUrl]?.items.some((item) => item.url === view.url && item.etag),
    );
  };
  const onKeyDown = useTasksShortcuts(selectedTasks().length > 0, (command) => {
    if (command.type === "focus") return onMove(command.direction);
    if (command.type === "open") return router.push(href);
    if (command.type === "clear") return focus?.clearSelection();
    if (command.type === "selectAll") return focus?.selectAll();
    if (command.type === "extend") return focus?.extendSelection(task.url, command.direction);
    if (command.type === "select") return toggleSelected();
    if (command.type === "menu") return setMenuOpen(true);
    if (pending) return;
    if (command.type === "complete") {
      const selected = selectedTasks();
      focus?.clearSelection();
      void completeTasks(selected, tasks);
    }
    if (command.type === "edit") setEditing(true);
    if (command.type === "delete") void deleteTask(task, tasks);
    if (command.type === "due") setRescheduleOpen(true);
    if (command.type === "labels") setPanel("labels");
    if (command.type === "repeat") setPanel("repeat");
    if (command.type === "reschedule")
      void rescheduleTasks([task], localDayKey(addDays(now, command.days)), tasks);
    if (command.type === "priority") {
      const stored = tasks.tasks[task.projectUrl]?.items.find((item) => item.url === task.url);
      if (stored)
        void tasks.updateTask(stored, (task) => {
          task.priority = priorityValue(command.level);
        });
      focus?.announce(`Priority P${command.level}`);
    }
    if (command.type === "reorder") void moves.run(command.direction === -1 ? moveUp : moveDown);
  });
  return (
    <tr
      className="tsk-row"
      data-tsk-row={task.url}
      data-task-url={task.url}
      data-depth={depth}
      data-selecting={selecting || undefined}
      data-dragging={drag.dragging || undefined}
      data-drop={drag.hint}
      data-closed={task.state === "closed" || completing || undefined}
      data-completing={completing || undefined}
      tabIndex={tabIndex}
      onFocus={(event) => {
        if ((event.target as HTMLElement).tagName === "TD") event.currentTarget.focus();
        onFocus();
      }}
      aria-selected={selected}
      ref={rowRef}
      onKeyDown={onKeyDown}
      onClickCapture={(event) => {
        if (Date.now() - longPressed.current > 700) return;
        longPressed.current = 0;
        event.preventDefault();
        event.stopPropagation();
      }}
      {...drag.touch}
    >
      <td className="tsk-drag-cell">
        {drag.handle && (
          <button
            type="button"
            className="tsk-drag-handle"
            {...drag.handle}
            tabIndex={tabIndex}
            aria-label={`Move '${task.title}'`}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        )}
      </td>
      <td className="tsk-select-cell">
        <button
          type="button"
          className="tsk-select"
          tabIndex={-1}
          aria-pressed={selected}
          aria-label={`Select '${task.title}'`}
          onClick={(event) => {
            if (event.shiftKey) focus?.selectRange(task.url, task.url);
            else focus?.toggleSelection(task.url);
          }}
        />
      </td>
      <td className="tsk-completion-cell">
        <TaskCheck task={task} pending={pending} completing={completing} />
      </td>
      <td className="tsk-row-body">
        {editing ? (
          <div
            className="tsk-inline-title"
            onKeyDownCapture={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setEditing(false);
                focusRow();
              }
            }}
          >
            <EditableText
              label="Task title"
              value={task.title}
              validate={(value) => (value.trim() ? undefined : "A title is required")}
              onCommit={(value) => {
                const stored = tasks.tasks[task.projectUrl]?.items.find(
                  (item) => item.url === task.url,
                );
                if (stored)
                  void tasks.updateTask(stored, (task) => {
                    task.title = value.trim();
                  });
                setEditing(false);
                focusRow();
              }}
            />
          </div>
        ) : (
          <Link
            className="tsk-task-title"
            tabIndex={-1}
            href={href}
            onPointerDown={() => {
              titleWasFocused.current = document.activeElement === rowElement.current;
            }}
            onClick={(event) => {
              if (
                !pending &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey &&
                titleWasFocused.current
              ) {
                event.preventDefault();
                setEditing(true);
              }
              titleWasFocused.current = false;
            }}
          >
            {task.title}
          </Link>
        )}
        {hasMeta && (
          <div className="tsk-meta">
            {(task.due || task.allDay) && (
              <button
                type="button"
                className="tsk-due"
                disabled={pending || completing}
                aria-label={`Reschedule '${task.title}'`}
                onClick={() => setRescheduleOpen(true)}
                data-overdue={isOverdue(task, now) || undefined}
              >
                {formatDue(task, now)}
              </button>
            )}
            {task.recurring && (
              <span title="Recurring task">
                <Repeat2 size={14} aria-label="Recurring task" />
              </span>
            )}
            {task.derivedFrom && (
              <span title="Occurrence of a recurring task">
                <Repeat2 size={14} aria-label="Occurrence of a recurring task" />
              </span>
            )}
            {task.state === "closed" && task.completedAt && (
              <time dateTime={task.completedAt.toISOString()} title="Completed at">
                {task.completedAt.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            )}
            {task.hasReminders && (
              <span title="Reminder set">
                <Bell size={14} aria-label="Reminder set" />
              </span>
            )}
            {children.length > 0 && (
              <span
                role="img"
                aria-label={`${children.filter((child) => child.state === "closed").length} of ${children.length} sub-tasks complete`}
              >
                {children.filter((child) => child.state === "closed").length}/{children.length}
              </span>
            )}
            {orphanParentTitle && <span>↳ {orphanParentTitle}</span>}
            {labels.slice(0, 3).map((label) => (
              <span className="tsk-chip" key={label.id}>
                @{label.name}
              </span>
            ))}
            {labels.length > 3 && (
              <span
                title={labels
                  .slice(3)
                  .map((label) => label.name)
                  .join(", ")}
              >
                +{labels.length - 3}
              </span>
            )}
            {showProject && task.projectTitle && <span>{task.projectTitle}</span>}
            <AssigneeAvatar task={task} />
          </div>
        )}
      </td>
      <td className="tsk-actions-cell">
        <ReschedulePopover
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          onSelect={(dayKey) => {
            void rescheduleTasks([task], dayKey, tasks);
          }}
          onCloseFocus={() => {
            document
              .querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(task.url)}"]`)
              ?.focus();
          }}
        >
          <div className="tsk-row-actions">
            <IconButton
              className="tsk-wide-action"
              label="Reschedule"
              variant="ghost"
              tabIndex={-1}
              disabled={pending || completing}
              onClick={() => setRescheduleOpen(true)}
            >
              <CalendarDays size={16} aria-hidden="true" />
            </IconButton>
            <Link
              className="tsk-wide-action tsk-icon-link"
              href={href}
              tabIndex={-1}
              aria-label={`Edit '${task.title}'`}
            >
              <Pencil size={16} aria-hidden="true" />
            </Link>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Actions for '${task.title}'`} variant="ghost" tabIndex={-1}>
                  <Ellipsis size={18} aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  if (confirmForever || rescheduleOpen || panel) return;
                  document
                    .querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(task.url)}"]`)
                    ?.focus();
                }}
              >
                <DropdownMenuItem asChild>
                  <Link href={href}>Edit</Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={pending || completing}
                  onSelect={() => {
                    setRescheduleOpen(true);
                  }}
                >
                  Reschedule…
                </DropdownMenuItem>
                {task.state === "closed" && (
                  <DropdownMenuItem
                    disabled={pending || completing}
                    onSelect={() => {
                      void reopenTask(task, tasks);
                    }}
                  >
                    Reopen
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  disabled={pending || completing}
                  onSelect={() => setEditing(true)}
                >
                  Edit title
                </DropdownMenuItem>
                {focus && (
                  <DropdownMenuItem onSelect={toggleSelected}>
                    {selected ? "Deselect" : "Select"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  disabled={pending || completing}
                  onSelect={() => setPanel("labels")}
                >
                  Labels…
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={pending || completing}
                  onSelect={() => setPanel("repeat")}
                >
                  Repeat…
                </DropdownMenuItem>
                {task.recurring && task.state === "open" && (
                  <DropdownMenuItem
                    disabled={pending || completing}
                    onSelect={() => setConfirmForever(true)}
                  >
                    Complete forever
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
                <MoveMenuItems
                  task={task}
                  disabled={pending || completing}
                  reorder={container?.kind === "section"}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog open={confirmForever} onOpenChange={setConfirmForever}>
              <AlertDialogContent
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  document
                    .querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(task.url)}"]`)
                    ?.focus();
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop repeating and complete?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Complete '{task.title}' without creating another occurrence.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      void completeTask(task, tasks, { forever: true, animate: true });
                    }}
                  >
                    Complete forever
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </ReschedulePopover>
        <RowProperties task={task} panel={panel} onClose={() => setPanel(undefined)} />
        {saving && slow && <span className="tsk-saving" role="status" aria-label="Saving task" />}
      </td>
    </tr>
  );
}
