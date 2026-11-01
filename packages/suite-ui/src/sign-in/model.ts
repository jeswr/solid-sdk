// AUTHORED-BY Codex GPT-6.1-Sol
import type { SignInProvider } from "./types.js";

const tones = ["home", "drive", "docs", "tasks", "calendar", "contacts"] as const;

/** The first Unicode character, with a fallback for an empty display name. */
export function monogramFor(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() || "?";
}

/** Stable across renders and provider ordering; colours follow the active theme. */
export function toneFor(issuer: string): string {
  let hash = 0;
  for (const character of issuer)
    hash = (Math.imul(hash, 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  return `var(--app-${tones[hash % tones.length]})`;
}

/** Display metadata only. URL validation and login resolution belong to the host. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function signUpTarget(providers: readonly SignInProvider[]): string | undefined {
  for (const provider of providers) {
    const target = provider.signUpUrl?.trim();
    if (target) return target;
  }
  return undefined;
}
