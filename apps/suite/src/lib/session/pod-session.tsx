// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
/**
 * App sessions follow the shell account and its authenticated fetch. Standalone
 * previews retain the extension/demo adapter; a shell session never falls back to demo.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOptionalAccounts } from "@/shell/session/accounts-context";
import type { AccountsContextValue } from "@/shell/session/accounts-provider";
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

import type {
  DemoPodSession,
  ExtensionPodSession,
  PodSession,
  SessionResult,
  SessionState,
} from "./types";

export type { DemoPodSession, ExtensionPodSession, PodSession } from "./types";

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
  const accounts = useOptionalAccounts();
  return accounts ? (
    <ShellPodSessionProvider accounts={accounts}>{children}</ShellPodSessionProvider>
  ) : (
    <InterimPodSessionProvider>{children}</InterimPodSessionProvider>
  );
}

const publicFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, { ...init, credentials: "omit" });

function ShellPodSessionProvider({
  accounts,
  children,
}: {
  accounts: AccountsContextValue;
  children: ReactNode;
}) {
  const latest = useRef(accounts);
  latest.current = accounts;
  const account = accounts.active;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const binding = useRef({ account, version: 0 });
  if (binding.current.account !== account)
    binding.current = { account, version: binding.current.version + 1 };
  const session = useMemo<PodSession | undefined>(() => {
    if (!account) return undefined;
    const version = binding.current.version;
    const usable = () =>
      mounted.current &&
      binding.current.version === version &&
      latest.current.status === "ready" &&
      latest.current.active === account;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (!usable()) throw new Error("Sign in to continue");
      const response = await latest.current.fetch(input, init);
      if (!usable()) throw new Error("Sign in to continue");
      return response;
    };
    const subscribe = (listener: (url: string) => void) => {
      let stopped = false;
      let stopDemo = () => {};
      if (account.kind === "demo")
        void getDemoPod()
          .then((pod) => {
            if (!stopped && usable())
              stopDemo = pod.subscribe((url) => {
                if (usable()) listener(url);
              });
          })
          .catch(() => {
            /* Opening errors surface through the session's fetch. */
          });
      const onFocus = () => {
        if (usable()) listener(account.storageUrl);
      };
      window.addEventListener("focus", onFocus);
      return () => {
        stopped = true;
        stopDemo();
        window.removeEventListener("focus", onFocus);
      };
    };
    const common = {
      webId: account.webId,
      displayName: account.name,
      storageUrl: account.storageUrl,
      fetch,
      subscribe,
    };
    if (account.kind === "demo")
      return {
        ...common,
        mode: "demo",
        reset: async () => {
          if (usable()) {
            await resetDemoPod();
            if (usable()) location.reload();
          }
        },
      };
    if (account.kind === "extension")
      return {
        ...common,
        mode: "extension",
        publicFetch,
        disconnect: () => latest.current.signOut(account.id),
      };
    return { ...common, mode: "solid", publicFetch };
  }, [account]);
  const state: SessionState = {
    ...(accounts.status === "loading"
      ? { status: "loading" as const }
      : accounts.status !== "signed-out" && session
        ? { status: "ready" as const, session }
        : { status: "signed-out" as const }),
    extension: ABSENT,
    connectExtension: async () => {},
  };
  return <SessionContext value={state}>{children}</SessionContext>;
}

function InterimPodSessionProvider({ children }: { children: ReactNode }) {
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
                let disconnected = false;
                try {
                  await opened.disconnect();
                  disconnected = true;
                } finally {
                  // Older extensions don't broadcast class revocations. Re-read even on failure.
                  if (live) {
                    if (disconnected && isCurrent(captured)) invalidate();
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
