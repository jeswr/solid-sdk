// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  createInboxReader,
  type InboxNotification,
  type InboxReaderOptions,
} from "@jeswr/pod-access/notify";
import { usePodAuth } from "@jeswr/pod-auth/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

export interface UseInboxResult {
  status: "idle" | "loading" | "ready" | "error";
  items: InboxNotification[];
  error: unknown;
  /** Reload now. Ordinary failures populate error; a revoked session rejects. */
  refresh(): Promise<void>;
}

type Snapshot = Omit<UseInboxResult, "refresh"> & { session: object };

/** Read the current WebID's LDN inbox, canceling reads and clearing items on session changes. */
export function useInbox(options: Omit<InboxReaderOptions, "fetch"> = {}): UseInboxResult {
  const { fetch, identity } = usePodAuth();
  const { clock, maxItems, pinningFetch } = options;
  const active = useRef<{ session: object; signal: AbortSignal } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const state = useMemo(() => {
    const session = {};
    const webId = identity?.webId;
    let pending: AbortController | undefined;
    function assertActive() {
      const current = active.current;
      if (current?.session !== session) throw new Error("Notification session changed");
      return current;
    }
    const scoped =
      (transport: typeof fetch): typeof fetch =>
      async (input, init) => {
        const { signal } = assertActive();
        // clientFetch always supplies its own deadline/cancellation signal to this transport.
        const requestSignal = (init as RequestInit & { signal: AbortSignal }).signal;
        return transport(input, {
          ...init,
          signal: AbortSignal.any([signal, requestSignal]),
        });
      };
    const reader = createInboxReader({
      fetch: scoped(fetch),
      clock,
      maxItems,
      pinningFetch: pinningFetch === undefined ? undefined : scoped(pinningFetch),
    });
    const initial: Snapshot = {
      session,
      status: webId ? "loading" : "idle",
      items: [],
      error: undefined,
    };
    const refresh = async () => {
      assertActive();
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      if (!webId) {
        setSnapshot(initial);
        return;
      }
      setSnapshot({ ...initial, status: "loading" });
      try {
        const inbox = await reader.inbox(webId);
        assertActive();
        if (controller.signal.aborted) return;
        const items = inbox ? await reader.list(inbox, { signal: controller.signal }) : [];
        assertActive();
        if (!controller.signal.aborted) {
          setSnapshot({ session, status: "ready", items, error: undefined });
        }
      } catch (error) {
        assertActive();
        if (!controller.signal.aborted) {
          setSnapshot({ session, status: "error", items: [], error });
        }
      }
    };
    return { session, initial, refresh, cancel: () => pending?.abort() };
  }, [fetch, identity, clock, maxItems, pinningFetch]);
  // Activate only committed sessions, as useNotify does. Include discovery in lifetime cancellation.
  useLayoutEffect(() => {
    const lifetime = new AbortController();
    active.current = { session: state.session, signal: lifetime.signal };
    // StrictMode replays effects: start only after the committed activation survives that replay.
    queueMicrotask(() => {
      if (!lifetime.signal.aborted) void state.refresh().catch(() => {});
    });
    return () => {
      active.current = null;
      lifetime.abort();
      state.cancel();
    };
  }, [state]);
  const result = snapshot?.session === state.session ? snapshot : state.initial;
  return {
    status: result.status,
    items: result.items,
    error: result.error,
    refresh: state.refresh,
  };
}
