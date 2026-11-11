// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  hideSharedItem,
  isSharedUrlEntry,
  parseSharedEntries,
  sharedAccountKey,
} from "@jeswr/suite-sdk/shared";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";

const empty: readonly { url: string }[] = [];
const snapshots = new Map<
  string,
  { raw: string | null; unsaved?: boolean; items: readonly { url: string }[] }
>();
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function read(owner: string): readonly { url: string }[] {
  try {
    const cached = snapshots.get(owner);
    if (cached?.unsaved) return cached.items;
    const raw = localStorage.getItem(sharedAccountKey(owner));
    const previous = snapshots.get(owner);
    if (previous?.raw === raw) return previous.items;
    const items = parseSharedEntries(raw, isSharedUrlEntry);
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
  const items = hideSharedItem(read(owner), url);
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
