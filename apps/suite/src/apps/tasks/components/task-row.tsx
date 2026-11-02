// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
  IconButton,
} from "@jeswr/suite-ui";
import { Bell, CalendarDays, Ellipsis, Pencil, Repeat2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { formatDue, isOverdue } from "../lib/format/due";
import type { Row } from "../lib/views/project-groups";
import { completeTask, deleteTask } from "../state/actions";
import { useNow } from "../state/clock";
import { useTasks } from "../state/tasks-context";
import { reopenTask, rescheduleTasks } from "../state/view-actions";
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
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  return (
    <li
      className="tsk-row"
      data-tsk-row={task.url}
      data-task-url={task.url}
      data-depth={depth}
      data-closed={task.state === "closed" || undefined}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (
          event.key === "ArrowDown" ||
          event.key === "j" ||
          event.key === "ArrowUp" ||
          event.key === "k"
        ) {
          event.preventDefault();
          onMove(event.key === "ArrowDown" || event.key === "j" ? 1 : -1);
        }
        if (event.key === "Enter") {
          event.preventDefault();
          router.push(href);
        }
        if (event.key === " " && !pending) {
          event.preventDefault();
          void (task.state === "closed" ? reopenTask(task, tasks) : completeTask(task, tasks));
        }
        if (event.key === "F10" && event.shiftKey) {
          event.preventDefault();
          setMenuOpen(true);
        }
      }}
    >
      <label className="tsk-check-target">
        <input
          className="tsk-check"
          data-priority={task.priority}
          type="checkbox"
          tabIndex={-1}
          checked={task.state === "closed"}
          disabled={pending}
          aria-label={`${task.state === "closed" ? "Reopen" : "Complete"} '${task.title}'`}
          onChange={() => {
            void (task.state === "closed" ? reopenTask(task, tasks) : completeTask(task, tasks));
          }}
        />
      </label>
      <div className="tsk-row-body">
        <Link className="tsk-task-title" tabIndex={-1} href={href}>
          {task.title}
        </Link>
        {hasMeta && (
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
      </div>
      <ReschedulePopover
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        onSelect={(dayKey) => {
          void rescheduleTasks([task], dayKey, tasks);
        }}
        onCloseFocus={() => {
          document.querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(task.url)}"]`)?.focus();
        }}
      >
        <div className="tsk-row-actions">
          <IconButton
            className="tsk-wide-action"
            label="Reschedule"
            variant="ghost"
            tabIndex={-1}
            disabled={pending}
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
                if (confirmDelete || rescheduleOpen) return;
                document
                  .querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(task.url)}"]`)
                  ?.focus();
              }}
            >
              <DropdownMenuItem asChild>
                <Link href={href}>Edit</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={pending}
                onSelect={() => {
                  setRescheduleOpen(true);
                }}
              >
                Reschedule…
              </DropdownMenuItem>
              {task.state === "closed" && (
                <DropdownMenuItem
                  disabled={pending}
                  onSelect={() => {
                    void reopenTask(task, tasks);
                  }}
                >
                  Reopen
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={pending}
                onSelect={() => {
                  setConfirmDelete(true);
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                document
                  .querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(task.url)}"]`)
                  ?.focus();
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>Delete '{task.title}'?</AlertDialogTitle>
                <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void deleteTask(task, tasks);
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </ReschedulePopover>
      {saving && slow && <span className="tsk-saving" role="status" aria-label="Saving task" />}
    </li>
  );
}
