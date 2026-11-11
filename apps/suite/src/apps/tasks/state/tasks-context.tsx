// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { classifyError } from "../lib/model/errors";
import { type StoredProject, TaskStore } from "../lib/model/store";
import { TasksSharingAdapter } from "../lib/share/adapter";
import { ensurePrivateIndexAccess, ensurePrivateTasksAccess, supportsTasksSharing } from "./access";
import { pendingDeletes } from "./actions";
import { completionVisuals } from "./completion-visuals";
import {
  setPreferencesIdentity,
  subscribeSharedProjectRemoval,
  useTasksPreferences,
} from "./preferences";
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
        (message) => toast.info(message),
      ),
  );
  const { preferences } = useTasksPreferences();
  useLayoutEffect(() => {
    setPreferencesIdentity(session.webId);
    return () => setPreferencesIdentity(undefined);
  }, [session.webId]);
  useEffect(() => {
    // Only this account's list: never another WebID's, even for the render that switches.
    if (preferences.sharedOwner !== session.webId) return;
    void cache.setSharedProjects(preferences.sharedProjects);
  }, [cache, preferences.sharedProjects, preferences.sharedOwner, session.webId]);
  useEffect(
    () =>
      subscribeSharedProjectRemoval((owner, url) => {
        if (owner === session.webId && !cache.isOwnProject(url)) cache.forgetSharedProject(url);
      }),
    [cache, session.webId],
  );
  const sharing = useMemo(() => new Map<string, TasksSharingAdapter>(), []);
  const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot);
  useEffect(() => {
    const flush = () => {
      completionVisuals(cache).flush();
      pendingDeletes(cache).flush();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [cache]);
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
      storageUrl: session.storageUrl,
      sharingAvailable: supportsTasksSharing(session),
      shareAdapter: (project: StoredProject) => {
        const key = `${project.url} ${project.tracker.stateStore}`;
        let adapter = sharing.get(key);
        if (!adapter) {
          adapter = new TasksSharingAdapter({
            fetch: session.fetch,
            webId: session.webId,
            trackerUrl: project.url,
            folderUrl: project.url.replace(/\.ttl$/, "/"),
            projectsContainer: cache.isOwnProject(project.url) ? cache.store.projects : undefined,
            ensurePrivate: (url, owner) => ensurePrivateTasksAccess(session, url, owner),
            syncMembers: async (webId, granted) => {
              if (!(await cache.syncProjectMember(project, webId, granted, { silent: true })))
                throw new Error("Couldn't update project members");
            },
          });
          sharing.set(key, adapter);
        }
        return adapter;
      },
      inboxUrl: cache.inboxUrl,
      loadTasks: cache.loadTasks.bind(cache),
      retry: cache.retry,
      createTask: cache.createTask.bind(cache),
      updateTask: cache.updateTask.bind(cache),
      updateProject: cache.updateProject.bind(cache),
      moveTaskToProject: cache.moveTaskToProject.bind(cache),
      deleteTask: cache.deleteTask.bind(cache),
      createProject: cache.createProject.bind(cache),
      ensureLabels: cache.ensureLabels.bind(cache),
      renameProject: cache.renameProject,
      archiveProject: cache.archiveProject,
      deleteProject: cache.deleteProject.bind(cache),
      moveProject: cache.moveProject.bind(cache),
      addSection: cache.addSection,
      renameSection: cache.renameSection,
      moveSection: cache.moveSection.bind(cache),
      deleteSection: cache.deleteSection.bind(cache),
    }),
    [snapshot, cache, session, sharing],
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
