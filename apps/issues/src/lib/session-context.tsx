"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loadProfile, trackerDocumentUrl, type SolidProfile } from "@/lib/profile";
import { Repository } from "@/lib/repository";
import { registerTracker } from "@/lib/type-index";
import { RecentAccounts, type RecentAccount } from "@/lib/login-ux";
import { NoStorageError } from "@/lib/errors";

export type SessionStatus =
  | "initialising"
  | "logged-out"
  | "authenticating"
  | "logged-in"
  | "error";

export interface SolidSession {
  status: SessionStatus;
  profile: SolidProfile | null;
  /** Pod root chosen for this session (where the tracker lives). */
  storageUrl: string | null;
  /** URL of this user's own tracker config document. */
  trackerUrl: string | null;
  error: string | null;
  recentAccounts: RecentAccount[];
  login: (webId: string) => Promise<void>;
  logout: () => void;
  /** Forget a remembered account (does not affect the active session). */
  forgetAccount: (webId: string) => void;
}

const SessionContext = createContext<SolidSession | null>(null);

/** Minimal shape of the <authorization-code-flow> element we depend on. */
interface AuthCodeFlowElement extends HTMLElement {
  getCode: (authorizationUri: URL, signal: AbortSignal) => Promise<string>;
}

function describeError(e: unknown): string {
  if (e instanceof NoStorageError) return e.message;
  if (e instanceof DOMException && e.name === "AbortError") {
    return "Login was cancelled.";
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong during login.";
}

export function SolidSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("initialising");
  const [profile, setProfile] = useState<SolidProfile | null>(null);
  const [storageUrl, setStorageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentAccounts, setRecentAccounts] = useState<RecentAccount[]>([]);

  const flowRef = useRef<AuthCodeFlowElement | null>(null);
  const managerReady = useRef(false);
  // The WebID the user is logging in with — the provider's getWebId resolves this.
  const webIdRef = useRef<string | null>(null);
  const recentRef = useRef<RecentAccounts | null>(null);

  // Patch globalThis.fetch exactly once, as early as possible (AGENTS.md §Authentication).
  useEffect(() => {
    if (managerReady.current) return;
    let cancelled = false;
    (async () => {
      const { ReactiveFetchManager } = await import("@solid/reactive-authentication");
      const { WebIdDPoPTokenProvider } = await import("@/lib/webid-token-provider");
      const ui = flowRef.current;
      if (cancelled || !ui || managerReady.current) return;

      // Static client-id only when deployed (HTTPS): a remote IdP can't dereference
      // a localhost client-id document, so localhost falls back to dynamic
      // registration — which works against both local CSS and live servers.
      const host = location.hostname;
      const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      const clientId = isLoopback ? undefined : new URL("/clientid.jsonld", location.href).toString();

      const provider = new WebIdDPoPTokenProvider(
        new URL("/callback.html", location.href).toString(),
        ui.getCode.bind(ui),
        // getWebId — resolves to the WebID the user submitted via login().
        async () => {
          if (!webIdRef.current) throw new Error("No WebID provided.");
          return webIdRef.current;
        },
        { allowInsecureLoopback: true, ...(clientId ? { clientId } : {}) },
      );
      // 0.1.3: the constructor does NOT patch globalThis.fetch — registerGlobally() does.
      const manager = new ReactiveFetchManager([provider]);
      manager.registerGlobally();
      managerReady.current = true;

      recentRef.current = new RecentAccounts();
      setRecentAccounts(recentRef.current.list());
      setStatus("logged-out");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (webIdInput: string) => {
    setError(null);
    setStatus("authenticating");
    const webId = webIdInput.trim();
    webIdRef.current = webId;
    try {
      // 1. Public profile read (no auth) → display name, avatar, storage.
      const loaded = await loadProfile(webId);
      const storage = loaded.storageUrls[0];
      if (!storage) throw new NoStorageError(webId);

      // 2. First authenticated fetch: a private resource in the pod returns 401,
      //    which transparently drives the login popup, then retries. A 404 (the
      //    tracker doesn't exist yet) is success — the pod is reachable + authed.
      const trackerUrl = trackerDocumentUrl(storage);
      await new Repository(trackerUrl).loadTracker();

      setProfile(loaded);
      setStorageUrl(storage);
      setStatus("logged-in");

      // Make the tracker discoverable by other apps/people (best-effort, non-blocking).
      void registerTracker(webId, storage, trackerUrl);

      recentRef.current?.remember({
        webId,
        displayName: loaded.name ?? webId,
        avatarUrl: undefined,
        storage,
      });
      if (recentRef.current) setRecentAccounts(recentRef.current.list());
    } catch (e) {
      webIdRef.current = null;
      setError(describeError(e));
      setStatus("error");
    }
  }, []);

  const logout = useCallback(() => {
    // Tokens live in memory in the fetch manager; a reload is the clean way to
    // drop them (skill: solid-reactive-authentication §Sessions). Recent accounts
    // persist in localStorage and survive the reload.
    setProfile(null);
    setStorageUrl(null);
    setStatus("logged-out");
    window.location.reload();
  }, []);

  const forgetAccount = useCallback((webId: string) => {
    recentRef.current?.forget(webId);
    if (recentRef.current) setRecentAccounts(recentRef.current.list());
  }, []);

  const value: SolidSession = {
    status,
    profile,
    storageUrl,
    trackerUrl: storageUrl ? trackerDocumentUrl(storageUrl) : null,
    error,
    recentAccounts,
    login,
    logout,
    forgetAccount,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
      {/* Registered + driven by @solid/reactive-authentication; visually hidden. */}
      <authorization-code-flow
        ref={flowRef as unknown as React.Ref<HTMLElement>}
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      />
    </SessionContext.Provider>
  );
}

export function useSolidSession(): SolidSession {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSolidSession must be used within SolidSessionProvider");
  return ctx;
}
