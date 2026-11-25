// AUTHORED-BY Claude Sonnet 5.5
import { fail } from "./errors.js";
import { isShardKey } from "./scope.js";

/** Decoded form of the opaque list cursor. */
export interface ListPosition {
  /** `yyyy/mm` of the shard being read. */
  shard: string;
  /** The shard container itself: two containers may carry one label on LWS. */
  shardUrl: string;
  /** Storage page cursor URL within that shard, or null for its first page. */
  page: string | null;
  /** Index into that page's newest-first candidates. */
  offset: number;
}

const MAX_OFFSET = 1_000_000;

export function encodeCursor(position: ListPosition): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify([2, position.shard, position.shardUrl, position.page, position.offset]),
  );
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict decode; anything malformed is an `invalid-cursor` failure. */
export function decodeCursor(cursor: string): ListPosition {
  let parsed: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new TypeError("alphabet");
    const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw fail("failed", "invalid-cursor");
  }
  if (!Array.isArray(parsed) || parsed.length !== 5 || parsed[0] !== 2) {
    throw fail("failed", "invalid-cursor");
  }
  const [, shard, shardUrl, page, offset] = parsed as [unknown, unknown, unknown, unknown, unknown];
  if (
    !isShardKey(shard) ||
    typeof shardUrl !== "string" ||
    !(page === null || typeof page === "string") ||
    !Number.isSafeInteger(offset) ||
    (offset as number) < 0 ||
    (offset as number) > MAX_OFFSET
  ) {
    throw fail("failed", "invalid-cursor");
  }
  return { shard, shardUrl, page, offset: offset as number };
}
