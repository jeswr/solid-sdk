// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import type { Identity } from "@jeswr/pod-auth";
import type { AccountManager } from "@jeswr/pod-auth/accounts";
import { PodAuthProvider } from "@jeswr/pod-auth/react";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

/** Public account snapshots and the manager's stable actions. */
export interface AccountsSession {
  accounts: Identity[];
  active: Identity | null;
  switchTo: AccountManager["switchTo"];
  add: AccountManager["add"];
  remove: AccountManager["remove"];
}

const Context = createContext<AccountsSession | null>(null);

/** Mirror an account manager and give existing usePodAuth consumers the active account's core. */
export function AccountsProvider({
  manager,
  children,
}: {
  manager: AccountManager;
  children?: ReactNode;
}): ReactNode {
  const store = useMemo(() => {
    const read = () => {
      const active = manager.active();
      return {
        active,
        accounts: manager.accounts(),
        auth: manager.authFor(active?.webId ?? null),
      };
    };
    let value = read();
    return {
      snapshot: () => value,
      subscribe: (notify: () => void) => {
        const refresh = () => {
          value = read();
          notify();
        };
        const stop = manager.on("change", refresh);
        refresh();
        return stop;
      },
    };
  }, [manager]);
  const { accounts, active, auth } = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  const session = useMemo<AccountsSession>(
    () => ({
      accounts,
      active,
      switchTo: manager.switchTo,
      add: manager.add,
      remove: manager.remove,
    }),
    [manager, accounts, active],
  );
  // PodAuthProvider adopts its first core. Replace its component boundary when that core changes,
  // including a new login as the same WebID; all lifecycle state still belongs to PodAuthProvider.
  const SessionProvider = useMemo(
    () =>
      function AccountSession({ children }: { children?: ReactNode }) {
        return createElement(PodAuthProvider, { auth }, children);
      },
    [auth],
  );
  return createElement(
    Context.Provider,
    { value: session },
    createElement(SessionProvider, null, children),
  );
}

/** Read the nearest account manager provider. */
export function useAccounts(): AccountsSession {
  const session = useContext(Context);
  if (session === null) throw new Error("useAccounts() must be used inside an <AccountsProvider>");
  return session;
}
