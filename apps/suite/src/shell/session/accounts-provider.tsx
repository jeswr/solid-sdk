// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ACCOUNTS_KEY,
  type AccountsAction,
  type AccountsState,
  accountsReducer,
  emptyAccounts,
  parseAccounts,
  serializeAccounts,
} from "../lib/accounts-store";
import { suiteEnv } from "../lib/env";
import { clearRecentItems } from "../lib/recent-items";
import { DemoBackend, demoAccount } from "./demo-backend";
import { SolidBackend } from "./solid-backend";
import {
  type SessionBackend,
  type SessionStatus,
  SignInError,
  type SignInHint,
  type SignInOptions,
  type SuiteAccount,
} from "./types";

export interface AccountsContextValue {
  status: SessionStatus;
  active: SuiteAccount | null;
  accounts: SuiteAccount[];
  signIn(hint: SignInHint, options?: SignInOptions): Promise<SuiteAccount>;
  signInDemo(): Promise<SuiteAccount>;
  /** Sign in through a specific backend (e.g. "extension"); rejects when none is registered. */
  signInWith(
    kind: SuiteAccount["kind"],
    hint: SignInHint,
    options?: SignInOptions,
  ): Promise<SuiteAccount>;
  /** Backend kinds available in this deployment. */
  backendKinds: readonly SuiteAccount["kind"][];
  add(hint: SignInHint, options?: SignInOptions): Promise<SuiteAccount>;
  switchTo(id: string): void;
  signOut(id?: string): Promise<void>;
  signOutAll(): Promise<void>;
  reauth(): Promise<SuiteAccount>;
  fetch: typeof fetch;
}
const AccountsContext = createContext<AccountsContextValue | null>(null);

