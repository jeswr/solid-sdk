// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { scenes } from "../src/apps/photos/demo/images";
import { browserEncoder } from "../src/apps/photos/lib/browser/encoder";
import { getOrientationTransform } from "../src/apps/photos/lib/library/orientation";
import { readExif, thumbnailPlan } from "../src/apps/photos/lib/model";
import { animatedPng } from "./photos/animated-png";
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
  it("preserves every JPEG ICC profile segment byte for byte while removing non-profile APP2 metadata", async () => {
    const original = new Uint8Array(await jpeg(6).arrayBuffer());
    const segment = (payload: Uint8Array) =>
      Uint8Array.from([
        255,
        226,
        (payload.length + 2) >> 8,
        (payload.length + 2) & 255,
        ...payload,
      ]);
    const signature = [...new TextEncoder().encode("ICC_PROFILE\0")];
    const profile = [
      segment(Uint8Array.from([...signature, 1, 2, 0, 128, 255, 42])),
      segment(Uint8Array.from([...signature, 2, 2, 17, 0, 31])),
    ] as const;
    const privateMetadata = segment(new TextEncoder().encode("GPS location in APP2"));
    const input = new Blob(
      [original.slice(0, -2), profile[0], privateMetadata, profile[1], original.slice(-2)],
      { type: "image/jpeg" },
    );
    const stripped = new Uint8Array(
      await (await browserEncoder.stripLocation(input)).arrayBuffer(),
    );
    const expected = new Uint8Array(
      await (await browserEncoder.stripLocation(jpeg(6))).arrayBuffer(),
    );
    expect(stripped).toEqual(
      new Uint8Array(
        await new Blob([expected.slice(0, -2), ...profile, expected.slice(-2)]).arrayBuffer(),
      ),
    );
    expect(new TextDecoder().decode(stripped)).not.toContain("GPS");
    expect((await readExif(stripped.buffer)).orientation).toBe(6);
  });
  it("rejects stripping animated PNGs before a canvas can discard frames", async () => {
    const bytes = Uint8Array.from(atob(scenes[0][0]), (c) => c.charCodeAt(0));
    const animated = animatedPng();
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(browserEncoder.stripLocation(animated)).rejects.toThrow(
      "Turn off Remove location from uploads to keep all frames",
    );
    expect(decode).not.toHaveBeenCalled();
    const invalid = new Blob(
      [bytes.slice(0, 33), Uint8Array.from([255, 255, 255, 255, 73, 68, 65, 84, 0, 0, 0, 0])],
      { type: "image/png" },
    );
    await expect(browserEncoder.stripLocation(invalid)).rejects.toThrow("Invalid PNG chunk");
  });
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

