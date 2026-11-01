// AUTHORED-BY Codex GPT-6
"use client";

import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { toast } from "@jeswr/suite-ui";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useHomeSession } from "../components/home-app";
import { httpUrl, inStorage, subjectOf } from "../lib/model/rdf";
import { readTypeIndexes } from "../lib/model/type-index";
import {
  type AgentRow,
  applyRevoke,
  type ClientMetadata,
  isClientIdDocument,
  LockoutError,
  loadPermissions,
  PartialRevokeError,
  type PermissionLine,
  type PermissionsSnapshot,
  planRevoke,
  RestoreConflictError,
  type RevokePlan,
  resolveClientName,
  UnsupportedAccessError,
} from "../lib/permissions";
import {
  agentName,
  consequenceText,
  type PermissionsView,
  relativePath,
} from "../lib/permissions/view";

interface RemovedLine {
  row: AgentRow;
  line: PermissionLine;
  token?: string;
  /** The removed rules were changed elsewhere, so this Undo can no longer apply. */
  stale?: boolean;
}
export interface PermissionsState {
  status: "loading" | "ready" | "error";
  rows: AgentRow[];
  failures: PermissionsSnapshot["failures"];
  truncated: boolean;
  removed: Record<string, RemovedLine>;
  busy: boolean;
}
export const initialPermissionsState: PermissionsState = {
  status: "loading",
  rows: [],
  failures: [],
  truncated: false,
  removed: {},
  busy: false,
};
export type PermissionsAction =
  | { type: "reset" }
  | { type: "undo-start" }
  | { type: "settled" }
  | { type: "loaded"; snapshot: PermissionsSnapshot }
  | { type: "error" }
  | { type: "start"; row: AgentRow; line?: PermissionLine }
  | { type: "line-done"; key: string; token: string }
  | { type: "row-done"; keys: string[] }
  | { type: "write-error"; key?: string }
  | { type: "undo-done"; token: string }
  | { type: "undo-unavailable"; token: string }
  | { type: "named"; key: string; name: string }
  | { type: "collapse"; key: string };

export function permissionsReducer(
  state: PermissionsState,
  action: PermissionsAction,
): PermissionsState {
  switch (action.type) {
    case "undo-start":
      return { ...state, busy: true };
    case "settled":
      return { ...state, busy: false };
    case "reset":
      return initialPermissionsState;
    case "loaded": {
      const rows = action.snapshot.rows.map((row) => ({ ...row, lines: [...row.lines] }));
      const removed = { ...state.removed };
      for (const [key, entry] of Object.entries(removed)) {
        let row = rows.find((r) => r.key === entry.row.key);
        // A fresh active grant supersedes a completed removal, including regrants
        // by another client. Pending writes keep their optimistic switch state.
        if (entry.token && row?.lines.some((line) => line.key === key)) {
          delete removed[key];
          continue;
        }
        if (!row) {
          row = { ...entry.row, lines: [] };
          rows.push(row);
        }
        if (!row.lines.some((l) => l.key === entry.line.key)) row.lines.push(entry.line);
      }
      return { ...state, ...action.snapshot, rows, removed, status: "ready" };
    }
    case "error":
      return { ...state, status: "error" };
    case "start":
      return {
        ...state,
        busy: true,
        removed: action.line
          ? { ...state.removed, [action.line.key]: { row: action.row, line: action.line } }
          : state.removed,
      };
    case "line-done": {
      const entry = state.removed[action.key];
      return {
        ...state,
        busy: false,
        removed: entry
          ? { ...state.removed, [action.key]: { ...entry, token: action.token } }
          : state.removed,
      };
    }
    case "row-done":
      return {
        ...state,
        busy: false,
        rows: state.rows.filter((r) => !action.keys.includes(r.key)),
        removed: Object.fromEntries(
          Object.entries(state.removed).filter(([, e]) => !action.keys.includes(e.row.key)),
        ),
      };
    case "write-error":
      return {
        ...state,
        busy: false,
        removed: Object.fromEntries(
          Object.entries(state.removed).filter(([key]) => key !== action.key),
        ),
      };
    case "undo-done":
      return {
        ...state,
        busy: false,
        removed: Object.fromEntries(
          Object.entries(state.removed).filter(([, e]) => e.token !== action.token),
        ),
      };
    case "undo-unavailable":
      return {
        ...state,
        busy: false,
        removed: Object.fromEntries(
          Object.entries(state.removed).map(([key, e]) => [
            key,
            e.token === action.token ? { ...e, stale: true } : e,
          ]),
        ),
      };
    case "named":
      return {
        ...state,
        rows: state.rows.map((r) => (r.key === action.key ? { ...r, name: action.name } : r)),
      };
    case "collapse": {
      const keys = new Set(
        Object.entries(state.removed)
          .filter(([, e]) => e.row.key === action.key && e.token)
          .map(([key]) => key),
      );
      return {
        ...state,
        rows: state.rows
          .map((r) => ({ ...r, lines: r.lines.filter((l) => !keys.has(l.key)) }))
          .filter((r) => r.lines.length),
        removed: Object.fromEntries(
          Object.entries(state.removed).filter(([key]) => !keys.has(key)),
        ),
      };
    }
  }
}

