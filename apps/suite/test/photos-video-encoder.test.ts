// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserEncoder } from "../src/apps/photos/lib/browser/encoder";
import { thumbnailPlan, VideoLocationError } from "../src/apps/photos/lib/model";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function browser(
  options: {
    duration?: number;
    width?: number;
    error?: boolean;
    stall?: boolean;
    seekError?: boolean;
    context?: boolean;
    encoding?: "null" | "wrong";
  } = {},
) {
  const videos: FakeVideo[] = [];
  class FakeVideo extends EventTarget {
    src = "";
    muted = false;
    playsInline = false;
    preload = "";
    videoWidth = options.width ?? 1920;
    videoHeight = 1080;
    duration = options.duration ?? 62.5;
    readyState = 2;
    time = 0;
    pause = vi.fn();
    removeAttribute(name: string) {
      if (name === "src") this.src = "";
    }
    load() {
      if (!this.src || options.stall) return;
      queueMicrotask(() =>
        this.dispatchEvent(new Event(options.error ? "error" : "loadedmetadata")),
      );
    }
    set currentTime(value: number) {
      this.time = value;
      queueMicrotask(() => this.dispatchEvent(new Event(options.seekError ? "error" : "seeked")));
    }
  }
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (options.context === false ? null : { drawImage }),
    toBlob: (callback: BlobCallback) =>
      callback(
        options.encoding === "null"
          ? null
          : new Blob(["frame"], {
              type: options.encoding === "wrong" ? "image/png" : "image/webp",
            }),
      ),
  };
  vi.stubGlobal("document", {
    createElement: (type: string) => {
      if (type === "canvas") return canvas;
      const video = new FakeVideo();
      videos.push(video);
      return video;
    },
  });
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { videos, create, revoke, drawImage, canvas };
}
const original = new Blob(["video"], { type: "video/webm" });
const plan = thumbnailPlan(1920, 1080);
describe("video browser encoder", () => {
  it("uses detached muted metadata loaders, seeks to the poster frame and releases every URL", async () => {
    const fake = browser();
    expect(await browserEncoder.dimensions(original)).toEqual({
      width: 1920,
      height: 1080,
      durationSeconds: 62.5,
    });
    expect((await browserEncoder.thumbnail(original, plan)).type).toBe("image/webp");
    expect(fake.videos[0]).toMatchObject({ muted: true, playsInline: true, preload: "metadata" });
    expect(fake.videos[1]?.time).toBe(1);
    expect(fake.canvas).toMatchObject({ width: 320, height: 180 });
    expect(fake.drawImage).toHaveBeenCalledWith(fake.videos[1], 0, 0, 320, 180);
    expect(fake.revoke).toHaveBeenCalledTimes(2);
    for (const video of fake.videos) {
      expect(video.src).toBe("");
      expect(video.pause).toHaveBeenCalledOnce();
    }
  });
  it("takes a short clip's midpoint and can capture an already-loaded first frame", async () => {
    let fake = browser({ duration: 0.6 });
    await browserEncoder.thumbnail(original, plan);
    expect(fake.videos[0]?.time).toBe(0.3);
    fake = browser({ duration: 0 });
    await browserEncoder.thumbnail(original, plan);
    expect(fake.videos[0]?.time).toBe(0);
  });
  it("always cleans up decode, seek, dimension, canvas and WebP failures", async () => {
    for (const options of [
      { error: true },
      { width: 0 },
      { seekError: true },
      { context: false },
      { encoding: "null" as const },
      { encoding: "wrong" as const },
      { duration: Infinity },
    ]) {
      vi.restoreAllMocks();
      const fake = browser(options);
      await expect(browserEncoder.thumbnail(original, plan)).rejects.toThrow();
      expect(fake.revoke).toHaveBeenCalledOnce();
      expect(fake.videos[0]?.pause).toHaveBeenCalledOnce();
    }
  });
  it("times out metadata loading after 15 seconds and revokes the URL", async () => {
    vi.useFakeTimers();
    const fake = browser({ stall: true });
    const pending = expect(browserEncoder.dimensions(original)).rejects.toThrow(
      "timed out after 15 seconds",
    );
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    expect(fake.revoke).toHaveBeenCalledOnce();
    expect(fake.videos[0]?.pause).toHaveBeenCalledOnce();
  });
  it("scrubs MP4/MOV with unchanged offsets and refuses unsafe WebM and Apple location metadata", async () => {
    const free = Uint8Array.of(0, 0, 0, 8, 102, 114, 101, 101);
    for (const type of ["video/mp4", "video/quicktime"]) {
      const stripped = await browserEncoder.stripLocation(new Blob([free], { type }));
      expect(stripped.type).toBe(type);
      expect(new Uint8Array(await stripped.arrayBuffer())).toEqual(free);
      await expect(
        browserEncoder.stripLocation(new Blob(["com.apple.quicktime.location.ISO6709"], { type })),
      ).rejects.toThrow(VideoLocationError);
    }
    await expect(browserEncoder.stripLocation(original)).rejects.toThrow(
      "Turn off Remove location for this video",
    );
  });
});
