// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { decodeRef, encodeRef } from "@/lib/refs";
import { useRouteParams, useRoutePathname } from "@/lib/route-params";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { parseQuickAdd } from "../lib/compose/quick-add";
import { classifyError } from "../lib/model/errors";
import { replaceQuery } from "../lib/route/replace-query";
import { savedFilters } from "../lib/views/filter-query";
import { isEditing, openAddTask } from "../state/add-focus";
import { useTasksPreferences } from "../state/preferences";
import { useReminderScheduler } from "../state/reminders";
import { TasksProvider, useTasks } from "../state/tasks-context";
import { Composer } from "./composer/composer";
import { TaskDetail } from "./detail/task-detail";
import { TasksDnd } from "./dnd/tasks-dnd";
import "./detail/detail.css";
import { ShareProject } from "./share-project";
import { TasksSidebar } from "./sidebar";
import { SortMenu } from "./sort-menu";
import { ViewToggle } from "./view-toggle";

const VIEW_NAMES: Readonly<Record<string, string>> = {
  "/tasks/inbox": "Inbox",
  "/tasks/today": "Today",
  "/tasks/upcoming": "Upcoming",
  "/tasks/completed": "Completed",
};

function TasksChrome({ children }: { children: ReactNode }) {
  const tasks = useTasks();
  const { preferences, dispatch } = useTasksPreferences();
  const [sharing, setSharing] = useState(false);
  const pathname = useRoutePathname();
  // Smart views have fixed grouping/order; only project lists consume the sort preference.
  const supportsSort = pathname === "/tasks/inbox" || /^\/tasks\/p\/[^/]+$/.test(pathname);
  const params = useSearchParams();
  const label = useRouteParams<{ label: string }>("/tasks/l/[label]")?.label;
  const listRef = useRouteParams<{ ref: string }>("/tasks/p/[ref]")?.ref;
  const boardRef = useRouteParams<{ ref: string }>("/tasks/p/[ref]/board")?.ref;
  const ref = listRef ?? boardRef;
  const router = useRouter();
  const [quickAdd, setQuickAdd] = useState(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const title =
    VIEW_NAMES[pathname] ??
    savedFilters(
      tasks.projects.find((project) => project.url === tasks.inboxUrl)?.tracker.savedViews ?? [],
    ).find((filter) => pathname === `/tasks/filters/${filter.iri.split("#view-")[1]}`)?.name ??
    (typeof label === "string"
      ? `@${label}`
      : ref
        ? (tasks.projects.find((project) => encodeRef(project.url) === ref)?.tracker.title ??
          preferences.sharedProjects.find((shared) => encodeRef(shared.url) === ref)?.title ??
          "Project")
        : "Tasks");
  let projectUrl: string | undefined;
  try {
    if (typeof ref === "string") projectUrl = decodeRef(ref);
  } catch {
    /* The project route renders its own not-found state. */
  }
  const activeProject = tasks.projects.find((project) => project.url === projectUrl);
  const projectLoad = projectUrl ? tasks.tasks[projectUrl] : undefined;
  // Navigating to a project may reopen one removed from Shared with me; a re-render on the
  // same route may not, so a project removed while it is showing stays removed.
  useEffect(() => {
    if (projectUrl) tasks.cache.allowSharedProject(projectUrl);
  }, [projectUrl, tasks.cache]);
  useEffect(() => {
    if (projectUrl && tasks.status === "ready" && !activeProject && !projectLoad)
      void tasks.cache.openProject(projectUrl);
  }, [projectUrl, activeProject, projectLoad, tasks.status, tasks.cache]);
  useEffect(() => {
    if (
      activeProject &&
      !tasks.cache.isOwnProject(activeProject.url) &&
      tasks.cache.hasSharedProject(activeProject.url)
    )
      dispatch({
        type: "sharedProject",
        url: activeProject.url,
        title: activeProject.tracker.title ?? "Project",
      });
  }, [activeProject, tasks.cache, dispatch]);
  const taskRef = params.get("task");
  let taskUrl: string | undefined;
  try {
    if (taskRef !== null) taskUrl = decodeRef(taskRef);
  } catch {
    /* Show not found inside details. */
  }
  // The persistent route owner handles initial moves and retries using current selection.
  // A detail may unmount optimistically or be closed while the write is still in flight.
  useLayoutEffect(
    () =>
      tasks.cache.subscribeTaskMoves(({ from, to }) => {
        if (taskUrl !== from) return;
        const query = new URLSearchParams(params.toString());
        query.set("task", encodeRef(to));
        replaceQuery(pathname, query);
      }),
    [tasks.cache, taskUrl, params, pathname],
  );
  // Reminder notifications and toasts open the same `?task=` detail pane as a task row.
  useReminderScheduler(tasks.cache, (url) => {
    const query = new URLSearchParams(params.toString());
    query.set("task", encodeRef(url));
    router.push(`${pathname}?${query}`, { scroll: false });
  });
  const origin = useRef<string | undefined>(undefined);
  const returnTo = useRef<string | undefined>(undefined);
  // A narrow-viewport details Sheet restores focus itself once it unmounts; point it at the
  // originating row (06-tasks §2.8) rather than the link that opened it, which re-renders.
  const detailsReturnFocus = useMemo(
    () => ({
      get current() {
        const url = origin.current ?? returnTo.current;
        return url
          ? document.querySelector<HTMLElement>(`[data-task-url="${CSS.escape(url)}"]`)
          : null;
      },
    }),
    [],
  );
  useEffect(() => {
    // A new pane must not fall back to a row from an earlier, already closed pane.
    if (taskRef !== null) returnTo.current = undefined;
    if (taskRef !== null && origin.current === undefined) {
      const row = document.activeElement?.closest<HTMLElement>("[data-task-url]");
      origin.current = row?.dataset.taskUrl ?? taskUrl;
    }
    if (taskRef === null && origin.current) {
      const url = origin.current;
      returnTo.current = url;
      origin.current = undefined;
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(`[data-task-url="${CSS.escape(url)}"]`)?.focus(),
        ),
      );
    }
  }, [taskRef, taskUrl]);
  const closeDetails = useCallback(() => {
    // A Sheet dismisses on document capture, before a TagInput can consume Escape.
    if (document.querySelector('.tsk-detail input[role="combobox"][aria-expanded="true"]')) return;
    // The sub-task composer consumes Escape to collapse its own row first.
    if (document.activeElement?.matches('.tsk-detail input[aria-label="Sub-task title"]')) return;
    if (
      document.activeElement?.closest(
        ".tsk-detail [data-tsk-attachment-form], .tsk-detail [data-tsk-comment-form]",
      )
    )
      return;
    const query = new URLSearchParams(params.toString());
    query.delete("task");
    // A shared link's pane must close after a hard load too (see replaceQuery).
    replaceQuery(pathname, query);
  }, [params, pathname]);
  useEffect(() => {
    if (taskRef === null) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector(
          '[data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="select-content"]',
        )
      )
        return;
      if (document.querySelector('.tsk-detail [role="combobox"][aria-expanded="true"]')) return;
      event.preventDefault();
      closeDetails();
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [taskRef, closeDetails]);
  const selectedProject = tasks.projects.find((project) =>
    tasks.tasks[project.url]?.items.some((item) => item.url === taskUrl),
  );
  const selected =
    selectedProject && tasks.tasks[selectedProject.url]?.items.find((item) => item.url === taskUrl);
  const loading =
    taskUrl &&
    (tasks.status === "loading" ||
      tasks.saving.includes(taskUrl) ||
      tasks.projects.some(
        (project) => !tasks.tasks[project.url] || tasks.tasks[project.url]?.status === "loading",
      ));
  const details =
    taskRef !== null ? (
      selected && selectedProject ? (
        <TaskDetail
          key={selected.url}
          stored={selected}
          project={selectedProject}
          onClose={closeDetails}
        />
      ) : loading ? (
        <div className="tsk-detail">
          <LoadingSkeleton preset="list" />
        </div>
      ) : (
        <section className="tsk-detail" aria-labelledby="tsk-not-found-heading">
          <h2 className="sr-only" id="tsk-not-found-heading">
            Task details
          </h2>
          <ErrorState error="not-found">
            <Button onClick={closeDetails}>Close</Button>
          </ErrorState>
        </section>
      )
    ) : undefined;
  useEffect(() => {
    const open = () => {
      restoreFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuickAdd(true);
    };
    addEventListener("tasks:quick-add", open);
    return () => removeEventListener("tasks:quick-add", open);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigation closes the overlay.
  useEffect(() => {
    setQuickAdd(false);
  }, [pathname]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isEditing(event.target) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.key !== "q" && event.key !== "c")
      )
        return;
      event.preventDefault();
      openAddTask();
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, []);
  const inbox = tasks.projects.find((project) => project.url === tasks.inboxUrl);
  return (
    <TasksDnd>
      <SuiteFrame
        app="tasks"
        sidebar={<TasksSidebar />}
        context={<span className="tsk-context-title">{title}</span>}
        actions={
          supportsSort || projectUrl ? (
            <>
              {activeProject && tasks.sharingAvailable && (
                <Button variant="outline" onClick={() => setSharing(true)}>
                  Share
                </Button>
              )}
              {supportsSort && <SortMenu viewId={pathname} />}
              {projectUrl && (
                <ViewToggle
                  projectUrl={projectUrl}
                  mode={pathname.endsWith("/board") ? "board" : "list"}
                />
              )}
            </>
          ) : undefined
        }
        details={details}
        detailsReturnFocus={detailsReturnFocus}
        onDetailsClose={closeDetails}
      >
        {sharing && activeProject && (
          <ShareProject project={activeProject} onClose={() => setSharing(false)} />
        )}
        {quickAdd && inbox && (
          <Composer
            modal
            project={inbox}
            due={
              pathname === "/tasks/today"
                ? parseQuickAdd("today", {
                    now: new Date(),
                    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    projects: [],
                    labels: [],
                  }).due
                : undefined
            }
            onClose={() => {
              setQuickAdd(false);
              requestAnimationFrame(() => restoreFocus.current?.focus());
            }}
          />
        )}
        <div data-tsk-task-ref={taskRef ?? undefined}>
          {tasks.status === "error" ? (
            <div className="tsk-content">
              <h1>Tasks</h1>
              <ErrorState error={classifyError(tasks.error)} actions={{ retry: tasks.retry }} />
            </div>
          ) : (
            children
          )}
        </div>
      </SuiteFrame>
    </TasksDnd>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="tsk-boot" role="status">
        Opening your Tasks…
      </div>
    );
  // Native builds start signed out until native sign-in lands.
  if (state.status === "signed-out")
    return (
      <div className="tsk-boot">
        <h1>Tasks</h1>
        <p role="status">Sign in to open your Tasks</p>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="tsk-boot">
        <h1>Can't open your Tasks</h1>
        <ErrorState error="unknown" actions={{ retry: () => location.reload() }} />
      </div>
    );
  return (
    <TasksProvider key={state.session.webId} session={state.session}>
      <TasksChrome>{children}</TasksChrome>
    </TasksProvider>
  );
}
export function TasksApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <Suspense
        fallback={
          <div className="tsk-boot" role="status">
            Opening your Tasks…
          </div>
        }
      >
        <SessionGate>{children}</SessionGate>
      </Suspense>
      <Toaster className="toaster group tsk-toaster" position="bottom-center" />
    </PodSessionProvider>
  );
}
