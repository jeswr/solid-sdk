// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it, vi } from "vitest";
import { photoDataStorage } from "../src/apps/photos/lib/data/storage";
import { takeoutFailure } from "../src/apps/photos/lib/data/takeout-import";
import { uploadFiles } from "../src/apps/photos/lib/data/upload";
import { type ImageEncoder, PrivateDestinationError } from "../src/apps/photos/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://owner.demo.pod/";
const NOW = "2026-11-11T12:00:00.000Z";
const encoder: ImageEncoder = {
  dimensions: async () => ({ width: 16, height: 16 }),
  stripLocation: async (blob) => blob,
  thumbnail: async () => new Blob(["thumb"], { type: "image/webp" }),
};
function setup() {
  const pod = createDemoPod({ root: ROOT });
  const puts: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.method === "PUT" && !String(input).endsWith("/")) puts.push(String(input));
    return pod.fetch(input, init);
  };
  return { io: photoDataStorage(fetch, ROOT), puts };
}
const files = [
  { name: "a.webm", original: new Blob(["a"], { type: "video/webm" }) },
  { name: "b.webm", original: new Blob(["b"], { type: "video/webm" }) },
];
let next = 0;
const options = (verifyDestination: (container: string) => Promise<boolean>) => ({
  encoder,
  stripLocation: false,
  now: NOW,
  id: () => `photo-${++next}`,
  verifyDestination,
});

describe("owner-only upload destination", () => {
  it("fails closed at runtime when the check is omitted by a caller that bypasses types", async () => {
    const { io, puts } = setup();
    await expect(uploadFiles(io, files, options(undefined as never))).rejects.toThrow(TypeError);
    await expect(io.uploadPhotos([], encoder, NOW, undefined as never)).rejects.toThrow(TypeError);
    expect(puts).toEqual([]);
  });
  it.each([
    ["not owner-only", async () => false],
    [
      "unreadable",
      async () => {
        throw new Error("policy unreadable");
      },
    ],
  ])("refuses to write anything when the destination is %s", async (_name, verify) => {
    const { io, puts } = setup();
    const results = await uploadFiles(io, files, options(verify));
    expect(results.map((result) => result.ok)).toEqual([false, false]);
    for (const result of results)
      expect(!result.ok && result.error).toBeInstanceOf(PrivateDestinationError);
    expect(puts).toEqual([]);
  });
  it("uploads once every container is verified, checking each container once per batch", async () => {
    const { io, puts } = setup();
    const verify = vi.fn(async (_container: string) => true);
    const results = await uploadFiles(io, files, options(verify));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(puts.length).toBe(6);
    expect(verify.mock.calls.map(([container]) => container).sort()).toEqual([
      `${ROOT}photos/items/`,
      `${ROOT}photos/originals/`,
      `${ROOT}photos/thumbs/`,
    ]);
  });
  it("does not remember a refusal and can upload after the destination is made private", async () => {
    const { io, puts } = setup();
    let private_ = false;
    const verify = async () => private_;
    const batch = options(verify);
    const input = [files[0] as (typeof files)[number]];
    expect((await uploadFiles(io, input, { ...batch, id: () => "retry" }))[0]?.ok).toBe(false);
    private_ = true;
    expect((await uploadFiles(io, input, { ...batch, id: () => "retry" }))[0]?.ok).toBe(true);
    expect(puts.length).toBe(3);
  });
  it("shows the designed refusal text to the person, without a recommendation to lower privacy", () => {
    const error = new PrivateDestinationError();
    expect(takeoutFailure(error, "video/mp4", true)).toEqual({
      kind: "photo",
      reason: error.message,
    });
    expect(error.message).not.toMatch(/turn off|disable/iu);
  });
});
