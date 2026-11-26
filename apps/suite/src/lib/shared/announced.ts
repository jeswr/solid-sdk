// AUTHORED-BY Claude Sonnet 5.5
/** Marks a Drive preview link that came from an unverified inbox announcement. */
export const ANNOUNCED_QUERY = "from=announced";

export function isAnnouncedLocation(search: string | undefined): boolean {
  return new URLSearchParams(search ?? "").get("from") === "announced";
}
