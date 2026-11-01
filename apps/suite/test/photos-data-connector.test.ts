// AUTHORED-BY Codex GPT-6
import { googlePhotosAdapter } from "@jeswr/pod-connectors/adapters/google-photos";
import { demoImport, TEST_POD_ROOT } from "@jeswr/pod-connectors/testing";
import { describe, expect, it } from "vitest";
import { listLibrary, saveKeywords } from "../src/apps/photos/lib/data/library";
import { photoDataStorage } from "../src/apps/photos/lib/data/storage";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = TEST_POD_ROOT;
const SOURCE = `${ROOT}integrations/google-photos/media/`;
const DOCUMENT = `${SOURCE}photos.ttl`;
async function setup() {
  // Run the real connector with its recorded API fixtures, then serve its exact
  // document from the suite's demo pod rather than hand-authoring ImageObjects.
  const imported = await demoImport(googlePhotosAdapter);
  expect(imported.report.written.map((item) => item.url)).toEqual([DOCUMENT]);
  const document = imported.pod.get(DOCUMENT);
  if (!document) throw new Error("Missing connector document");
  const pod = createDemoPod({ root: ROOT });
  await pod.fetch(DOCUMENT, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: document,
  });
  const requests: { url: string; method: string; redirect: RequestRedirect | undefined }[] = [];
  let intercept: ((url: string) => Response | undefined) | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET", redirect: init?.redirect });
    return intercept?.(url) ?? pod.fetch(input, init);
  };
  return {
    pod,
    requests,
    io: photoDataStorage(fetch, ROOT),
    intercept: (value: typeof intercept) => {
      intercept = value;
    },
  };
}
describe("Google Photos read-only source", () => {
  it("merges the connector's actual media/photos.ttl into the library without fetching hosted assets", async () => {
    const s = await setup();
    await s.io.ensureContainers(["", "items/"]);
    const nativeUrl = `${s.io.root}items/native.ttl`;
    await s.io.savePhoto(
      nativeUrl,
      {
        name: "Native photo",
        contentUrl: `${s.io.root}originals/native.png`,
        created: "2026-11-01T12:00:00Z",
        keywords: [],
        exif: {},
      },
      { create: true },
    );
    s.requests.length = 0;
    const library = await listLibrary(s.io);
    expect(library.failures).toEqual([]);
    expect(library.items.map((photo) => photo.name)).toEqual([
      "Native photo",
      "IMG_4822.heic",
      "IMG_4821.jpg",
    ]);
    expect(library.groups.map((group) => group.key)).toEqual([
      "2026-11-01",
      "2026-05-21",
      "2026-05-20",
    ]);
    const imported = library.items.filter((photo) => photo.source === "google-photos");
    expect(imported).toHaveLength(2);
    for (const photo of imported) {
      expect(photo).toMatchObject({ url: DOCUMENT, readOnly: true });
      await expect(saveKeywords(s.io, photo, ["unchanged"])).rejects.toThrow("read-only");
    }
    expect(imported[1]?.exif).toMatchObject({ pixelWidth: 4032, pixelHeight: 3024 });
    expect(
      s.requests.every(
        (request) =>
          request.url.startsWith(ROOT) && request.method === "GET" && request.redirect === "manual",
      ),
    ).toBe(true);
    await expect(s.io.loadPhotos(DOCUMENT)).rejects.toThrow();
  });
  it("skips an absent source and reports unreadable containers and individual documents", async () => {
    const s = await setup();
    await s.pod.fetch(`${SOURCE}broken.ttl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "invalid RDF",
    });
    const partial = await listLibrary(s.io);
    expect(partial.items).toHaveLength(2);
    expect(partial.failures.map((failure) => failure.url)).toEqual([`${SOURCE}broken.ttl`]);
    s.intercept((url) => (url === SOURCE ? new Response(null, { status: 403 }) : undefined));
    expect((await listLibrary(s.io)).failures).toMatchObject([
      { url: SOURCE, error: { status: 403 } },
    ]);
    const missing = createDemoPod({ root: ROOT });
    expect(await listLibrary(photoDataStorage(missing.fetch, ROOT))).toEqual({
      items: [],
      failures: [],
      groups: [],
    });
  });
  it.each([
    SOURCE,
    DOCUMENT,
  ])("refuses every redirect from %s, including redirects inside the pod", async (target) => {
    for (const location of [`${SOURCE}elsewhere.ttl`, "https://outside.example/photos.ttl"]) {
      const s = await setup();
      s.intercept((url) =>
        url === target ? new Response(null, { status: 302, headers: { location } }) : undefined,
      );
      const result = await listLibrary(s.io);
      expect(result.items).toEqual([]);
      expect(result.failures.map((failure) => failure.url)).toEqual([target]);
      expect(s.requests.some((request) => request.url === location)).toBe(false);
    }
  });
});
