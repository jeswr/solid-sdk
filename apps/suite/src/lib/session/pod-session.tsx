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
import { boundedRead } from "./bounded-read";
import {
  chooseSession,
  ExtensionSessionError,
  isLiveStorageGrant,
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
  /** Native page reads of public profiles/indexes, always without credentials. */
  readonly publicFetch: typeof globalThis.fetch;
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
    let observed = ABSENT;
    let observedApi: ExtensionWindow["solid"];
    let requestedKey: string | undefined;
    let selectedGrant: SolidExtensionGrant | undefined;
    let failed = false;
    let pending = Promise.resolve();
    let connecting: Promise<void> | undefined;
    let opening = new AbortController();
    type CheckQueue = {
      controller: AbortController;
      promise: Promise<void>;
      queued: boolean;
      retry: boolean;
      allowRetry: boolean;
    };
    let checking: CheckQueue | undefined;
    let fallbackTimer: unknown;
    let expiryTimer: unknown;
    let retryTimer: unknown;
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
      selectedGrant = grant;
      failed = false;
      const captured = ++generation;
      opening.abort();
      opening = new AbortController();
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
              signal: opening.signal,
            });
            if (!isCurrent(captured)) return;
            const session: ExtensionPodSession = {
              ...opened,
              disconnect: async () => {
                try {
                  await opened.disconnect();
                } finally {
                  // Older extensions don't broadcast class revocations. Re-read even on failure.
                  if (live) {
                    if (isCurrent(captured)) invalidate();
                    await refresh();
                  }
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
              void refresh(true);
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

    const invalidate = () => {
      ++generation;
      ++decisionGeneration;
      opening.abort();
      checking?.controller.abort();
      checking = undefined;
      win.clearTimeout(retryTimer);
      win.clearTimeout(expiryTimer);
      requestedKey = undefined;
      selectedGrant = undefined;
      setState({ status: "loading" });
    };

    const observe = () => {
      const next = readSolidExtension();
      setExtension(next);
      if (
        next.webId !== observed.webId ||
        next.present !== observed.present ||
        next.granted !== observed.granted ||
        win.solid !== observedApi
      ) {
        observed = next;
        observedApi = win.solid;
        // A new account/binding must never queue behind a lost reply from the old one.
        invalidate();
      }
      return next;
    };

    const recheck = async (
      queue: CheckQueue,
      request: number,
      retry: boolean,
      allowRetry: boolean,
    ): Promise<void> => {
      const next = observe();
      try {
        const api = win.solid;
        const listGrants = api?.listGrants;
        if (!next.present || !api || !listGrants) {
          // The permanent stub announces before its asynchronous initial state arrives.
          if (next.present && initialDecision) return;
          finishInitialDecision();
          win.clearTimeout(expiryTimer);
          void select(
            null,
            undefined,
            next.present ? new ExtensionSessionError("not-granted") : undefined,
          );
          return;
        }
        const grants = await boundedRead(
          () => listGrants.call(api),
          5000,
          queue.controller.signal,
          win,
        );
        if (!live || checking !== queue) return;
        if (request !== decisionGeneration) {
          queue.retry ||= retry;
          return;
        }
        if (readSolidExtension().webId !== next.webId || win.solid !== api) {
          void refresh(retry);
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
        void select(
          next.webId,
          next.webId && api.fetch ? grant : undefined,
          grant
            ? undefined
            : new ExtensionSessionError(
                grants.some((candidate) => isLiveStorageGrant(candidate, Date.now()))
                  ? "no-storage"
                  : "not-granted",
              ),
          retry,
        );
      } catch (error) {
        if (!live || checking !== queue) return;
        if (request !== decisionGeneration) {
          queue.retry ||= retry;
          return;
        }
        if (readSolidExtension().webId !== next.webId) {
          void refresh(retry);
          return;
        }
        finishInitialDecision();
        // Keep a known safe session during a transient failure, but never retain an
        // expired grant or an account whose generation has already been invalidated.
        if (!requestedKey || (selectedGrant && selectedGrant.expiresAt <= Date.now())) {
          win.clearTimeout(expiryTimer);
          void select(null, undefined, error);
        } else setExtensionError(error);
        if (allowRetry) {
          win.clearTimeout(retryTimer);
          retryTimer = win.setTimeout(() => void refresh(retry, false), 1000);
        }
      }
    };

    // Coalesce within one account generation. Superseded queues stop independently.
    // Session opening is separate: a slow public profile must not block an account switch.
    const refresh = async (retry = false, allowRetry = true): Promise<void> => {
      if (!live) return;
      observe(); // Invalidate retained sessions immediately, even while a check is pending.
      win.clearTimeout(retryTimer);
      ++decisionGeneration;
      if (!checking) {
        const queue: CheckQueue = {
          controller: new AbortController(),
          promise: Promise.resolve(),
          queued: true,
          retry,
          allowRetry,
        };
        checking = queue;
        queue.promise = (async () => {
          while (live && checking === queue && queue.queued) {
            queue.queued = false;
            const retry = queue.retry;
            const allowRetry = queue.allowRetry;
            queue.retry = false;
            queue.allowRetry = false;
            await recheck(queue, decisionGeneration, retry, allowRetry);
          }
        })().finally(() => {
          if (checking === queue) checking = undefined;
        });
      } else {
        checking.queued = true;
        checking.retry ||= retry;
        checking.allowRetry ||= allowRetry;
      }
      await checking.promise;
      await pending;
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
      opening.abort();
      checking?.controller.abort();
      win.clearTimeout(fallbackTimer);
      win.clearTimeout(expiryTimer);
      win.clearTimeout(retryTimer);
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
