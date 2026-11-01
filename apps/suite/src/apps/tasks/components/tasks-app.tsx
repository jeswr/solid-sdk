// AUTHORED-BY Codex GPT-6
"use client";
import { ErrorState, Toaster } from "@jeswr/suite-ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { classifyError } from "../lib/model/errors";
import { focusAddTask, isEditing } from "../state/add-focus";
import { TasksProvider, useTasks } from "../state/tasks-context";
import { TasksSidebar } from "./sidebar";
import { SortMenu } from "./sort-menu";

function TasksChrome({ children }: { children: ReactNode }) {
  const tasks = useTasks();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  // TSK-04 replaces this empty details slot using the resource reference.
  const taskRef = params.get("task");
  const details = undefined;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isEditing(event.target) ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.key !== "q"
      )
        return;
      event.preventDefault();
      if (!focusAddTask()) router.push("/tasks/inbox?add=1");
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [router]);
  return (
    <SuiteFrame
      app="tasks"
      sidebar={<TasksSidebar />}
      context={<span>Tasks</span>}
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
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
