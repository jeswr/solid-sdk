// AUTHORED-BY Codex
/** Decode without publishing the source bytes as a navigable blob URL. */
export async function imagePng(blob: Blob) {
  if (!blob.type.startsWith("image/")) throw new Error("Image unavailable");
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image unavailable");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Image unavailable"))),
        "image/png",
      ),
    );
    return { blob: png, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Only passive raster MIME types may retain their original (possibly animated) bytes. */
export async function displayImageBlob(blob: Blob): Promise<Blob> {
  if (/^image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(blob.type))
    return blob;
  return (await imagePng(blob)).blob;
}
