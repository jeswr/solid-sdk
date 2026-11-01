// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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

/** The credential-free grant shape exposed by the extension's page API. */
export interface SolidExtensionGrant {
  readonly grantId: string;
  readonly dataClass: string;
  readonly modes: readonly string[];
  readonly purpose: string | null;
  readonly expiresAt: number;
  readonly targets: ReadonlyArray<{
    readonly url: string;
    readonly kind: "instance" | "container";
  }>;
}

/** The subset of `window.solid` the suite reads. Privileged members exist only while granted. */
export interface SolidExtensionApi {
  readonly webId?: string | null;
  readonly fetch?: typeof globalThis.fetch;
  requestAccess?(request: unknown): Promise<{ ok: boolean }>;
  listGrants?(): Promise<readonly SolidExtensionGrant[]>;
  revokeGrant?(grantId: string): Promise<boolean>;
  disconnect?(): Promise<boolean>;
  login?(webId: string): Promise<void>;
}

/**
 * UI hints only. Any page script can forge the marker, the stub and same-window state
 * messages, so nothing here authorises anything: the extension's worker gates every request.
 */
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
  try {
    const solid = win.solid;
    const marker = win.document.documentElement.getAttribute(EXTENSION_MARKER);
    if (marker !== "1" || typeof solid !== "object" || solid === null) return ABSENT;
    // Each page-realm property is read once, inside the guard: a getter may throw or change.
    const granted = typeof solid.fetch === "function";
    const rawWebId = granted ? solid.webId : null;
    return { present: true, granted, webId: typeof rawWebId === "string" ? rawWebId : null };
  } catch {
    return ABSENT;
  }
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
 * messages, and window focus, which covers a grant made in the consent window or a revoke in
 * the side panel. Every event notifies at once and again on the next task, because our
 * listener may run before the extension's (if we subscribed before it injected) and would
 * then read the stub before the extension updates it. Pending re-checks die on unsubscribe.
 */
export function subscribeSolidExtension(
  onChange: () => void,
  win: ExtensionWindow | undefined = browserWindow(),
): () => void {
  if (!win) return () => {};
  const pending = new Set<unknown>();
  let active = true;
  const notify = () => {
    onChange();
    const timer = win.setTimeout(() => {
      pending.delete(timer);
      if (active) onChange();
    }, 0);
    pending.add(timer);
  };
  const onMessage = (event?: unknown) => {
    if (isStateMessage(win, event)) notify();
  };
  win.addEventListener(EXTENSION_READY_EVENT, notify);
  win.addEventListener("focus", notify);
  win.addEventListener("message", onMessage);
  return () => {
    active = false;
    win.removeEventListener(EXTENSION_READY_EVENT, notify);
    win.removeEventListener("focus", notify);
    win.removeEventListener("message", onMessage);
    for (const timer of pending) win.clearTimeout(timer);
    pending.clear();
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
