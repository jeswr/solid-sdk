// AUTHORED-BY Codex GPT-6

/** Resolve app-owned URLs from Vite's base, including on a nested client route. */
export function appUrl(path = "", origin = location.origin): string {
  return new URL(path, new URL(import.meta.env.BASE_URL, `${origin}/`)).href;
}
