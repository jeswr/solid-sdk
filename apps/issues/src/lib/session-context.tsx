// AUTHORED-BY GPT-6.1 Sol
"use client";

import { publicFetch, type DerivedSession } from "@jeswr/app-session";
import { SessionProvider, useSession, type SessionProviderProps } from "@jeswr/app-session/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { NoStorageError } from "./errors";
import { clearAllIssueCaches } from "./issue-cache";
import { APP_NAME, DEV, getPodAuth, legacyCredentials } from "./pod-auth";
import { trackerDocumentUrl, type SolidProfile } from "./profile";
import { Repository } from "./repository";
import { registerTracker } from "./type-index";

export type SessionStatus =
  | "initialising"
  | "restoring"
  | "logged-out"
  | "authenticating"
  | "choose-storage"
  | "logged-in"
  | "error";
export interface SolidSession {
  status: SessionStatus;
  profile: SolidProfile | null;
  storageUrl: string | null;
  trackerUrl: string | null;
  error: string | null;
  storageChoices: string[];
  chooseStorage(storageUrl: string): Promise<void>;
  logout(): Promise<void>;
  podFetch: typeof fetch;
  retry(): void;
}
const SessionContext = createContext<SolidSession | null>(null);

type Props = Pick<SessionProviderProps, "children" | "auth" | "readProfile">;

export function SolidSessionProvider({ children, auth, readProfile }: Props) {
  const getAuth = useCallback(() => (auth ? Promise.resolve(auth) : getPodAuth()), [auth]);
  return (
    <SessionProvider
      getPodAuth={getPodAuth}
      appName={APP_NAME}
      dev={DEV}
      legacyCredentials={legacyCredentials}
      auth={auth}
      readProfile={readProfile}
    >
      <TrackerSession getAuth={getAuth}>{children}</TrackerSession>
    </SessionProvider>
  );
}

interface TrackerState {
  session: DerivedSession;
  profile: SolidProfile | null;
  storageUrl: string | null;
  storageChoices: string[];
  status: SessionStatus;
  error: string | null;
}

/** Public application preference; every use is checked against current verified roots. */
function storagePreferenceKey(webId: string): string {
  return `solid-issues:storage:${webId}`;
}
function readStoragePreference(webId: string): string | undefined {
  try {
    return localStorage.getItem(storagePreferenceKey(webId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Issues policy only: choose a verified storage, open its tracker, and register it. */
function TrackerSession({
  children,
  getAuth,
}: {
  children: React.ReactNode;
  getAuth: SessionProviderProps["getPodAuth"];
}) {
  const shared = useSession();
  const [tracker, setTracker] = useState<TrackerState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    ++generation.current;
  }, []);
  const previousWebId = useRef<string | null>(null);
  const selectedStorages = useRef(new Map<string, string>());
  const { session, webId, fetch: podFetch, logout: endSession } = shared;

  useEffect(() => {
    if (previousWebId.current && previousWebId.current !== webId) clearAllIssueCaches();
    previousWebId.current = webId;
  }, [webId]);

  const openTracker = useCallback(
    async (
      session: DerivedSession,
      profile: SolidProfile,
      storage: string,
      current: () => boolean,
    ) => {
      const url = trackerDocumentUrl(storage);
      await new Repository(url, podFetch).loadTracker();
      if (!current()) return;
      selectedStorages.current.set(profile.webId, storage);
      try {
        localStorage.setItem(storagePreferenceKey(profile.webId), storage);
      } catch {
        /* The page-lifetime choice remains usable if browser storage is unavailable. */
      }
      setTracker({
        session,
        profile,
        storageUrl: storage,
        storageChoices: [],
        status: "logged-in",
        error: null,
      });
      void registerTracker(profile.webId, storage, url, podFetch);
    },
    [podFetch],
  );

  useEffect(() => {
    const epoch = ++generation.current;
    let disposed = false;
    const current = () => !disposed && generation.current === epoch;
    if (session && webId) {
      void (async () => {
        // app-session currently exposes just the first display storage. Issues needs all
        // verified roots for its chooser; public profile data must never grant access.
        const auth = await getAuth();
        const identity = await auth.identity();
        if (!current()) return;
        if (identity?.webId !== webId) throw new Error("Session changed");
        const profile: SolidProfile = {
          webId,
          name: session.displayName ?? null,
          storageUrls: [...identity.storages],
        };
        if (!profile.storageUrls.length) throw new NoStorageError(webId);
        const selected = selectedStorages.current.get(webId) ?? readStoragePreference(webId);
        if (
          profile.storageUrls.length > 1 &&
          (!selected || !profile.storageUrls.includes(selected))
        ) {
          setTracker({
            session,
            profile,
            storageUrl: null,
            storageChoices: profile.storageUrls,
            status: "choose-storage",
            error: null,
          });
          return;
        }
        await openTracker(
          session,
          profile,
          selected && profile.storageUrls.includes(selected) ? selected : profile.storageUrls[0],
          current,
        );
      })().catch((failure) => {
        if (current())
          setTracker({
            session,
            profile: null,
            storageUrl: null,
            storageChoices: [],
            status: "error",
            error:
              failure instanceof NoStorageError
                ? failure.message
                : "We couldn't open your tracker. Try again.",
          });
      });
    }
    return () => {
      disposed = true;
      invalidate();
    };
  }, [session, webId, getAuth, openTracker, attempt, invalidate]);

  const chooseStorage = useCallback(
    async (storage: string) => {
      if (
        !session ||
        tracker?.session !== session ||
        !tracker.profile ||
        !tracker.storageChoices.includes(storage)
      )
        return;
      const epoch = ++generation.current;
      const current = () => generation.current === epoch;
      setTracker({ ...tracker, status: "authenticating", error: null });
      try {
        await openTracker(session, tracker.profile, storage, current);
      } catch {
        if (current())
          setTracker({
            ...tracker,
            status: "choose-storage",
            error: "We couldn't open that storage. Try again.",
          });
      }
    },
    [session, tracker, openTracker],
  );

  const logout = useCallback(async () => {
    ++generation.current;
    clearAllIssueCaches();
    setTracker(null);
    await endSession();
  }, [endSession]);
  const retry = () => {
    setTracker(null);
    setAttempt((value) => value + 1);
  };
  const active = session && tracker?.session === session ? tracker : null;
  const status: SessionStatus = shared.pending
    ? "authenticating"
    : shared.restoringSession
      ? "restoring"
      : shared.startupFailed
        ? "error"
        : (!shared.ready && !shared.error) || (webId && !session) || (session && !active)
          ? "initialising"
          : (active?.status ?? (shared.error ? "error" : "logged-out"));
  const value: SolidSession = {
    status,
    profile: active?.profile ?? null,
    storageUrl: active?.storageUrl ?? null,
    trackerUrl: active?.storageUrl ? trackerDocumentUrl(active.storageUrl) : null,
    storageChoices: active?.storageChoices ?? [],
    error: active?.error ?? shared.error,
    podFetch,
    chooseStorage,
    logout,
    retry,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSolidSession(): SolidSession {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSolidSession must be used within SolidSessionProvider");
  return value;
}

/** Independent previews may read public data; signed-in views always receive auth.fetch. */
export function usePodFetch(): typeof fetch {
  return useContext(SessionContext)?.podFetch ?? publicFetch;
}
