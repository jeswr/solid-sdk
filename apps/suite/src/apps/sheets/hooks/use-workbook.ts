// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenedWorkbook, Snapshot } from "../lib/contract";
import { WorkbookNotFoundError } from "../lib/contract";
import { pendingSaves } from "../lib/pending-saves";
import { useWorkbookService } from "../state/service";

export function useWorkbook(container: string) {
  const service = useWorkbookService();
  const [workbook, setWorkbook] = useState<OpenedWorkbook | null>(null);
  const [error, setError] = useState<unknown>();
  const [status, setStatus] = useState<ReturnType<typeof pendingSaves.acquire>["status"]>("saved");
  const [attempt, setAttempt] = useState(0);
  const writer = useRef<ReturnType<typeof pendingSaves.acquire> | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries opening the workbook
  useEffect(() => {
    let live = true;
    let detach: (() => void) | undefined;
    writer.current = undefined;
    setWorkbook(null);
    setError(undefined);
    pendingSaves.connect(window, () => navigator.onLine);
    void service.open(container).then(
      (opened) => {
        if (!live) return;
        const pending = pendingSaves.get(container);
        if (opened.readOnly && pending) pending.reset({ ...pending.workbook, readOnly: true });
        const entry = pendingSaves.acquire(service, pending?.workbook ?? opened);
        writer.current = entry;
        const update = () => {
          setWorkbook(entry.workbook);
          setStatus(entry.status);
        };
        detach = entry.subscribe(update);
        update();
      },
      (failure: unknown) => {
        if (!live) return;
        if (failure instanceof WorkbookNotFoundError && failure.reason === "missing")
          pendingSaves.drop(container);
        setError(failure);
      },
    );
    const flush = () => {
      void writer.current?.flush();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", flush);
    return () => {
      live = false;
      detach?.();
      writer.current = undefined;
      pendingSaves.prune();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [container, service, attempt]);

  const scheduleSave = useCallback((read: () => Snapshot) => writer.current?.schedule(read), []);
  const reload = async () => {
    try {
      const opened = await service.open(container);
      writer.current?.reset(opened);
      return opened.snapshot;
    } catch (failure) {
      if (failure instanceof WorkbookNotFoundError) {
        if (failure.reason === "missing") pendingSaves.drop(container);
        setError(failure);
      }
      throw failure;
    }
  };
  return {
    workbook,
    readOnly: workbook?.readOnly === true,
    metadata: workbook?.metadata,
    version: workbook?.version,
    error,
    status,
    scheduleSave,
    rename: (title: string) => writer.current?.rename(title),
    reload,
    retry: (force = false) => writer.current?.retry(force),
    flush: () => writer.current?.flush(),
    discard: () => writer.current?.discard(),
    retryOpen: () => setAttempt((value) => value + 1),
  };
}
