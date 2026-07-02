// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Detect whether the @jeswr Solid browser extension is installed on this page, so the app can
// drop its OWN duplicated profile chrome (the app-shell <AccountMenu/>: avatar + display name +
// WebID) — the extension already shows a pinned top-right account menu, so rendering both is
// duplicate chrome (bead suite-tracker-lpo). App.tsx keeps a minimal Sign-out control in its
// place while the app still owns its own session (see the note there).
//
// The extension's MAIN-world inject announces presence THREE ways (see
// solid-browser-extension/src/inject/inject.ts); we consume all three so detection is race-free
// regardless of whether this hook mounts before or after the inject ran:
//   1. a STICKY `<html data-solid-extension="1">` marker — read SYNCHRONOUSLY on first render, so
//      there is no flash of the app's own menu when the extension is already present (the common
//      case: inject runs at document_start, before the app bundle);
//   2. `window.solid` — the injected API object (a belt-and-braces synchronous signal); and
//   3. a one-shot `solid-extension:ready` event — for the (rare) case the app mounted before the
//      inject ran, so we flip to "present" without a reload.
//
// Presence is DELIBERATELY not identity: none of these signals carry the user's WebID (that lives
// only on `window.solid.webId`, null until the user authenticates through the extension). Hiding
// the app's menu on mere PRESENCE is the intended behaviour (the extension owns the account
// surface whether or not the user has signed in there yet) — matching the extension design's
// "apps ALWAYS skip own login + hide own profile/logout when extension present" decision.
import { useSyncExternalStore } from "react";

/** True if any of the extension's presence signals are currently observable. */
function readPresence(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-solid-extension") === "1" || "solid" in window;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // The one-shot announce event (case 3). We also observe the sticky marker via a
  // MutationObserver so a late dynamic injection (the extension's SW-registered path, which can
  // land after document_start) is picked up even if the event was missed.
  window.addEventListener("solid-extension:ready", onChange);
  let observer: MutationObserver | undefined;
  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-solid-extension"],
    });
  }
  return () => {
    window.removeEventListener("solid-extension:ready", onChange);
    observer?.disconnect();
  };
}

/**
 * `true` when the Solid browser extension is present on this page. Synchronous on first render
 * (no flash), and reactive if the extension announces itself after mount.
 */
export function useExtensionPresent(): boolean {
  // getServerSnapshot returns false — SSR/prerender has no extension (and Vite CSR never calls it,
  // but keeping it explicit is safe + documents intent).
  return useSyncExternalStore(subscribe, readPresence, () => false);
}
