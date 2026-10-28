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
  id: string;
  choices: Map<string, UploadChoice>;
  retry: Batch | undefined;
}

function newBatch(): Batch {
  return { id: crypto.randomUUID(), choices: new Map(), retry: undefined };
}

interface Job {
  task: UploadTask;
  file: File;
  root: string;
  policy: "fail" | "confirm" | "upload" | ConflictChoice;
  replacing: boolean;
  intentKey: string | undefined;
  target: DriveItem | undefined;
  batch: Batch;
}

// Creating at a vanished replacement URL needs a separate decision about this
// folder's access. An approval to replace existing files cannot authorize it.
function confirmationGroup(job: Job): string {
  return job.replacing && !job.target ? job.task.folder : "existing";
}

function forgetReplacement(job: Job) {
  try {
    if (job.intentKey) sessionStorage.removeItem(job.intentKey);
  } catch {
    // Retaining a marker only causes an extra confirmation on a later upload.
  }
}

function rememberReplacement(job: Job) {
  if (job.replacing && job.intentKey) sessionStorage.setItem(job.intentKey, job.batch.id);
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
  accountScope?: string,
): UploadQueue {
  const jobs = useRef(new Map<string, Job>());
  const batches = useRef(new Map<string, Batch>());
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
        const automatic = allowAutomatic
          ? job.batch.choices.get(confirmationGroup(job))
          : undefined;
        if (automatic === "replace") job.replacing = true;
        if (automatic && automatic !== "skip") rememberReplacement(job);
        job.policy = automatic ?? "fail";
        patch(id, {
          status: automatic ? "queued" : "conflict",
          conflictTarget: job.target,
          missingReplacement: job.replacing && !job.target,
        });
      };
      void (async () => {
        try {
          if (policy === "confirm") {
            await confirm(true);
            return;
          }
          if (policy === "replace") job.replacing = true;
          // Persist intent, never approval or bytes. If storage refuses the
          // marker, stop before writing rather than losing intent on reload.
          if (policy !== "skip") rememberReplacement(job);
          const item = await uploadFile(
            client,
            job.task.folder,
            job.file,
            job.task.name,
            policy === "upload" ? "fail" : policy,
            target,
          );
          forgetReplacement(job);
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
        const id = crypto.randomUUID();
        let target: string | undefined;
        let intentKey: string | undefined;
        try {
          target = targetFolder(folder, source);
          const name = normalizeUploadName(file.name);
          if (accountScope)
            intentKey = `suite.drive.upload-replacement.${accountScope}.${childUrl(target, name)}`;
        } catch {
          target = undefined;
        }
        let restored: string | null = null;
        let storageFailed = false;
        try {
          if (intentKey) restored = sessionStorage.getItem(intentKey);
        } catch {
          // An unreadable marker cannot prove this is a new upload.
          storageFailed = true;
        }
        let jobBatch = batch;
        if (restored) {
          jobBatch = batches.current.get(restored) ?? newBatch();
          batches.current.set(restored, jobBatch);
        }
        jobs.current.set(id, {
          file,
          root: folder,
          policy: restored ? "confirm" : "fail",
          replacing: !!restored || storageFailed,
          intentKey,
          target: undefined,
          batch: jobBatch,
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
        });
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
          if (choice === "replace") job.replacing = true;
          try {
            // Include approved siblings still queued behind the concurrency limit.
            if (choice !== "skip") rememberReplacement(job);
            job.task = { ...job.task, status: "queued" };
          } catch (error) {
            job.task = { ...job.task, status: "failed", error: describe(error) };
          }
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
      job.policy = job.replacing ? "confirm" : "fail";
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
        forgetReplacement(job);
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
