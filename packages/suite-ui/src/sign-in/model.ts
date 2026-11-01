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

/** Rotate the app palette by a provider's zero-based list position. */
export function toneAt(index: number): string {
  return `var(--app-${tones[index % tones.length]})`;
}

/** HTTP(S) only; single-slash local paths require explicit opt-in for help links. */
export function safeHref(
  value: string | undefined,
  allowSameOriginPath = false,
): string | undefined {
  const target = value?.trim();
  // URL parsers can discard embedded whitespace or treat backslashes as slashes.
  if (!target || /[\s\\]/u.test(target)) return undefined;
  try {
    if (allowSameOriginPath && target.startsWith("/") && !target.startsWith("//")) {
      return target;
    }
    const url = new URL(target);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
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
    const target = safeHref(provider.signUpUrl);
    if (target) return target;
  }
  return undefined;
}
