// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";
/**
 * Registers the offline worker from `/service-worker` in production builds only: a development server's
 * chunks change on every edit, and a cached shell would hide them.
 */
import { useEffect } from "react";
import { REMEMBER_PAGE } from "../lib/service-worker";

const enabled = () =>
  process.env.NEXT_PUBLIC_SUITE_TARGET !== "native" &&
  process.env.NODE_ENV === "production" &&
  "serviceWorker" in navigator;

export function registerServiceWorker(): void {
  if (!enabled()) return;
  void navigator.serviceWorker
    .register("/service-worker", { scope: "/", updateViaCache: "none" })
    .catch(() => {
      /* Offline support is an enhancement; the app works without it. */
    });
}

/** Ask the worker to keep a copy of this page (its HTML and assets) for offline use. */
export function rememberPage(path: string): void {
  if (!enabled()) return;
  void navigator.serviceWorker.ready.then((registration) =>
    registration.active?.postMessage({ type: REMEMBER_PAGE, path }),
  );
}

/** Mount once at the root. Dev fixtures are never registered. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!location.pathname.startsWith("/dev/")) registerServiceWorker();
  }, []);
  return null;
}
