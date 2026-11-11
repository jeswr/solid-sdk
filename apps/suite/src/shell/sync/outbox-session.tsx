// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { createPodClient, type StorageClient } from "@jeswr/storage-client";
import {
  createOutbox,
  type Outbox,
  type QueueingStorageClient,
  withOutbox,
} from "@jeswr/suite-sdk/offline";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { createRealOutbox, outboxTransport } from "../lib/real-outbox";
import { useAccounts } from "../session/accounts-provider";
import type { SuiteAccount } from "../session/types";

interface OutboxSession {
  account: SuiteAccount;
  outbox: Outbox;
  adapter: ReturnType<typeof createRealOutbox>;
  storage: QueueingStorageClient | null;
  signal: AbortSignal;
}
const Context = createContext<OutboxSession | null>(null);

/** Own the queue's listeners and client for exactly the active shell session. Never purge. */
export function OutboxSessionProvider({ children }: { children: ReactNode }) {
  const accounts = useAccounts();
  const latest = useRef(accounts);
  latest.current = accounts;
  const account = accounts.active;
  const ready = accounts.status === "ready";
  const [session, setSession] = useState<OutboxSession | null>(null);
  useEffect(() => {
    if (!ready || !account || account.kind === "demo") return;
    const controller = new AbortController();
    const active = () =>
      latest.current.active === account && latest.current.isActiveAccount(account.id);
    const fetch = outboxTransport(
      (input, init) => latest.current.fetch(input, init),
      active,
      controller.signal,
    );
    const outbox = createOutbox({ webId: account.webId });
    let storage: StorageClient | null = null;
    const adapter = createRealOutbox({
      outbox,
      storage: () => (active() ? storage : null),
      signal: controller.signal,
    });
    const opened: OutboxSession = {
      account,
      outbox,
      adapter,
      storage: null,
      signal: controller.signal,
    };
    setSession(opened);
    let opening = false;
    const open = () => {
      if (opening || storage || controller.signal.aborted) return;
      opening = true;
      void createPodClient({ storage: account.storageUrl, fetch, signal: controller.signal })
        .then((client) => {
          if (controller.signal.aborted || !active()) return;
          storage = client.storage;
          setSession({ ...opened, storage: withOutbox(storage, outbox) });
        })
        .catch(() => {
          // Preserve the hydrated queue if discovery fails; a later session can open storage.
        })
        .finally(() => {
          opening = false;
        });
    };
    open();
    addEventListener("online", open);
    return () => {
      controller.abort();
      removeEventListener("online", open);
      adapter.dispose();
      outbox.close();
    };
  }, [account, ready]);
  const current = ready && session?.account === account && !session.signal.aborted ? session : null;
  return <Context.Provider value={current}>{children}</Context.Provider>;
}

export function useOutboxSession() {
  return useContext(Context);
}
