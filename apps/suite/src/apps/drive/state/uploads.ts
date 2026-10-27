// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * The upload queue behind the upload dock (04-drive §2.6): up to three files
 * upload at once; a name clash pauses that file until the user picks
 * keep both / replace / skip (optionally for every remaining clash).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { DriveClient } from "../lib/client/client";
import { DriveError } from "../lib/client/client";
import { type ConflictChoice, uploadFile } from "../lib/operations/operations";
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
  policy: "fail" | ConflictChoice;
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
      uploadFile(client, job.task.folder, job.file, job.task.name, job.policy)
        .then(
          (item) =>
            patch(
              id,
              item ? { status: "done", url: item.url, name: item.name } : { status: "skipped" },
            ),
          (error: unknown) => {
            if (error instanceof DriveError && error.kind === "conflict" && job.policy === "fail") {
              if (blanket.current) {
                job.policy = blanket.current;
                patch(id, { status: "queued" });
              } else patch(id, { status: "conflict" });
            } else patch(id, { status: "failed", error: describe(error) });
          },
        )
        .finally(() => {
          running.current -= 1;
          invalidate(job.task.folder);
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
          policy: "fail",
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
        if (job.task.id === id || (applyToAll && job.task.status === "conflict")) {
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
