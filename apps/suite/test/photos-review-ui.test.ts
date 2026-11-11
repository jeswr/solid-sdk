// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import type { LibraryPhoto } from "../src/apps/photos/lib/data/library";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { click, h, key, mount } from "./drive-ui-dom";

const state = vi.hoisted(() => ({ usePhotos: vi.fn() }));
vi.mock("../src/apps/photos/state/photos-context", () => state);
vi.mock("../src/apps/photos/components/photos-app", () => ({ useRequestUpload: () => vi.fn() }));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  usePathname: () => "/photos/albums",
  useSearchParams: () => new URLSearchParams(),
}));
// Radix must load after the DOM harness installs browser globals.
const { AlbumsScreen, CollectionScreen } = await import(
  "../src/apps/photos/components/collections"
);
const { PhotoGrid } = await import("../src/apps/photos/components/photo-grid");
const { getByRole } = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
)("@testing-library/dom") as {
  getByRole(container: HTMLElement, role: string, options: { name: string }): HTMLElement;
};
const ROOT = "https://ui.demo.pod/";
const photo: LibraryPhoto = {
  url: `${ROOT}photos/items/one.ttl`,
  ref: `${ROOT}photos/items/one.ttl#it`,
  etag: '"one"',
  readOnly: false,
  name: "Garden",
  created: "2026-10-29T12:00:00Z",
  contentUrl: `${ROOT}photos/originals/one.png`,
  keywords: [],
  exif: {},
};
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const pod = createDemoPod({ root: ROOT });
  await pod.fetch(photo.contentUrl, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: new Uint8Array([1, 2, 3]),
  });
  state.usePhotos.mockReturnValue({
    status: "ready",
    photos: [photo],
    favourites: [],
    trash: [],
    warnings: 0,
    albumFailures: [],
    albums: [
      {
        name: "Weekend",
        url: `${ROOT}photos/albums/weekend.ttl`,
        coverUrl: photo.ref,
        members: [photo.ref, `${ROOT}photos/items/two.ttl#it`],
      },
    ],
    session: { storageUrl: ROOT, fetch: pod.fetch },
  });
}
it("keeps an album card's accessible name unchanged when its decorative cover loads", async () => {
  await setup();
  const view = await mount(h(AlbumsScreen));
  const card = getByRole(view.host, "link", { name: "Weekend 2 photos" });
  const image = card.querySelector("img");
  expect(image).not.toBeNull();
  expect(image?.getAttribute("alt")).toBe("");
  expect(image?.closest('[aria-hidden="true"]')).not.toBeNull();
});
it.each([0, 1])("shows album-specific failures with Retry when %s albums loaded", async (count) => {
  await setup();
  const snapshot = state.usePhotos();
  const refresh = vi.fn().mockResolvedValue(undefined);
  state.usePhotos.mockReturnValue({
    ...snapshot,
    albums: snapshot.albums.slice(0, count),
    albumFailures: [{ url: `${ROOT}photos/albums/broken.ttl`, error: new Error("Bad RDF") }],
    warnings: 1,
    refresh,
  });
  const view = await mount(h(AlbumsScreen));
  expect(view.host.textContent).toContain("1 album couldn't be read.");
  expect(view.host.textContent).not.toContain("A home for every story");
  expect(view.host.querySelectorAll(".pho-album-card")).toHaveLength(count);
  if (count === 0) expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
  await click(getByRole(view.host, "button", { name: "Retry" }));
  expect(refresh).toHaveBeenCalledOnce();
  state.usePhotos.mockReturnValue({ ...snapshot, refresh });
  await view.render(h(AlbumsScreen));
  expect(view.host.textContent).not.toContain("couldn't be read");
});
it("gives incomplete trash moves their own Resume action and excludes them from normal bulk actions", async () => {
  await setup();
  const snapshot = state.usePhotos();
  const resume = vi.fn().mockResolvedValue(true);
  const restore = vi.fn().mockResolvedValue(true);
  const recoveryUrl = `${ROOT}photos/.trash/recovery.ttl`;
  const trashedUrl = `${ROOT}photos/.trash/complete.ttl`;
  const recovery = {
    url: recoveryUrl,
    photo,
    etag: '"recovery"',
    record: { originalUrl: photo.url },
    status: "needs-recovery",
  };
  state.usePhotos.mockReturnValue({ ...snapshot, resume, restore, trash: [recovery] });
  const view = await mount(h(CollectionScreen, { kind: "trash", collectionPath: "/photos/trash" }));
  const card = view.host.querySelector(".pho-tile") as HTMLElement;
  expect(card.textContent).toContain("Needs recovery");
  expect(card.textContent).not.toContain("Restore");
  expect(card.textContent).not.toContain("Delete forever");
  expect(getByRole(view.host, "button", { name: "Empty trash" }).hasAttribute("disabled")).toBe(
    true,
  );
  await click(getByRole(card, "button", { name: "Resume" }));
  expect(resume).toHaveBeenLastCalledWith([recoveryUrl]);
  await click(getByRole(card, "checkbox", { name: "Select Garden" }));
  const selection = view.host.querySelector(".pho-selection") as HTMLElement;
  expect(selection.textContent).not.toContain("Restore");
  expect(selection.textContent).not.toContain("Delete forever");
  await click(getByRole(selection, "button", { name: "Resume" }));
  expect(resume).toHaveBeenLastCalledWith([recoveryUrl]);
  // A mixed selection can only restore fully moved photos.
  state.usePhotos.mockReturnValue({
    ...snapshot,
    resume,
    restore,
    trash: [recovery, { ...recovery, url: trashedUrl, status: "trashed" }],
  });
  await view.render(h(CollectionScreen, { kind: "trash", collectionPath: "/photos/trash" }));
  for (const item of view.host.querySelectorAll<HTMLElement>(".pho-tile"))
    await click(getByRole(item, "checkbox", { name: "Select Garden" }));
  await click(
    getByRole(view.host.querySelector(".pho-selection") as HTMLElement, "button", {
      name: "Restore",
    }),
  );
  expect(restore).toHaveBeenLastCalledWith([trashedUrl]);
});
it("selects trash records independently when two records describe the same original subject", async () => {
  await setup();
  const snapshot = state.usePhotos();
  const urls = [`${ROOT}photos/.trash/first.ttl`, `${ROOT}photos/.trash/second.ttl`];
  const restore = vi.fn().mockResolvedValue(true);
  const purge = vi.fn().mockResolvedValue(true);
  state.usePhotos.mockReturnValue({
    ...snapshot,
    restore,
    purge,
    trash: urls.map((url) => ({
      url,
      photo,
      etag: '"trash"',
      record: { originalUrl: photo.url },
    })),
  });
  const errors = vi.spyOn(console, "error");
  const view = await mount(h(CollectionScreen, { kind: "trash", collectionPath: "/photos/trash" }));
  const cards = view.host.querySelectorAll<HTMLElement>(".pho-tile");
  expect(cards).toHaveLength(2);
  expect(
    [...view.host.querySelectorAll("a[data-photo-ref]")].map((node) =>
      node.getAttribute("data-photo-ref"),
    ),
  ).toEqual(urls);
  const first = cards[0] as HTMLElement;
  const second = cards[1] as HTMLElement;
  await click(getByRole(first, "checkbox", { name: "Select Garden" }));
  expect(first.querySelector("input")?.checked).toBe(true);
  expect(second.querySelector("input")?.checked).toBe(false);
  expect(view.host.textContent).toContain("1 selected");
  await click(
    getByRole(view.host.querySelector(".pho-selection") as HTMLElement, "button", {
      name: "Restore",
    }),
  );
  expect(restore).toHaveBeenLastCalledWith([urls[0]]);
  await click(getByRole(second, "button", { name: "Restore" }));
  expect(restore).toHaveBeenLastCalledWith([urls[1]]);
  await key(first.querySelector("a") as HTMLAnchorElement, "Enter");
  expect(first.querySelector("input")?.checked).toBe(true);
  expect(second.querySelector("input")?.checked).toBe(false);
  await click(
    getByRole(view.host.querySelector(".pho-selection") as HTMLElement, "button", {
      name: "Delete forever",
    }),
  );
  await click(
    getByRole(document.querySelector('[role="dialog"]') as HTMLElement, "button", {
      name: "Delete forever",
    }),
  );
  expect(purge).toHaveBeenCalledWith([urls[0]]);
  expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/);
  expect(view.host.textContent).toContain(
    "Photos and videos in Trash stay in your pod until you delete them forever.",
  );
  expect(view.host.querySelector(".pho-eyebrow")).toBeNull();
});
it("shows Favourites without the memories eyebrow", async () => {
  await setup();
  const view = await mount(
    h(CollectionScreen, { kind: "favourites", collectionPath: "/photos/favourites" }),
  );
  expect(getByRole(view.host, "heading", { name: "Favourites" })).toBeDefined();
  expect(view.host.querySelector(".pho-eyebrow")).toBeNull();
});
it("uses the default browser locale for day headings and labels connector photos", async () => {
  await setup();
  const formatter = Intl.DateTimeFormat;
  const requested: Intl.LocalesArgument[] = [];
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function DateTimeFormat(locale, options) {
    requested.push(locale);
    return new formatter(locale ?? "en-GB", options);
  });
  const view = await mount(
    h(PhotoGrid, {
      photos: [{ ...photo, source: "google-photos", readOnly: true }],
      from: "/photos",
      selecting: false,
      selected: new Set<string>(),
      onSelection: vi.fn(),
    }),
  );
  expect(getByRole(view.host, "heading", { name: "Thursday, 29 October 2026" })).toBeDefined();
  expect(requested.every((locale) => locale === undefined)).toBe(true);
  expect(view.host.querySelector('[data-source="google-photos"]')?.textContent).toContain(
    "From Google Photos",
  );
});
