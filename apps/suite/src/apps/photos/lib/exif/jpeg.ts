// AUTHORED-BY Codex GPT-6.1-Sol
import { requireExif } from "./error";
import { type ExifMetadata, readTiff } from "./tiff";

/** Read JPEG header metadata through SOS/EOI; does not decode/validate compressed image data. */
export function parseExif(input: Uint8Array | ArrayBuffer): ExifMetadata | null {
  requireExif(input instanceof Uint8Array || input instanceof ArrayBuffer, "invalid-input");
  const buffer = input instanceof Uint8Array ? input.buffer : input;
  requireExif(buffer instanceof ArrayBuffer && !buffer.detached, "invalid-input");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  requireExif(bytes[0] === 0xff && bytes[1] === 0xd8, "invalid-jpeg");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = 2;
  let result: ExifMetadata | null = null;
  while (position < bytes.length) {
    requireExif(bytes[position++] === 0xff, "invalid-jpeg");
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    requireExif(marker !== undefined, "out-of-bounds");
    if (marker === 0xd9) return result;
    if (marker === 0x01) continue; // TEM is a standalone marker.
    requireExif(marker >= 0xc0 && (marker < 0xd0 || marker > 0xd8), "invalid-jpeg");
    requireExif(position + 2 <= bytes.length, "out-of-bounds");
    const length = view.getUint16(position);
    requireExif(length >= 2, "invalid-jpeg");
    const end = position + length;
    requireExif(end <= bytes.length, "out-of-bounds");
    position += 2;
    if (marker === 0xda) return result;
    if (
      marker === 0xe1 &&
      end - position >= 4 &&
      bytes[position] === 0x45 &&
      bytes[position + 1] === 0x78 &&
      bytes[position + 2] === 0x69 &&
      bytes[position + 3] === 0x66
    ) {
      requireExif(
        end - position >= 6 && bytes[position + 4] === 0 && bytes[position + 5] === 0,
        "invalid-tiff",
      );
      requireExif(result === null, "duplicate-exif");
      result = readTiff(bytes.subarray(position + 6, end));
    }
    position = end;
  }
  requireExif(false, "out-of-bounds");
}
