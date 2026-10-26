// AUTHORED-BY Codex GPT-6
import { decode } from "./rdf.js";

export function codec(bytes: Uint8Array): "gzip" | "zstd" {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes.length >= 4) {
    const magic = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    if (magic === 0xfd2fb528 || (magic & 0xfffffff0) === 0x184d2a50) return "zstd";
  }
  throw new TypeError("Expected gzip or zstd snapshot magic bytes");
}

export async function gzip(text: string): Promise<Uint8Array> {
  const input = new Blob([new TextEncoder().encode(text)]).stream();
  return new Uint8Array(
    await new Response(input.pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
  );
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const input = new Blob([new Uint8Array(bytes)]).stream();
  return decode(
    new Uint8Array(
      await new Response(input.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(),
    ),
  );
}
