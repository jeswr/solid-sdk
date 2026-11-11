// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type Scene, sceneBounds, sceneToSvg } from "@jeswr/excalidraw-scene";
export function pngSize(scene: Scene): { width: number; height: number } {
  const b = sceneBounds(scene),
    width = b.width + 48,
    height = b.height + 48;
  const scale = Math.min(2, 4096 / Math.max(width, height));
  return {
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil(height * scale)),
  };
}
export async function scenePng(scene: Scene): Promise<Blob> {
  const svg = new Blob([sceneToSvg(scene, { background: true })], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Couldn't render this board"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    const size = pngSize(scene);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable in this browser");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't export this board"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function downloadBoard(blob: Blob, title: string, extension: string): Promise<void> {
  const name = `${title.replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 100) || "whiteboard"}.${extension}`;
  if (process.env.NEXT_PUBLIC_SUITE_TARGET === "native") {
    const { saveNatively } = await import("@/lib/native/save-file");
    await saveNatively(blob, name, blob.type);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
