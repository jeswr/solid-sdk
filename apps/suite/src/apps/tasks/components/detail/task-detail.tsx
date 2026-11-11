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
import { ArrowLeft, Ellipsis, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { ChipText, ChipTextarea } from "@/components/chips";
import { encodeRef } from "@/lib/refs";
import { duplicateTaskData } from "../../lib/detail/task-data";
import type { StoredProject, StoredTask } from "../../lib/model/store";
import { compareTasks, treeRows } from "../../lib/views/project-groups";
import { expandedRows, taskLevel, taskProgress } from "../../lib/views/tree";
import { toTaskView } from "../../lib/views/types";
import { completeTask, deleteTask } from "../../state/actions";
import { useTasks } from "../../state/tasks-context";
import { TaskProgress, TreeToggle, useCollapsedTasks } from "../tree-controls";
import { TaskAttachments } from "./attachments";
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

/** Saved-value changes may reconcile a submitted edit, but never a newer local draft. */
function useDetailDraft(saved: string) {
  const [value, setValue] = useState(saved);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setValue(saved);
  }, [saved]);
  return {
    value,
    change: (text: string) => {
      dirty.current = true;
      setValue(text);
    },
    blur: (normalise: (text: string) => string = (text) => text) => {
      const next = dirty.current ? normalise(value) : saved;
      dirty.current = false;
      setValue(next);
      return next;
    },
  };
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
  const pathname = usePathname();
  const params = useSearchParams();
  const view = toTaskView(stored, project);
  const id = useId();
  const titleField = useRef<HTMLTextAreaElement>(null);
  const titleDraft = useDetailDraft(view.title);
  const descriptionDraft = useDetailDraft(view.description ?? "");
  const title = titleDraft.value;
  const description = descriptionDraft.value;
  const [editingDescription, setEditingDescription] = useState(false);
  const [childTitle, setChildTitle] = useState("");
  const [addingChild, setAddingChild] = useState(false);
  const childField = useRef<HTMLInputElement>(null);
  const childTrigger = useRef<HTMLButtonElement>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  useEffect(() => {
    titleField.current?.focus();
  }, []);
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
    await tasks.moveTaskToProject(stored, target);
  };
  const { open } = taskProgress(tasks.views, view.id);
  const tree = useCollapsedTasks();
  const descendants = new Set<string>();
  const pending = [view.id];
  while (pending.length) {
    const id = pending.pop() as string;
    if (descendants.has(id)) continue;
    descendants.add(id);
    for (const child of tasks.views) if (child.parentId === id) pending.push(child.id);
  }
  const rows = treeRows(
    tasks.views
      .filter((task) => task.id !== view.id && descendants.has(task.id))
      .sort(compareTasks("manual")),
    tasks.views,
  );
  const visibleRows = expandedRows(rows, tree.collapsed);
  const [activeChild, setActiveChild] = useState<string>();
  const parent = tasks.views.find((task) => task.id === view.parentId);
  const section = project.tracker.sections.find((section) => section.id === view.sectionId);
  const commitTitle = () => {
    const value = titleDraft.blur((text) => text.trim() || view.title);
    if (value !== view.title)
      void tasks.updateTask(stored, (task) => {
        task.title = value;
      });
  };
  const toggle = async (item: StoredTask, closed: boolean) => {
    const owner = tasks.projects.find((project) =>
      tasks.tasks[project.url]?.items.some((task) => task.url === item.url),
    );
    if (!owner) return;
    if (!closed) await completeTask(toTaskView(item, owner), tasks);
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
              aria-label={`${view.projectTitle} › ${section?.name ?? "No section"}, move task`}
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
          onChange={(event) => titleDraft.change(event.target.value)}
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
        <ChipTextarea
          className={!editingDescription && description ? "sr-only" : undefined}
          aria-label="Description"
          placeholder="Description"
          value={description}
          onFocus={() => {
            setEditingDescription(true);
          }}
          onChange={(event) => descriptionDraft.change(event.target.value)}
          onBlur={() => {
            setEditingDescription(false);
            const value = descriptionDraft.blur();
            if (value !== (view.description ?? ""))
              void tasks.updateTask(stored, (task) => {
                task.description = value || undefined;
              });
          }}
        />
        {!editingDescription && description && (
          <>
            <p className="tsk-detail-description-text">
              <ChipText text={description} plain={descriptionNodes} />
            </p>
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
      {view.parentId && (
        <p className="tsk-detail-muted">
          Part of{" "}
          <Link href={href(parent?.url ?? (view.parentId.split("#")[0] as string))}>
            {parent?.title ?? "parent task"}
          </Link>
        </p>
      )}
      <section className="tsk-detail-subtasks" aria-labelledby={`${id}-subtasks`}>
        <h3 id={`${id}-subtasks`}>
          Sub-tasks <TaskProgress tasks={tasks.views} id={view.id} />
        </h3>
        {view.state === "closed" && open > 0 && (
          <p role="status" className="tsk-detail-muted">
            {open} {open === 1 ? "sub-task" : "sub-tasks"} still open
          </p>
        )}
        {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the list implements a tree with roving focus and arrow-key navigation. */}
        <ul role="tree" aria-label="Sub-tasks">
          {visibleRows.map(({ task: child, depth }, index) => {
            const hasChildren = rows.some(
              (row) => row.task.parentId === child.id && row.depth > depth,
            );
            const expanded = !tree.collapsed.has(child.id);
            return (
              <li
                key={child.url}
                role="treeitem"
                className="tsk-detail-tree-row"
                style={{ "--tsk-depth": depth } as CSSProperties}
                aria-label={child.title}
                aria-level={taskLevel(child, tasks.views)}
                aria-expanded={hasChildren ? expanded : undefined}
                tabIndex={
                  activeChild === child.id ||
                  (!visibleRows.some((row) => row.task.id === activeChild) && index === 0)
                    ? 0
                    : -1
                }
                onFocus={() => setActiveChild(child.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  let target: string | undefined;
                  if (event.key === "ArrowDown") target = visibleRows[index + 1]?.task.id;
                  else if (event.key === "ArrowUp") target = visibleRows[index - 1]?.task.id;
                  else if (event.key === "Home") target = visibleRows[0]?.task.id;
                  else if (event.key === "End") target = visibleRows.at(-1)?.task.id;
                  else if (event.key === "ArrowRight" && hasChildren) {
                    if (!expanded) tree.setExpanded(child.id, true);
                    else target = visibleRows[index + 1]?.task.id;
                  } else if (event.key === "ArrowLeft") {
                    if (hasChildren && expanded) tree.setExpanded(child.id, false);
                    else target = child.parentId;
                  } else return;
                  event.preventDefault();
                  const items =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                      '[role="treeitem"]',
                    );
                  const at = visibleRows.findIndex((row) => row.task.id === target);
                  if (at >= 0) items?.[at]?.focus();
                }}
              >
                {hasChildren && (
                  <TreeToggle
                    title={child.title}
                    expanded={expanded}
                    onToggle={() => tree.setExpanded(child.id, !expanded)}
                  />
                )}
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
                <TaskProgress tasks={tasks.views} id={child.id} />
              </li>
            );
          })}
        </ul>
        {addingChild ? (
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
              ref={childField}
              aria-label="Sub-task title"
              placeholder="+ Add sub-task"
              value={childTitle}
              onChange={(event) => setChildTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  setAddingChild(false);
                  setChildTitle("");
                  requestAnimationFrame(() => childTrigger.current?.focus());
                }
              }}
            />
          </form>
        ) : (
          <button
            ref={childTrigger}
            type="button"
            className="tsk-ghost"
            onClick={() => {
              setAddingChild(true);
              requestAnimationFrame(() => childField.current?.focus());
            }}
          >
            <Plus size={16} aria-hidden="true" />
            Add sub-task
          </button>
        )}
      </section>
      <TaskAttachments key={stored.url} stored={stored} />
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
