// AUTHORED-BY Codex
import { applyUpdate, Doc, encodeStateAsUpdate, equalSnapshots, snapshot } from "yjs";

/** Acknowledgement must cover clocks, deletions and still-unintegrated structs. */
export function coversUpdates(confirmed: Uint8Array, updates: readonly Uint8Array[]) {
  const probe = new Doc();
  try {
    applyUpdate(probe, confirmed);
    const durable = snapshot(probe);
    const baseline = encodeStateAsUpdate(probe);
    for (const update of updates) applyUpdate(probe, update);
    if (!equalSnapshots(durable, snapshot(probe))) return false;
    const merged = encodeStateAsUpdate(probe);
    return (
      merged.length === baseline.length && merged.every((byte, index) => byte === baseline[index])
    );
  } finally {
    probe.destroy();
  }
}
