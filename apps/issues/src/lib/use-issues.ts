"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Repository, type IssueRecord, type NewIssueInput, type IssuePatch, type SprintRecord } from "@/lib/repository";
import { watchContainer } from "@/lib/notifications";
import { ConflictError } from "@/lib/errors";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { IssueState, StatusSlug } from "@/lib/issue";

export type { IssueRecord, SprintRecord } from "@/lib/repository";

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
  sprints: SprintRecord[];
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
  createSprint: (title: string) => Promise<void>;
  setSprintMembership: (sprintIri: string, issueUrl: string, member: boolean) => Promise<void>;
  startSprint: (sprintIri: string) => Promise<void>;
  completeSprint: (sprintIri: string, releaseUrls?: string[]) => Promise<void>;
  /** Apply several operations against one Repository, then refresh once (bulk actions). */
  batch: (fn: (repo: Repository) => Promise<void>) => Promise<void>;
}

/** One fetched view of a tracker, tagged with the tracker it came from. */
interface TrackerSnapshot {
  tracker: string | null;
  issues: IssueRecord[];
  sprints: SprintRecord[];
  canCreate: boolean;
  error: string | null;
}

const EMPTY_SNAPSHOT: Omit<TrackerSnapshot, "tracker"> = {
  issues: [],
  sprints: [],
  canCreate: true,
  error: null,
};

/**
 * Loads and mutates the issues in a tracker (one document per issue). Mutations
 * conditionally PUT the individual issue and refresh the list; a {@link ConflictError}
 * (412) is rethrown for the caller to surface and retry.
 */
export function useIssues(trackerUrl: string | null, creator: string | null): UseIssues {
  // All fetched data lives in ONE snapshot tagged with its tracker, and the
  // render derives from it only when the tag matches the current tracker. A
  // read from a previously-open project can therefore never be rendered — or
  // acted on — under the new one, no matter when it lands (no effect-ordering
  // races, unlike a ref-based "is this stale?" check).
  const [snapshot, setSnapshot] = useState<TrackerSnapshot>({ tracker: null, ...EMPTY_SNAPSHOT });
  const [refreshing, setRefreshing] = useState(false);

  const current = snapshot.tracker === trackerUrl;
  const issues = current ? snapshot.issues : [];
  const sprints = current ? snapshot.sprints : [];
  const canCreate = current ? snapshot.canCreate : true;
  const error = current ? snapshot.error : null;
  const loading = !current || refreshing;

  // Monotonic fetch sequence: a slow, older read (e.g. a live-sync refresh that
  // started before a mutation's PUT) must never clobber state written by a newer
  // one — only the latest in-flight fetch may apply its result.
  const fetchSeq = useRef(0);

  const fetchInto = useCallback(async () => {
    if (!trackerUrl) return;
    const seq = ++fetchSeq.current;
    try {
      const repo = new Repository(trackerUrl);
      const [{ issues: list, canCreate: cc }, sprintList] = await Promise.all([repo.list(), repo.listSprints()]);
      if (seq !== fetchSeq.current) return; // a newer fetch superseded this one
      setSnapshot({ tracker: trackerUrl, issues: list, sprints: sprintList, canCreate: cc, error: null });
    } catch (e) {
      if (seq !== fetchSeq.current) return;
      // Keep the last good data for THIS tracker; never carry another's over.
      setSnapshot((prev) =>
        prev.tracker === trackerUrl
          ? { ...prev, error: describe(e) }
          : { tracker: trackerUrl, ...EMPTY_SNAPSHOT, error: describe(e) },
      );
    } finally {
      if (seq === fetchSeq.current) setRefreshing(false);
    }
  }, [trackerUrl]);

  const refresh = useCallback(async () => {
    if (trackerUrl) setRefreshing(true); // fetchInto no-ops without a tracker
    await fetchInto();
  }, [trackerUrl, fetchInto]);

  useEffect(() => {
    // Client-side mount fetch; setState only runs after the await inside fetchInto.
     
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
    sprints,
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
    createSprint: (title) => mutate((r) => r.createSprint(title).then(() => undefined)),
    setSprintMembership: (sprintIri, issueUrl, member) => mutate((r) => r.setSprintMembership(sprintIri, issueUrl, member)),
    startSprint: (sprintIri) => mutate((r) => r.startSprint(sprintIri)),
    completeSprint: (sprintIri, releaseUrls) => mutate((r) => r.completeSprint(sprintIri, releaseUrls)),
    batch: (fn) => mutate(fn),
  };
}
