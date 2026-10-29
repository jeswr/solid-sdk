// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
import { DriveDeletePendingError } from "../lib/client/deletion";
import { DriveOperationInProgressError } from "../lib/client/source-operations";
/**
 * The upload queue behind the upload dock (04-drive §2.6): up to three files
 * upload at once; a name clash pauses that file until the user picks
 * keep both / replace / skip (optionally for every remaining clash).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { DriveClient, DriveItem } from "../lib/client/client";
import { DriveError, DrivePartialFailureError, parentOf } from "../lib/client/client";
import { type ConflictChoice, childUrl, uploadFile } from "../lib/operations/operations";
import { normalizeUploadName } from "../lib/upload";
import type { DroppedFile } from "./dropped-files";

export type UploadStatus = "queued" | "uploading" | "done" | "conflict" | "failed" | "skipped";
export type UploadChoice = ConflictChoice | "upload";

export interface UploadTask {
  readonly id: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly status: UploadStatus;
  readonly url?: string;
  readonly error?: string | undefined;
  readonly conflictTarget?: DriveItem | undefined;
  readonly missingReplacement?: boolean | undefined;
}

export interface UploadQueue {
  readonly tasks: readonly UploadTask[];
  enqueue(folder: string, files: Iterable<File | DroppedFile>): void;
  resolve(id: string, choice: UploadChoice, applyToAll?: boolean): void;
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

interface Batch {
  choices: Map<string, UploadChoice>;
  retry: Batch | undefined;
}

function newBatch(): Batch {
  return { choices: new Map(), retry: undefined };
}

interface SavedJob {
  id: string;
  targetUrl: string;
  conflictSeen: boolean;
}

interface Job {
  task: UploadTask;
  file: File;
  root: string;
  policy: "fail" | "confirm" | "upload" | ConflictChoice;
  conflictSeen: boolean;
  targetUrl: string | undefined;
  storageKey: string | undefined;
  target: DriveItem | undefined;
  batch: Batch;
}

// Creating at a vanished replacement URL needs a separate decision about this
// folder's access. An approval to replace existing files cannot authorize it.
function confirmationGroup(job: Job): string {
  return job.conflictSeen && !job.target ? job.task.folder : "existing";
}

function forgetJob(job: Job) {
  try {
    if (job.storageKey) sessionStorage.removeItem(job.storageKey);
  } catch {
    // Retaining this job only causes an extra confirmation on a later upload.
  }
}

function rememberJob(job: Job) {
  if (job.storageKey && job.targetUrl)
    sessionStorage.setItem(
      job.storageKey,
      JSON.stringify({ id: job.task.id, targetUrl: job.targetUrl, conflictSeen: job.conflictSeen }),
    );
}

function savedJobs(prefix: string): SavedJob[] {
  const saved: SavedJob[] = [];
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const job: SavedJob = JSON.parse(sessionStorage.getItem(key) as string);
    if (
      !job ||
      typeof job.id !== "string" ||
      typeof job.targetUrl !== "string" ||
      typeof job.conflictSeen !== "boolean" ||
      key !== `${prefix}${job.id}`
    )
      throw new Error("Unreadable upload history");
    saved.push(job);
  }
  return saved;
}

function describe(error: unknown): string {
  if (error instanceof DrivePartialFailureError)
    return `Upload failed. Recovery copies retained at: ${error.retainedDestinations.join(", ")}. Check these locations before retrying.`;
  if (error instanceof DriveDeletePendingError || error instanceof DriveOperationInProgressError)
    return error.message;
  if (error instanceof DriveError) {
    if (error.kind === "forbidden") return "You don't have permission to upload here";
    if (error.kind === "unauthenticated") return "Sign in again to upload";
  }
  return "Upload failed";
}

export function useUploadQueue(
  client: DriveClient,
  invalidate: (url: string) => void,
  accountScope?: string,
): UploadQueue {
  const jobs = useRef(new Map<string, Job>());
  const running = useRef(0);
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
      const { policy, target } = job;
      // A choice authorizes one attempt. ETags validate bytes, not identity or access.
      job.policy = "fail";
      job.target = undefined;
      patch(id, {
        status: "uploading",
        error: undefined,
        conflictTarget: undefined,
        missingReplacement: undefined,
      });
      const confirm = async (allowAutomatic: boolean) => {
        // Read before presenting a decision, including when Retry finds no file.
        job.target = await client
          .stat(childUrl(job.task.folder, normalizeUploadName(job.task.name)))
          .catch((cause: unknown) => {
            if (cause instanceof DriveError && cause.kind === "not-found") return undefined;
            throw cause;
          });
        if (job.target) job.conflictSeen = true;
        rememberJob(job);
        // A failed fresh PUT may never have encountered a resource. Only that
        // case can resume without a decision after checking the vacant URL.
        if (!job.target && !job.conflictSeen) {
          job.policy = "fail";
          patch(id, { status: "queued" });
          return;
        }
        const automatic = allowAutomatic
          ? job.batch.choices.get(confirmationGroup(job))
          : undefined;
        job.policy = automatic ?? "fail";
        patch(id, {
          status: automatic ? "queued" : "conflict",
          conflictTarget: job.target,
          missingReplacement: job.conflictSeen && !job.target,
        });
      };
      void (async () => {
        try {
          if (policy === "confirm") {
            await confirm(true);
            return;
          }
          // Persist only this job's history, never an approval or file bytes.
          // Storage failure stops the attempt before any write.
          if (policy !== "skip") rememberJob(job);
          const item = await uploadFile(
            client,
            job.task.folder,
            job.file,
            job.task.name,
            policy === "upload" ? "fail" : policy,
            target,
          );
          forgetJob(job);
          patch(
            id,
            item
              ? { status: "done", url: item.url, name: item.name, error: undefined }
              : { status: "skipped", error: undefined },
          );
        } catch (error: unknown) {
          if (
            error instanceof DriveError &&
            (error.kind === "conflict" || (error.kind === "not-found" && policy === "replace"))
          ) {
            try {
              job.conflictSeen = true;
              rememberJob(job);
              await confirm(policy === "fail");
            } catch (cause) {
              patch(id, { status: "failed", error: describe(cause) });
            }
          } else patch(id, { status: "failed", error: describe(error) });
        }
      })().finally(() => {
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
      const batch = newBatch();
      for (const source of files) {
        const file = "path" in source ? source.file : source;
        let id: string = crypto.randomUUID();
        let target: string | undefined;
        let targetUrl: string | undefined;
        try {
          target = targetFolder(folder, source);
          targetUrl = childUrl(target, normalizeUploadName(file.name));
        } catch {
          target = undefined;
        }
        const prefix = accountScope ? `suite.drive.upload-job.${accountScope}.` : undefined;
        let resumed = false;
        let conflictSeen = false;
        let storageFailed = false;
        try {
          const saved = prefix
            ? savedJobs(prefix).filter((job) => job.targetUrl === targetUrl)
            : [];
          const active = [...jobs.current.values()].filter((job) => job.targetUrl === targetUrl);
          resumed = saved.length > 0 || active.length > 0;
          conflictSeen = [...saved, ...active].some((job) => job.conflictSeen);
          // Reattach a reselected file to its own persisted job after reload.
          // A duplicate of an active job gets a separate id and storage record.
          const restored = saved.find((job) => !jobs.current.has(job.id));
          if (restored) id = restored.id;
        } catch {
          // Unreadable history cannot prove this is a never-attempted upload.
          storageFailed = true;
          conflictSeen = true;
        }
        const job: Job = {
          file,
          root: folder,
          policy: resumed ? "confirm" : "fail",
          conflictSeen,
          targetUrl,
          storageKey: prefix ? `${prefix}${id}` : undefined,
          target: undefined,
          batch,
          task:
            target && !storageFailed
              ? { id, name: file.name, folder: target, size: file.size, status: "queued" }
              : {
                  id,
                  name: file.name,
                  folder: target ?? folder,
                  size: file.size,
                  status: "failed",
                  error: storageFailed ? "Upload failed" : "This name can't be uploaded",
                },
        };
        try {
          if (!storageFailed) rememberJob(job);
        } catch (error) {
          job.task = { ...job.task, status: "failed", error: describe(error) };
        }
        jobs.current.set(id, job);
      }
      publish();
      pump();
    },
    [accountScope, publish, pump],
  );

  const resolve = useCallback(
    (id: string, choice: UploadChoice, applyToAll = false) => {
      const selected = jobs.current.get(id);
      if (selected?.task.status !== "conflict") return;
      const group = confirmationGroup(selected);
      if (choice === "upload" && !selected.task.missingReplacement) return;
      if (selected.task.missingReplacement && choice !== "upload" && choice !== "skip") return;
      for (const job of jobs.current.values()) {
        if (
          job.task.status === "conflict" &&
          (job.task.id === id ||
            (applyToAll && job.batch === selected.batch && confirmationGroup(job) === group))
        ) {
          if (applyToAll) job.batch.choices.set(group, choice);
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
      const job = jobs.current.get(id);
      if (job?.task.status !== "failed") return;
      // Failed siblings enter the same fresh batch, so renewed Apply to all is
      // shared without carrying an earlier attempt's approval into this retry.
      job.batch.retry ??= newBatch();
      job.batch = job.batch.retry;
      job.policy = "confirm";
      job.target = undefined;
      patch(id, { status: "queued", error: undefined, conflictTarget: undefined });
      pump();
    },
    [patch, pump],
  );

  const cancel = useCallback(
    (id: string) => {
      const job = jobs.current.get(id);
      if (job && job.task.status !== "uploading") {
        forgetJob(job);
        jobs.current.delete(id);
      }
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
