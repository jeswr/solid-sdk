// AUTHORED-BY GPT-6.1 Sol
"use client";

import { publicFetch } from "@jeswr/app-session";
import {
  SessionProvider as AppSessionProvider,
  useSession as useAppSession,
  type SessionProviderProps,
} from "@jeswr/app-session/react";
import type { Identity, PodAuth } from "@jeswr/pod-auth";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiaryStore } from "@/lib/cache/diary-store";
import { defaultKv } from "@/lib/cache/kv";
import { flushOutbox } from "@/lib/diary/sync";
import { ensureDiaryReady, resetDiaryReadyMemo } from "@/lib/pod/pod-fs";
import { registerDiaryTypes } from "@/lib/pod/type-index";
import { anonymousSession, SessionContext, type SessionValue } from "@/lib/session/context";
import { runSecureLogout } from "@/lib/session/logout";
import { warningsFromOutcome } from "@/lib/session/logout-warnings";
import { restoreDiarySession } from "@/lib/session/restore";
import { APP_NAME, DEV, getPodAuth, LEGACY_CREDENTIALS } from "@/lib/pod-auth";
import { LoginArea } from "./login-area";
import { LogoutPurgeWarning } from "./logout-purge-warning";
import { LogoutRevokeWarning } from "./logout-revoke-warning";
import { RestoringSplash } from "./restoring-splash";

/** Shared auth lifecycle and UI, wrapped by Coeliac's health-data lifecycle. */
export function SessionProvider({
  children,
  auth,
  readProfile,
}: {
  children: ReactNode;
  auth?: PodAuth;
  readProfile?: SessionProviderProps["readProfile"];
}) {
  const [restorePurgeFailure, setRestorePurgeFailure] = useState<DiaryStore | null>(null);
  const getCore = useMemo(() => {
    let adapter: PodAuth | undefined;
    return async () => {
      const core = auth ?? (await getPodAuth());
      adapter ??= {
        ...core,
        restore: () => restoreDiarySession(core, setRestorePurgeFailure),
      };
      return adapter;
    };
  }, [auth]);
  return (
    <AppSessionProvider
      getPodAuth={getCore}
      readProfile={readProfile}
      appName={APP_NAME}
      dev={DEV}
      legacyCredentials={LEGACY_CREDENTIALS}
    >
      <DiarySession getCore={getCore} restorePurgeFailure={restorePurgeFailure}>
        {children}
      </DiarySession>
    </AppSessionProvider>
  );
}

