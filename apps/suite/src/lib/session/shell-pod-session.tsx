// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";

/** Shared shell account adapter for web and native app sessions. */
import { createContext, type ReactNode, useContext, useLayoutEffect, useMemo, useRef } from "react";
import type { AccountsContextValue } from "@/shell/session/accounts-provider";
import { getDemoPod, resetDemoPod } from "../demo-pod/browser";
import { ABSENT } from "./extension-session";
import { openNativePodCache } from "./native-pod-cache";
import type { PodSession, SessionState } from "./types";

export const SessionContext = createContext<SessionState>({
  status: "loading",
  extension: ABSENT,
  connectExtension: async () => {},
});

const publicFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, { ...init, credentials: "omit" });

export function ShellPodSessionProvider({
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
  // Restore liveness before descendants start passive reads during Strict Mode's
  // effect replay. Cleanup still fences requests after a real unmount.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const binding = useRef({ account, version: 0 });
  const nativeCache = useRef<ReturnType<typeof openNativePodCache> | undefined>(undefined);
  const nativeListeners = useRef(new Set<(url: string) => void>());
  if (binding.current.account !== account)
    binding.current = { account, version: binding.current.version + 1 };
  const session = useMemo<PodSession | undefined>(() => {
    if (!account) return undefined;
    const version = binding.current.version;
    const usable = () =>
      mounted.current &&
      binding.current.version === version &&
      latest.current.status === "ready" &&
      latest.current.active === account &&
      // The rendered state can lag a switch or sign-out that React has not committed yet, while
      // AccountsProvider.fetch picks credentials from live state: check the live account too.
      latest.current.isActiveAccount(account.id, accounts.sessionVersion);
    const authenticatedFetch: typeof globalThis.fetch = async (input, init) => {
      if (!usable()) throw new Error("Sign in to continue");
      const response = await latest.current.fetch(input, init);
      if (!usable()) throw new Error("Sign in to continue");
      return response;
    };
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (!usable()) throw new Error("Sign in to continue");
      const response = await (nativeCache.current?.cache.fetch ?? authenticatedFetch)(input, init);
      if (!usable()) throw new Error("Sign in to continue");
      return response;
    };
    const subscribe = (listener: (url: string) => void) => {
      const onChange = (url: string) => {
        if (usable()) listener(url);
      };
      nativeListeners.current.add(onChange);
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
        nativeListeners.current.delete(onChange);
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
  }, [account, accounts.sessionVersion]);
  useLayoutEffect(() => {
    if (
      process.env.NEXT_PUBLIC_SUITE_TARGET !== "native" ||
      !account ||
      account.kind === "demo" ||
      accounts.status !== "ready"
    )
      return;
    const version = binding.current.version;
    const usable = () =>
      mounted.current &&
      binding.current.version === version &&
      latest.current.status === "ready" &&
      latest.current.active === account &&
      latest.current.isActiveAccount(account.id, accounts.sessionVersion);
    const opened = openNativePodCache({
      webId: account.webId,
      storageRoot: account.storageUrl,
      usable,
      fetch: (input, init) => latest.current.fetch(input, init),
      onEvent: (event) => {
        if (event.event === "updated" && usable())
          for (const listener of nativeListeners.current) listener(event.url);
      },
    });
    nativeCache.current = opened;
    const start = () => {
      if (usable()) void opened.cache.start().catch(() => {});
    };
    start();
    window.addEventListener("online", start);
    return () => {
      window.removeEventListener("online", start);
      opened.close();
      if (nativeCache.current === opened) nativeCache.current = undefined;
    };
  }, [account, accounts.status, accounts.sessionVersion]);
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

export function usePodSessionState(): SessionState {
  return useContext(SessionContext);
}
