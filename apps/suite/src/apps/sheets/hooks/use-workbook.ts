// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createAutosave, type SaveStatus } from "../lib/autosave";
import { type OpenedWorkbook, type Snapshot, WorkbookConflictError } from "../lib/contract";
import { useWorkbookService } from "../state/service";

export function useWorkbook(container: string) {
  const service = useWorkbookService();
  const [workbook, setWorkbook] = useState<OpenedWorkbook | null>(null);
  const [error, setError] = useState<unknown>();
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [attempt, setAttempt] = useState(0);
  const current = useRef<OpenedWorkbook | null>(null);
  const title = useRef("");
  const read = useRef<(() => Snapshot) | undefined>(undefined);
  const scheduler = useRef<ReturnType<typeof createAutosave<Snapshot>> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries opening the workbook
  useEffect(() => {
    let live = true;
    current.current = null;
    read.current = undefined;
    setWorkbook(null);
    setError(undefined);
    const update = (opened: OpenedWorkbook) => {
      current.current = opened;
      if (live) setWorkbook({ ...opened, metadata: { ...opened.metadata, title: title.current } });
    };
    const queue = createAutosave<Snapshot>({
      online: navigator.onLine,
      onStatus: (next) => live && setStatus(next),
      isConflict: (failure) => failure instanceof WorkbookConflictError,
      async save(snapshot, force) {
        let opened = current.current;
        if (!opened) throw new Error("Spreadsheet has not opened yet");
        const desiredTitle = title.current;
        // Rename and snapshot writes share this one writer and its latest opaque version.
        if (!force && opened.metadata.title !== desiredTitle) {
          const renamed = await service.rename(container, desiredTitle, opened.version);
          opened = { ...opened, ...renamed };
          update(opened);
        }
        const result = await service.save(container, snapshot, opened.version, {
          force,
          title: desiredTitle,
        });
        update({ ...opened, ...result, snapshot });
      },
    });
    scheduler.current = queue;
    void service.open(container).then(
      (opened) => {
        if (!live) return;
        title.current = opened.metadata.title;
        update(opened);
        queue.setOnline(navigator.onLine);
      },
      (failure: unknown) => live && setError(failure),
    );
    const flush = () => {
      void queue.flush();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const online = () => queue.setOnline(true);
    const offline = () => queue.setOnline(false);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      // Captures queued getters synchronously, before the engine's cleanup disposes it.
      flush();
      live = false;
      if (scheduler.current === queue) scheduler.current = null;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [container, service, attempt]);

  const scheduleSave = useCallback((getSnapshot: () => Snapshot) => {
    read.current = getSnapshot;
    scheduler.current?.schedule(getSnapshot);
  }, []);
  const rename = (next: string) => {
    title.current = next.trim();
    setWorkbook(
      (opened) => opened && { ...opened, metadata: { ...opened.metadata, title: title.current } },
    );
    const getSnapshot =
      read.current ??
      (() => {
        if (!current.current) throw new Error("Spreadsheet has not opened yet");
        return current.current.snapshot;
      });
    scheduler.current?.schedule(getSnapshot);
    void scheduler.current?.flush();
  };
  const reload = async () => {
    const opened = await service.open(container);
    scheduler.current?.reset();
    current.current = opened;
    title.current = opened.metadata.title;
    read.current = undefined;
    setWorkbook(opened);
    return opened.snapshot;
  };
  return {
    workbook,
    metadata: workbook?.metadata,
    version: workbook?.version,
    error,
    status,
    scheduleSave,
    rename,
    reload,
    retry: (force = false) => scheduler.current?.retry(force),
    flush: () => scheduler.current?.flush(),
    discard: () => scheduler.current?.reset(),
    retryOpen: () => setAttempt((value) => value + 1),
  };
}
