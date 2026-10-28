// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/**
 * The upload queue behind the upload dock (04-drive §2.6): up to three files
 * upload at once; a name clash pauses that file until the user picks
 * keep both / replace / skip (optionally for every remaining clash).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { DriveClient, DriveItem } from "../lib/client/client";
import { DriveError, parentOf } from "../lib/client/client";
import { type ConflictChoice, childUrl, uploadFile } from "../lib/operations/operations";
import { normalizeUploadName } from "../lib/upload";
import type { DroppedFile } from "./dropped-files";

export type UploadStatus = "queued" | "uploading" | "done" | "conflict" | "failed" | "skipped";

export interface UploadTask {
  readonly id: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly status: UploadStatus;
  readonly url?: string;
  readonly error?: string;
}

export interface UploadQueue {
  readonly tasks: readonly UploadTask[];
  enqueue(folder: string, files: Iterable<File | DroppedFile>): void;
  resolve(id: string, choice: ConflictChoice, applyToAll?: boolean): void;
  retry(id: string): void;
  cancel(id: string): void;
  clear(): void;
}

const CONCURRENCY = 3;

/**
 * Folder uploads keep their structure: `a/b/c.txt` lands in `<folder>a/b/`.
 * Solid servers create the intermediate containers on the file's PUT.
 */
export function targetFolder(folder: string, source: File | DroppedFile): string {
  const path = "path" in source ? source.path : source.webkitRelativePath;
  const segments = (path || "").split("/").slice(0, -1);
  return segments.reduce(
    (url, segment) => `${url}${encodeURIComponent(normalizeUploadName(segment, "folder"))}/`,
    folder,
  );
}

interface Job {
  task: UploadTask;
  file: File;
  root: string;
  policy: "fail" | ConflictChoice;
  target: DriveItem | undefined;
}

function describe(error: unknown): string {
  if (error instanceof DriveError) {
    if (error.kind === "forbidden") return "You don't have permission to upload here";
    if (error.kind === "unauthenticated") return "Sign in again to upload";
  }
  return "Upload failed";
}

export function useUploadQueue(
  client: DriveClient,
  invalidate: (url: string) => void,
): UploadQueue {
  const jobs = useRef(new Map<string, Job>());
  const running = useRef(0);
  const blanket = useRef<ConflictChoice | undefined>(undefined);
  const [tasks, setTasks] = useState<UploadTask[]>([]);

  const publish = useCallback(
    () => setTasks([...jobs.current.values()].map((job) => job.task)),
    [],
  );
  const patch = useCallback(
    (id: string, change: Partial<UploadTask>) => {
      const job = jobs.current.get(id);
      if (!job) return;
      job.task = { ...job.task, ...change };
      publish();
    },
    [publish],
  );

  const pump = useCallback(() => {
    for (const job of jobs.current.values()) {
      if (running.current >= CONCURRENCY) return;
      if (job.task.status !== "queued") continue;
      running.current += 1;
      const { id } = job.task;
      patch(id, { status: "uploading" });
      uploadFile(client, job.task.folder, job.file, job.task.name, job.policy, job.target)
        .then(
          (item) =>
            patch(
              id,
              item ? { status: "done", url: item.url, name: item.name } : { status: "skipped" },
            ),
          async (error: unknown) => {
            if (
              error instanceof DriveError &&
              (error.kind === "conflict" ||
                (error.kind === "not-found" && job.policy === "replace"))
            ) {
              // Snapshot before presenting the prompt, never when executing its
              // decision. A changed approved target needs another explicit choice.
              const automatic = job.policy === "fail" ? blanket.current : undefined;
              try {
                job.target = await client
                  .stat(childUrl(job.task.folder, normalizeUploadName(job.task.name)))
                  .catch((cause: unknown) => {
                    if (cause instanceof DriveError && cause.kind === "not-found") return undefined;
                    throw cause;
                  });
              } catch (cause) {
                patch(id, { status: "failed", error: describe(cause) });
                return;
              }
              job.policy = automatic ?? "fail";
              patch(id, { status: automatic ? "queued" : "conflict" });
            } else patch(id, { status: "failed", error: describe(error) });
          },
        )
        .finally(() => {
          running.current -= 1;
          // The file PUT can create every container between the drop target and
          // its destination. Refresh the whole path, including a flat upload once.
          const folders = new Set([job.root]);
          for (
            let folder: string | undefined = job.task.folder;
            folder && folder !== job.root;
            folder = parentOf(folder)
          ) {
            folders.add(folder);
          }
          for (const folder of folders) invalidate(folder);
          pump();
        });
    }
  }, [client, invalidate, patch]);

  const enqueue = useCallback(
    (folder: string, files: Iterable<File | DroppedFile>) => {
      blanket.current = undefined;
      for (const source of files) {
        const file = "path" in source ? source.file : source;
        const id = crypto.randomUUID();
        let target: string | undefined;
        try {
          target = targetFolder(folder, source);
        } catch {
          target = undefined;
        }
        jobs.current.set(id, {
          file,
          root: folder,
          policy: "fail",
          target: undefined,
          task: target
            ? { id, name: file.name, folder: target, size: file.size, status: "queued" }
            : {
                id,
                name: file.name,
                folder,
                size: file.size,
                status: "failed",
                error: "This name can't be uploaded",
              },
        });
      }
      publish();
      pump();
    },
    [publish, pump],
  );

  const resolve = useCallback(
    (id: string, choice: ConflictChoice, applyToAll = false) => {
      if (applyToAll) blanket.current = choice;
      for (const job of jobs.current.values()) {
        if (job.task.status === "conflict" && (job.task.id === id || applyToAll)) {
          job.policy = choice;
          job.task = { ...job.task, status: "queued" };
        }
      }
      publish();
      pump();
    },
    [publish, pump],
  );

  const retry = useCallback(
    (id: string) => {
      if (jobs.current.get(id)?.task.status !== "failed") return;
      patch(id, { status: "queued" });
      pump();
    },
    [patch, pump],
  );

  const cancel = useCallback(
    (id: string) => {
      const job = jobs.current.get(id);
      if (job && job.task.status !== "uploading") jobs.current.delete(id);
      publish();
    },
    [publish],
  );

  const clear = useCallback(() => {
    for (const [id, job] of jobs.current) {
      if (["done", "skipped", "failed"].includes(job.task.status)) jobs.current.delete(id);
    }
    publish();
  }, [publish]);

  return useMemo(
    () => ({ tasks, enqueue, resolve, retry, cancel, clear }),
    [tasks, enqueue, resolve, retry, cancel, clear],
  );
}
