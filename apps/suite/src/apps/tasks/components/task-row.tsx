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
import { Bell, CalendarDays, Ellipsis, Pencil, Repeat2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { encodeRef } from "@/lib/refs";
import { formatDue, isOverdue } from "../lib/format/due";
import { runBulk } from "../lib/views/bulk";
import { addDays, localDayKey } from "../lib/views/days";
import { moveDown, moveUp } from "../lib/views/positions";
import type { Row } from "../lib/views/project-groups";
import { compareTasks } from "../lib/views/project-groups";
import { priorityValue } from "../lib/views/types";
import { completeTask, deleteTask } from "../state/actions";
import { useNow } from "../state/clock";
import { completionVisuals } from "../state/completion-visuals";
import { useTaskListFocus } from "../state/list-focus";
import { useTasksShortcuts } from "../state/shortcuts";
import { useTasks } from "../state/tasks-context";
import { reopenTask, rescheduleTasks } from "../state/view-actions";
import { RowProperties } from "./row-properties";
import { ReschedulePopover } from "./views/reschedule-popover";
import "./views/views.css";
export interface TaskRowProps {
  row: Row;
  showProject?: boolean | undefined;
  tabIndex: number;
  onFocus: () => void;
  onMove: (direction: -1 | 1) => void;
}
export function TaskRow({
  row: { task, depth, orphanParentTitle },
  showProject,
  tabIndex,
  onFocus,
  onMove,
}: TaskRowProps) {
  const tasks = useTasks();
  const visuals = completionVisuals(tasks.cache);
  const completing = useSyncExternalStore(
    visuals.subscribe,
    visuals.getSnapshot,
    visuals.getSnapshot,
  ).has(task.url);
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
      task.derivedFrom,
  );
  const onKeyDown = useTasksShortcuts(!!focus?.selection.size, (command) => {
    if (command.type === "focus") return onMove(command.direction);
    if (command.type === "open") return router.push(href);
    if (command.type === "clear") return focus?.clearSelection();
    if (command.type === "select") {
      focus?.toggleSelection(task.url);
      focus?.announce(
        focus.selection.has(task.url) ? `Deselected '${task.title}'` : `Selected '${task.title}'`,
      );
      return;
    }
    if (command.type === "menu") return setMenuOpen(true);
    if (pending) return;
    if (command.type === "complete") {
      const selected = tasks.views.filter((view) => focus?.selection.has(view.url));
      focus?.clearSelection();
      void runBulk(selected, async (view) => {
        if (view.state === "open") await completeTask(view, tasks, { animate: true });
      });
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
    if (command.type === "reorder") {
      const siblings = tasks.views
        .filter(
          (view) =>
            view.state === task.state &&
            view.projectUrl === task.projectUrl &&
            view.sectionId === task.sectionId &&
            view.parentId === task.parentId,
        )
        .sort(compareTasks("manual"));
      const plan = (command.direction === -1 ? moveUp : moveDown)(siblings, task.url);
      if (!plan) return;
      void (async () => {
        for (const patch of [
          ...(plan.renumber ?? []),
          { url: task.url, position: plan.position },
        ]) {
          const stored = tasks.cache
            .getSnapshot()
            .tasks[task.projectUrl]?.items.find((item) => item.url === patch.url);
          if (
            !stored ||
            !(await tasks.updateTask(stored, (task) => {
              task.rank = patch.position;
            }))
          )
            return;
        }
        focus?.announce(`Moved '${task.title}' ${command.direction === -1 ? "up" : "down"}`);
      })();
    }
  });
  return (
    <tr
      className="tsk-row"
      data-tsk-row={task.url}
      data-task-url={task.url}
      data-depth={depth}
      data-closed={task.state === "closed" || completing || undefined}
      data-completing={completing || undefined}
      tabIndex={tabIndex}
      onFocus={(event) => {
        if ((event.target as HTMLElement).tagName === "TD") event.currentTarget.focus();
        onFocus();
      }}
      aria-selected={focus?.selection.has(task.url) ?? false}
      ref={rowElement}
      onKeyDown={onKeyDown}
    >
      <td className="tsk-completion-cell">
        <label className="tsk-check-target">
          <input
            className="tsk-check"
            data-priority={task.priority}
            type="checkbox"
            tabIndex={-1}
            checked={task.state === "closed" || completing}
            disabled={pending || completing}
            aria-label={`${task.state === "closed" ? "Reopen" : "Complete"} '${task.title}'`}
            onChange={() => {
              void (task.state === "closed"
                ? reopenTask(task, tasks)
                : completeTask(task, tasks, { animate: true }));
            }}
          />
        </label>
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
