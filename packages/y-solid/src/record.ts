// AUTHORED-BY Codex GPT-6.1-Sol
import type { StoredUpdate } from "./store.js";

export const LOG_HEADER_BYTES = 16;
type RecordData = Omit<StoredUpdate, "url" | "etag">;

/** Network byte order: magic[4], unsigned milliseconds[8], random[4]. */
export function encodeRecord(
  update: Uint8Array,
  kind: StoredUpdate["kind"],
): { bytes: Uint8Array; name: string } {
  const timestamp = BigInt(Date.now());
  const random = crypto.getRandomValues(new Uint32Array(1))[0] as number;
  const bytes = new Uint8Array(LOG_HEADER_BYTES + update.byteLength);
  bytes.set(new TextEncoder().encode(kind === "snapshot" ? "JYS1" : "JYU1"));
  const view = new DataView(bytes.buffer);
  view.setBigUint64(4, timestamp);
  view.setUint32(12, random);
  bytes.set(update, LOG_HEADER_BYTES);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let suffix = "";
  let bits = BigInt(random);
  for (let i = 0; i < 8; i++) {
    suffix = alphabet[Number(bits & 31n)] + suffix;
    bits >>= 5n;
  }
  const name = `${kind === "snapshot" ? "snapshot-" : ""}${String(timestamp).padStart(13, "0")}-${suffix}.${kind === "snapshot" ? "ysnap" : "yupdate"}`;
  return { bytes, name };
}

export function decodeRecord(bytes: Uint8Array, url: string): RecordData {
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic === "JYU1" || magic === "JYS1") {
    if (bytes.byteLength < LOG_HEADER_BYTES) throw new Error("[y-solid] truncated log header");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      kind: magic === "JYS1" ? "snapshot" : "update",
      timestamp: view.getBigUint64(4),
      random: view.getUint32(12),
      update: bytes.slice(LOG_HEADER_BYTES),
    };
  }
  // v0.1 resources contain bare Yjs bytes and 15-digit timestamp/UUID names.
  const name = new URL(url).pathname.split("/").pop() ?? "";
  const timestamp = /^(\d{13,15})-/.exec(name)?.[1];
  return { kind: "update", timestamp: BigInt(timestamp ?? 0), random: 0, update: bytes };
}

export function compareRecords(a: StoredUpdate, b: StoredUpdate): number {
  if (a.kind !== b.kind) return a.kind === "snapshot" ? -1 : 1;
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  if (a.random !== b.random) return a.random - b.random;
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
}
