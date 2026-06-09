"use client";

import { useCallback, useEffect, useState } from "react";
import { Repository, type IssueRecord, type NewIssueInput, type IssuePatch } from "@/lib/repository";
import { watchContainer } from "@/lib/notifications";
import { ConflictError } from "@/lib/errors";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { IssueState, StatusSlug } from "@/lib/issue";

export type { IssueRecord } from "@/lib/repository";

function describe(e: unknown): string {
  if (e instanceof ConflictError) return e.message;
  if (e instanceof RdfFetchError) {
    if (e.status === 401 || e.status === 403) return "You don't have access to this pod resource.";
    return `Could not read the issue list (HTTP ${e.status ?? "?"}).`;
  }
  if (e instanceof Error) return e.message;
  return "Unexpected error.";
}

export interface UseIssues {
  issues: IssueRecord[];
  loading: boolean;
  error: string | null;
  /** Whether the signed-in user may create new issues in this tracker. */
  canCreate: boolean;
  refresh: () => Promise<void>;
  create: (input: Omit<NewIssueInput, "creator">) => Promise<void>;
  update: (url: string, patch: IssuePatch) => Promise<void>;
  setState: (url: string, state: IssueState) => Promise<void>;
  setStatus: (url: string, status: StatusSlug) => Promise<void>;
  addComment: (url: string, content: string, mentions?: string[]) => Promise<void>;
  uploadAttachment: (url: string, file: { name: string; type: string; data: ArrayBuffer }) => Promise<void>;
  removeAttachment: (url: string, fileUrl: string) => Promise<void>;
  remove: (url: string) => Promise<void>;
  /** Apply several operations against one Repository, then refresh once (bulk actions). */
  batch: (fn: (repo: Repository) => Promise<void>) => Promise<void>;
}

/**
 * Loads and mutates the issues in a tracker (one document per issue). Mutations
 * conditionally PUT the individual issue and refresh the list; a {@link ConflictError}
 * (412) is rethrown for the caller to surface and retry.
 */
export function useIssues(trackerUrl: string | null, creator: string | null): UseIssues {
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(true);

  const fetchInto = useCallback(async () => {
    if (!trackerUrl) return;
    try {
      const { issues: list, canCreate: cc } = await new Repository(trackerUrl).list();
      setIssues(list);
      setCanCreate(cc);
      setError(null);
    } catch (e) {
      setError(describe(e));
    } finally {
      setLoading(false);
    }
  }, [trackerUrl]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchInto();
  }, [fetchInto]);

  useEffect(() => {
    // Client-side mount fetch; setState only runs after the await inside fetchInto.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchInto();
  }, [fetchInto]);

  // Live-sync: refresh (debounced) when the tracker's container changes in the pod.
  useEffect(() => {
    if (!trackerUrl) return;
    const containerUrl = new Repository(trackerUrl).containerUrl;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = watchContainer(containerUrl, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void fetchInto(), 800);
    });
    return () => {
      sync.close();
      if (timer) clearTimeout(timer);
    };
  }, [trackerUrl, fetchInto]);

  const mutate = useCallback(
    async (apply: (r: Repository) => Promise<unknown>) => {
      if (!trackerUrl) throw new Error("Not signed in.");
      await apply(new Repository(trackerUrl));
      await refresh();
    },
    [trackerUrl, refresh],
  );

  return {
    issues,
    loading,
    error,
    canCreate,
    refresh,
    create: (input) => mutate((r) => r.create({ ...input, creator: creator ?? undefined })),
    update: (url, patch) => mutate((r) => r.update(url, patch)),
    setState: (url, state) => mutate((r) => r.setState(url, state)),
    setStatus: (url, status) => mutate((r) => r.setStatus(url, status)),
    addComment: (url, content, mentions) => mutate((r) => r.addComment(url, content, creator ?? undefined, mentions)),
    uploadAttachment: (url, file) => mutate(async (r) => void (await r.uploadAttachment(url, file))),
    removeAttachment: (url, fileUrl) => mutate((r) => r.removeAttachment(url, fileUrl)),
    remove: (url) => mutate((r) => r.remove(url)),
    batch: (fn) => mutate(fn),
  };
}
