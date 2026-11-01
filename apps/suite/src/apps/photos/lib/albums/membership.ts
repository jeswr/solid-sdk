// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { generateKeyBetween } from "../../../../lib/order";
import { isRecord, isText, requireAlbum } from "./error";

export interface AlbumMember {
  readonly id: string;
  /** Base-62 fractional key; compare with ordinary string ordering, never localeCompare. */
  readonly key: string;
}

function orderedMembers(members: readonly AlbumMember[]): AlbumMember[] {
  requireAlbum(Array.isArray(members), "invalid-input");
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const member of members) {
    requireAlbum(isRecord(member) && isText(member.id), "invalid-input");
    requireAlbum(!ids.has(member.id), "duplicate-member");
    requireAlbum(
      typeof member.key === "string" &&
        member.key.length > 0 &&
        !/[^0-9A-Za-z]/.test(member.key) &&
        !member.key.endsWith("0"),
      "invalid-order",
    );
    requireAlbum(!keys.has(member.key), "invalid-order");
    ids.add(member.id);
    keys.add(member.key);
  }
  return [...members].sort((a, b) => (a.key < b.key ? -1 : 1));
}

function position(index: number, size: number): void {
  requireAlbum(Number.isSafeInteger(index) && index >= 0 && index <= size, "invalid-position");
}

function memberIndex(members: readonly AlbumMember[], id: string): number {
  requireAlbum(isText(id), "invalid-input");
  const index = members.findIndex((member) => member.id === id);
  requireAlbum(index !== -1, "member-not-found");
  return index;
}

/** Insert at a zero-based displayed position (default append). Existing keys stay intact. */
export function addMember(
  members: readonly AlbumMember[],
  id: string,
  index?: number,
): AlbumMember[] {
  const ordered = orderedMembers(members);
  if (index === undefined) index = ordered.length;
  requireAlbum(isText(id), "invalid-input");
  requireAlbum(!ordered.some((member) => member.id === id), "duplicate-member");
  position(index, ordered.length);
  const key = generateKeyBetween(ordered[index - 1]?.key ?? null, ordered[index]?.key ?? null);
  ordered.splice(index, 0, { id, key });
  return ordered;
}

/** Remove exactly one existing member; no renumbering or input mutation. */
export function removeMember(members: readonly AlbumMember[], id: string): AlbumMember[] {
  const ordered = orderedMembers(members);
  ordered.splice(memberIndex(ordered, id), 1);
  return ordered;
}

/** Move a member to its final zero-based position, changing only that member's key. */
export function reorderMember(
  members: readonly AlbumMember[],
  id: string,
  index: number,
): AlbumMember[] {
  const ordered = orderedMembers(members);
  const from = memberIndex(ordered, id);
  position(index, ordered.length - 1);
  if (from === index) return ordered;
  ordered.splice(from, 1);
  const key = generateKeyBetween(ordered[index - 1]?.key ?? null, ordered[index]?.key ?? null);
  ordered.splice(index, 0, { id, key });
  return ordered;
}

/** Explicit member cover wins; otherwise first ordered member, or null for an empty album. */
export function selectCover(
  members: readonly AlbumMember[],
  explicit: string | null = null,
): string | null {
  const ordered = orderedMembers(members);
  if (explicit !== null) {
    memberIndex(ordered, explicit);
    return explicit;
  }
  return ordered[0]?.id ?? null;
}
