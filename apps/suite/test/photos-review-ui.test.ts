// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { AlbumsScreen } from "../src/apps/photos/components/collections";
import { PhotoGrid } from "../src/apps/photos/components/photo-grid";
import type { LibraryPhoto } from "../src/apps/photos/lib/data/library";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { h, mount } from "./drive-ui-dom";

const state = vi.hoisted(() => ({ usePhotos: vi.fn() }));
vi.mock("../src/apps/photos/state/photos-context", () => state);
vi.mock("../src/apps/photos/components/photos-app", () => ({ useRequestUpload: () => vi.fn() }));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  usePathname: () => "/photos/albums",
  useSearchParams: () => new URLSearchParams(),
}));
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
