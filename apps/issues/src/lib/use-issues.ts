"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Repository, type IssueRecord, type NewIssueInput, type IssuePatch, type SprintRecord, type ActivityRecord } from "@/lib/repository";
import { watchContainer } from "@/lib/notifications";
import { ConflictError } from "@/lib/errors";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { IssueState, StatusSlug } from "@/lib/issue";
import { readIssueCache, writeIssueCache } from "@/lib/issue-cache";

export type { IssueRecord, SprintRecord, ActivityRecord, WorklogRecord } from "@/lib/repository";

function describe(e: unknown): string {
  if (e instanceof ConflictError) return e.message;
  if (e instanceof RdfFetchError) {
    if (e.status === 401 || e.status === 403) return "You don't have access to this pod resource.";
    return `Could not read the issue list (HTTP ${e.status ?? "?"}).`;
  }
  if (e instanceof Error) return e.message;
  return "Unexpected error.";
}

/**
 * Whether a background pod write is in flight, just landed, or failed — drives
 * the non-intrusive global save indicator (pss-w29w). "saved" is shown briefly
 * after a success then returns to "idle".
 */
export type SaveState = "idle" | "saving" | "saved" | "error";

export interface UseIssues {
  issues: IssueRecord[];
  sprints: SprintRecord[];
  loading: boolean;
  /**
   * True only while the FIRST load for a tracker is in flight with NO data yet to
   * show. Once a cache hydrate or a fetch has produced issues, this is false even
   * during a background revalidation — so the board never flashes a blank/loading
   * state when cached data exists (pss-tvds).
   */
  initialLoading: boolean;
  error: string | null;
  /** Whether the signed-in user may create new issues in this tracker. */
  canCreate: boolean;
  /** Save indicator for optimistic board writes (pss-w29w). */
  saveState: SaveState;
  /**
   * Optimistically replace the local issue list (e.g. slide a card across the
   * board immediately), then persist via `persist`. On a persist failure the
   * caller reverts with `setIssuesLocal` and the indicator shows "error".
   */
  setIssuesLocal: (updater: (issues: IssueRecord[]) => IssueRecord[]) => void;
  /**
   * Run a pod write with the save indicator, WITHOUT the blocking full refresh
   * that `update`/`setStatus` do — for optimistic board moves where the local
   * state is already correct. Reconciles in the background on success; on failure
   * rejects so the caller can revert. A live-sync/refresh still reconciles later.
   */
  persist: (write: (repo: Repository) => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  create: (input: Omit<NewIssueInput, "creator">) => Promise<void>;
  update: (url: string, patch: IssuePatch) => Promise<void>;
  setState: (url: string, state: IssueState) => Promise<void>;
  setStatus: (url: string, status: StatusSlug) => Promise<void>;
  addComment: (url: string, content: string, mentions?: string[]) => Promise<void>;
  /** F4: log work (seconds, optional note) against an issue, then refresh. */
  logWork: (url: string, seconds: number, note?: string) => Promise<void>;
  uploadAttachment: (url: string, file: { name: string; type: string; data: ArrayBuffer }) => Promise<void>;
  removeAttachment: (url: string, fileUrl: string) => Promise<void>;
  remove: (url: string) => Promise<void>;
  createSprint: (title: string) => Promise<void>;
  setSprintMembership: (sprintIri: string, issueUrl: string, member: boolean) => Promise<void>;
  startSprint: (sprintIri: string) => Promise<void>;
  completeSprint: (sprintIri: string, releaseUrls?: string[]) => Promise<void>;
  /** Apply several operations against one Repository, then refresh once (bulk actions). */
  batch: (fn: (repo: Repository) => Promise<void>) => Promise<void>;
  /** Read an issue's provenance activity log (F3), newest first. */
  activityLog: (url: string) => Promise<ActivityRecord[]>;
  /**
   * Fan out bounded reads of the F3 status-transition history for the given issues
   * (for the three-band cumulative flow). Bounded: a few pages per issue, a few
   * issues in flight at once.
   */
  statusHistory: (urls: string[]) => Promise<Map<string, { to: StatusSlug; at: Date }[]>>;
}

/**
 * One fetched view of a tracker, tagged with BOTH the tracker it came from AND
 * the authenticated WebID (`creator`) that fetched it. The render derives from a
 * snapshot only when BOTH match the current (trackerUrl, creator) — so a view
 * fetched by a previous user can never be shown to, or preserved for, a different
 * later user on the same browser, even when the tracker URL is unchanged. This
 * mirrors the WebID scoping of the durable cache (issue-cache.ts) in the live
 * in-memory layer.
 */
interface TrackerSnapshot {
  tracker: string | null;
  /** The WebID that fetched this snapshot (null only for the empty snapshot). */
  creator: string | null;
  issues: IssueRecord[];
  sprints: SprintRecord[];
  canCreate: boolean;
  error: string | null;
}

const EMPTY_SNAPSHOT: Omit<TrackerSnapshot, "tracker" | "creator"> = {
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
/**
 * Seed the snapshot from the durable cache so the board paints instantly. The
 * cache is WebID-scoped: without an authenticated WebID, or for a snapshot
 * fetched by a different WebID, this is a MISS — so a previous user's data can
 * never paint for the current one before authorization revalidates.
 */
function hydrate(webId: string | null, trackerUrl: string | null): TrackerSnapshot {
  if (!trackerUrl || !webId) return { tracker: null, creator: null, ...EMPTY_SNAPSHOT };
  const cached = readIssueCache(webId, trackerUrl);
  if (!cached) return { tracker: null, creator: null, ...EMPTY_SNAPSHOT };
  // Tag with BOTH the tracker and the WebID so the render shows the cached issues
  // immediately (and only for this same identity); a background fetch reconciles.
  // Sprints aren't cached (small, config-derived).
  return { tracker: trackerUrl, creator: webId, issues: cached, sprints: [], canCreate: true, error: null };
}

export function useIssues(trackerUrl: string | null, creator: string | null): UseIssues {
  // All fetched data lives in ONE snapshot tagged with its tracker, and the
  // render derives from it only when the tag matches the current tracker. A
  // read from a previously-open project can therefore never be rendered — or
  // acted on — under the new one, no matter when it lands (no effect-ordering
  // races, unlike a ref-based "is this stale?" check).
  //
  // The initial snapshot is hydrated SYNCHRONOUSLY from the durable cache
  // (pss-tvds): a returning user sees their last board paint immediately, while
  // the network fetch revalidates in the background (stale-while-revalidate).
  const [snapshot, setSnapshot] = useState<TrackerSnapshot>(() => hydrate(creator, trackerUrl));
  const [refreshing, setRefreshing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // True until the first network fetch lands for the current tracker — used only
  // to distinguish "we have nothing yet" from "we have cached/loaded data".
  const [fetched, setFetched] = useState(false);

  // A snapshot is the CURRENT view only when BOTH its tracker AND the WebID that
  // fetched it match the active (trackerUrl, creator). If the identity changed
  // while the tracker URL stayed the same, the previous user's snapshot is stale
  // and is neither rendered nor preserved — it falls through to the empty view
  // until an authorized fetch for the new identity lands.
  const current = snapshot.tracker === trackerUrl && snapshot.creator === creator;
  const issues = current ? snapshot.issues : [];
  const sprints = current ? snapshot.sprints : [];
  const canCreate = current ? snapshot.canCreate : true;
  const error = current ? snapshot.error : null;
  const loading = !current || refreshing;
  // We have something to show iff the current snapshot carries issues (cache or a
  // completed fetch). initialLoading is true ONLY when we have neither — so a
  // cache-hydrated board is never treated as "loading" (pss-tvds).
  const hasData = current && (snapshot.issues.length > 0 || fetched);
  const initialLoading = !hasData && !error;

  // Monotonic fetch sequence: a slow, older read (e.g. a live-sync refresh that
  // started before a mutation's PUT) must never clobber state written by a newer
  // one — only the latest in-flight fetch may apply its result.
  const fetchSeq = useRef(0);

  const fetchInto = useCallback(async () => {
    if (!trackerUrl) return;
    const seq = ++fetchSeq.current;
    // The identity this fetch is for — stamped onto the snapshot so the result
    // can never be rendered for a different later identity.
    const forCreator = creator;
    try {
      const repo = new Repository(trackerUrl, undefined, forCreator ?? undefined);
      const [{ issues: list, canCreate: cc }, sprintList] = await Promise.all([repo.list(), repo.listSprints()]);
      if (seq !== fetchSeq.current) return; // a newer fetch superseded this one
      setSnapshot({ tracker: trackerUrl, creator: forCreator, issues: list, sprints: sprintList, canCreate: cc, error: null });
      setFetched(true);
      // Persist the fresh list so the next reopen paints from it — scoped to the
      // active WebID so it only ever rehydrates for this same identity.
      writeIssueCache(forCreator, trackerUrl, list);
    } catch (e) {
      if (seq !== fetchSeq.current) return;
      // Keep the last good data for THIS (tracker, identity) only; never carry
      // another tracker's OR another user's data over. A creator mismatch starts
      // a fresh error snapshot rather than annotating the previous user's view.
      setSnapshot((prev) =>
        prev.tracker === trackerUrl && prev.creator === forCreator
          ? { ...prev, error: describe(e) }
          : { tracker: trackerUrl, creator: forCreator, ...EMPTY_SNAPSHOT, error: describe(e) },
      );
    } finally {
      if (seq === fetchSeq.current) setRefreshing(false);
    }
  }, [trackerUrl, creator]);

  const refresh = useCallback(async () => {
    if (trackerUrl) setRefreshing(true); // fetchInto no-ops without a tracker
    await fetchInto();
  }, [trackerUrl, fetchInto]);

  // When the tracker OR the active identity changes, re-hydrate from that
  // (WebID, tracker)'s cache (instant paint) and reset the first-load flag so the
  // new board doesn't inherit the old one's "loaded" status. On a cache MISS
  // (no entry for this identity/tracker, or no authenticated WebID) we install
  // the EMPTY snapshot — never leave the previous identity's in-memory data
  // standing for the new one to render before an authorized fetch lands.
  useEffect(() => {
    setFetched(false);
    setSnapshot(hydrate(creator, trackerUrl));
  }, [creator, trackerUrl]);

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
      await apply(new Repository(trackerUrl, undefined, creator ?? undefined));
      await refresh();
    },
    [trackerUrl, creator, refresh],
  );

  // Optimistic local edit of the issue list (board moves slide instantly).
  const setIssuesLocal = useCallback(
    (updater: (issues: IssueRecord[]) => IssueRecord[]) => {
      setSnapshot((prev) => {
        // Never edit another tracker's OR another user's snapshot.
        if (prev.tracker !== trackerUrl || prev.creator !== creator) return prev;
        const next = updater(prev.issues);
        // Keep the cache in lock-step so a reopen mid-write paints the optimistic
        // state — scoped to the active WebID (writeIssueCache no-ops without one).
        if (trackerUrl) writeIssueCache(creator, trackerUrl, next);
        return { ...prev, issues: next };
      });
    },
    [creator, trackerUrl],
  );

  // A "saved" flash auto-clears back to idle so the indicator is non-intrusive.
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  const flashSaved = useCallback(() => {
    setSaveState("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
  }, []);

  // Persist an optimistic board write: show "Saving…", run the pod write WITHOUT
  // the blocking refresh, then a background reconcile (so a coupled change the
  // server made — e.g. wf:Closed alongside the status — lands too). On failure,
  // surface "error" and reject so the caller reverts the card.
  const persist = useCallback(
    async (write: (repo: Repository) => Promise<void>) => {
      if (!trackerUrl) throw new Error("Not signed in.");
      setSaveState("saving");
      try {
        await write(new Repository(trackerUrl, undefined, creator ?? undefined));
        flashSaved();
        void fetchInto(); // background reconcile; does not block the smooth move
      } catch (e) {
        setSaveState("error");
        throw e;
      }
    },
    [trackerUrl, creator, flashSaved, fetchInto],
  );

  // Read-only fetch of an issue's provenance activity log (F3), not part of the
  // list snapshot — the detail view loads it on demand.
  const activityLog = useCallback(
    async (url: string) => {
      if (!trackerUrl || !url) return [];
      return new Repository(trackerUrl, undefined, creator ?? undefined).activityLog(url);
    },
    [trackerUrl, creator],
  );

  // Bounded fan-out of status-transition history for the three-band CFD.
  const statusHistory = useCallback(
    async (urls: string[]) => {
      if (!trackerUrl || urls.length === 0) return new Map<string, { to: StatusSlug; at: Date }[]>();
      return new Repository(trackerUrl, undefined, creator ?? undefined).dashboardStatusHistory(urls);
    },
    [trackerUrl, creator],
  );

  return {
    issues,
    sprints,
    loading,
    initialLoading,
    error,
    canCreate,
    saveState,
    setIssuesLocal,
    persist,
    refresh,
    create: (input) => mutate((r) => r.create({ ...input, creator: creator ?? undefined })),
    update: (url, patch) => mutate((r) => r.update(url, patch)),
    setState: (url, state) => mutate((r) => r.setState(url, state)),
    setStatus: (url, status) => mutate((r) => r.setStatus(url, status)),
    addComment: (url, content, mentions) => mutate((r) => r.addComment(url, content, creator ?? undefined, mentions)),
    logWork: (url, seconds, note) => mutate((r) => r.logWork(url, seconds, note)),
    uploadAttachment: (url, file) => mutate(async (r) => void (await r.uploadAttachment(url, file))),
    removeAttachment: (url, fileUrl) => mutate((r) => r.removeAttachment(url, fileUrl)),
    remove: (url) => mutate((r) => r.remove(url)),
    createSprint: (title) => mutate((r) => r.createSprint(title).then(() => undefined)),
    setSprintMembership: (sprintIri, issueUrl, member) => mutate((r) => r.setSprintMembership(sprintIri, issueUrl, member)),
    startSprint: (sprintIri) => mutate((r) => r.startSprint(sprintIri)),
    completeSprint: (sprintIri, releaseUrls) => mutate((r) => r.completeSprint(sprintIri, releaseUrls)),
    batch: (fn) => mutate(fn),
    activityLog,
    statusHistory,
  };
}
