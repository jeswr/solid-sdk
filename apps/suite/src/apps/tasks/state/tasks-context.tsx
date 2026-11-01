// AUTHORED-BY Codex GPT-6
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { classifyError } from "../lib/model/errors";
import { TaskStore } from "../lib/model/store";
import { toTaskView } from "../lib/views/types";
import { ensurePrivateIndexAccess, ensurePrivateTasksAccess } from "./access";
import { TasksCache } from "./tasks-cache";

export type { NewTask, TaskLoad, TasksSnapshot } from "./tasks-cache";
export type TasksContextValue = ReturnType<typeof useTasksValue>;
const TasksContext = createContext<TasksContextValue | null>(null);
function useTasksValue(session: PodSession) {
  const [cache] = useState(
    () =>
      new TasksCache(
        new TaskStore({
          storage: session.storageUrl,
          webId: session.webId,
          fetch: session.fetch,
          ensurePrivateTasksAccess: (url, owner) => ensurePrivateTasksAccess(session, url, owner),
          ensurePrivateIndexAccess: (url, owner) => ensurePrivateIndexAccess(session, url, owner),
        }),
        (error, retry) => {
          toast.error(
            classifyError(error) === "conflict"
              ? "Changed elsewhere — refreshed"
              : error instanceof Error
                ? error.message
                : "Couldn't save your changes",
            { action: { label: "Retry", onClick: retry } },
          );
        },
        session.webId,
      ),
  );
  const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  useEffect(() => {
    void cache.start();
  }, [cache]);
  useEffect(() => {
    const urls = new Set<string>();
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = session.subscribe((url) => {
      urls.add(url);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const changed = [...urls];
        urls.clear();
        for (const target of changed) void cache.invalidate(target);
      }, 150);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [cache, session]);
  // Defer sidebar counts until after the frame has painted. A failed project stays isolated.
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const project of snapshot.projects) void cache.loadTasks(project);
    }, 0);
    return () => clearTimeout(timer);
  }, [cache, snapshot.projects]);
  return useMemo(
    () => ({
      ...snapshot,
      cache,
      webId: session.webId,
      inboxUrl: cache.inboxUrl,
      views: snapshot.projects.flatMap((project) =>
        (snapshot.tasks[project.url]?.items ?? []).map((task) => toTaskView(task, project)),
      ),
      loadTasks: cache.loadTasks.bind(cache),
      retry: cache.retry,
      createTask: cache.createTask.bind(cache),
      updateTask: cache.updateTask.bind(cache),
      updateProject: cache.updateProject.bind(cache),
      moveTaskToProject: cache.moveTaskToProject.bind(cache),
      deleteTask: cache.deleteTask.bind(cache),
      createProject: cache.createProject.bind(cache),
      renameProject: cache.renameProject,
      archiveProject: cache.archiveProject,
      deleteProject: cache.deleteProject.bind(cache),
      moveProject: cache.moveProject.bind(cache),
      addSection: cache.addSection,
      renameSection: cache.renameSection,
      moveSection: cache.moveSection.bind(cache),
      deleteSection: cache.deleteSection.bind(cache),
    }),
    [snapshot, cache, session.webId],
  );
}
/** Small session-scoped API: projects, URL-keyed loads, TaskView projections and conditional mutations.
 * Mutations resolve undefined after rollback + a retry toast. Consumers retain StoredTask validators. */
export function TasksProvider({ session, children }: { session: PodSession; children: ReactNode }) {
  const value = useTasksValue(session);
  return <TasksContext value={value}>{children}</TasksContext>;
}
export function useTasks(): TasksContextValue {
  const context = useContext(TasksContext);
  if (!context) throw new Error("useTasks must be used within TasksProvider");
  return context;
}
