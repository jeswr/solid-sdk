// AUTHORED-BY Codex GPT-6.1-Sol
import type { Dimensions, ThumbnailPlan } from "../model";

function waitFor(video: HTMLVideoElement, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(event, ready);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", failed);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(
        new Error("This browser couldn't read this video. Try an MP4, MOV or WebM it can play."),
      );
    };
    video.addEventListener(event, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", failed, { once: true });
    if (signal.aborted) failed();
  });
}

async function withVideo<T>(
  blob: Blob,
  use: (video: HTMLVideoElement, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const video = document.createElement("video");
  const url = URL.createObjectURL(blob);
  const controller = new AbortController();
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            "Reading this video timed out after 15 seconds. Try again or choose another video.",
          ),
        );
        controller.abort();
      }, 15000);
    });
    const work = async () => {
      const loaded = waitFor(video, "loadedmetadata", controller.signal);
      video.src = url;
      video.load();
      await loaded;
      if (!video.videoWidth || !video.videoHeight)
        throw new Error("This browser couldn't read the video's dimensions.");
      return use(video, controller.signal);
    };
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export function videoDimensions(blob: Blob): Promise<Dimensions> {
  return withVideo(blob, async (video) => ({
    width: video.videoWidth,
    height: video.videoHeight,
    ...(Number.isFinite(video.duration) && video.duration >= 0
      ? { durationSeconds: video.duration }
      : {}),
  }));
}

export function videoThumbnail(blob: Blob, plan: ThumbnailPlan): Promise<Blob> {
  return withVideo(blob, async (video, signal) => {
    if (!Number.isFinite(video.duration) || video.duration < 0)
      throw new Error("This video's duration is unavailable. Try another video.");
    const time = Math.min(1, video.duration / 2);
    video.preload = "auto";
    if (time > 0) {
      const sought = waitFor(video, "seeked", signal);
      video.currentTime = time;
      await sought;
    } else if (video.readyState < 2) {
      await waitFor(video, "loadeddata", signal);
    }
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Video thumbnails are unavailable in this browser.");
    context.drawImage(video, 0, 0, plan.width, plan.height);
    const encoded = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Video thumbnail encoding failed."))),
        "image/webp",
        0.8,
      ),
    );
    if (encoded.type !== "image/webp")
      throw new Error("This browser cannot encode WebP thumbnails.");
    return encoded;
  });
}