function webpChunk(type: string, payload: Uint8Array) {
  const chunk = new Uint8Array(8 + payload.length + (payload.length % 2));
  chunk.set([...type].map((c) => c.charCodeAt(0)));
  new DataView(chunk.buffer).setUint32(4, payload.length, true);
  chunk.set(payload, 8);
  return chunk;
}
function webp(chunks: Uint8Array[]) {
  const header = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  new DataView(header.buffer).setUint32(
    4,
    4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    true,
  );
  return new Blob([header, ...chunks.map((chunk) => new Uint8Array(chunk))], {
    type: "image/webp",
  });
}
function chunksOf(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = new Map<string, Uint8Array>();
  for (let offset = 12; offset < bytes.length; ) {
    const size = new DataView(buffer).getUint32(offset + 4, true);
    chunks.set(
      String.fromCharCode(...bytes.slice(offset, offset + 4)),
      bytes.slice(offset + 8, offset + 8 + size),
    );
    offset += 8 + size + (size % 2);
  }
  expect(new DataView(buffer).getUint32(4, true) + 8).toBe(bytes.length);
  return chunks;
}
it("removes GPS metadata between progressive JPEG scans without altering entropy or restart markers", async () => {
  const original = new Uint8Array(await jpeg(6).arrayBuffer());
  const gps = new TextEncoder().encode(
    "http://ns.adobe.com/xap/1.0/\0 GPSLatitude=51.05 GPSLongitude=3.72",
  );
  const segment = Uint8Array.from([
    255,
    225,
    (gps.length + 2) >> 8,
    (gps.length + 2) & 255,
    ...gps,
  ]);
  const scan = Uint8Array.from([255, 218, 0, 2, 10, 255, 0, 20, 255, 208, 30, 255, 255, 209, 40]);
  const bytes = new Blob(
    [original.slice(0, -2), segment, scan, segment, scan, Uint8Array.from([255, 217]), gps],
    { type: "image/jpeg" },
  );
  const stripped = await browserEncoder.stripLocation(bytes);
  const output = new Uint8Array(await stripped.arrayBuffer());
  expect(new TextDecoder().decode(output)).not.toContain("GPS");
  expect([...output.slice(-2 - scan.length * 2)]).toEqual([...scan, ...scan, 255, 217]);
  expect((await readExif(output.buffer)).orientation).toBe(6);
});
it("strips WebP GPS without recompressing pixels or changing orientation, including animation chunks", async () => {
  const pixel = webpChunk("VP8 ", Uint8Array.from([1, 2, 255, 0, 5]));
  const frame = webpChunk("ANMF", Uint8Array.from([8, 7, 6, 5]));
  const xmp = webpChunk("XMP ", new TextEncoder().encode("GPSLatitude=51"));
  for (let orientation = 1; orientation <= 8; orientation++) {
    const header = webpChunk("VP8X", Uint8Array.from([14, 0, 0, 0, 1, 0, 0, 1, 0, 0]));
    const tiff = new Uint8Array(tiffFixture(orientation));
    const prefixed =
      orientation % 2 === 0 ? Uint8Array.from([69, 120, 105, 102, 0, 0, ...tiff]) : tiff;
    const original = webp([header, pixel, frame, webpChunk("EXIF", prefixed), xmp]);
    const stripped = await browserEncoder.stripLocation(original);
    const buffer = await stripped.arrayBuffer();
    const chunks = chunksOf(buffer);
    expect(chunks.get("VP8 ")).toEqual(pixel.slice(8, 13));
    expect(chunks.get("ANMF")).toEqual(frame.slice(8));
    expect(chunks.has("XMP ")).toBe(false);
    expect((chunks.get("VP8X")?.[0] ?? 0) & 12).toBe(orientation === 1 ? 0 : 8);
    const exif = chunks.get("EXIF");
    if (orientation === 1) expect(exif).toBeUndefined();
    else {
      const metadata = await readExif(new Uint8Array(exif as Uint8Array).buffer);
      expect(metadata.orientation).toBe(orientation);
      expect(metadata.location).toBeUndefined();
    }
    expect(stripped.type).toBe("image/webp");
    expect(new TextDecoder().decode(buffer)).not.toContain("GPS");
  }
});
it("preserves a simple WebP bitstream exactly and rejects malformed containers instead of uploading metadata", async () => {
  const original = webp([webpChunk("VP8L", Uint8Array.from([47, 0, 1, 2, 3]))]);
  expect(await (await browserEncoder.stripLocation(original)).arrayBuffer()).toEqual(
    await original.arrayBuffer(),
  );
  const invalid = [
    new Blob(["not webp"], { type: "image/webp" }),
    webp([Uint8Array.from([1])]),
    webp([Uint8Array.from([86, 80, 56, 32, 255, 255, 255, 255])]),
    webp([webpChunk("VP8X", new Uint8Array(1))]),
    webp([webpChunk("EXIF", new Uint8Array(tiffFixture(6)))]),
  ];
  for (const blob of invalid) await expect(browserEncoder.stripLocation(blob)).rejects.toThrow();
});
