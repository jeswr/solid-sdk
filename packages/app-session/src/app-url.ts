// AUTHORED-BY GPT-6.1 Sol
/** Resolve app-owned URLs from an explicit base, including on a nested client route. */
export function appUrl(path: string, base: string, origin = location.origin): string {
  return new URL(path, new URL(base, `${origin}/`)).href;
}
