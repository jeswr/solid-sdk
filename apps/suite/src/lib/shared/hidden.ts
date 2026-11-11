// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  type HiddenSharedItem,
  hideSharedItem,
  isHiddenSharedItem,
  parseSharedEntries,
  removeSharedItem,
  sharedAccountKey,
} from "@jeswr/suite-sdk/shared";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";

const empty: readonly HiddenSharedItem[] = [];
const snapshots = new Map<
  string,
  { raw: string | null; unsaved?: boolean; items: readonly HiddenSharedItem[] }
>();
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function read(owner: string): readonly HiddenSharedItem[] {
  try {
    const cached = snapshots.get(owner);
    if (cached?.unsaved) return cached.items;
    const raw = localStorage.getItem(sharedAccountKey(owner));
    const previous = snapshots.get(owner);
    if (previous?.raw === raw) return previous.items;
    const items = parseSharedEntries(raw, isHiddenSharedItem);
    snapshots.set(owner, { raw, items });
    return items;
  } catch {
    return snapshots.get(owner)?.items ?? empty;
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
/** Local removal only: no resource deletion, revocation or inbox mutation. */
export function hideSharedForAccount(owner: string, url: string) {
  write(owner, hideSharedItem(read(owner), url));
}
export function clearHiddenSharedForAccount(owner: string, url: string) {
  write(owner, removeSharedItem(read(owner), url));
}
function write(owner: string, items: readonly HiddenSharedItem[]) {
  const raw = JSON.stringify(items);
  let unsaved = false;
  try {
    localStorage.setItem(sharedAccountKey(owner), raw);
  } catch {
    unsaved = true;
  }
  snapshots.set(owner, { raw, items, unsaved });
  notify();
}
export function useHiddenSharedItems(owner: string) {
  const active = useRef<string | null>(null);
  useLayoutEffect(() => {
    active.current = owner;
    return () => {
      active.current = null;
    };
  }, [owner]);
  const hidden = useSyncExternalStore(
    subscribe,
    () => read(owner),
    () => empty,
  );
  const remove = useCallback(
    (url: string) => {
      if (active.current === owner) hideSharedForAccount(owner, url);
    },
    [owner],
  );
  return { hidden, remove };
}
