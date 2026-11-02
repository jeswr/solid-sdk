// @vitest-environment jsdom
// AUTHORED-BY Codex
import { afterEach, expect, it, vi } from "vitest";
import { displayImageBlob, imagePng } from "../src/apps/docs/editor/image-blob";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  "display",
  "export",
])("round35 SVG %s decodes when Chromium rejects createImageBitmap without publishing active blobs", async (path) => {
  vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("SVG not supported")));
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><script>throw 1</script><rect width="12" height="8"/></svg>';
  const sources: string[] = [];
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 12;
      naturalHeight = 8;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        if (value) {
          sources.push(value);
          queueMicrotask(() => this.onload?.());
        }
      }
    },
  );
  const createObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
    },
  );
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const png = new Blob(["pixels"], { type: "image/png" });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(png));
  const blob = new Blob([source], { type: "image/svg+xml" });
  if (path === "display") expect(await displayImageBlob(blob)).toBe(png);
  else expect(await imagePng(blob)).toEqual({ blob: png, width: 12, height: 8 });
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(drawImage).toHaveBeenCalledOnce();
  expect(createObjectURL).not.toHaveBeenCalled();
});