// Public profile reads never use the pod's authenticated transport. Cache failures too.
export function createPeopleNameResolver() {
  const names = new Map<string, Promise<string | undefined>>();
  return (id: string): Promise<string | undefined> => {
    let pending = names.get(id);
    if (!pending) {
      pending = (async () => {
        if (!httpUrl(id)) return undefined;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const plainFetch: typeof globalThis.fetch = (input, init) =>
            globalThis.fetch(input, {
              ...init,
              credentials: "omit",
              redirect: "error",
            });
          const { dataset } = await fetchRdf(id.split("#")[0] as string, {
            fetch: plainFetch,
            signal: controller.signal,
          });
          const person = subjectOf(dataset, id);
          return ["http://xmlns.com/foaf/0.1/name", "http://www.w3.org/2006/vcard/ns#fn"]
            .flatMap((predicate) => person.texts(predicate))
            .find((name) => name.trim());
        } catch {
          return undefined;
        } finally {
          clearTimeout(timer);
        }
      })();
      names.set(id, pending);
    }
    return pending;
  };
}

interface SessionCache {
  identity: string;
  people: ReturnType<typeof createPeopleNameResolver>;
  snapshot?: PermissionsSnapshot;
  clients: Record<string, ClientMetadata>;
  /** Resolved display names by agent key, applied to every later snapshot. */
  names: Record<string, string>;
  /** Undo plans outlive the page, so a toast's Undo still works after navigating away. */
  undos: Map<string, UndoEntry>;
  /** One access write at a time per session, including writes from an earlier mount. */
  writing?: object | undefined;
  /** The mounted page's refresh, run when a write started by an earlier mount settles. */
  settled: Set<() => void>;
  /** The mounted page's busy marker, run whenever any write takes the lock. */
  busy: Set<() => void>;
}
interface UndoEntry {
  plan: RevokePlan;
  /** Pod-relative item names by ACL document, to say which parts an Undo restored. */
  items: Record<string, string[]>;
}
const CHANGED_ELSEWHERE = "This access was changed elsewhere, so it can't be restored here";
const ANOTHER_WRITE = "Another change is saving. Try again in a moment.";
function undoEntry(plan: RevokePlan, changes: RevokePlan, storage: string): UndoEntry {
  const items: Record<string, string[]> = {};
  for (const change of changes.changes) {
    const path = relativePath(change.resource, storage);
    const names = items[change.source] ?? [];
    items[change.source] = [...new Set([...names, path === "/" ? "your pod" : path])];
  }
  return { plan, items };
}
function itemNames(entry: UndoEntry, sources: string[]): string {
  const names = [...new Set(sources.flatMap((source) => entry.items[source] ?? []))];
  return names.length
    ? names.join(", ")
    : `${sources.length} ${sources.length === 1 ? "item" : "items"}`;
}
const caches = new WeakMap<typeof globalThis.fetch, SessionCache>();
export function readPermissionsView(): PermissionsView {
  try {
    return localStorage.getItem("suite.permissions.view") === "advanced" ? "advanced" : "overview";
  } catch {
    return "overview";
  }
}
export function writePermissionsView(view: PermissionsView): void {
  try {
    localStorage.setItem("suite.permissions.view", view);
  } catch {
    /* Best effort preference. */
  }
}
export function technicalDetailsEnabled(): boolean {
  try {
    return localStorage.getItem("suite.settings.advanced") === "1";
  } catch {
    return false;
  }
}

