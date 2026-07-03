// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The real auth wiring (client-only). Owns the reactive-auth `LoginController`
 * (`@jeswr/solid-elements/auth`), drives silent session restore on load (UX
 * invariant #1), resolves the pod storage root, provisions the diary
 * (owner-only ACL), registers the private type index (best-effort), and flushes
 * the optimistic outbox on login + reconnect. Everything reactive-auth /
 * solid-elements is dynamically imported inside an effect so `next build`
 * prerendering never touches `customElements.define`.
 *
 * All of this is exposed to the app ONLY through the plain `SessionContext`
 * (`@/lib/session/context`), so views stay testable with a stubbed fetch.
 */
import type { LoginController, SessionChangeDetail } from "@jeswr/solid-elements/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { DiaryStore } from "@/lib/cache/diary-store";
import { defaultKv } from "@/lib/cache/kv";
import { flushOutbox } from "@/lib/diary/sync";
import { ensureDiaryReady, resetDiaryReadyMemo } from "@/lib/pod/pod-fs";
import { originRoot, resolveStorageRoot } from "@/lib/pod/storage";
import { registerDiaryTypes } from "@/lib/pod/type-index";
import {
  anonymousSession,
  SessionContext,
  type SessionValue,
} from "@/lib/session/context";
import { LoginArea } from "./login-area";
import { RestoringSplash } from "./restoring-splash";

export function SessionProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<LoginController | null>(null);
  const [controller, setController] = useState<LoginController | null>(null);
  const [value, setValue] = useState<SessionValue>(() => ({ ...anonymousSession }));
  const valueRef = useRef(value);
  valueRef.current = value;

  /** Bring an authenticated controller online: resolve storage + provision + flush. */
  const activateSession = useCallback(async (c: LoginController) => {
    const webId = c.webId;
    if (!webId) return;
    const authedFetch = c.authenticatedFetch;
    const publicFetch = c.publicFetch;
    let storageRoot: string;
    try {
      storageRoot = await resolveStorageRoot(webId, authedFetch);
    } catch {
      storageRoot = originRoot(webId);
    }
    const store = new DiaryStore(defaultKv(), webId);
    setValue((v) => ({ ...v, status: "authed", webId, authedFetch, publicFetch, storageRoot, store }));
    // Background provisioning — never blocks the UI; each step is best-effort.
    void (async () => {
      try {
        await ensureDiaryReady(authedFetch, storageRoot, webId);
      } catch {
        /* provisioned lazily on first write */
      }
      try {
        await registerDiaryTypes(authedFetch, { webId, storageRoot });
      } catch {
        /* interop nicety */
      }
      try {
        await flushOutbox({ authedFetch, webId, storageRoot }, store);
      } catch {
        /* retried on reconnect */
      }
    })();
  }, []);

  const login = useCallback(
    async (webId?: string) => {
      const c = controllerRef.current;
      if (!c) return;
      await c.login(webId);
      await activateSession(c);
    },
    [activateSession],
  );

  const logout = useCallback(async () => {
    const c = controllerRef.current;
    resetDiaryReadyMemo();
    if (c) await c.logout();
    setValue((v) => ({ ...anonymousSession, status: "anonymous", login: v.login, logout: v.logout, reconcile: v.reconcile }));
  }, []);

  const reconcile = useCallback(async () => {
    const v = valueRef.current;
    if (!v.store || !v.webId || !v.storageRoot) return;
    await flushOutbox({ authedFetch: v.authedFetch, webId: v.webId, storageRoot: v.storageRoot }, v.store);
  }, []);

  // Inject the stable callbacks once.
  useEffect(() => {
    setValue((v) => ({ ...v, login, logout, reconcile }));
  }, [login, logout, reconcile]);

  // Build the controller + silent-restore on mount (client-only).
  useEffect(() => {
    let cancelled = false;
    const toAnonymous = () =>
      setValue((v) => (v.status === "loading" ? { ...v, status: "anonymous" } : v));
    // Fail-closed guard (UX invariant #1): if init / restore hangs, never trap the
    // user on the restoring splash — fall back to the login prompt.
    const fallback = setTimeout(() => {
      if (!cancelled) toAnonymous();
    }, 6000);

    void (async () => {
      try {
        const { createReactiveAuthController } = await import("@jeswr/solid-elements/auth");
        await import("@solid/reactive-authentication"); // registers <authorization-code-flow>
        const flowEl = document.createElement("authorization-code-flow") as HTMLElement & {
          getCode: (uri: URL, signal: AbortSignal) => Promise<string>;
        };
        document.body.appendChild(flowEl);
        const origin = window.location.origin;
        const c = createReactiveAuthController({
          authFlow: { getCode: (uri, signal) => flowEl.getCode(uri, signal) },
          callbackUri: new URL("/callback.html", origin).toString(),
          clientId: new URL("/clientid.jsonld", origin).toString(),
          dbName: "coeliac-diary-session",
          rememberedAccountsKey: "coeliac-diary:last-account",
          recentAccountsKey: "coeliac-diary:accounts",
          allowInsecureLoopback: true,
        });
        controllerRef.current = c;
        setController(c);
        // Bound the restore so a stuck network read can't hang the splash forever.
        const outcome = await Promise.race([
          c.restore(),
          new Promise<{ outcome: "login" }>((resolve) =>
            setTimeout(() => resolve({ outcome: "login" }), 5000),
          ),
        ]);
        if (cancelled) return;
        if (outcome.outcome === "restored") await activateSession(c);
        else toAnonymous();
      } catch (err) {
        if (typeof console !== "undefined") console.warn("[session] init failed:", err);
        if (!cancelled) toAnonymous();
      } finally {
        clearTimeout(fallback);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, [activateSession]);

  // Reconcile the outbox when connectivity returns.
  useEffect(() => {
    const onOnline = () => void reconcile();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [reconcile]);

  const onSessionChange = useCallback(
    (detail: SessionChangeDetail) => {
      const c = controllerRef.current;
      if (detail.loggedIn && c) void activateSession(c);
    },
    [activateSession],
  );

  return (
    <SessionContext.Provider value={value}>
      {value.status === "loading" ? (
        <RestoringSplash />
      ) : value.status === "authed" ? (
        children
      ) : (
        <LoginArea controller={controller} onSessionChange={onSessionChange} />
      )}
    </SessionContext.Provider>
  );
}
