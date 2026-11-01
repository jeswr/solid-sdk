// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  toast,
} from "@jeswr/suite-ui";
import { ArrowLeft, Ellipsis, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { duplicateTaskData } from "../../lib/detail/task-data";
import type { StoredProject, StoredTask } from "../../lib/model/store";
import { toTaskView } from "../../lib/views/types";
import { completeTask, deleteTask } from "../../state/actions";
import { useTasks } from "../../state/tasks-context";
import { ProjectFields, TaskProperties } from "./fields";

function descriptionNodes(text: string) {
  const seen = new Map<string, number>();
  return text.split(/(https?:\/\/[^\s<>]+)/gi).map((part) => {
    const occurrence = (seen.get(part) ?? 0) + 1;
    seen.set(part, occurrence);
    if (/^https?:\/\//i.test(part)) {
      try {
        const url = new URL(part);
        if (url.protocol === "http:" || url.protocol === "https:")
          return (
            <a
              key={`${part}-${occurrence}`}
              href={url.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {part}
            </a>
          );
      } catch {
        /* Malformed URLs remain text. */
      }
    }
    return part;
  });
}

export function TaskDetail({
  stored,
  project,
  onClose,
}: {
  stored: StoredTask;
  project: StoredProject;
  onClose: () => void;
}) {
  const tasks = useTasks();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = toTaskView(stored, project);
  const id = useId();
  const titleField = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(view.title);
  const [description, setDescription] = useState(view.description ?? "");
  const [editingDescription, setEditingDescription] = useState(false);
  const [childTitle, setChildTitle] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  useEffect(() => {
    titleField.current?.focus();
  }, []);
  useEffect(() => setTitle(view.title), [view.title]);
  useEffect(() => setDescription(view.description ?? ""), [view.description]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Resize after each draft title change.
  useEffect(() => {
    const field = titleField.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, [title]);
  const href = (url: string) => {
    const query = new URLSearchParams(params.toString());
    query.set("task", encodeRef(url));
    return `${pathname}?${query}`;
  };
  const move = async (target: StoredProject) => {
    setMoveOpen(false);
    const moved = await tasks.moveTaskToProject(stored, target);
    if (moved) router.replace(href(moved.url), { scroll: false });
  };
  const children = tasks.views.filter((task) => task.parentId === view.id);
  const completed = children.filter((task) => task.state === "closed").length;
  const open = children.length - completed;
  const parent = tasks.views.find((task) => task.id === view.parentId);
  const section = project.tracker.sections.find((section) => section.id === view.sectionId);
  const commitTitle = () => {
    const value = title.trim();
    if (!value) setTitle(view.title);
    else if (value !== view.title)
      void tasks.updateTask(stored, (task) => {
        task.title = value;
      });
  };
  const toggle = async (item: StoredTask, closed: boolean) => {
    if (!closed) await completeTask(toTaskView(item, project), tasks);
    else if (
      await tasks.updateTask(item, (task) => {
        task.state = "open";
      })
    )
      toast.success("Reopened");
  };
  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
  const creator = stored.task.creator;
  const creatorName =
    !creator || creator === tasks.webId
      ? "You"
      : (new URL(creator).pathname.split("/").filter(Boolean).at(-1) ?? new URL(creator).hostname);
  return (
    <section className="tsk-detail" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="sr-only">
        Task details: {view.title}
      </h2>
      <header className="tsk-detail-header">
        <Button className="tsk-detail-back" variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </Button>
        <Popover open={moveOpen} onOpenChange={setMoveOpen}>
          <PopoverTrigger asChild>
            <Button
              className="tsk-detail-breadcrumb"
              variant="ghost"
              size="sm"
              aria-label="Move task"
            >
              {view.projectTitle} › {section?.name ?? "No section"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="tsk-detail-popover" align="start">
            <div className="tsk-detail-stack">
              <ProjectFields
                stored={stored}
                project={project}
                view={view}
                onMove={(target) => {
                  void move(target);
                }}
              />
            </div>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Task actions" variant="ghost">
              <Ellipsis size={18} aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!stored.etag}
              onSelect={() => {
                void tasks.createTask(project, duplicateTaskData(stored, tasks.webId));
              }}
            >
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard.writeText(`${location.origin}${href(stored.url)}`).then(
                  () => toast.success("Link copied"),
                  () => toast.error("Couldn't copy the link"),
                );
              }}
            >
              Copy link
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!stored.etag}
              onSelect={() => {
                void deleteTask(view, tasks);
                onClose();
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton
          className="tsk-detail-close"
          label="Close task details"
          variant="ghost"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </IconButton>
      </header>
      <div className="tsk-detail-title-row">
        <label className="tsk-check-target">
          <input
            className="tsk-check"
            type="checkbox"
            aria-label={`${view.state === "closed" ? "Reopen" : "Complete"} '${view.title}'`}
            checked={view.state === "closed"}
            data-priority={view.priority}
            onChange={() => {
              void toggle(stored, view.state === "closed");
            }}
          />
        </label>
        <Textarea
          ref={titleField}
          className="tsk-detail-title"
          aria-label="Task title"
          rows={1}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <div className="tsk-detail-description">
        <Textarea
          className={!editingDescription && description ? "sr-only" : undefined}
          aria-label="Description"
          placeholder="Description"
          value={description}
          onFocus={() => setEditingDescription(true)}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            setEditingDescription(false);
            if (description !== (view.description ?? ""))
              void tasks.updateTask(stored, (task) => {
                task.description = description || undefined;
              });
          }}
        />
        {!editingDescription && description && (
          <>
            <p className="tsk-detail-description-text">{descriptionNodes(description)}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingDescription(true);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLTextAreaElement>(
                      ".tsk-detail textarea[aria-label='Description']",
                    )
                    ?.focus(),
                );
              }}
            >
              Edit description
            </Button>
          </>
        )}
      </div>
      {view.parentId ? (
        <p className="tsk-detail-muted">
          Part of{" "}
          <Link href={href(parent?.url ?? (view.parentId.split("#")[0] as string))}>
            {parent?.title ?? "parent task"}
          </Link>
        </p>
      ) : (
        <section className="tsk-detail-subtasks" aria-labelledby={`${id}-subtasks`}>
          <h3 id={`${id}-subtasks`}>
            Sub-tasks{" "}
            <span role="img" aria-label={`${completed} of ${children.length} sub-tasks complete`}>
              {completed}/{children.length}
            </span>
          </h3>
          {view.state === "closed" && open > 0 && (
            <p role="status" className="tsk-detail-muted">
              {open} {open === 1 ? "sub-task" : "sub-tasks"} still open
            </p>
          )}
          <ul>
            {children.map((child) => (
              <li key={child.url}>
                <label className="tsk-check-target">
                  <input
                    className="tsk-check"
                    type="checkbox"
                    aria-label={`${child.state === "closed" ? "Reopen" : "Complete"} '${child.title}'`}
                    checked={child.state === "closed"}
                    onChange={() => {
                      const item = tasks.tasks[child.projectUrl]?.items.find(
                        (item) => item.url === child.url,
                      );
                      if (item) void toggle(item, child.state === "closed");
                    }}
                  />
                </label>
                <Link href={href(child.url)}>{child.title}</Link>
              </li>
            ))}
          </ul>
          <form
            className="tsk-detail-inline"
            onSubmit={(event) => {
              event.preventDefault();
              if (!childTitle.trim()) return;
              void tasks.createTask(project, {
                title: childTitle.trim(),
                parent: view.id,
                sectionId: view.sectionId,
              });
              setChildTitle("");
            }}
          >
            <input
              aria-label="Sub-task title"
              placeholder="+ Add sub-task"
              value={childTitle}
              onChange={(event) => setChildTitle(event.target.value)}
            />
            <Button variant="ghost" size="sm" type="submit" disabled={!childTitle.trim()}>
              Add sub-task
            </Button>
          </form>
        </section>
      )}
      <TaskProperties
        stored={stored}
        project={project}
        view={view}
        onMove={(target) => {
          void move(target);
        }}
      />
      <footer className="tsk-detail-footer">
        {view.created && (
          <p>
            Created {formatDate(view.created)} by {creatorName}
          </p>
        )}
        {view.state === "closed" && view.completedAt && (
          <p>Completed {formatDate(view.completedAt)}</p>
        )}
      </footer>
    </section>
  );
}
