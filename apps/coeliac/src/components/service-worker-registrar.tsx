// AUTHORED-BY Claude Fable 5
"use client";
/**
 * Applies the app-shell offline service-worker policy once on mount: in a
 * PRODUCTION build it registers `public/sw.js` so a reopen while offline paints
 * the cached shell instantly (UX invariant #3); in dev/test it does NOT register
 * and actively cleans up any worker + shell caches a prior session left behind
 * (a dev SW would cache Next dev route docs + `/_next` chunks → stale chunks and
 * hydration mismatches). Renders nothing. Mounted high in the tree (outside the
 * auth boundary) so the shell is cached even at the login screen. Fully guarded
 * and fail-safe — the app works without it.
 */
import { useEffect } from "react";
import { applyServiceWorkerPolicy } from "@/lib/offline/register-sw";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void applyServiceWorkerPolicy();
  }, []);
  return null;
}
