// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import type { LibraryPhoto } from "../src/apps/photos/lib/data/library";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { act, click, h, mount } from "./drive-ui-dom";

const state = vi.hoisted(() => ({ usePhotos: vi.fn() }));
vi.mock("../src/apps/photos/state/photos-context", () => state);
vi.mock("../src/apps/photos/components/photos-app", () => ({ useRequestUpload: () => vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/photos",
  useSearchParams: () => new URLSearchParams(),
}));
const { VideoPlayer } = await import("../src/apps/photos/components/video-player");
const { usePhotoUrl } = await import("../src/apps/photos/components/photo-image");
const { PhotoGrid } = await import("../src/apps/photos/components/photo-grid");
const { StorageScreen } = await import("../src/apps/photos/components/storage");
const { AlbumsScreen } = await import("../src/apps/photos/components/collections");
const { getByRole } = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
)("@testing-library/dom") as {
  getByRole(container: HTMLElement, role: string, options: { name: string }): HTMLElement;
};
const ROOT = "https://video.demo.pod/";
const photo: LibraryPhoto = {
  url: `${ROOT}photos/items/clip.ttl`,
  ref: `${ROOT}photos/items/clip.ttl#it`,
  etag: '"1"',
  readOnly: false,
  name: "Lake clip",
  kind: "video",
  durationSeconds: 62.5,
  contentUrl: `${ROOT}photos/originals/clip.mp4`,
  thumbnailUrl: `${ROOT}photos/thumbs/clip.webp`,
  keywords: [],
  exif: {},
};
afterEach(() => vi.restoreAllMocks());
async function setup(type = "video/mp4") {
  const pod = createDemoPod({ root: ROOT });
  await pod.fetch(photo.contentUrl, {
    method: "PUT",
    headers: { "content-type": type, "if-none-match": "*" },
    body: "fixture",
  });
  await pod.fetch(photo.thumbnailUrl as string, {
    method: "PUT",
    headers: { "content-type": "image/webp", "if-none-match": "*" },
    body: "thumbnail",
  });
  const fetch = vi.fn(pod.fetch);
  state.usePhotos.mockReturnValue({
    status: "ready",
    photos: [photo],
    favourites: [],
    trash: [],
    albums: [],
    albumFailures: [],
    io: { root: ROOT },
    session: { fetch, storageUrl: ROOT },
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => `blob:${(blob as Blob).type}`);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const pause = vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  return { revoke, pause, fetch };
}

it("loads an authenticated video and poster, retries network failure and pauses on navigation", async () => {
  const { revoke, pause } = await setup();
  const view = await mount(h(VideoPlayer, { photo }));
  const node = view.host.querySelector("video") as HTMLVideoElement;
  expect(node).not.toBeNull();
  expect(node.src).toBe("blob:video/mp4");
  expect(node.poster).toBe("blob:image/webp");
  expect(node.controls).toBe(true);
  expect(node.playsInline).toBe(true);
  Object.defineProperty(node, "error", { value: { code: 2 } });
  await act(() => node.dispatchEvent(new window.Event("error")));
  await click(getByRole(view.host, "button", { name: "Retry" }));
  expect(view.host.querySelector("video")?.src).toBe("blob:video/mp4");
  const current = view.host.querySelector("video");
  pause.mockClear();
  await view.unmount();
  expect(pause.mock.contexts).toContain(current);
  expect(revoke).toHaveBeenCalledWith("blob:video/mp4");
  expect(revoke).toHaveBeenCalledWith("blob:image/webp");
});

it.each([
  3, 4,
])("offers a download without re-fetching after media decode/format error %s", async (code) => {
  const { fetch } = await setup();
  const view = await mount(h(VideoPlayer, { photo }));
  const node = view.host.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(node, "error", { value: { code } });
  const requests = fetch.mock.calls.length;
  await act(() => node.dispatchEvent(new window.Event("error")));
  expect(view.host.textContent).toContain("This video format can't be played in this browser");
  const download = getByRole(view.host, "link", { name: "Download video" });
  expect(download.getAttribute("href")).toBe("blob:video/mp4");
  expect(download.getAttribute("download")).toBe(photo.name);
  expect(view.host.querySelector("button")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(requests);
});

it("treats a downloaded blob's metadata timeout as decode failure and retries the same URL", async () => {
  const { fetch, revoke } = await setup();
  vi.useFakeTimers();
  try {
    const view = await mount(h(VideoPlayer, { photo }));
    const requests = fetch.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(view.host.textContent).toContain("This video format can't be played in this browser");
    expect(getByRole(view.host, "link", { name: "Download video" }).getAttribute("href")).toBe(
      "blob:video/mp4",
    );
    await click(getByRole(view.host, "button", { name: "Retry" }));
    const node = view.host.querySelector("video") as HTMLVideoElement;
    expect(node.src).toBe("blob:video/mp4");
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(revoke).not.toHaveBeenCalled();
    await act(() => node.dispatchEvent(new window.Event("loadedmetadata")));
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(view.host.querySelector("video")).toBe(node);
    await view.unmount();
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  "grid",
  "storage",
  "albums",
])("never downloads a thumbnail-less video's original in the %s tiles", async (surface) => {
  const { fetch } = await setup();
  const withoutThumbnail = { ...photo };
  delete withoutThumbnail.thumbnailUrl;
  state.usePhotos.mockReturnValue({
    ...state.usePhotos(),
    photos: [withoutThumbnail],
    albums: [{ name: "Clips", url: `${ROOT}photos/albums/clips.ttl`, members: [photo.ref] }],
  });
  const view = await mount(
    surface === "grid"
      ? h(PhotoGrid, {
          photos: [withoutThumbnail],
          from: "/photos",
          selecting: false,
          selected: new Set<string>(),
          onSelection: vi.fn(),
        })
      : surface === "storage"
        ? h(StorageScreen)
        : h(AlbumsScreen),
  );
  expect(view.host.querySelector(".pho-video-badge")).not.toBeNull();
  expect(view.host.querySelector(".pho-image-placeholder")).not.toBeNull();
  expect(view.host.querySelector("img, video")).toBeNull();
  expect(fetch.mock.calls.filter(([, init]) => !init?.method || init.method === "GET")).toEqual([]);
  if (surface !== "albums")
    expect(
      getByRole(view.host, "img", { name: `${photo.name}: preview unavailable` }),
    ).toBeTruthy();
});

function ImageProbe() {
  const image = usePhotoUrl(photo.contentUrl);
  return h("p", null, image.error ? "Rejected" : image.url ? "Loaded" : "Loading");
}
it("keeps image MIME validation for photos and video MIME validation for the player", async () => {
  await setup();
  const image = await mount(h(ImageProbe));
  expect(image.host.textContent).toBe("Rejected");
  await image.unmount();
  await setup("image/jpeg");
  const video = await mount(h(VideoPlayer, { photo }));
  expect(getByRole(video.host, "button", { name: "Retry" })).toBeTruthy();
  expect(video.host.querySelector("video")).toBeNull();
});
