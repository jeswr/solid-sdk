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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiaryStore } from "@/lib/cache/diary-store";
import { defaultKv } from "@/lib/cache/kv";
import { flushOutbox } from "@/lib/diary/sync";
import { ensureDiaryReady, resetDiaryReadyMemo } from "@/lib/pod/pod-fs";
import { podRootFallback, resolveStorageRoot } from "@/lib/pod/storage";
import { registerDiaryTypes } from "@/lib/pod/type-index";
import {
  anonymousSession,
  SessionContext,
  type SessionValue,
} from "@/lib/session/context";
import { performSecureLogout } from "@/lib/session/logout";
import { LoginArea } from "./login-area";
import { RestoringSplash } from "./restoring-splash";

export function SessionProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<LoginController | null>(null);
  const [controller, setController] = useState<LoginController | null>(null);
  const [value, setValue] = useState<SessionValue>(() => ({ ...anonymousSession }));
  const valueRef = useRef(value);
  // Keep the ref in sync post-commit (react-hooks v6 forbids ref writes during
  // render); `reconcile` only reads it from event handlers, so this is safe.
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

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
      storageRoot = podRootFallback(webId);
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
    const { store, webId, storageRoot, authedFetch, status } = valueRef.current;
    resetDiaryReadyMemo();
    // Best-effort final flush (online only) BEFORE the credential is revoked, then
    // a MANDATORY purge of the WebID-scoped private health cache so no logged/read
    // data survives on a shared device. Extracted + unit-tested in session/logout.
    const flush =
      store && webId && storageRoot && status === "authed"
        ? () => flushOutbox({ authedFetch, webId, storageRoot }, store)
        : undefined;
    try {
      await performSecureLogout({
        store,
        flush,
        revokeCredentials: c ? () => c.logout() : undefined,
      });
    } catch (err) {
      // The credential is already revoked; complete the UI sign-out regardless, but
      // surface an incomplete privacy purge (a shared-device concern) rather than
      // hide it behind a clean-looking logout.
      if (typeof console !== "undefined") console.warn("[session] logout purge incomplete:", err);
    }
    setValue(() => ({ ...anonymousSession, status: "anonymous" }));
  }, []);

  const reconcile = useCallback(async () => {
    const v = valueRef.current;
    if (!v.store || !v.webId || !v.storageRoot) return;
    await flushOutbox({ authedFetch: v.authedFetch, webId: v.webId, storageRoot: v.storageRoot }, v.store);
  }, []);

  // Merge the stable callbacks into the context value during render (react-hooks
  // v6 forbids the old inject-via-effect setValue; this also drops a render pass).
  const contextValue = useMemo(
    () => ({ ...value, login, logout, reconcile }),
    [value, login, logout, reconcile],
  );

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
        // Import the registerElements entrypoint — on @solid/reactive-authentication
        // 0.1.5 the bare package import no longer self-registers the custom element;
        // ./registerElements is the export that defines <authorization-code-flow>.
        await import("@solid/reactive-authentication/registerElements");
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
    <SessionContext.Provider value={contextValue}>
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
