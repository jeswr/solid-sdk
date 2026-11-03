// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import { collectionPhotos } from "../src/apps/photos/components/collections";
import { encodeRef } from "../src/lib/refs";

type Args = Parameters<typeof collectionPhotos>;
const photos = [
  { ref: "https://pod.example/p/1", name: "one" },
  { ref: "https://pod.example/p/2", name: "two" },
] as unknown as Args[0];
const album = "https://pod.example/albums/a";
const albums = [{ url: album, members: ["https://pod.example/p/2"] }] as unknown as Args[1];

it.each([
  "",
  "/",
])("resolves collections from native export paths with a trailing slash (%j)", (slash) => {
  expect(
    collectionPhotos(photos, albums, ["https://pod.example/p/1"], `/photos/favourites${slash}`),
  ).toEqual([photos[0]]);
  expect(collectionPhotos(photos, albums, [], `/photos/a/${encodeRef(album)}${slash}`)).toEqual([
    photos[1],
  ]);
});
