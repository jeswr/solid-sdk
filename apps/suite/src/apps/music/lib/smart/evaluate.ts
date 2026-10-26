// AUTHORED-BY Codex GPT-6.1-Sol
import { validateSmartPlaylist } from "./schema";
import type {
  SmartPlaylist,
  SmartPlaylistRule,
  SmartPlaylistSort,
  SmartPlaylistTrack,
} from "./types";
import { validateLibrary } from "./validation";

function fieldValue(track: SmartPlaylistTrack, field: SmartPlaylistSort["field"]) {
  return field === "album" ? track.albumTitle : track[field];
}

function matches(track: SmartPlaylistTrack, rule: SmartPlaylistRule): boolean {
  const value = fieldValue(track, rule.field);
  if (value === undefined) return false;
  switch (rule.operator) {
    case "eq":
      return value === rule.value;
    case "ne":
      return value !== rule.value;
    case "contains":
      return (value as string).includes(rule.value);
    case "startsWith":
      return (value as string).startsWith(rule.value);
    case "endsWith":
      return (value as string).endsWith(rule.value);
    case "lt":
      return (value as number) < rule.value;
    case "lte":
      return (value as number) <= rule.value;
    case "gt":
      return (value as number) > rule.value;
    case "gte":
      return (value as number) >= rule.value;
  }
}

function compare(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparator(sort: SmartPlaylistSort) {
  return (a: SmartPlaylistTrack, b: SmartPlaylistTrack): number => {
    const left = fieldValue(a, sort.field);
    const right = fieldValue(b, sort.field);
    if (left === undefined && right !== undefined) return 1;
    if (left !== undefined && right === undefined) return -1;
    const order = left === undefined || right === undefined ? 0 : compare(left, right);
    return (sort.direction === "asc" ? order : -order) || compare(a.id, b.id);
  };
}

/**
 * Validate every rule and track before filtering, even with limit zero or an empty library.
 * Fresh array, original records, no clock/cache/I/O: call again after any library change.
 */
export function evaluateSmartPlaylist<T extends SmartPlaylistTrack>(
  library: readonly T[],
  playlist: SmartPlaylist,
): T[] {
  const definition = validateSmartPlaylist(playlist);
  validateLibrary(library);
  const result = library.filter((track) =>
    definition.mode === "all"
      ? definition.rules.every((rule) => matches(track, rule))
      : definition.rules.some((rule) => matches(track, rule)),
  );
  if (definition.sort) result.sort(comparator(definition.sort));
  return definition.limit === undefined ? result : result.slice(0, definition.limit);
}
