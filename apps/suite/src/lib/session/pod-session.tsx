// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
  type SolidExtensionGrant,
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
    let initialDecision = true;
    let generation = 0;
    let decisionGeneration = 0;
    let observedWebId: string | null = null;
    let requestedKey: string | undefined;
    let failed = false;
    let pending = Promise.resolve();
    let connecting: Promise<void> | undefined;
    let fallbackTimer: unknown;
    let expiryTimer: unknown;
    const win = window as unknown as ExtensionWindow;
    const isCurrent = (captured: number) => live && captured === generation;
    const finishInitialDecision = () => {
      initialDecision = false;
      win.clearTimeout(fallbackTimer);
    };

    const select = (
      webId: string | null,
      grant?: SolidExtensionGrant,
      error?: unknown,
      retry = false,
    ): Promise<void> => {
      const key = JSON.stringify([grant ? "extension" : "demo", grant ? webId : null, grant]);
      if (key === requestedKey && !(retry && failed)) {
        if (!failed) setExtensionError(error);
        return pending;
      }
      setExtensionError(error);
      requestedKey = key;
      failed = false;
      const captured = ++generation;
      setState({ status: "loading" });
      pending = (async () => {
        if (grant) {
          try {
            const api = win.solid;
            if (!api) throw new ExtensionSessionError("unavailable");
            const opened = await openExtensionSession(api, {
              grant,
              generation: captured,
              isCurrent,
            });
            if (!isCurrent(captured)) return;
            const session: ExtensionPodSession = {
              ...opened,
              disconnect: async () => {
                try {
                  await opened.disconnect();
                } finally {
                  // Older extensions don't broadcast class revocations. Re-read even on failure.
                  if (live) await refresh();
                }
              },
            };
            setExtensionError(undefined);
            setState({ status: "ready", session });
            return;
          } catch (error) {
            if (!isCurrent(captured)) return;
            if (error instanceof ExtensionSessionError && error.code === "stale") {
              requestedKey = undefined;
              await refresh(true);
              return;
            }
            failed = true;
            setExtensionError(error);
          }
        }
        try {
          const session = await openDemoSession();
          if (isCurrent(captured)) setState({ status: "ready", session });
        } catch (error) {
          if (isCurrent(captured)) setState({ status: "error", mode: "demo", error });
        }
      })();
      return pending;
    };

    const refresh = async (retry = false): Promise<void> => {
      const request = ++decisionGeneration;
      const next = readSolidExtension();
      setExtension(next);
      if (next.webId !== observedWebId) {
        observedWebId = next.webId;
        ++generation; // Invalidate opened sessions before awaiting the new account's grants.
        requestedKey = undefined;
        setState({ status: "loading" });
      }
      try {
        const api = win.solid;
        if (!next.present || !api?.listGrants) {
          // The permanent stub announces before its asynchronous initial state arrives.
          if (next.present && initialDecision) return;
          finishInitialDecision();
          win.clearTimeout(expiryTimer);
          await select(
            null,
            undefined,
            next.present ? new ExtensionSessionError("not-granted") : undefined,
          );
          return;
        }
        const grants = await api.listGrants();
        if (!live || request !== decisionGeneration) return;
        if (readSolidExtension().webId !== next.webId || win.solid !== api) {
          await refresh(retry);
          return;
        }
        finishInitialDecision();
        const grant = chooseSession(grants);
        win.clearTimeout(expiryTimer);
        if (grant) {
          // P30D exceeds the browser's signed 32-bit timer limit; re-check in bounded chunks.
          expiryTimer = win.setTimeout(
            () => void refresh(),
            Math.min(grant.expiresAt - Date.now(), 2_147_483_647),
          );
        }
        await select(
          next.webId,
          next.webId && api.fetch ? grant : undefined,
          grant ? undefined : new ExtensionSessionError("not-granted"),
          retry,
        );
      } catch (error) {
        if (!live || request !== decisionGeneration) return;
        if (readSolidExtension().webId !== next.webId) {
          await refresh(retry);
          return;
        }
        finishInitialDecision();
        win.clearTimeout(expiryTimer);
        await select(null, undefined, error);
      }
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
    void detectSolidExtension(500).then((present) => {
      if (!live) return;
      started = true;
      if (present) {
        fallbackTimer = win.setTimeout(() => {
          finishInitialDecision();
          void select(null, undefined, new ExtensionSessionError("unavailable"));
        }, 1500);
      }
      return refresh();
    });
    return () => {
      live = false;
      ++generation;
      ++decisionGeneration;
      win.clearTimeout(fallbackTimer);
      win.clearTimeout(expiryTimer);
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