export function usePermissions() {
  const session = useHomeSession();
  const identity = `${session.webId}\u0000${session.storageUrl}`;
  let cache = caches.get(session.fetch);
  if (!cache || cache.identity !== identity) {
    cache = {
      identity,
      people: createPeopleNameResolver(),
      clients: {},
      names: {},
      undos: new Map(),
      settled: new Set(),
      busy: new Set(),
    };
    caches.set(session.fetch, cache);
  }
  const sessionCache = cache;
  const [state, dispatch] = useReducer(
    permissionsReducer,
    sessionCache.snapshot
      ? permissionsReducer(initialPermissionsState, {
          type: "loaded",
          snapshot: sessionCache.snapshot,
        })
      : initialPermissionsState,
  );
  const [online, setOnline] = useState(true);
  const [clients, setClients] = useState(sessionCache.clients);
  const generation = useRef(0);
  const mounted = useRef(false);
  const stateOwner = useRef(sessionCache);
  const stateRef = useRef(state);
  const scopedState = stateOwner.current === sessionCache ? state : initialPermissionsState;
  stateRef.current = scopedState;

  const refresh = useCallback(async () => {
    if (sessionCache.writing || (!navigator.onLine && sessionCache.snapshot)) return;
    const seq = ++generation.current;
    try {
      // Existing discovery supplies registrations; the permissions model owns all aggregation.
      let locations: Awaited<ReturnType<typeof readTypeIndexes>>["locations"] = [];
      try {
        const profile = session.webId.split("#")[0] as string;
        if (!httpUrl(profile)) throw new TypeError("Expected an HTTP(S) profile URL");
        const scoped: typeof globalThis.fetch = (input, init) =>
          session.fetch(assertWithinPodScope(session.storageUrl, String(input)), {
            ...init,
            redirect: "error",
          });
        const plain: typeof globalThis.fetch = (input, init) =>
          globalThis.fetch(input, { ...init, credentials: "omit", redirect: "error" });
        const { dataset } = await fetchRdf(profile, {
          fetch: inStorage(profile, session.storageUrl) ? scoped : plain,
        });
        locations = (await readTypeIndexes(scoped, session.webId, dataset, session.storageUrl))
          .locations;
      } catch {
        /* The permissions walk reports inaccessible storage separately. */
      }
      const snapshot = await loadPermissions({
        fetch: session.fetch,
        storage: session.storageUrl,
        webId: session.webId,
        typeIndex: locations,
      });
      if (!mounted.current || seq !== generation.current) return;
      if (!snapshot.rows.length && snapshot.failures.some((f) => f.url === session.storageUrl)) {
        dispatch({ type: "error" });
        return;
      }
      const named = (rows: AgentRow[]): AgentRow[] =>
        rows.map((row) => {
          const name = sessionCache.names[row.key];
          return name ? { ...row, name } : row;
        });
      const current: PermissionsSnapshot = { ...snapshot, rows: named(snapshot.rows) };
      sessionCache.snapshot = current;
      dispatch({ type: "loaded", snapshot: current });
      // Paint fallback names immediately and apply each foreign name as it settles:
      // one slow profile or Client ID Document never holds back the others.
      const apply = (key: string, name: string | undefined) => {
        if (!name || sessionCache.names[key] === name) return;
        sessionCache.names[key] = name;
        const latest = sessionCache.snapshot ?? current;
        sessionCache.snapshot = { ...latest, rows: named(latest.rows) };
        if (mounted.current && stateOwner.current === sessionCache)
          dispatch({ type: "named", key, name });
      };
      for (const row of snapshot.rows) {
        if (row.kind === "app" && isClientIdDocument(row.id))
          void resolveClientName(row.id).then((metadata) => {
            sessionCache.clients[row.id] = metadata;
            if (mounted.current && stateOwner.current === sessionCache)
              setClients({ ...sessionCache.clients });
            apply(row.key, metadata.name);
          });
        else if (row.kind === "person")
          void sessionCache.people(row.id).then((name) => apply(row.key, name));
      }
    } catch {
      if (mounted.current && seq === generation.current) dispatch({ type: "error" });
    }
  }, [session, sessionCache]);

  useEffect(() => {
    mounted.current = true;
    stateOwner.current = sessionCache;
    dispatch({ type: "reset" });
    if (sessionCache.snapshot) dispatch({ type: "loaded", snapshot: sessionCache.snapshot });
    // A write from an earlier mount may still be saving; it refreshes this page when done.
    if (sessionCache.writing) dispatch({ type: "undo-start" });
    const settled = () => {
      dispatch({ type: "settled" });
      void refresh();
    };
    sessionCache.settled.add(settled);
    // Another page's write (a toast's Undo, say) still shows this page as saving.
    const busy = () => dispatch({ type: "undo-start" });
    sessionCache.busy.add(busy);
    setClients({ ...sessionCache.clients });
    setOnline(navigator.onLine);
    void refresh();
    let timer: ReturnType<typeof setTimeout>;
    let lastFocus = Date.now();
    const unsubscribe = session.subscribe?.(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    });
    const focus = () => {
      if (!unsubscribe && Date.now() - lastFocus >= 60_000) {
        lastFocus = Date.now();
        void refresh();
      }
    };
    const connection = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void refresh();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      mounted.current = false;
      generation.current++;
      sessionCache.settled.delete(settled);
      sessionCache.busy.delete(busy);
      clearTimeout(timer);
      unsubscribe?.();
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, [refresh, session, sessionCache]);

  /** Take the session's write lock and show whichever page is mounted as saving. */
  const acquire = useCallback(() => {
    const lock = {};
    sessionCache.writing = lock;
    for (const listener of sessionCache.busy) listener();
    return lock;
  }, [sessionCache]);

  /** Release the session's write lock; refresh this page, or the one mounted now. */
  const settle = useCallback(
    (lock: object, live: boolean) => {
      if (sessionCache.writing === lock) sessionCache.writing = undefined;
      if (live) void refresh();
      else for (const listener of sessionCache.settled) listener();
    },
    [refresh, sessionCache],
  );

  /**
   * Restore a revoke. From a toast (`event` given), a click while another change saves
   * is announced and the toast, with its Undo, stays open.
   */
  const undo = useCallback(
    async (token: string, event?: { preventDefault(): void }): Promise<void> => {
      const entry = sessionCache.undos.get(token);
      if (!entry || !navigator.onLine) return;
      if (sessionCache.writing) {
        if (event) {
          event.preventDefault();
          toast.info(ANOTHER_WRITE);
        }
        return;
      }
      const lock = acquire();
      const seq = ++generation.current;
      dispatch({ type: "undo-start" });
      // The result is always announced, even after navigating away from the page.
      const live = () => mounted.current && seq === generation.current;
      try {
        await applyRevoke(entry.plan, {
          fetch: session.fetch,
          storage: session.storageUrl,
          webId: session.webId,
        });
        sessionCache.undos.delete(token);
        if (live()) dispatch({ type: "undo-done", token });
        toast.success("Access restored");
      } catch (error) {
        const partial = error instanceof PartialRevokeError ? error : undefined;
        const cause = partial ? partial.cause : error;
        const restored = [...new Set(partial?.undo.restore?.map((delta) => delta.source))];
        if (restored.length) {
          const unrestored = (entry.plan.restore ?? []).filter(
            (delta) => !restored.includes(delta.source),
          );
          // The refused document can't come back here; documents after it still can.
          const conflict =
            cause instanceof RestoreConflictError
              ? (cause.source ?? unrestored[0]?.source)
              : undefined;
          const remaining = unrestored.filter((delta) => delta.source !== conflict);
          if (remaining.length)
            sessionCache.undos.set(token, { ...entry, plan: { changes: [], restore: remaining } });
          else sessionCache.undos.delete(token);
          if (live())
            dispatch(conflict ? { type: "undo-unavailable", token } : { type: "write-error" });
          const message = `Access restored for ${itemNames(entry, restored)}. ${
            conflict
              ? `Access to ${itemNames(entry, [conflict])} was changed elsewhere, so it can't be restored here`
              : `Couldn't restore access to ${itemNames(
                  entry,
                  remaining.map((delta) => delta.source),
                )}. Refresh and try again.`
          }`;
          if (remaining.length)
            toast.error(message, {
              action: {
                label: "Undo remaining",
                onClick: (click) => void undo(token, click),
              },
            });
          else toast.error(message);
        } else if (cause instanceof RestoreConflictError) {
          sessionCache.undos.delete(token);
          if (live()) dispatch({ type: "undo-unavailable", token });
          toast.error(CHANGED_ELSEWHERE);
        } else {
          if (live()) dispatch({ type: "write-error" });
          toast.error("Couldn't restore access. Refresh and try again.");
        }
      } finally {
        settle(lock, live());
      }
    },
    [acquire, session, sessionCache, settle],
  );

  const revoke = useCallback(
    async (target: AgentRow | PermissionLine | "makePrivate") => {
      if (sessionCache.writing || !navigator.onLine) return;
      const current = stateRef.current;
      const line = typeof target !== "string" && "resources" in target ? target : undefined;
      const rows =
        target === "makePrivate"
          ? current.rows.filter((r) => r.kind === "public" || r.kind === "authenticated")
          : line
            ? current.rows.filter((r) => r.lines.some((l) => l.key === line.key))
            : [target as AgentRow];
      const row = rows[0];
      if (!row) return;
      const name = agentName(row);
      const activeRows = rows.map((r) => ({
        ...r,
        lines: r.lines.filter((l) => !current.removed[l.key]),
      }));
      if (line && current.removed[line.key]) return;
      const lock = acquire();
      const seq = ++generation.current;
      // The plan and its toast outlive the page; only this page's state needs it live.
      const live = () => mounted.current && seq === generation.current;
      dispatch({ type: "start", row, ...(line ? { line } : {}) });
      let plan: RevokePlan = { changes: [] };
      try {
        plan = line
          ? planRevoke(line, "line")
          : planRevoke(
              {
                rows: activeRows,
                failures: current.failures,
                truncated: current.truncated,
                summary: { people: 0, apps: 0, publicItems: 0 },
              },
              target === "makePrivate" ? "make-private" : "all",
            );
        const result = await applyRevoke(plan, {
          fetch: session.fetch,
          storage: session.storageUrl,
          webId: session.webId,
        });
        const token = crypto.randomUUID();
        sessionCache.undos.set(token, undoEntry(result.undo, plan, session.storageUrl));
        if (live()) {
          if (line) dispatch({ type: "line-done", key: line.key, token });
          else dispatch({ type: "row-done", keys: rows.map((r) => r.key) });
        }
        toast.success(
          line
            ? consequenceText(line, name, session.storageUrl)
            : target === "makePrivate"
              ? "Public and signed-in access removed"
              : `${name} no longer has access`,
          {
            duration: 8000,
            action: { label: "Undo", onClick: (click) => void undo(token, click) },
          },
        );
      } catch (error) {
        if (live()) dispatch({ type: "write-error", ...(line ? { key: line.key } : {}) });
        const message =
          error instanceof UnsupportedAccessError
            ? "This storage doesn't support changing access here yet"
            : error instanceof LockoutError
              ? "This change would remove your own access"
              : `Couldn't change access for ${name}`;
        if (error instanceof PartialRevokeError) {
          const token = crypto.randomUUID();
          sessionCache.undos.set(token, undoEntry(error.undo, plan, session.storageUrl));
          toast.error(message, {
            duration: Infinity,
            description: "Some changes were saved. Undo them or refresh before trying again.",
            action: { label: "Undo", onClick: (click) => void undo(token, click) },
          });
        } else toast.error(message, { duration: Infinity });
      } finally {
        settle(lock, live());
      }
    },
    [acquire, session, sessionCache, settle, undo],
  );

  return {
    ...scopedState,
    online,
    clients: stateOwner.current === sessionCache ? clients : {},
    refresh,
    revoke,
    undo,
    collapse: (key: string) => dispatch({ type: "collapse", key }),
  };
}
export type PermissionsBinding = ReturnType<typeof usePermissions>;
