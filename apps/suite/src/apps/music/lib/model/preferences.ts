// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { InvalidMusicError } from "./validation";

/** Passed to the later per-account preferences hook; no image fetch happens here. */
export interface MusicPreferences {
  artwork: "hot-link" | "none";
}

export function parsePreferences(value: unknown): MusicPreferences {
  if (value === undefined || value === null) return { artwork: "none" };
  if (
    typeof value !== "object" ||
    !("artwork" in value) ||
    (value.artwork !== "none" && value.artwork !== "hot-link")
  ) {
    throw new InvalidMusicError("Artwork must be hot-link or none");
  }
  return { artwork: value.artwork };
}

export function artworkUrl(
  image: string | undefined,
  preferences: MusicPreferences,
): string | undefined {
  if (preferences.artwork === "none" || image === undefined) return undefined;
  const safe = safeHttpIri(image);
  if (!safe || new URL(safe).username || new URL(safe).password) return undefined;
  return safe;
}
