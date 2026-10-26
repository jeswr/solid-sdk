// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";

export class InvalidMusicError extends Error {
  override name = "InvalidMusicError";
}

export function nonEmpty(value: string): string {
  if (!value.trim()) throw new InvalidMusicError("A name is required");
  return value;
}

/** Preserve lexical RDF identity while escaping forbidden IRIREF characters. */
export function httpIri(value: string): string {
  const safe = safeHttpIri(value);
  if (!safe || new URL(safe).username || new URL(safe).password) {
    throw new InvalidMusicError("An absolute HTTP(S) IRI without credentials is required");
  }
  return safe;
}

export function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidMusicError("A finite non-negative number is required");
  }
  return value;
}

export function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new InvalidMusicError("A valid date is required");
  return value;
}

/** Legacy integer seconds and Spotify's ISO H/M/S duration converge to seconds. */
export function durationSeconds(value: string): number | undefined {
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds : undefined;
  }
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match?.slice(1).some(Boolean)) return undefined;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return Number.isFinite(seconds) ? seconds : undefined;
}