export function AccountsProvider({
  children,
  backends: supplied,
}: {
  children: ReactNode;
  backends?: readonly SessionBackend[];
}) {
  const [backends] = useState(() => supplied ?? [new DemoBackend(), new SolidBackend()]);
  const [state, setState] = useState<AccountsState>(emptyAccounts);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const current = useRef(state);
  const currentStatus = useRef(status);
  const sessions = useRef(new Map<string, SessionBackend>());
  const generation = useRef(0);
  const signInAttempt = useRef(0);
  const changeStatus = useCallback((value: SessionStatus) => {
    currentStatus.current = value;
    setStatus(value);
  }, []);
  const publish = useCallback(
    (value: AccountsState) => {
      current.current = value;
      setState(value);
      try {
        localStorage.setItem(ACCOUNTS_KEY, serializeAccounts(value));
      } catch {
        /* Memory-only when browser storage is blocked. */
      }
      changeStatus(
        !value.activeId ? "signed-out" : sessions.current.has(value.activeId) ? "ready" : "expired",
      );
    },
    [changeStatus],
  );
  const dispatch = (action: AccountsAction) => publish(accountsReducer(current.current, action));

  useEffect(() => {
    let cancelled = false;
    const revision = ++generation.current;
    let remembered = emptyAccounts;
    try {
      remembered = parseAccounts(localStorage.getItem(ACCOUNTS_KEY));
    } catch {
      /* No remembered session. */
    }
    if (!suiteEnv().NEXT_PUBLIC_SUITE_DEMO) {
      for (const account of remembered.accounts)
        if (account.kind === "demo")
          remembered = accountsReducer(remembered, { type: "remove", id: account.id });
    }
    void Promise.all(
      backends.map(async (backend) => {
        if (backend.kind === "demo" && !suiteEnv().NEXT_PUBLIC_SUITE_DEMO) return null;
        try {
          return { backend, account: await backend.restore() };
        } catch {
          return null;
        }
      }),
    ).then((restored) => {
      if (cancelled || revision !== generation.current) return;
      let next = remembered;
      for (const result of restored) {
        if (!result?.account) continue;
        sessions.current.set(result.account.id, result.backend);
        next = accountsReducer(next, { type: "remember", account: result.account });
      }
      // Demo sessions never expire. Keep an inactive remembered demo usable when switching accounts.
      const demo = backends.find((backend) => backend.kind === "demo");
      if (
        demo &&
        suiteEnv().NEXT_PUBLIC_SUITE_DEMO &&
        next.accounts.some((account) => account.id === demoAccount.id && account.kind === "demo")
      )
        sessions.current.set(demoAccount.id, demo);
      // restore() may complete in any order; the remembered active pointer wins.
      if (remembered.activeId)
        next = accountsReducer(next, { type: "switch", id: remembered.activeId });
      publish(next);
    });
    const unsubscribe = backends.map((backend) =>
      backend.onExpired(() => {
        const activeExpired =
          current.current.activeId !== null &&
          sessions.current.get(current.current.activeId) === backend;
        for (const [id, owner] of sessions.current)
          if (owner === backend) sessions.current.delete(id);
        if (activeExpired) changeStatus("expired");
      }),
    );
    return () => {
      cancelled = true;
      ++generation.current;
      for (const stop of unsubscribe) stop();
    };
  }, [backends, changeStatus, publish]);

  const signInWith = async (
    kind: SuiteAccount["kind"],
    hint: SignInHint,
    options?: SignInOptions,
  ) => {
    const revision = generation.current;
    const attempt = ++signInAttempt.current;
    const backend = backends.find((item) => item.kind === kind);
    if (!backend || (kind === "demo" && !suiteEnv().NEXT_PUBLIC_SUITE_DEMO))
      throw new SignInError("unavailable");
    const account = await backend.signIn(hint, options);
    if (revision !== generation.current || attempt !== signInAttempt.current)
      throw new Error("The account changed while signing in. Please try again.");
    ++generation.current;
    sessions.current.set(account.id, backend);
    dispatch({ type: "remember", account });
    return account;
  };
  const signIn = (hint: SignInHint, options?: SignInOptions) => signInWith("solid", hint, options);
  const signInDemo = () => signInWith("demo", { webId: demoAccount.webId });
  const signOut = async (id = current.current.activeId ?? "") => {
    ++generation.current;
    const account = current.current.accounts.find((item) => item.id === id);
    if (!account) return;
    const backend = sessions.current.get(id) ?? backends.find((item) => item.kind === account.kind);
    sessions.current.delete(id);
    try {
      clearRecentItems(localStorage, id);
    } catch {
      /* Browser storage may be blocked. */
    }
    // Keep pending outbox items: signing out must not discard unsent changes.
    dispatch({ type: "remove", id });
    await backend?.signOut(account);
  };
  const signOutAll = async () => {
    ++generation.current;
    const previous = current.current.accounts.map((account) => ({
      account,
      backend: sessions.current.get(account.id) ?? backends.find((b) => b.kind === account.kind),
    }));
    sessions.current.clear();
    try {
      clearRecentItems(localStorage);
    } catch {
      /* Browser storage may be blocked. */
    }
    dispatch({ type: "clear" });
    const results = await Promise.allSettled(
      previous.map(({ account, backend }) => backend?.signOut(account)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  };
  const active = state.accounts.find((a) => a.id === state.activeId) ?? null;
  const reauth = () => {
    const account = current.current.accounts.find((a) => a.id === current.current.activeId);
    if (!account) return Promise.reject(new SignInError("unavailable"));
    return signInWith(
      account.kind,
      account.issuer ? { issuer: account.issuer } : { webId: account.webId },
    );
  };
  const authenticatedFetch: typeof fetch = async (input, init) => {
    const account = current.current.accounts.find((a) => a.id === current.current.activeId);
    const backend = account && sessions.current.get(account.id);
    if (!account || !backend || currentStatus.current !== "ready")
      throw new Error("Sign in to continue");
    return backend.fetchFor(account)(input, init);
  };
  return (
    <AccountsContext.Provider
      value={{
        status,
        active,
        accounts: state.accounts,
        signIn,
        signInDemo,
        signInWith,
        backendKinds: backends.map((backend) => backend.kind),
        add: signIn,
        switchTo: (id) => {
          ++generation.current;
          dispatch({ type: "switch", id });
        },
        signOut,
        signOutAll,
        reauth,
        fetch: authenticatedFetch,
      }}
    >
      {children}
    </AccountsContext.Provider>
  );
}

export function useAccounts(): AccountsContextValue {
  const value = useContext(AccountsContext);
  if (!value) throw new Error("useAccounts requires AccountsProvider");
  return value;
}
