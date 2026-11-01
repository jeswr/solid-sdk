// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { ErrorState, Toaster } from "@jeswr/suite-ui";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { encodeRef } from "@/lib/refs";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { parseQuickAdd } from "../lib/compose/quick-add";
import { classifyError } from "../lib/model/errors";
import { isEditing, openAddTask } from "../state/add-focus";
import { TasksProvider, useTasks } from "../state/tasks-context";
import { Composer } from "./composer/composer";
import { TasksSidebar } from "./sidebar";
import { SortMenu } from "./sort-menu";

const VIEW_NAMES: Readonly<Record<string, string>> = {
  "/tasks/inbox": "Inbox",
  "/tasks/today": "Today",
  "/tasks/upcoming": "Upcoming",
  "/tasks/completed": "Completed",
};

function TasksChrome({ children }: { children: ReactNode }) {
  const tasks = useTasks();
  const pathname = usePathname();
  const params = useSearchParams();
  const route = useParams();
  const [quickAdd, setQuickAdd] = useState(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const title =
    VIEW_NAMES[pathname] ??
    (typeof route.label === "string"
      ? `@${route.label}`
      : route.ref
        ? (tasks.projects.find((project) => encodeRef(project.url) === route.ref)?.tracker.title ??
          "Project")
        : "Tasks");
  // TSK-04 replaces this empty details slot using the resource reference.
  const taskRef = params.get("task");
  const details = undefined;
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
    <SuiteFrame
      app="tasks"
      sidebar={<TasksSidebar />}
      context={<span className="tsk-context-title">{title}</span>}
      actions={
        <SortMenu
          viewId={pathname}
          defaultSort={
            pathname === "/tasks/today" || pathname === "/tasks/upcoming" ? "due" : "manual"
          }
        />
      }
      details={details}
    >
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
