// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
/**
 * Drive's interim account session: the installed extension's granted pod, or
 * the in-browser demo pod. Every data operation uses the active session's fetch.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { getDemoPod, resetDemoPod } from "../demo-pod/browser";
import { DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../demo-pod/seed";
import {
  chooseSession,
  ExtensionSessionError,
  openExtensionSession,
  requestStorageAccess,
} from "./extension-pod-session";
import {
  ABSENT,
  detectSolidExtension,
  type ExtensionWindow,
  readSolidExtension,
  type SolidExtensionState,
  subscribeSolidExtension,
} from "./extension-session";

interface SessionAccount {
  readonly webId: string;
  readonly displayName: string;
  readonly storageUrl: string;
  readonly fetch: typeof globalThis.fetch;
  /** Change events or focus-driven revalidation for resources in the storage. */
  subscribe(listener: (url: string) => void): () => void;
}

export interface DemoPodSession extends SessionAccount {
  readonly mode: "demo";
  reset(): Promise<void>;
}

export interface ExtensionPodSession extends SessionAccount {
  readonly mode: "extension";
  disconnect(): Promise<void>;
}

export type PodSession = DemoPodSession | ExtensionPodSession;

type SessionResult =
  | { status: "loading" }
  | { status: "ready"; session: PodSession }
  | { status: "error"; mode: PodSession["mode"]; error: unknown };

type SessionState = SessionResult & {
  extension: SolidExtensionState;
  connectExtension(): Promise<void>;
  extensionError?: unknown;
};

const SessionContext = createContext<SessionState>({
  status: "loading",
  extension: ABSENT,
  connectExtension: async () => {},
});

async function openDemoSession(): Promise<DemoPodSession> {
  const pod = await getDemoPod();
  return {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: DEMO_NAME,
    storageUrl: DEMO_ROOT,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {
      await resetDemoPod();
      location.reload();
    },
  };
}

export function PodSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionResult>({ status: "loading" });
  const [extension, setExtension] = useState<SolidExtensionState>(ABSENT);
  const [extensionError, setExtensionError] = useState<unknown>();
  const connect = useRef<() => Promise<void>>(async () => {});
  const connectExtension = useCallback(() => connect.current(), []);

  useEffect(() => {
    let live = true;
    let started = false;
    let generation = 0;
    let requestedKey: string | undefined;
    let failed = false;
    let pending = Promise.resolve();
    let connecting: Promise<void> | undefined;
    const win = window as unknown as ExtensionWindow;

    const refresh = (retry = false): Promise<void> => {
      const next = readSolidExtension();
      setExtension(next);
      const mode = chooseSession(next);
      const key = JSON.stringify([mode, mode === "extension" ? next.webId : null]);
      if (key === requestedKey && !(retry && failed)) return pending;
      requestedKey = key;
      failed = false;
      const request = ++generation;
      const current = () => live && request === generation;
      setState({ status: "loading" });
      pending = (async () => {
        if (mode === "extension") {
          try {
            const api = win.solid;
            if (!api) throw new ExtensionSessionError("unavailable");
            const session = await openExtensionSession(api);
            if (current()) {
              setExtensionError(undefined);
              setState({ status: "ready", session });
            }
            return;
          } catch (error) {
            if (!current()) return;
            failed = true;
            setExtensionError(error);
          }
        }
        try {
          const session = await openDemoSession();
          if (current()) setState({ status: "ready", session });
        } catch (error) {
          if (current()) setState({ status: "error", mode: "demo", error });
        }
      })();
      return pending;
    };

    connect.current = () => {
      if (connecting) return connecting;
      connecting = (async () => {
        try {
          setExtensionError(undefined);
          const api = win.solid;
          if (!api) throw new ExtensionSessionError("unavailable");
          if ((await requestStorageAccess(api)) && live) await refresh(true);
        } catch (error) {
          if (live) setExtensionError(error);
        }
      })().finally(() => {
        connecting = undefined;
      });
      return connecting;
    };
    const stop = subscribeSolidExtension(() => {
      if (started) void refresh();
    });
    void detectSolidExtension(500).then(() => {
      if (!live) return;
      started = true;
      return refresh();
    });
    return () => {
      live = false;
      stop();
      connect.current = async () => {};
    };
  }, []);
  return (
    <SessionContext value={{ ...state, extension, connectExtension, extensionError }}>
      {children}
    </SessionContext>
  );
}

export function usePodSessionState(): SessionState {
  return useContext(SessionContext);
}
