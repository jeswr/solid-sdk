// AUTHORED-BY Codex GPT-6.1-Sol
import { requireValid, validateUrl } from "./validation";

function copyStars(stars: ReadonlySet<string>): Set<string> {
  requireValid(stars instanceof Set, "invalid-stars");
  const copy = new Set<string>();
  for (const url of stars) {
    validateUrl(url);
    copy.add(url);
  }
  return copy;
}

/** Add or remove a star; always returns a fresh set, including for idempotent operations. */
export function setStarred(stars: ReadonlySet<string>, url: string, starred: boolean): Set<string> {
  const result = copyStars(stars);
  validateUrl(url);
  requireValid(typeof starred === "boolean", "invalid-stars");
  if (starred) result.add(url);
  else result.delete(url);
  return result;
}

export function toggleStarred(stars: ReadonlySet<string>, url: string): Set<string> {
  const result = copyStars(stars);
  validateUrl(url);
  if (!result.delete(url)) result.add(url);
  return result;
}

/** Re-point a star using the actual URL returned by a successful move. */
export function moveStar(stars: ReadonlySet<string>, fromUrl: string, toUrl: string): Set<string> {
  const result = copyStars(stars);
  validateUrl(fromUrl);
  validateUrl(toUrl);
  if (result.delete(fromUrl)) result.add(toUrl);
  return result;
}
