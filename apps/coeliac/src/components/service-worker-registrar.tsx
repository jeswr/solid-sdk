// AUTHORED-BY Claude Fable 5
"use client";
/**
 * Registers the app-shell offline service worker (`public/sw.js`) once on mount
 * so a reopen while offline paints the cached shell instantly (UX invariant #3).
 * Renders nothing. Mounted high in the tree (outside the auth boundary) so the
 * shell is cached even at the login screen. Registration is fully guarded and
 * fail-safe (see `registerServiceWorker`) — the app works without it.
 */
import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/offline/register-sw";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}
