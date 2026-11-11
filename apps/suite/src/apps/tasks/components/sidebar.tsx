// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EditableText,
  IconButton,
  Input,
} from "@jeswr/suite-ui";
import {
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Inbox,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { useRoutePathname } from "@/lib/route-params";
import { dueDate, isOverdue, localDay } from "../lib/format/due";
import { ModelError } from "../lib/model/errors";
import type { StoredProject } from "../lib/model/store";
import { unionLabels } from "../lib/model/tracker";
import { labelColour } from "../lib/views/label-colours";
import { openAddTask } from "../state/add-focus";
import { useNow } from "../state/clock";
import { useTasksPreferences } from "../state/preferences";
import { useTasks } from "../state/tasks-context";
import { useCalendarExchange } from "./calendar-exchange/calendar-exchange";
import { DeleteCompletedDialog, DeleteCompletedMenuItem } from "./delete-completed";
import "./calendar-exchange/calendar-exchange.css";
import { useDropTarget } from "./dnd/use-task-drag";
import { FiltersSection, NewFilterButton } from "./filters";
import { TasksImportDialog } from "./import/import-dialog";
import { LabelDot } from "./label-chip";
import { LabelColourPicker } from "./label-colour-picker";
import { ProjectColourPicker } from "./project-colour-picker";
import { ProjectDot } from "./project-dot";
import { ShareProject } from "./share-project";

/** A sidebar entry that accepts dropped rows: the task moves to that project (06-tasks §4.4). */
function ProjectDropItem({
  projectUrl,
  className,
  children,
}: {
  projectUrl: string;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const drop = useDropTarget(`project:${projectUrl}:${id}`, { kind: "project", projectUrl });
  return (
    <li ref={drop.ref} className={className} data-drop-over={drop.over || undefined}>
      {children}
    </li>
  );
}

function ProjectRow({
  project,
  first,
  last,
  shared = false,
}: {
  shared?: boolean;
  project: StoredProject;
  first: boolean;
  last: boolean;
}) {
  const tasks = useTasks();
  const calendar = useCalendarExchange(project);
  const { preferences, dispatch } = useTasksPreferences();
  const favourite = preferences.favourites.includes(project.url);
  const [colourOpen, setColourOpen] = useState(false);
  const path = useRoutePathname();
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [clearCompleted, setClearCompleted] = useState(false);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const renameRoot = useRef<HTMLDivElement>(null);
  const name = project.tracker.title ?? "Untitled";
  const href = `/tasks/p/${encodeRef(project.url)}`;
  const count = tasks.views.filter(
    (task) => task.projectUrl === project.url && task.state === "open",
  ).length;
  return (
    <ProjectDropItem projectUrl={project.url} className="tsk-project-row">
      <ProjectDot colour={project.tracker.color} />
      {renaming ? (
        <div className="tsk-inline-edit" ref={renameRoot}>
          <EditableText
            label="Project name"
            value={name}
            validate={(value) => (value.trim() ? undefined : "A name is required")}
            onCommit={(value) => {
              void tasks.renameProject(project, value);
              setRenaming(false);
            }}
          />
          <button type="button" className="tsk-ghost" onClick={() => setRenaming(false)}>
            Done
          </button>
        </div>
      ) : (
        <Link href={href} aria-current={path === href ? "page" : undefined}>
          <span>{name}</span>
          <span role="img" className="tsk-count" aria-label={`${count} open tasks`}>
            {count}
          </span>
        </Link>
      )}
      <ProjectColourPicker
        colour={project.tracker.color}
        open={colourOpen}
        onOpenChange={setColourOpen}
        onSelect={(colour) => {
          void tasks.cache.setProjectColor(project, colour);
        }}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              ref={actionsButton}
              className="tsk-project-actions"
              label={`Project actions for ${name}`}
              variant="ghost"
            >
              <Ellipsis size={16} aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {calendar.items}
            <DropdownMenuItem
              disabled={!project.etag}
              onSelect={() => {
                requestAnimationFrame(() => setColourOpen(true));
              }}
            >
              Colour
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!preferences.sharedOwner}
              onSelect={() =>
                dispatch({ type: "favouriteProject", url: project.url, value: !favourite })
              }
            >
              {favourite ? "Remove from favourites" : "Add to favourites"}
            </DropdownMenuItem>
            {shared ? (
              <DropdownMenuItem
                onSelect={() => {
                  tasks.cache.forgetSharedProject(project.url);
                  dispatch({ type: "removeSharedProject", url: project.url });
                  dispatch({ type: "favouriteProject", url: project.url, value: false });
                  if (path === href || path === `${href}/board`) router.push("/tasks/inbox");
                }}
              >
                Remove from Shared with me
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem
                  disabled={!project.etag}
                  onSelect={() => {
                    setRenaming(true);
                    requestAnimationFrame(() =>
                      renameRoot.current
                        ?.querySelector<HTMLButtonElement>(".suite-editable")
                        ?.click(),
                    );
                  }}
                >
                  Rename
                </DropdownMenuItem>
                {tasks.sharingAvailable && (
                  <DropdownMenuItem disabled={!project.etag} onSelect={() => setSharing(true)}>
                    Share
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  disabled={first || !project.etag}
                  onSelect={() => {
                    void tasks.moveProject(project, "up");
                  }}
                >
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={last || !project.etag}
                  onSelect={() => {
                    void tasks.moveProject(project, "down");
                  }}
                >
                  Move down
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!project.etag}
                  onSelect={() => {
                    void tasks.archiveProject(project).then((result) => {
                      if (result && path === href) router.push("/tasks/inbox");
                    });
                  }}
                >
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!project.etag} onSelect={() => setConfirm(true)}>
                  Delete
                </DropdownMenuItem>
                <DeleteCompletedMenuItem
                  project={project}
                  onSelect={() => setClearCompleted(true)}
                />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </ProjectColourPicker>
      {sharing && <ShareProject project={project} onClose={() => setSharing(false)} />}
      <DeleteCompletedDialog
        project={project}
        open={clearCompleted}
        onOpenChange={setClearCompleted}
        returnFocus={() => actionsButton.current?.focus()}
      />
      {calendar.dialog}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the project and its tasks. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void tasks.deleteProject(project).then((result) => {
                  if (result && path === href) router.push("/tasks/inbox");
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProjectDropItem>
  );
}
export function TasksSidebar() {
  const router = useRouter();
  const tasks = useTasks();
  const { preferences, dispatch } = useTasksPreferences();
  const path = useRoutePathname();
  const [creating, setCreating] = useState(false);
  const [clearShared, setClearShared] = useState<StoredProject>();
  const sharedActionButtons = useRef(new Map<string, HTMLButtonElement>());
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const open = tasks.views.filter((task) => task.state === "open");
  const now = useNow();
  const dueToday = open.filter((task) => {
    const due = dueDate(task);
    return due && localDay(due) <= localDay(now);
  });
  const overdue = dueToday.some((task) => isOverdue(task, now));
  const inboxCount = open.filter((task) => task.projectUrl === tasks.inboxUrl).length;
  const labels = unionLabels(tasks.projects.map((project) => project.tracker));
  const shared = preferences.sharedProjects.filter(
    (project) => !tasks.cache.isOwnProject(project.url),
  );
  const sharedUrls = new Set(shared.map((project) => project.url));
  const projects = tasks.projects.filter(
    (project) => project.url !== tasks.inboxUrl && !sharedUrls.has(project.url),
  );
  // Refresh retains cached shared trackers on errors; confirmed deletions aren't favourites.
  const favourites = tasks.projects.filter((project) => {
    const error = tasks.tasks[project.url]?.error;
    return (
      preferences.favourites.includes(project.url) &&
      !project.tracker.archivedAt &&
      !(error instanceof ModelError && error.url === project.url && error.category === "not-found")
    );
  });
  const link = (
    href: string,
    title: string,
    icon: ReactNode,
    count?: number,
    destructive = false,
    projectUrl?: string,
  ) => {
    const content = (
      <Link href={href} aria-current={path === href ? "page" : undefined}>
        {icon}
        <span>{title}</span>
        {count !== undefined && (
          <span
            role="img"
            className="tsk-count"
            data-destructive={destructive || undefined}
            aria-label={`${count} open tasks`}
          >
            {count}
          </span>
        )}
      </Link>
    );
    return projectUrl ? (
      <ProjectDropItem key={href} projectUrl={projectUrl}>
        {content}
      </ProjectDropItem>
    ) : (
      <li key={href}>{content}</li>
    );
  };
  return (
    <nav className="tsk-sidebar" aria-label="Tasks">
      <Button
        className="tsk-primary-add"
        onClick={() => {
          // Close the interim mobile drawer before moving focus back into the list.
          document
            .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')
            ?.click();
          requestAnimationFrame(() => {
            openAddTask();
          });
        }}
      >
        <Plus size={18} aria-hidden="true" />
        Add task
      </Button>
      <h2 className="tsk-nav-heading">Views</h2>
      <ul className="tsk-nav-list">
        {link(
          "/tasks/inbox",
          "Inbox",
          <Inbox size={18} aria-hidden="true" />,
          inboxCount,
          false,
          tasks.inboxUrl,
        )}
        {link(
          "/tasks/today",
          "Today",
          <CalendarDays size={18} aria-hidden="true" />,
          dueToday.length,
          overdue,
        )}
        {link("/tasks/upcoming", "Upcoming", <CalendarRange size={18} aria-hidden="true" />)}
        {link("/tasks/completed", "Completed", <Check size={18} aria-hidden="true" />)}
      </ul>
      {labels.size > 0 && (
        <>
          <button
            type="button"
            className="tsk-nav-heading tsk-disclosure"
            aria-expanded={preferences.sidebar.labelsOpen}
            onClick={() => dispatch({ type: "sidebar", group: "labelsOpen" })}
          >
            {preferences.sidebar.labelsOpen ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
            Labels
          </button>
          {preferences.sidebar.labelsOpen && (
            <ul className="tsk-nav-list">
              {[...labels]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, categories]) => {
                  const href = `/tasks/l/${encodeURIComponent(name)}`;
                  const count = open.filter((task) =>
                    task.labelIds.some((id) => categories.some((category) => category.id === id)),
                  ).length;
                  return (
                    <li key={name} className="tsk-project-row">
                      <Link href={href} aria-current={path === href ? "page" : undefined}>
                        <LabelDot colour={labelColour(name, tasks.projects)} />
                        <span>@{categories[0]?.name}</span>
                        <span role="img" className="tsk-count" aria-label={`${count} open tasks`}>
                          {count}
                        </span>
                      </Link>
                      <LabelColourPicker name={categories[0]?.name ?? name} menu />
                    </li>
                  );
                })}
            </ul>
          )}
        </>
      )}
      <FiltersSection />
      {favourites.length > 0 && (
        <section aria-label="Favourites">
          <h2 className="tsk-nav-heading">Favourites</h2>
          <ul className="tsk-nav-list tsk-projects">
            {favourites.map((project) => (
              <ProjectRow
                key={project.url}
                project={project}
                shared={sharedUrls.has(project.url)}
                first={projects[0]?.url === project.url}
                last={projects.at(-1)?.url === project.url}
              />
            ))}
          </ul>
        </section>
      )}
      <button
        type="button"
        className="tsk-nav-heading tsk-disclosure"
        aria-expanded={preferences.sidebar.projectsOpen}
        onClick={() => dispatch({ type: "sidebar", group: "projectsOpen" })}
      >
        {preferences.sidebar.projectsOpen ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        Projects
      </button>
      {preferences.sidebar.projectsOpen && (
        <ul className="tsk-nav-list tsk-projects">
          {projects.map((project, index) => (
            <ProjectRow
              key={project.url}
              project={project}
              first={index === 0}
              last={index === projects.length - 1}
            />
          ))}
        </ul>
      )}
      {shared.length > 0 && (
        <>
          <h2 className="tsk-nav-heading">Shared with me</h2>
          <ul className="tsk-nav-list">
            {shared.map((project) => {
              const href = `/tasks/p/${encodeRef(project.url)}`;
              const loaded = tasks.projects.find((loaded) => loaded.url === project.url);
              if (loaded)
                return <ProjectRow key={project.url} project={loaded} first last shared />;
              const title = project.title;
              return (
                <li key={project.url} className="tsk-project-row">
                  <ProjectDot colour={undefined} />
                  <Link href={href} aria-current={path === href ? "page" : undefined}>
                    {title}
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        ref={(button) => {
                          if (button) sharedActionButtons.current.set(project.url, button);
                          else sharedActionButtons.current.delete(project.url);
                        }}
                        className="tsk-project-actions"
                        label={`Project actions for ${title}`}
                        variant="ghost"
                      >
                        <Ellipsis size={16} aria-hidden="true" />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {loaded && (
                        <DeleteCompletedMenuItem
                          project={loaded}
                          onSelect={() => setClearShared(loaded)}
                        />
                      )}
                      <DropdownMenuItem
                        onSelect={() => {
                          tasks.cache.forgetSharedProject(project.url);
                          dispatch({ type: "removeSharedProject", url: project.url });
                          if (path === href || path === `${href}/board`)
                            router.push("/tasks/inbox");
                        }}
                      >
                        Remove from Shared with me
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {clearShared && (
        <DeleteCompletedDialog
          project={clearShared}
          open
          onOpenChange={(open) => !open && setClearShared(undefined)}
          returnFocus={() => sharedActionButtons.current.get(clearShared.url)?.focus()}
        />
      )}
      <div className="tsk-sidebar-footer">
        <NewFilterButton />
        <TasksImportDialog />
        {creating ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              const title = name.trim();
              setCreating(false);
              setName("");
              void tasks.createProject(title).then((project) => {
                if (project) router.push(`/tasks/p/${encodeRef(project.url)}`);
              });
            }}
          >
            <Input
              ref={field}
              aria-label="New project name"
              placeholder="Project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setCreating(false);
                  setName("");
                }
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            className="tsk-ghost"
            onClick={() => {
              setCreating(true);
              requestAnimationFrame(() => field.current?.focus());
            }}
          >
            <Plus size={16} aria-hidden="true" />
            New project
          </button>
        )}
      </div>
    </nav>
  );
}
