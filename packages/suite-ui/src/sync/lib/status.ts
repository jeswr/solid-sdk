// AUTHORED-BY Codex GPT-6.1-Sol
import type { SyncSnapshot, SyncStatusKind } from "../types.js";

export function waitingLabel(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"} waiting`;
}

export function syncStatus(snapshot: SyncSnapshot): { kind: SyncStatusKind; label: string } {
  if (snapshot.conflicts.length) {
    const count = snapshot.conflicts.length;
    return { kind: "conflict", label: `${count} ${count === 1 ? "conflict" : "conflicts"}` };
  }
  if (snapshot.reconnecting) return { kind: "reconnecting", label: "Reconnecting…" };
  if (!snapshot.online) return { kind: "offline", label: "Offline — showing saved copies" };
  if (snapshot.pending.length)
    return { kind: "waiting", label: waitingLabel(snapshot.pending.length) };
  return { kind: "hidden", label: "" };
}