/** Preserve the public diary context without owning login, restore or profile discovery. */
function DiarySession({
  children,
  getCore,
  restorePurgeFailure,
}: {
  children: ReactNode;
  getCore: () => Promise<PodAuth>;
  restorePurgeFailure: DiaryStore | null;
}) {
  const shared = useAppSession();
  const [value, setValue] = useState<SessionValue>(() => ({ ...anonymousSession }));
  const valueRef = useRef(value);
  const failedPurgeStoreRef = useRef<DiaryStore | null>(null);
  const activation = useRef(0);
  const signingOut = useRef(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [checkedWebId, setCheckedWebId] = useState<string | null>(null);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    if (!restorePurgeFailure) return;
    failedPurgeStoreRef.current = restorePurgeFailure;
    setValue((v) => ({
      ...v,
      ...warningsFromOutcome({ purgeFailed: true, revokeFailed: false }),
      revokeWarning: v.revokeWarning,
    }));
  }, [restorePurgeFailure]);

  const activateSession = useCallback((identity: Identity, core: PodAuth) => {
    if (!identity.webId) throw new Error("No WebID returned");
    const webId = identity.webId;
    // Authority comes from the core, never a guessed WebID path or a second profile read.
    const storageRoot = identity.storages[0] ?? null;
    const authedFetch = core.fetch;
    const store = new DiaryStore(defaultKv(), webId);
    const epoch = ++activation.current;
    failedPurgeStoreRef.current = null;
    resetDiaryReadyMemo();
    const next = {
      ...anonymousSession,
      status: "authed" as const,
      webId,
      authedFetch,
      publicFetch,
      storageRoot,
      store,
    };
    valueRef.current = next;
    setValue(next);
    if (!storageRoot) return;
    void (async () => {
      const current = () => activation.current === epoch;
      try {
        await ensureDiaryReady(authedFetch, storageRoot, webId);
      } catch {
        /* Provisioned lazily on first write. */
      }
      if (!current()) return;
      try {
        await registerDiaryTypes(authedFetch, { webId, storageRoot });
      } catch {
        /* Best-effort interoperability. */
      }
      if (!current()) return;
      try {
        await flushOutbox({ authedFetch, webId, storageRoot }, store);
      } catch {
        /* Retried on reconnect. */
      }
    })();
  }, []);

  const depart = useCallback(() => {
    setCheckedWebId(null);
    ++activation.current;
    resetDiaryReadyMemo();
    const store = valueRef.current.store;
    const next = {
      ...anonymousSession,
      status: "anonymous" as const,
      purgeWarning: valueRef.current.purgeWarning,
      revokeWarning: valueRef.current.revokeWarning,
    };
    valueRef.current = next;
    setValue(next);
    if (!signingOut.current && store) {
      // Also clear an active cache when another caller logs out through this core.
      void store.purge().catch(() => {
        failedPurgeStoreRef.current = store;
        setValue((v) => ({
          ...v,
          ...warningsFromOutcome({ purgeFailed: true, revokeFailed: false }),
          revokeWarning: v.revokeWarning,
        }));
      });
    }
  }, []);
  // The shared display profile can fall back to the WebID origin. Health writes
  // use only the core's verified storages, never that public browsing fallback.
  useEffect(() => {
    if (!shared.webId) {
      depart();
      return;
    }
    if (valueRef.current.webId && valueRef.current.webId !== shared.webId) depart();
    let disposed = false;
    const epoch = ++activation.current;
    void getCore()
      .then(async (core) => {
        const identity = await core.identity();
        if (disposed || activation.current !== epoch) return;
        if (identity && identity.webId === shared.webId) activateSession(identity, core);
        else depart();
        setCheckedWebId(shared.webId);
      })
      .catch(() => {
        if (!disposed && activation.current === epoch) {
          depart();
          setCheckedWebId(shared.webId);
        }
      });
    return () => {
      disposed = true;
    };
  }, [shared.webId, getCore, activateSession, depart]);

  const { loginWithAccount, recentAccounts } = shared;
  const login = useCallback(
    async (webId?: string) => {
      const account = webId ?? recentAccounts[0]?.webId;
      if (account) await loginWithAccount(account);
    },
    [loginWithAccount, recentAccounts],
  );

  const logout = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    setLoggingOut(true);
    ++activation.current;
    const { store, webId, storageRoot, authedFetch, status } = valueRef.current;
    resetDiaryReadyMemo();
    const flush =
      store && webId && storageRoot && status === "authed"
        ? () => flushOutbox({ authedFetch, webId, storageRoot }, store)
        : undefined;
    const outcome = await runSecureLogout({
      store,
      flush,
      // Shared logout intentionally catches failures; Coeliac must report them.
      revokeCredentials: async () => (await getCore()).logout(),
    });
    failedPurgeStoreRef.current = outcome.purgeFailed ? store : null;
    const next = {
      ...anonymousSession,
      status: "anonymous" as const,
      ...warningsFromOutcome(outcome),
    };
    valueRef.current = next;
    setValue(next);
    signingOut.current = false;
    setLoggingOut(false);
  }, [getCore]);

  /** Re-attempt the failed logout purge; clears the warning only when it succeeds. */
  const retryPurge = useCallback(async () => {
    const store = failedPurgeStoreRef.current;
    if (!store) {
      setValue((v) => ({ ...v, purgeWarning: null }));
      return;
    }
    try {
      await store.purge();
      failedPurgeStoreRef.current = null;
      setValue((v) => ({ ...v, purgeWarning: null }));
    } catch (err) {
      // Still not cleared — keep the warning visible (updated with the reason).
      setValue((v) => ({
        ...v,
        purgeWarning:
          err instanceof Error
            ? `Still could not clear local health data: ${err.message}`
            : "Still could not clear local health data.",
      }));
    }
  }, []);

  const dismissPurgeWarning = useCallback(() => {
    setValue((v) => (v.purgeWarning === null ? v : { ...v, purgeWarning: null }));
  }, []);

  /**
   * Re-attempt the failed credential revocation (sign out again). Clears the
   * revoke-warning ONLY when the revocation actually succeeds — a still-failing revoke
   * keeps the security banner visible with an updated reason. Never touches the purge
   * warning. There is no plain "dismiss" for this banner: the user IS still signed in.
   */
  const retryRevoke = useCallback(async () => {
    try {
      await (await getCore()).logout();
      setValue((v) => (v.revokeWarning === null ? v : { ...v, revokeWarning: null }));
    } catch (err) {
      setValue((v) => ({
        ...v,
        revokeWarning:
          err instanceof Error
            ? `Sign-out still failed — you may still be signed in on this device (${err.message}). Reload the page and sign out again.`
            : "Sign-out still failed — you may still be signed in on this device. Reload the page and sign out again.",
      }));
    }
  }, [getCore]);

  const reconcile = useCallback(async () => {
    const v = valueRef.current;
    if (!v.store || !v.webId || !v.storageRoot) return;
    await flushOutbox(
      { authedFetch: v.authedFetch, webId: v.webId, storageRoot: v.storageRoot },
      v.store,
    );
  }, []);

  // Never render the previous account while the shared core is signing out or
  // the next account's verified identity is being read.
  const status: SessionValue["status"] =
    loggingOut ||
    (!shared.ready && !shared.error) ||
    (shared.webId !== null && checkedWebId !== shared.webId)
      ? "loading"
      : shared.webId && value.webId === shared.webId && value.status === "authed"
        ? "authed"
        : "anonymous";
  const contextValue = useMemo(
    () => ({
      ...(status === "authed"
        ? value
        : {
            ...anonymousSession,
            purgeWarning: value.purgeWarning,
            revokeWarning: value.revokeWarning,
          }),
      status,
      login,
      logout,
      reconcile,
      retryPurge,
      dismissPurgeWarning,
      retryRevoke,
    }),
    [value, status, login, logout, reconcile, retryPurge, dismissPurgeWarning, retryRevoke],
  );
  useEffect(() => {
    const onOnline = () => {
      void reconcile().catch(() => {});
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [reconcile]);
  useEffect(
    () => () => {
      ++activation.current;
    },
    [],
  );

  return (
    <SessionContext.Provider value={contextValue}>
      {status === "loading" ? (
        <RestoringSplash />
      ) : status === "authed" ? (
        <>
          {!value.storageRoot && (
            <p role="alert">
              You’re signed in, but your WebID does not advertise a verified pod storage location.
              You can view cached data; logging and syncing are unavailable. Add a storage location
              to your WebID profile, then sign out and sign in again.
            </p>
          )}
          {children}
        </>
      ) : (
        <>
          {value.revokeWarning !== null && (
            <LogoutRevokeWarning
              message={value.revokeWarning}
              onRetry={retryRevoke}
              onReload={() => window.location.reload()}
            />
          )}
          {value.purgeWarning !== null && (
            <LogoutPurgeWarning
              message={value.purgeWarning}
              onRetry={retryPurge}
              onDismiss={dismissPurgeWarning}
            />
          )}
          <LoginArea />
        </>
      )}
    </SessionContext.Provider>
  );
}
