// AUTHORED-BY Codex GPT-6.1-Sol
import { validateTracks } from "../library/validation";
import type { NumberField, SmartPlaylistTrack } from "./types";

export type SmartPlaylistErrorCode = "invalid-playlist" | "invalid-json" | "invalid-library";

/** Does not echo library metadata or serialised input into messages. */
export class SmartPlaylistError extends Error {
  constructor(public readonly code: SmartPlaylistErrorCode) {
    super(`Smart playlist: ${code}`);
    this.name = "SmartPlaylistError";
  }
}

export function requireSmart(condition: unknown, code: SmartPlaylistErrorCode): asserts condition {
  if (!condition) throw new SmartPlaylistError(code);
}

/** JSON-like data records only; accessors, hidden fields and custom prototypes fail closed. */
export function dataRecord(
  value: unknown,
  code: SmartPlaylistErrorCode,
): asserts value is Record<string, unknown> {
  requireSmart(typeof value === "object" && value !== null && !Array.isArray(value), code);
  const prototype = Object.getPrototypeOf(value);
  requireSmart(prototype === Object.prototype || prototype === null, code);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key) as PropertyDescriptor;
    requireSmart(typeof key === "string" && descriptor.enumerable && "value" in descriptor, code);
  }
}

export function isText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.isWellFormed() &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

export function isNumber(field: NumberField, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  switch (field) {
    case "rating":
      return value >= 0 && value <= 5;
    case "year":
      return Number.isInteger(value) && value >= 1 && value <= 9999;
    case "playCount":
      return Number.isSafeInteger(value) && value >= 0;
    case "lastPlayedAt":
      return Number.isInteger(value) && Math.abs(value) <= 8_640_000_000_000_000;
  }
}

export function validateLibrary(tracks: readonly SmartPlaylistTrack[]): void {
  requireSmart(Array.isArray(tracks), "invalid-library");
  for (const track of tracks) dataRecord(track, "invalid-library");
  try {
    validateTracks(tracks);
  } catch {
    throw new SmartPlaylistError("invalid-library");
  }
  for (const track of tracks) {
    requireSmart(track.genre === undefined || isText(track.genre), "invalid-library");
    for (const field of ["year", "playCount", "lastPlayedAt", "rating"] as const) {
      requireSmart(track[field] === undefined || isNumber(field, track[field]), "invalid-library");
    }
  }
}
