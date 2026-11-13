// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenedWorkbook, Snapshot, SnapshotSaved } from "../lib/contract";
import { WorkbookNotFoundError } from "../lib/contract";
import { pendingSaves } from "../lib/pending-saves";
import { directChild } from "../lib/workbook/layout";
import { useWorkbookService } from "../state/service";

export function useWorkbook(container: string) {
  const service = useWorkbookService();
  const [workbook, setWorkbook] = useState<OpenedWorkbook | null>(null);
  const [error, setError] = useState<unknown>();
  const [status, setStatus] = useState<ReturnType<typeof pendingSaves.acquire>["status"]>("saved");
  const [attempt, setAttempt] = useState(0);
  const writer = useRef<ReturnType<typeof pendingSaves.acquire> | undefined>(undefined);
  const own = container.startsWith(service.root) && directChild(service.root, container);
  const open = useCallback(async () => {
    return {
      opened: await (own ? service.open(container) : service.openShared(container)),
      shared: !own,
    };
  }, [container, service, own]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries opening the workbook
  useEffect(() => {
    let live = true;
    let detach: (() => void) | undefined;
    writer.current = undefined;
    setWorkbook(null);
    setError(undefined);
    pendingSaves.connect(window, () => navigator.onLine);
    void open().then(
      ({ opened, shared }) => {
        if (!live) return;
        // Shared links have no writer and never consume another account's pending edits.
        if (shared) {
          setWorkbook(opened);
          setStatus("saved");
          return;
        }
        const pending = pendingSaves.get(container);
        pending?.setReadOnly(opened.readOnly === true);
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
        if (failure instanceof WorkbookNotFoundError && failure.reason === "missing" && own)
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
  }, [container, service, open, own, attempt]);

  const scheduleSave = useCallback((read: () => Snapshot) => writer.current?.schedule(read), []);
  const onSaved = useCallback((listener: SnapshotSaved) => writer.current?.onSaved(listener), []);
  const reload = async (loaded?: SnapshotSaved) => {
    try {
      const { opened, shared } = await open();
      loaded?.(opened.snapshot, opened.version.snapshotEtag);
      if (shared) setWorkbook(opened);
      else writer.current?.reset(opened);
      return opened.snapshot;
    } catch (failure) {
      if (failure instanceof WorkbookNotFoundError) {
        if (failure.reason === "missing" && own) pendingSaves.drop(container);
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
    onSaved,
    rename: (title: string) => writer.current?.rename(title),
    reload,
    restore: async (snapshot: Snapshot, loaded?: SnapshotSaved) => {
      if (!writer.current || writer.current.workbook.readOnly)
        throw new Error("Write access required");
      await writer.current.restore(snapshot);
      await reload(loaded);
    },
    retry: (force = false) => writer.current?.retry(force),
    flush: () => writer.current?.flush(),
    discard: () => writer.current?.discard(),
    retryOpen: () => setAttempt((value) => value + 1),
  };
}
