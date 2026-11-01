// AUTHORED-BY Codex GPT-6
import { createAutosave } from "./autosave";
import {
  type OpenedWorkbook,
  type Snapshot,
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
    let local = initial.snapshot;
    let read = () => local;
    const listeners = new Set<() => void>();
    const publish = () => {
      for (const listener of listeners) listener();
    };
    const releaseIdle = () => {
      if (listeners.size === 0 && !queue.dirty) {
        entries.delete(initial.container);
        prune();
      }
    };
    const queue = createAutosave<Snapshot>({
      online,
      onStatus: publish,
      isConflict: (error) => error instanceof WorkbookConflictError,
      async save(snapshot, force) {
        try {
          const result = await service.save(initial.container, snapshot, opened.version, {
            force,
            title,
          });
          opened = { ...opened, ...result, snapshot };
        } catch (error) {
          if (error instanceof WorkbookPartialSaveError)
            opened = { ...opened, version: error.version };
          throw error;
        }
      },
    });
    const flush = () => queue.flush().then(releaseIdle);
    const schedule = (next: () => Snapshot) => {
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
      rename(next: string) {
        title = next.trim();
        // flush() captures any pending engine getter before writing the rename.
        schedule(read);
        publish();
        void flush();
      },
      reset(next: OpenedWorkbook) {
        opened = next;
        title = next.metadata.title;
        local = next.snapshot;
        read = () => local;
        queue.reset();
        releaseIdle();
      },
      discard() {
        queue.reset();
        releaseIdle();
      },
      flush,
      retry: (force = false) => queue.retry(force).then(releaseIdle),
      setOnline(value: boolean) {
        queue.setOnline(value);
        void flush();
      },
    };
  }

  return {
    get: (container: string) => entries.get(container),
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
