// AUTHORED-BY Codex
/** SVG is unsupported by Chromium's bitmap decoder. Data URLs have an opaque
 * origin and let the passive HTML image decoder rasterize without a source blob URL. */
async function decodeImage(blob: Blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  } catch {
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Image unavailable"));
      reader.readAsDataURL(blob);
    });
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image unavailable"));
      image.src = src;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => {
        image.src = "";
      },
    };
  }
}

/** Decode without publishing the source bytes as a navigable blob URL. */
export async function imagePng(blob: Blob) {
  if (!blob.type.startsWith("image/")) throw new Error("Image unavailable");
  const bitmap = await decodeImage(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image unavailable");
    context.drawImage(bitmap.source, 0, 0);
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
