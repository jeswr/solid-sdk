// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { MusicQueueError } from "./errors";

export interface QueueEntry {
  /** Unique occurrence ID, not the track ID; the same track may occur repeatedly. */
  readonly id: string;
}
export type RepeatMode = "off" | "all" | "one";
export interface PlayQueue<T extends QueueEntry = QueueEntry> {
  readonly entries: readonly T[];
  readonly currentId: string | null;
  readonly repeat: RepeatMode;
  readonly unshuffledOrder: readonly string[] | null;
}
export type QueueAction<T extends QueueEntry = QueueEntry> =
  | { readonly type: "play-next" | "add-to-end"; readonly entries: readonly T[] }
  | { readonly type: "remove"; readonly id: string }
  | { readonly type: "move"; readonly id: string; readonly toIndex: number }
  | { readonly type: "skip" | "ended" }
  | { readonly type: "previous"; readonly elapsedSeconds: number }
  | { readonly type: "repeat"; readonly mode: RepeatMode }
  | { readonly type: "shuffle"; readonly enabled: boolean; readonly seed: number };

function repeatMode(value: unknown): value is RepeatMode {
  return value === "off" || value === "all" || value === "one";
}
function entryIds(entries: readonly QueueEntry[]): string[] {
  if (!Array.isArray(entries)) throw new MusicQueueError("invalid-entry");
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new MusicQueueError("invalid-entry");
    }
    ids.push(entry.id);
  }
  if (new Set(ids).size !== ids.length) throw new MusicQueueError("invalid-entry");
  return ids;
}
function validate<T extends QueueEntry>(state: PlayQueue<T>): void {
  if (!state || typeof state !== "object") throw new MusicQueueError("invalid-queue");
  const ids = entryIds(state.entries);
  if (!repeatMode(state.repeat) || (state.currentId !== null && !ids.includes(state.currentId))) {
    throw new MusicQueueError("invalid-queue");
  }
  const order = state.unshuffledOrder;
  if (
    order !== null &&
    (!Array.isArray(order) ||
      order.length !== ids.length ||
      new Set(order).size !== ids.length ||
      Array.from(order).some((id) => !ids.includes(id)))
  ) {
    throw new MusicQueueError("invalid-queue");
  }
}
export function createPlayQueue<T extends QueueEntry>(entries: readonly T[]): PlayQueue<T> {
  entryIds(entries);
  return {
    entries: [...entries],
    currentId: entries[0]?.id ?? null,
    repeat: "off",
    unshuffledOrder: null,
  };
}

/** Pure reducer. On every navigation action the playback adapter must seek to zero. */
export function reducePlayQueue<T extends QueueEntry>(
  state: PlayQueue<T>,
  action: QueueAction<T>,
): PlayQueue<T> {
  validate(state);
  if (!action || typeof action !== "object") throw new MusicQueueError("invalid-action");
  let entries = [...state.entries];
  const current = entries.findIndex((entry) => entry.id === state.currentId);
  switch (action.type) {
    case "play-next":
    case "add-to-end": {
      const added = entryIds(action.entries);
      if (added.some((id) => entries.some((entry) => entry.id === id))) {
        throw new MusicQueueError("invalid-entry");
      }
      const next = action.type === "play-next";
      const index = next ? current + 1 : entries.length;
      entries = [...entries.slice(0, index), ...action.entries, ...entries.slice(index)];
      let order = state.unshuffledOrder;
      if (order !== null) {
        const index = next ? order.indexOf(state.currentId as string) + 1 : order.length;
        order = [...order.slice(0, index), ...added, ...order.slice(index)];
      }
      return { ...state, entries, unshuffledOrder: order };
    }
    case "remove":
    case "move": {
      const from = entries.findIndex((entry) => entry.id === action.id);
      if (from < 0) throw new MusicQueueError("invalid-action");
      const [entry] = entries.splice(from, 1) as [T];
      if (action.type === "move") {
        if (
          !Number.isInteger(action.toIndex) ||
          action.toIndex < 0 ||
          action.toIndex > entries.length
        ) {
          throw new MusicQueueError("invalid-action");
        }
        entries.splice(action.toIndex, 0, entry);
        return { ...state, entries };
      }
      return {
        ...state,
        entries,
        currentId:
          action.id === state.currentId
            ? (entries[from]?.id ?? entries[from - 1]?.id ?? null)
            : state.currentId,
        unshuffledOrder: state.unshuffledOrder?.filter((id) => id !== action.id) ?? null,
      };
    }
    case "repeat":
      if (!repeatMode(action.mode)) throw new MusicQueueError("invalid-action");
      return { ...state, repeat: action.mode };
    case "previous": {
      if (!Number.isFinite(action.elapsedSeconds) || action.elapsedSeconds < 0) {
        throw new MusicQueueError("invalid-action");
      }
      if (current >= 0 && action.elapsedSeconds >= 3) return { ...state };
      let index = current < 0 ? entries.length - 1 : current - 1;
      if (index < 0) index = state.repeat === "all" ? entries.length - 1 : 0;
      return { ...state, currentId: entries[index]?.id ?? null };
    }
    case "skip":
    case "ended": {
      if (action.type === "ended" && (state.repeat === "one" || current < 0)) return { ...state };
      let index = current + 1;
      if (index === entries.length && state.repeat === "all") index = 0;
      return { ...state, currentId: entries[index]?.id ?? null };
    }
    case "shuffle": {
      if (
        typeof action.enabled !== "boolean" ||
        !Number.isInteger(action.seed) ||
        action.seed < 0 ||
        action.seed > 0xffffffff
      ) {
        throw new MusicQueueError("invalid-action");
      }
      if (action.enabled === (state.unshuffledOrder !== null)) return { ...state };
      if (!action.enabled) {
        // Validated permutation; the idempotence guard proves a saved order exists.
        const order = state.unshuffledOrder as readonly string[];
        return {
          ...state,
          entries: entries.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
          unshuffledOrder: null,
        };
      }
      const others = entries.filter((entry) => entry.id !== state.currentId);
      let seed = action.seed;
      // Numerical Recipes uint32 LCG; deterministic even for seed zero.
      for (let i = others.length - 1; i > 0; i--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const j = Math.floor((seed / 0x100000000) * (i + 1));
        [others[i], others[j]] = [others[j] as T, others[i] as T];
      }
      if (current >= 0) others.splice(current, 0, entries[current] as T);
      return { ...state, entries: others, unshuffledOrder: entries.map((entry) => entry.id) };
    }
    default:
      throw new MusicQueueError("invalid-action");
  }
}
