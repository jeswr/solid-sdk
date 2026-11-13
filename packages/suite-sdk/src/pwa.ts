// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useSyncExternalStore } from "react";

export type InstallOutcome = "accepted" | "dismissed";
export type InstallStatus = "unavailable" | "available" | "prompting" | "ios" | "installed";
export interface InstallSnapshot {
  readonly status: InstallStatus;
}
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: InstallOutcome }>;
}
const serverSnapshot: InstallSnapshot = { status: "unavailable" };

/** Browser-lifetime prompt capture, independent of the Settings page's mount. */
export function createInstallPromptStore() {
  let snapshot = serverSnapshot;
  let deferred: InstallPromptEvent | null = null;
  let cleanup: (() => void) | undefined;
  let users = 0;
  const listeners = new Set<() => void>();
  const update = (status: InstallStatus) => {
    if (snapshot.status === status) return;
    snapshot = { status };
    for (const listener of listeners) listener();
  };
  const installed = () => {
    deferred = null;
    update("installed");
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Share one set of listeners across providers, including React StrictMode remounts. */
    start(target: Window) {
      users += 1;
      if (!cleanup) {
        const displayMode = target.matchMedia(
          "(display-mode: standalone), (display-mode: window-controls-overlay)",
        );
        const nav = target.navigator as Navigator & { standalone?: boolean };
        const isStandalone = () => displayMode.matches || nav.standalone === true;
        const ios =
          (/iPad|iPhone|iPod/.test(nav.userAgent) ||
            (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)) &&
          // Safari, and Chrome/Edge (iOS 16.4+), can Add to Home Screen; in-app browsers cannot.
          /Safari|CriOS|EdgiOS/.test(nav.userAgent) &&
          !/FxiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram/.test(nav.userAgent);
        const modeChanged = () => {
          if (isStandalone()) installed();
          else update(deferred ? "available" : ios ? "ios" : "unavailable");
        };
        const capture = (event: Event) => {
          event.preventDefault();
          if (isStandalone() || snapshot.status === "installed") return;
          deferred = event as InstallPromptEvent;
          update("available");
        };
        target.addEventListener("beforeinstallprompt", capture);
        target.addEventListener("appinstalled", installed);
        displayMode.addEventListener("change", modeChanged);
        modeChanged();
        cleanup = () => {
          target.removeEventListener("beforeinstallprompt", capture);
          target.removeEventListener("appinstalled", installed);
          displayMode.removeEventListener("change", modeChanged);
        };
      }
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        users -= 1;
        if (users === 0) {
          cleanup?.();
          cleanup = undefined;
        }
      };
    },
    /** Call directly from a user gesture; browser prompt events are single-use. */
    async install(): Promise<InstallOutcome | null> {
      const event = deferred;
      if (!event) return null;
      deferred = null;
      update("prompting");
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        if (snapshot.status !== "installed")
          update(outcome === "accepted" ? "installed" : deferred ? "available" : "unavailable");
        return outcome;
      } finally {
        // A fresh prompt arriving meanwhile already set "available" through capture.
        if (snapshot.status === "prompting") update("unavailable");
      }
    },
  };
}

export const installPrompt = createInstallPromptStore();
export function useInstallPrompt(store = installPrompt): InstallSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
