// AUTHORED-BY Codex GPT-6
"use client";

import { fetchRdf } from "@jeswr/fetch-rdf";
import { toast } from "@jeswr/suite-ui";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useHomeSession } from "../components/home-app";
import { httpUrl, subjectOf } from "../lib/model/rdf";
import { readTypeIndexes } from "../lib/model/type-index";
import {
  type AgentRow,
  applyRevoke,
  type ClientMetadata,
  LockoutError,
  loadPermissions,
  PartialRevokeError,
  type PermissionLine,
  type PermissionsSnapshot,
  planRevoke,
  type RevokePlan,
  resolveClientName,
  UnsupportedAccessError,
} from "../lib/permissions";
import { agentName, consequenceText, type PermissionsView } from "../lib/permissions/view";

interface RemovedLine {
  row: AgentRow;
  line: PermissionLine;
  token?: string;
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
  | { type: "loaded"; snapshot: PermissionsSnapshot }
  | { type: "error" }
  | { type: "start"; row: AgentRow; line?: PermissionLine }
  | { type: "line-done"; key: string; token: string }
  | { type: "row-done"; keys: string[] }
  | { type: "write-error"; key?: string }
  | { type: "undo-done"; token: string }
  | { type: "collapse"; key: string };

export function permissionsReducer(
  state: PermissionsState,
  action: PermissionsAction,
): PermissionsState {
  switch (action.type) {
    case "undo-start":
      return { ...state, busy: true };
    case "reset":
      return initialPermissionsState;
    case "loaded": {
      const rows = action.snapshot.rows.map((row) => ({ ...row, lines: [...row.lines] }));
      for (const entry of Object.values(state.removed)) {
        let row = rows.find((r) => r.key === entry.row.key);
        if (!row) {
          row = { ...entry.row, lines: [] };
          rows.push(row);
        }
        if (!row.lines.some((l) => l.key === entry.line.key)) row.lines.push(entry.line);
      }
      return { ...state, ...action.snapshot, rows, status: "ready" };
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
    cache = { identity, people: createPeopleNameResolver(), clients: {} };
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
  const writing = useRef<number | undefined>(undefined);
  const stateOwner = useRef(sessionCache);
  const undos = useRef(new Map<string, RevokePlan>());
  const stateRef = useRef(state);
  const scopedState = stateOwner.current === sessionCache ? state : initialPermissionsState;
  stateRef.current = scopedState;

  const refresh = useCallback(async () => {
    if (writing.current || (!navigator.onLine && sessionCache.snapshot)) return;
    const seq = ++generation.current;
    try {
      // Existing discovery supplies registrations; the permissions model owns all aggregation.
      let locations: Awaited<ReturnType<typeof readTypeIndexes>>["locations"] = [];
      try {
        const { dataset } = await fetchRdf(session.webId.split("#")[0] as string, {
          fetch: session.fetch,
        });
        locations = (
          await readTypeIndexes(session.fetch, session.webId, dataset, session.storageUrl)
        ).locations;
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
      sessionCache.snapshot = snapshot;
      dispatch({ type: "loaded", snapshot });
      // Paint fallback names immediately; foreign metadata must not block the list.
      const rows = await Promise.all(
        snapshot.rows.map(async (row) => {
          if (row.kind === "app") {
            const metadata = await resolveClientName(row.id);
            sessionCache.clients[row.id] = metadata;
            return metadata.name ? { ...row, name: metadata.name } : row;
          }
          if (row.kind !== "person") return row;
          const name = await sessionCache.people(row.id);
          return name ? { ...row, name } : row;
        }),
      );
      if (!mounted.current || seq !== generation.current) return;
      sessionCache.snapshot = { ...snapshot, rows };
      setClients({ ...sessionCache.clients });
      dispatch({ type: "loaded", snapshot: sessionCache.snapshot });
    } catch {
      if (mounted.current && seq === generation.current) dispatch({ type: "error" });
    }
  }, [session, sessionCache]);

  useEffect(() => {
    mounted.current = true;
    writing.current = undefined;
    stateOwner.current = sessionCache;
    undos.current.clear();
    dispatch({ type: "reset" });
    if (sessionCache.snapshot) dispatch({ type: "loaded", snapshot: sessionCache.snapshot });
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
      clearTimeout(timer);
      unsubscribe?.();
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, [refresh, session, sessionCache]);

  const undo = useCallback(
    async (token: string) => {
      const plan = undos.current.get(token);
      if (!plan || writing.current || !navigator.onLine) return;
      const seq = ++generation.current;
      writing.current = seq;
      dispatch({ type: "undo-start" });
      try {
        await applyRevoke(plan, {
          fetch: session.fetch,
          storage: session.storageUrl,
          webId: session.webId,
        });
        if (mounted.current && seq === generation.current) {
          undos.current.delete(token);
          dispatch({ type: "undo-done", token });
          toast.success("Access restored");
        }
      } catch {
        if (mounted.current && seq === generation.current) {
          dispatch({ type: "write-error" });
          toast.error("Couldn't restore access. Refresh and try again.");
        }
      } finally {
        if (writing.current === seq) writing.current = undefined;
        if (mounted.current && seq === generation.current) void refresh();
      }
    },
    [refresh, session],
  );

  const revoke = useCallback(
    async (target: AgentRow | PermissionLine | "makePrivate") => {
      if (writing.current || !navigator.onLine) return;
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
      const seq = ++generation.current;
      writing.current = seq;
      dispatch({ type: "start", row, ...(line ? { line } : {}) });
      try {
        const plan = line
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
        if (!mounted.current || seq !== generation.current) return;
        const token = crypto.randomUUID();
        undos.current.set(token, result.undo);
        if (line) dispatch({ type: "line-done", key: line.key, token });
        else dispatch({ type: "row-done", keys: rows.map((r) => r.key) });
        toast.success(line ? consequenceText(line, name) : `${name} no longer has access`, {
          duration: 8000,
          action: { label: "Undo", onClick: () => void undo(token) },
        });
      } catch (error) {
        if (!mounted.current || seq !== generation.current) return;
        dispatch({ type: "write-error", ...(line ? { key: line.key } : {}) });
        const message =
          error instanceof UnsupportedAccessError
            ? "This storage doesn't support changing access here yet"
            : error instanceof LockoutError
              ? "This change would remove your own access"
              : `Couldn't change access for ${name}`;
        if (error instanceof PartialRevokeError) {
          const token = crypto.randomUUID();
          undos.current.set(token, error.undo);
          toast.error(message, {
            duration: Infinity,
            description: "Some changes were saved. Undo them or refresh before trying again.",
            action: { label: "Undo", onClick: () => void undo(token) },
          });
        } else toast.error(message, { duration: Infinity });
      } finally {
        if (writing.current === seq) writing.current = undefined;
        if (mounted.current && seq === generation.current) void refresh();
      }
    },
    [refresh, session, undo],
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
