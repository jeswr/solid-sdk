// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { createAutosave } from "./autosave";
import {
  type OpenedWorkbook,
  type Snapshot,
  type SnapshotSaved,
  WorkbookConflictError,
  WorkbookPartialSaveError,
  type WorkbookService,
} from "./contract";

/** Application-lifetime writers. Browser events and I/O enter through injected seams. */
export function createPendingSaves() {
  const entries = new Map<string, ReturnType<typeof createEntry>>();
  let disconnect: (() => void) | undefined;
  let online = true;

  function prune() {
    if (entries.size === 0) {
      disconnect?.();
      disconnect = undefined;
    }
  }

  function createEntry(service: WorkbookService, initial: OpenedWorkbook) {
    let opened = initial;
    let title = initial.metadata.title;
    let storedTitle = title;
    let dropped = false;
    let snapshotCurrent = false;
    let local = initial.snapshot;
    let read = () => local;
    const savedListeners = new Set<SnapshotSaved>();
    const acknowledge = (snapshot: Snapshot, revision: string) => {
      for (const listener of savedListeners) listener(snapshot, revision);
    };
    const listeners = new Set<() => void>();
    const publish = () => {
      for (const listener of listeners) listener();
    };
    const releaseIdle = () => {
      if (!dropped && listeners.size === 0 && !queue.dirty) {
        entries.delete(initial.container);
        prune();
      }
    };
    const queue = createAutosave<Snapshot>({
      online,
      onStatus: publish,
      isConflict: (error) => error instanceof WorkbookConflictError,
      async save(snapshot, force) {
        if (dropped) return;
        const savingTitle = title;
        const verifying = opened.version.pendingVerification;
        try {
          const result = await service.save(initial.container, snapshot, opened.version, {
            force,
            ...(snapshotCurrent ? { snapshotCurrent: true } : {}),
            ...(savingTitle === storedTitle ? {} : { title: savingTitle }),
          });
          if (dropped) return;
          snapshotCurrent = false;
          opened = { ...opened, ...result, snapshot };
          acknowledge(snapshot, result.version.snapshotEtag);
          storedTitle = result.metadata.title;
          if (title === savingTitle) title = storedTitle;
        } catch (error) {
          if (dropped) return;
          for (let cause = error; cause instanceof Error; cause = cause.cause) {
            if ("status" in cause && cause.status === 403) opened = { ...opened, readOnly: true };
          }
          if (error instanceof WorkbookPartialSaveError) {
            opened = { ...opened, version: error.version };
            // Verification failures can carry a previous write's ETag. Only a
            // confirmed snapshot write in this attempt acknowledges this value.
            if (!verifying && !error.version.pendingVerification?.snapshot)
              acknowledge(snapshot, error.version.snapshotEtag);
          }
          throw error;
        }
      },
    });
    const flush = () => (opened.readOnly ? Promise.resolve() : queue.flush()).then(releaseIdle);
    const schedule = (next: () => Snapshot) => {
      if (opened.readOnly) return;
      read = next;
      queue.schedule(() => {
        local = read();
        return local;
      });
    };
    return {
      get workbook(): OpenedWorkbook {
        return { ...opened, snapshot: local, metadata: { ...opened.metadata, title } };
      },
      get status() {
        return queue.status;
      },
      get dirty() {
        return queue.dirty;
      },
      onSaved(listener: SnapshotSaved) {
        savedListeners.add(listener);
        return () => savedListeners.delete(listener);
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          // Capture now, while the engine still exists. The writer outlives its subscriber.
          listeners.delete(listener);
          void flush();
          read = () => local;
        };
      },
      schedule,
      async restore(snapshot: Snapshot) {
        await flush();
        if (opened.readOnly || queue.status !== "saved")
          throw new Error("Save your changes online before restoring a version");
        snapshotCurrent = true;
        schedule(() => snapshot);
        await flush();
        if (queue.status !== "saved") throw new Error("Could not restore this version");
      },
      setReadOnly(readOnly = true) {
        if (!readOnly && !opened.readOnly) return;
        opened = { ...opened, readOnly };
        // Stop timers and capture the engine getter without discarding its pending edit.
        // Restored Write resumes with the registry's current connectivity.
        queue.setOnline(readOnly ? false : online);
        if (readOnly) void queue.flush();
      },
      rename(next: string) {
        if (opened.readOnly) return;
        title = next.trim();
        // flush() captures any pending engine getter before writing the rename.
        schedule(read);
        publish();
        void flush();
      },
      reset(next: OpenedWorkbook) {
        snapshotCurrent = false;
        opened = next;
        title = next.metadata.title;
        storedTitle = title;
        local = next.snapshot;
        read = () => local;
        queue.reset();
        releaseIdle();
      },
      discard() {
        snapshotCurrent = false;
        queue.reset();
        releaseIdle();
      },
      drop() {
        dropped = true;
        queue.reset();
        listeners.clear();
        savedListeners.clear();
      },
      flush,
      retry: (force = false) =>
        (opened.readOnly ? Promise.resolve() : queue.retry(force)).then(releaseIdle),
      setOnline(value: boolean) {
        if (opened.readOnly) return;
        queue.setOnline(value);
        void flush();
      },
    };
  }

  return {
    get: (container: string) => entries.get(container),
    drop(container: string) {
      entries.get(container)?.drop();
      entries.delete(container);
      prune();
    },
    acquire(service: WorkbookService, opened: OpenedWorkbook) {
      let entry = entries.get(opened.container);
      if (!entry) {
        entry = createEntry(service, opened);
        entries.set(opened.container, entry);
      }
      return entry;
    },
    /** Listeners remain installed while any detached edit needs saving. */
    connect(
      target: Pick<Window, "addEventListener" | "removeEventListener">,
      isOnline: () => boolean,
    ) {
      if (disconnect) return;
      online = isOnline();
      const connectivity = () => {
        online = isOnline();
        for (const entry of entries.values()) entry.setOnline(online);
      };
      const beforeUnload = (event: BeforeUnloadEvent) => {
        if (![...entries.values()].some((entry) => entry.dirty)) return;
        event.preventDefault();
        event.returnValue = "";
      };
      target.addEventListener("online", connectivity);
      target.addEventListener("offline", connectivity);
      target.addEventListener("beforeunload", beforeUnload);
      disconnect = () => {
        target.removeEventListener("online", connectivity);
        target.removeEventListener("offline", connectivity);
        target.removeEventListener("beforeunload", beforeUnload);
      };
    },
    prune,
  };
}

export const pendingSaves = createPendingSaves();
