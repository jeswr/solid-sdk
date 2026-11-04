// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PodSession } from "../../../lib/session/pod-session";
import { type AgentClient, createAgentClient } from "./client";
import { discoverWorkspace } from "./paths";

export type Query<T> =
  | { status: "loading"; data?: undefined; error?: undefined; reload(): void }
  | { status: "ready"; data: T; error?: undefined; reload(): void }
  | { status: "error"; data?: undefined; error: unknown; reload(): void };
export interface Workspace {
  session: PodSession;
  client: AgentClient;
}
const WorkspaceContext = createContext<Workspace | undefined>(undefined);
/** `quiet` notices (timed polls) refresh in place; others show loading like a pod notification. */
type Listener = (url: string, quiet?: boolean) => void;
/** Local change notices: successful writes through the workspace client, and status polls. */
function createNoticeBus() {
  const listeners = new Set<Listener>();
  return {
    invalidate(url: string, quiet = false) {
      for (const listener of [...listeners]) listener(url, quiet);
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
const InvalidationContext = createContext(createNoticeBus());
export function useAgentInvalidate() {
  return useContext(InvalidationContext).invalidate;
}
/**
 * Whether a change notice for `url` affects the query keyed `key`: the key itself, anything inside
 * it, or a container that holds it (the extension announces only its storage root on focus).
 * Containers end in "/", so the ancestor check stays on path boundaries.
 */
export function noticeAffects(url: string, key: string): boolean {
  if (url === key) return true;
  if (url.startsWith(key.endsWith("/") ? key : `${key}/`)) return true;
  return url.endsWith("/") && key.startsWith(url);
}
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Heartbeats land without a change notice on some sessions, so status re-reads on a timer. */
export const STATUS_REFRESH_MS = 30_000;
/** The URL a successful write changed, or undefined for reads and failed requests. */
export function writtenUrl(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  response: Response,
): string | undefined {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (!response.ok || READ_METHODS.has(method.toUpperCase())) return undefined;
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}
const ClockContext = createContext(0);
/** Shared by status, queue expiry, countdowns, and the sidebar waiting count. */
export function useAgentClock() {
  return Math.max(useContext(ClockContext), Date.now());
}
/**
 * The workspace tick: stable between ticks, so memoised results and effects keyed on it
 * don't change on every render. Outside a workspace it starts at the component's mount time.
 */
export function useAgentTick() {
  const tick = useContext(ClockContext);
  const [mounted] = useState(Date.now);
  return Math.max(tick, mounted);
}
export function useAgentWorkspace(): Workspace {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Agent workspace is not ready");
  return context;
}
export function AgentWorkspaceProvider({
  session,
  children,
  fallback,
}: {
  session: PodSession;
  children: ReactNode;
  fallback: (query: Query<Workspace>) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const [bus] = useState(createNoticeBus);
  const [state, setState] = useState<Query<Workspace>>({ status: "loading", reload });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries this query
  useEffect(() => {
    let active = true;
    setState({ status: "loading", reload });
    void discoverWorkspace(
      session.fetch,
      session.webId,
      session.storageUrl,
      session.mode === "extension" ? session.publicFetch : undefined,
    ).then(
      (workspace) => {
        // Writes announce themselves, so sessions without push notices still refresh.
        const io: PodSession["fetch"] = async (input, init) => {
          const response = await session.fetch(input, init);
          const written = writtenUrl(input, init, response);
          if (written) bus.invalidate(written);
          return response;
        };
        if (active)
          setState({
            status: "ready",
            data: {
              session,
              client: createAgentClient({ fetch: io, storage: session.storageUrl, workspace }),
            },
            reload,
          });
      },
      (error) => {
        if (active) setState({ status: "error", error, reload });
      },
    );
    return () => {
      active = false;
    };
  }, [session, reload, attempt, bus]);
  const pollClient = state.status === "ready" ? state.data.client : undefined;
  useEffect(() => {
    if (!pollClient) return;
    // One poller per workspace; it targets the status key only and skips hidden tabs.
    const poll = () => {
      if (document.visibilityState !== "hidden") bus.invalidate(pollClient.paths.control, true);
    };
    const timer = setInterval(poll, STATUS_REFRESH_MS);
    // A tab shown again catches up at once instead of waiting for the next tick.
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [pollClient, bus]);
  if (state.status !== "ready") return fallback(state);
  if (state.data.session !== session) return fallback({ status: "loading", reload });
  return createElement(
    InvalidationContext,
    { value: bus },
    createElement(
      WorkspaceContext,
      { value: state.data },
      createElement(ClockContext, { value: now }, children),
    ),
  );
}
/** Loads are fenced on unmount, retry, notifications and account changes. */
export function useAgentQuery<T>(
  key: string,
  loader: (client: AgentClient) => Promise<T>,
  debounceMs = 150,
): Query<T> {
  const { client, session } = useAgentWorkspace();
  const local = useContext(InvalidationContext);
  const load = useRef(loader);
  load.current = loader;
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const [state, setState] = useState<{ key: string; client: AgentClient; query: Query<T> }>({
    key,
    client,
    query: { status: "loading", reload },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries this query
  useEffect(() => {
    let active = true;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout>;
    let pendingQuiet = true;
    // A quiet notice refreshes in place: ready data stays on screen until the new read settles.
    const run = (refresh = false) => {
      const request = ++generation;
      if (!refresh) setState({ key, client, query: { status: "loading", reload } });
      void load.current(client).then(
        (data) => {
          if (active && request === generation)
            setState({ key, client, query: { status: "ready", data, reload } });
        },
        (error) => {
          if (!active || request !== generation) return;
          // A failed background poll keeps what is on screen; the next poll or notice retries.
          setState((current) =>
            refresh &&
            current.key === key &&
            current.client === client &&
            current.query.status === "ready"
              ? current
              : { key, client, query: { status: "error", error, reload } },
          );
        },
      );
    };
    run();
    const notice = (url: string, quiet = false) => {
      // URL keys are scope-checked by the client before loading; subscription keys are local.
      // A quiet poll names the exact key it refreshes; it never fans out to ancestors.
      if (quiet ? url === key : noticeAffects(url, key)) {
        ++generation;
        clearTimeout(timer);
        // A pending loud refresh stays loud if a quiet poll lands inside its debounce.
        pendingQuiet = pendingQuiet && quiet;
        timer = setTimeout(() => {
          const refresh = pendingQuiet;
          pendingQuiet = true;
          run(refresh);
        }, debounceMs);
      }
    };
    const unsubscribe = session.subscribe(notice);
    const unsubscribeLocal = local.subscribe(notice);
    return () => {
      active = false;
      ++generation;
      clearTimeout(timer);
      unsubscribe();
      unsubscribeLocal();
    };
  }, [client, session, local, key, reload, attempt, debounceMs]);
  return state.key === key && state.client === client ? state.query : { status: "loading", reload };
}
