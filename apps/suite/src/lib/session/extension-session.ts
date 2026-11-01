// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * Detects the Solid browser extension (apps/extension) and reads its credential-free state.
 *
 * The extension's MAIN-world script defines a permanent `window.solid` stub on every page,
 * sets `data-solid-extension="1"` on <html> and dispatches `solid-extension:ready`. The stub
 * gains `webId` and `fetch` only while this origin holds an origin grant, so presence never
 * reveals who the person is. This module never calls `fetch` or `requestAccess` itself.
 */

import { useSyncExternalStore } from "react";

export const EXTENSION_MARKER = "data-solid-extension";
export const EXTENSION_READY_EVENT = "solid-extension:ready";

/** The subset of `window.solid` the suite reads. Privileged members exist only while granted. */
export interface SolidExtensionApi {
  readonly webId?: string | null;
  readonly fetch?: typeof globalThis.fetch;
  requestAccess?(request: unknown): Promise<{ ok: boolean }>;
  login?(webId: string): Promise<void>;
}

export interface SolidExtensionState {
  /** The extension is installed and has announced itself on this page. */
  readonly present: boolean;
  /** This origin holds a grant, so `window.solid.fetch` is available. */
  readonly granted: boolean;
  /** The granted profile's WebID, or null when not granted or not signed in. */
  readonly webId: string | null;
}

/** The window members this module touches, so tests can pass a fake. */
export interface ExtensionWindow {
  readonly solid?: SolidExtensionApi;
  readonly document: { readonly documentElement: { getAttribute(name: string): string | null } };
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  removeEventListener(type: string, listener: (event?: unknown) => void): void;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export const ABSENT: SolidExtensionState = Object.freeze({
  present: false,
  granted: false,
  webId: null,
});

function browserWindow(): ExtensionWindow | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as ExtensionWindow);
}

/** Reads the current state synchronously. Values come from the page realm and are re-checked. */
export function readSolidExtension(
  win: ExtensionWindow | undefined = browserWindow(),
): SolidExtensionState {
  if (!win) return ABSENT;
  let solid: SolidExtensionApi | undefined;
  let marker: string | null = null;
  try {
    solid = win.solid;
    marker = win.document.documentElement.getAttribute(EXTENSION_MARKER);
  } catch {
    return ABSENT;
  }
  const present = marker === "1" && typeof solid === "object" && solid !== null;
  if (!present) return ABSENT;
  const granted = typeof solid?.fetch === "function";
  const webId = granted && typeof solid?.webId === "string" ? solid.webId : null;
  return { present, granted, webId };
}

/**
 * Resolves true once the extension has announced itself, or false after `timeoutMs`.
 * The marker is sticky, so a late caller resolves at once; the event covers an early caller.
 */
export function detectSolidExtension(
  timeoutMs = 500,
  win: ExtensionWindow | undefined = browserWindow(),
): Promise<boolean> {
  if (!win) return Promise.resolve(false);
  if (readSolidExtension(win).present) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      win.removeEventListener(EXTENSION_READY_EVENT, onReady);
      win.clearTimeout(timer);
      resolve(value);
    };
    const onReady = () => finish(readSolidExtension(win).present);
    win.addEventListener(EXTENSION_READY_EVENT, onReady);
    const timer = win.setTimeout(() => finish(readSolidExtension(win).present), timeoutMs);
  });
}

/** The extension's page channel; its state updates arrive as same-window messages on it. */
export const EXTENSION_CHANNEL = "solid-browser-ext";

function isStateMessage(win: ExtensionWindow, event: unknown): boolean {
  const { source, data } = (event ?? {}) as { source?: unknown; data?: unknown };
  if (source !== win || typeof data !== "object" || data === null) return false;
  const { channel, dir, type } = data as Record<string, unknown>;
  return (
    channel === EXTENSION_CHANNEL &&
    dir === "to-page" &&
    (type === "SOLID_STATE_UPDATE" || type === "SOLID_ACCESS_RESPONSE")
  );
}

/**
 * Subscribes to presence and grant changes: the ready event, the extension's own state
 * messages (its listener runs first, so the stub is already updated when ours runs), and
 * window focus, which covers a grant made in the consent window or a revoke in the side panel.
 */
export function subscribeSolidExtension(
  onChange: () => void,
  win: ExtensionWindow | undefined = browserWindow(),
): () => void {
  if (!win) return () => {};
  const onMessage = (event?: unknown) => {
    if (isStateMessage(win, event)) onChange();
  };
  win.addEventListener(EXTENSION_READY_EVENT, onChange);
  win.addEventListener("focus", onChange);
  win.addEventListener("message", onMessage);
  return () => {
    win.removeEventListener(EXTENSION_READY_EVENT, onChange);
    win.removeEventListener("focus", onChange);
    win.removeEventListener("message", onMessage);
  };
}

/** Keeps one object per distinct state so useSyncExternalStore sees stable snapshots. */
export function createSnapshotReader(read: () => SolidExtensionState): () => SolidExtensionState {
  let last = ABSENT;
  return () => {
    const next = read();
    if (
      next.present !== last.present ||
      next.granted !== last.granted ||
      next.webId !== last.webId
    ) {
      last = next.present ? next : ABSENT;
    }
    return last;
  };
}

const snapshot = createSnapshotReader(() => readSolidExtension());
const serverSnapshot = () => ABSENT;
const subscribe = (onChange: () => void) => subscribeSolidExtension(onChange);

/** React view of the extension's state. False/null during SSR and hydration. */
export function useSolidExtension(): SolidExtensionState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
