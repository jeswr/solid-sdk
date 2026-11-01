// AUTHORED-BY Codex GPT-6
"use client";
import {
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
import { useTasks } from "../state/tasks-context";
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
  const now = new Date();
  const hasMeta = Boolean(
    task.due ||
      task.allDay ||
      task.recurring ||
      task.hasReminders ||
      children.length ||
      orphanParentTitle ||
      labels.length ||
      (showProject && task.projectTitle),
  );
  return (
    <li
      className="tsk-row"
      data-tsk-row={task.url}
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
        if (event.key === " " && !pending && task.state === "open") {
          event.preventDefault();
          void completeTask(task, tasks);
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
          disabled={pending || task.state === "closed"}
          aria-label={`Complete '${task.title}'`}
          onChange={() => {
            void completeTask(task, tasks);
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
      <div className="tsk-row-actions">
        <IconButton
          className="tsk-wide-action"
          label="Reschedule"
          variant="ghost"
          tabIndex={-1}
          disabled
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
              document
                .querySelector<HTMLElement>(`[data-tsk-row="${CSS.escape(task.url)}"]`)
                ?.focus();
            }}
          >
            <DropdownMenuItem asChild>
              <Link href={href}>Edit</Link>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>Reschedule</DropdownMenuItem>
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => {
                void deleteTask(task, tasks);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {saving && slow && <span className="tsk-saving" role="status" aria-label="Saving task" />}
    </li>
  );
}
