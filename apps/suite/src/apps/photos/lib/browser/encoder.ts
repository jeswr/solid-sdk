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
/** Strip JPEG metadata without touching compressed pixels. Keep only orientation. */
async function stripJpeg(original: Blob) {
  const orientation = (await readExif(await original.arrayBuffer())).orientation ?? 1;
  const bytes = new Uint8Array(await original.arrayBuffer());
  const parts: BlobPart[] = [bytes.slice(0, 2)];
  // Orientation-only APP1; inserted after a leading JFIF header.
  const orientationBytes = Uint8Array.from([
    255,
    225,
    0,
    34,
    69,
    120,
    105,
    102,
    0,
    0,
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
  let inserted = false;
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 255) throw new Error("Invalid JPEG header");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker !== 224 && !inserted) {
      if (orientation !== 1) parts.push(orientationBytes);
      inserted = true;
    }
    if (marker === 218 || marker === 217) {
      parts.push(bytes.slice(start));
      break;
    }
    if (marker === undefined || offset + 2 > bytes.length) throw new Error("Invalid JPEG segment");
    const length = ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number);
    if (length < 2 || offset + length > bytes.length) throw new Error("Invalid JPEG segment");
    offset += length;
    if (!((marker >= 225 && marker <= 239 && marker !== 238) || marker === 254))
      parts.push(bytes.slice(start, offset));
  }
  return new Blob(parts, { type: "image/jpeg" });
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
    // Browser PNG/WebP encoding drops ancillary metadata. Reject other formats
    // instead of silently uploading location or changing their media type.
    if (!["image/png", "image/webp"].includes(original.type))
      throw new Error(
        "Turn off Strip location for this image format, or upload a JPEG, PNG or WebP",
      );
    const exif = await readExif(await original.arrayBuffer());
    if ((exif.orientation ?? 1) !== 1)
      throw new Error("Convert this oriented image to JPEG before stripping location");
    return render(original, undefined, original.type);
  },
};
