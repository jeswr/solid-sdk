// AUTHORED-BY Codex GPT-6
import { getOrientationTransform } from "../library/orientation";
import { type ImageEncoder, readExif, type ThumbnailPlan } from "../model";

async function decode(blob: Blob) {
  return createImageBitmap(blob, { imageOrientation: "none" });
}
async function render(blob: Blob, plan?: ThumbnailPlan, type = "image/webp", quality = 0.8) {
  const bitmap = await decode(blob);
  try {
    const transform = getOrientationTransform(bitmap.width, bitmap.height, plan?.orientation ?? 1);
    const width = plan?.width ?? bitmap.width;
    const height = plan?.height ?? bitmap.height;
    const canvas =
      typeof OffscreenCanvas === "undefined"
        ? document.createElement("canvas")
        : new OffscreenCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) throw new Error("Image encoding is unavailable in this browser");
    context.scale(width / transform.width, height / transform.height);
    context.transform(...transform.matrix);
    context.drawImage(bitmap, 0, 0);
    const encoded =
      canvas instanceof HTMLCanvasElement
        ? await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (value) => (value ? resolve(value) : reject(new Error("Image encoding failed"))),
              type,
              quality,
            ),
          )
        : await canvas.convertToBlob({ type, quality });
    if (encoded.type !== type) throw new Error("This browser cannot encode this image format");
    return encoded;
  } finally {
    bitmap.close();
  }
}
/** Minimal EXIF TIFF, retaining only the display orientation. */
function orientationTiff(orientation: number) {
  return Uint8Array.from([
    73,
    73,
    42,
    0,
    8,
    0,
    0,
    0,
    1,
    0,
    18,
    1,
    3,
    0,
    1,
    0,
    0,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
}
/** Walk every JPEG scan, preserving entropy bytes and removing inter-scan metadata too. */
async function stripJpeg(original: Blob) {
  const buffer = await original.arrayBuffer();
  const orientation = (await readExif(buffer)).orientation ?? 1;
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error("Invalid JPEG header");
  const parts: BlobPart[] = [bytes.slice(0, 2)];
  let inserted = false;
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 255) throw new Error("Invalid JPEG header");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker !== 224 && !inserted) {
      if (orientation !== 1)
        parts.push(
          Uint8Array.from([255, 225, 0, 34, 69, 120, 105, 102, 0, 0]),
          orientationTiff(orientation),
        );
      inserted = true;
    }
    if (marker === 217) {
      parts.push(bytes.slice(start, offset));
      return new Blob(parts, { type: "image/jpeg" });
    }
    if (marker === undefined || offset + 2 > bytes.length) throw new Error("Invalid JPEG segment");
    const length = ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number);
    if (length < 2 || offset + length > bytes.length) throw new Error("Invalid JPEG segment");
    offset += length;
    if (!((marker >= 225 && marker <= 239 && marker !== 238) || marker === 254))
      parts.push(bytes.slice(start, offset));
    if (marker === 218) {
      const scan = offset;
      // FF00 is an escaped entropy byte; restart markers are part of the scan.
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) {
          offset++;
          continue;
        }
        let next = offset + 1;
        while (bytes[next] === 255) next++;
        const code = bytes[next];
        if (code === 0 || (code !== undefined && code >= 208 && code <= 215)) offset = next + 1;
        else break;
      }
      parts.push(bytes.slice(scan, offset));
    }
  }
  throw new Error("Incomplete JPEG image");
}
/** Remove WebP metadata chunks without decoding or recompressing any image frame. */
async function stripWebp(original: Blob) {
  const buffer = await original.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const tag = (start: number) => String.fromCharCode(...bytes.slice(start, start + 4));
  if (
    bytes.length < 12 ||
    tag(0) !== "RIFF" ||
    tag(8) !== "WEBP" ||
    view.getUint32(4, true) + 8 !== bytes.length
  )
    throw new Error("Invalid WebP container");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let orientation = 1;
  let extended: Uint8Array<ArrayBuffer> | undefined;
  for (let offset = 12; offset < bytes.length; ) {
    if (offset + 8 > bytes.length) throw new Error("Invalid WebP chunk");
    const type = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) throw new Error("Invalid WebP chunk");
    if (type === "EXIF") {
      let tiff = bytes.slice(offset + 8, offset + 8 + size);
      if (String.fromCharCode(...tiff.slice(0, 6)) === "Exif\0\0") tiff = tiff.slice(6);
      orientation = (await readExif(tiff.buffer)).orientation ?? 1;
    } else if (["VP8X", "ICCP", "ANIM", "ANMF", "ALPH", "VP8 ", "VP8L"].includes(type)) {
      const chunk = bytes.slice(offset, end);
      if (type === "VP8X") {
        if (size !== 10) throw new Error("Invalid extended WebP header");
        extended = chunk;
        chunk[8] = (chunk[8] as number) & ~12;
      }
      chunks.push(chunk);
    }
    offset = end;
  }
  if (orientation !== 1) {
    if (!extended) throw new Error("WebP EXIF requires an extended header");
    extended[8] = (extended[8] as number) | 8;
    const tiff = orientationTiff(orientation);
    chunks.push(Uint8Array.from([69, 88, 73, 70, tiff.length, 0, 0, 0, ...tiff]));
  }
  const header = bytes.slice(0, 12);
  new DataView(header.buffer).setUint32(
    4,
    4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    true,
  );
  return new Blob([header, ...chunks], { type: "image/webp" });
}
export const browserEncoder: ImageEncoder = {
  async dimensions(original) {
    const image = await decode(original);
    try {
      return { width: image.width, height: image.height };
    } finally {
      image.close();
    }
  },
  thumbnail: (original, plan) => render(original, plan),
  async stripLocation(original) {
    if (original.type === "image/jpeg") return stripJpeg(original);
    if (original.type === "image/webp") return stripWebp(original);
    // PNG encoding is lossless and drops ancillary metadata. Reject other formats
    // instead of silently uploading location or changing their media type.
    if (original.type !== "image/png")
      throw new Error(
        "Turn off Strip location for this image format, or upload a JPEG, PNG or WebP",
      );
    const exif = await readExif(await original.arrayBuffer());
    if ((exif.orientation ?? 1) !== 1)
      throw new Error("Convert this oriented image to JPEG before stripping location");
    return render(original, undefined, original.type);
  },
};
