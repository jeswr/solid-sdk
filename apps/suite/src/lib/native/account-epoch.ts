// AUTHORED-BY Claude Opus 5.5
import { useSyncExternalStore } from "react";

/**
 * Counts changes of the active account (sst-8wx.18). The shell's NativePreviewCleanup bumps it
 * before clearing cached PDF previews, and Drive's PDF handoff aborts its transfer when it moves.
 * Dependency-free on purpose, so Drive can read it without importing the shell's session graph.
 */
let epoch = 0;
const listeners = new Set<() => void>();

export function bumpAccountEpoch(): void {
  epoch += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => epoch;

export function useAccountEpoch(): number {
  return useSyncExternalStore(subscribe, read, read);
}
