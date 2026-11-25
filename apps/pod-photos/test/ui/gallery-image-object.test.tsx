// AUTHORED-BY Claude Sonnet 5.5
// @vitest-environment jsdom
//
// listGallery and <PhotoGallery> over a creative-assets / pod-media-store library:
// `<yyyy>/<mm>/` shard containers aggregated by containment, ImageObject documents
// shown once, a thumbnail kept in its own document dropped, bounded descent, and a
// failed image load degrading to a placeholder.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { listGallery, SHARD_MAX_CONTAINERS } from "../../src/ui/index.js";
import { PhotoGallery } from "../../src/ui/PhotoGallery.js";
import { containerTurtle, MockPod } from "../helpers/mock-pod.js";

const LIB = "https://pod.example/creative/";
const imageDoc = (url: string, name: string, extra = "") => `
@prefix schema: <https://schema.org/> .
<${url}#it> a schema:ImageObject ;
  schema:name "${name}" ;
  schema:contentUrl <${url}.png> ${extra}.
<${url}#thumbnail> a schema:ImageObject ; schema:contentUrl <${url}-t.webp> .
`;

function library(): MockPod {
  const pod = new MockPod();
  const y = `${LIB}2026/`;
  const m6 = `${y}06/`;
  const m7 = `${y}07/`;
  pod.seed(LIB, containerTurtle(LIB, [y, `${LIB}stray.txt`]));
  pod.seed(y, containerTurtle(y, [m6, m7]));
  pod.seed(m6, containerTurtle(m6, [`${m6}aaa`, `${m6}aaa.png`]));
  pod.seed(m7, containerTurtle(m7, [`${m7}bbb`, `${m7}bbb-thumb`]));
  pod.seed(`${m6}aaa`, imageDoc(`${m6}aaa`, "First"));
  pod.seed(`${m7}bbb`, imageDoc(`${m7}bbb`, "Second", `; schema:thumbnail <${m7}bbb-thumb#it> `));
  pod.seed(`${m7}bbb-thumb`, imageDoc(`${m7}bbb-thumb`, "Second thumb"));
  pod.seed(`${m6}aaa.png`, "binary", "image/png");
  return pod;
}

describe("listGallery with aggregateShards", () => {
  it("lists photos from <yyyy>/<mm>/ shards by containment, once each, thumbnails dropped", async () => {
    const pod = library();
    const listing = await listGallery(LIB, { fetch: pod.fetch, aggregateShards: true });
    expect(listing.photos.map((p) => p.photo.name)).toEqual(["First", "Second"]);
    expect(listing.folders).toEqual([]);
  });

  it("shows shard containers as plain folders without aggregation", async () => {
    const listing = await listGallery(LIB, { fetch: library().fetch });
    expect(listing.folders.map((f) => f.url)).toEqual([`${LIB}2026/`]);
    expect(listing.photos).toEqual([]);
  });

  it("keeps non-shard sub-folders and ignores an unreadable shard", async () => {
    const pod = new MockPod();
    const y = `${LIB}2026/`;
    pod.seed(LIB, containerTurtle(LIB, [y, `${LIB}albums/`]));
    // The year container is missing (404): skipped, not thrown.
    const listing = await listGallery(LIB, { fetch: pod.fetch, aggregateShards: true });
    expect(listing.folders.map((f) => f.url)).toEqual([`${LIB}albums/`]);
    expect(listing.photos).toEqual([]);
  });

  it("does not descend below two levels and never follows a listing outside the container", async () => {
    const pod = new MockPod();
    const y = `${LIB}2026/`;
    const m = `${y}06/`;
    const deep = `${m}01/`;
    pod.seed(LIB, containerTurtle(LIB, [y, "https://other.example/2027/"]));
    pod.seed(y, containerTurtle(y, [m]));
    pod.seed(m, containerTurtle(m, [deep]));
    pod.seed(deep, containerTurtle(deep, [`${deep}x`]));
    pod.seed(`${deep}x`, imageDoc(`${deep}x`, "Too deep"));
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requested.push(String(input));
      return pod.fetch(input, init);
    }) as typeof fetch;
    const listing = await listGallery(LIB, { fetch: fetchImpl, aggregateShards: true });
    expect(listing.photos).toEqual([]);
    expect(requested).not.toContain(deep);
    expect(requested.some((u) => u.startsWith("https://other.example"))).toBe(false);
  });

  it("bounds the number of shard containers read", async () => {
    const pod = new MockPod();
    const years = Array.from({ length: SHARD_MAX_CONTAINERS + 5 }, (_, i) => {
      return `${LIB}${String(1900 + i)}/`;
    });
    pod.seed(LIB, containerTurtle(LIB, years));
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requested.push(String(input));
      return pod.fetch(input, init);
    }) as typeof fetch;
    await listGallery(LIB, { fetch: fetchImpl, aggregateShards: true });
    expect(requested.filter((u) => u !== LIB)).toHaveLength(SHARD_MAX_CONTAINERS);
  });

  it("rethrows a cancellation raised while reading a shard", async () => {
    const pod = library();
    const controller = new AbortController();
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === `${LIB}2026/`) controller.abort();
      return pod.fetch(input, init);
    }) as typeof fetch;
    await expect(
      listGallery(LIB, { fetch: fetchImpl, aggregateShards: true, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("<PhotoGallery aggregateShards>", () => {
  it("shows the library photos and a placeholder when an image fails to load", async () => {
    render(<PhotoGallery rootUrl={LIB} fetch={library().fetch} aggregateShards />);
    const img = await screen.findByRole("img", { name: "First" });
    expect(img).toHaveAttribute("src", `${LIB}2026/06/aaa.png`);
    // The browser could not load the (private) binary: the tile degrades, no broken image.
    fireEvent.error(img);
    const placeholder = screen.getByRole("img", { name: "First" });
    expect(placeholder.tagName).toBe("DIV");
    expect(placeholder).toHaveClass("pod-photos-thumb-missing");
    expect(screen.getByRole("img", { name: "Second" }).tagName).toBe("IMG");
  });
});
