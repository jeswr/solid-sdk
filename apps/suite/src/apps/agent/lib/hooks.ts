// AUTHORED-BY Codex GPT-6.1-Sol
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
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const [state, setState] = useState<Query<Workspace>>({ status: "loading", reload });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries this query
  useEffect(() => {
    let active = true;
    setState({ status: "loading", reload });
    void discoverWorkspace(session.fetch, session.webId, session.storageUrl).then(
      (workspace) => {
        if (active)
          setState({
            status: "ready",
            data: {
              session,
              client: createAgentClient({
                fetch: session.fetch,
                storage: session.storageUrl,
                workspace,
              }),
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
  }, [session, reload, attempt]);
  if (state.status !== "ready") return fallback(state);
  if (state.data.session !== session) return fallback({ status: "loading", reload });
  return createElement(WorkspaceContext, { value: state.data }, children);
}
/** Loads are fenced on unmount, retry, notifications and account changes. */
export function useAgentQuery<T>(
  key: string,
  loader: (client: AgentClient) => Promise<T>,
): Query<T> {
  const { client, session } = useAgentWorkspace();
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
    const run = () => {
      const request = ++generation;
      setState({ key, client, query: { status: "loading", reload } });
      void load.current(client).then(
        (data) => {
          if (active && request === generation)
            setState({ key, client, query: { status: "ready", data, reload } });
        },
        (error) => {
          if (active && request === generation)
            setState({ key, client, query: { status: "error", error, reload } });
        },
      );
    };
    run();
    const unsubscribe = session.subscribe((url) => {
      // URL keys are scope-checked by the client before loading; subscription keys are local.
      if (url === key || url.startsWith(key.endsWith("/") ? key : `${key}/`)) {
        ++generation;
        clearTimeout(timer);
        timer = setTimeout(run, 150);
      }
    });
    return () => {
      active = false;
      ++generation;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [client, session, key, reload, attempt]);
  return state.key === key && state.client === client ? state.query : { status: "loading", reload };
}
