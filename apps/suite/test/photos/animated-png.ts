// AUTHORED-BY Codex GPT-6
import { deflateSync } from "node:zlib";

function chunk(type: string, payload: Uint8Array) {
  const bytes = new Uint8Array(payload.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, payload.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(payload, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.slice(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
/** Two 1×1 RGBA APNG frames (red, then green), with real CRCs and zlib scans. */
export function animatedPng() {
  const frame = (sequence: number) => {
    const bytes = new Uint8Array(26);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, sequence);
    view.setUint32(4, 1);
    view.setUint32(8, 1);
    view.setUint16(20, 1);
    view.setUint16(22, 10);
    return chunk("fcTL", bytes);
  };
  return new Blob(
    [
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
      chunk("acTL", Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 0])),
      frame(0),
      chunk("IDAT", deflateSync(Uint8Array.from([0, 255, 0, 0, 255]))),
      frame(1),
      chunk(
        "fdAT",
        Uint8Array.from([0, 0, 0, 2, ...deflateSync(Uint8Array.from([0, 0, 255, 0, 255]))]),
      ),
      chunk("IEND", new Uint8Array()),
    ],
    { type: "image/png" },
  );
}
