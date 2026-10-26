// AUTHORED-BY Codex GPT-6.1-Sol
import type { UploadChunk } from "./types";
import { byteSize, chunkSize, requireValue } from "./validation";

/** Bound memory used by an eager plain-data plan. */
export const MAX_UPLOAD_CHUNKS = 100_000;

export function planChunks(size: number, bytesPerChunk: number): readonly UploadChunk[] {
  byteSize(size);
  chunkSize(bytesPerChunk);
  const count = Number((BigInt(size) + BigInt(bytesPerChunk) - BigInt(1)) / BigInt(bytesPerChunk));
  requireValue(count <= MAX_UPLOAD_CHUNKS, "plan-too-large");
  const chunks: UploadChunk[] = [];
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const end = start + Math.min(bytesPerChunk, size - start);
    chunks.push({ index, start, end });
    start = end;
  }
  return chunks;
}
