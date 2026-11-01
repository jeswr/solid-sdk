// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserEncoder } from "../src/apps/photos/lib/browser/encoder";
import { getOrientationTransform } from "../src/apps/photos/lib/library/orientation";
import { readExif, thumbnailPlan } from "../src/apps/photos/lib/model";
import { tiffFixture } from "./photos/fixtures";

afterEach(() => vi.unstubAllGlobals());
function jpeg(orientation: number) {
  const exif = new Uint8Array(tiffFixture(orientation));
  const length = exif.length + 8;
  return new Blob(
    [
      Uint8Array.from([
        255,
        216,
        255,
        224,
        0,
        4,
        1,
        2,
        255,
        225,
        length >> 8,
        length & 255,
        69,
        120,
        105,
        102,
        0,
        0,
      ]),
      exif,
      Uint8Array.from([
        255, 237, 0, 6, 71, 80, 83, 0, 255, 254, 0, 6, 71, 80, 83, 0, 255, 218, 0, 2, 10, 20, 30,
        255, 217,
      ]),
    ],
    { type: "image/jpeg" },
  );
}
describe("Photos browser encoder contracts", () => {
  it("strips private JPEG segments losslessly and preserves all eight raw orientations exactly once", async () => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const original = jpeg(orientation);
      expect((await readExif(await original.arrayBuffer())).location).toBeDefined();
      const stripped = await browserEncoder.stripLocation(original);
      const metadata = await readExif(await stripped.arrayBuffer());
      expect(stripped.type).toBe("image/jpeg");
      expect(metadata.location).toBeUndefined();
      expect(metadata.make).toBeUndefined();
      expect(metadata.orientation ?? 1).toBe(orientation);
      const bytes = new Uint8Array(await stripped.arrayBuffer());
      expect([...bytes.slice(-9)]).toEqual([255, 218, 0, 2, 10, 20, 30, 255, 217]);
      expect(new TextDecoder().decode(bytes)).not.toContain("GPS");
      // JFIF header and compressed scan remain unchanged.
      expect([...bytes.slice(0, 8)]).toEqual([255, 216, 255, 224, 0, 4, 1, 2]);
    }
  });
  it("decodes raw pixels, applies each requested orientation once and emits a bounded metadata-free WebP", async () => {
    const close = vi.fn();
    const decode = vi.fn(async (_blob: Blob, _options: ImageBitmapOptions) => ({
      width: 400,
      height: 200,
      close,
    }));
    vi.stubGlobal("createImageBitmap", decode);
    const context = { scale: vi.fn(), transform: vi.fn(), drawImage: vi.fn() };
    const encode = vi.fn(async () => new Blob(["encoded pixels"], { type: "image/webp" }));
    const canvasSizes: number[][] = [];
    vi.stubGlobal("HTMLCanvasElement", class {});
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
          canvasSizes.push([width, height]);
        }
        getContext() {
          return context;
        }
        convertToBlob = encode;
      },
    );
    const original = new Blob(["raw pixels"], { type: "image/jpeg" });
    expect(await browserEncoder.dimensions(original)).toEqual({ width: 400, height: 200 });
    for (let orientation = 1; orientation <= 8; orientation++) {
      const plan = thumbnailPlan(400, 200, orientation);
      expect((await browserEncoder.thumbnail(original, plan)).type).toBe("image/webp");
      expect(context.transform).toHaveBeenLastCalledWith(
        ...getOrientationTransform(400, 200, orientation).matrix,
      );
      expect(canvasSizes.at(-1)).toEqual([plan.width, plan.height]);
    }
    expect(decode.mock.calls.every((call) => call[0] === original)).toBe(true);
    expect(decode).toHaveBeenCalledWith(original, { imageOrientation: "none" });
    expect(encode).toHaveBeenLastCalledWith({ type: "image/webp", quality: 0.8 });
    expect(close).toHaveBeenCalledTimes(9);
  });
  it("fails clearly when a browser cannot safely strip a format", async () => {
    await expect(
      browserEncoder.stripLocation(new Blob(["unknown"], { type: "image/heic" })),
    ).rejects.toThrow("Turn off Strip location");
  });
});
