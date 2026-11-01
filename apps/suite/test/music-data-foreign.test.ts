// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { computeTopArtists, mostPlayedTracks } from "../src/apps/music/lib/data/history";
import {
  createDocument,
  loadLibrary,
  musicRoot,
  provision,
  search,
  sortTracks,
} from "../src/apps/music/lib/data/library";
import { parseMusic } from "../src/apps/music/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://foreign.test/";
const url = `${musicRoot(root)}tracks/foreign.ttl`;

it("normalizes foreign metadata once, retaining every credit and both membership directions without rewriting RDF", async () => {
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  const dataset = await parseMusic(
    await readFile(new URL("./music/fixtures/foreign.ttl", import.meta.url), "utf8"),
    url,
  );
  await createDocument(pod.fetch, root, url, dataset);
  const before = pod.snapshot();
  const library = await loadLibrary(pod.fetch, root);
  expect(pod.snapshot()).toEqual(before);
  const id = (fragment: string) => `${url}#${fragment}`;
  const legacy = library.albums.find((album) => album.id === id("legacy"));
  expect(legacy).toMatchObject({ title: "A real album", artist: "The Junipers, Guest Artist" });
  expect(legacy?.tracks.map((track) => [track.title, track.trackNumber])).toEqual([
    ["A real title", 1],
    ["Apple", 2],
    ["A prelude", 3],
  ]);
  expect(library.tracks.find((track) => track.id === id("moon"))?.discNumber).toBeUndefined();
  expect(library.tracks.find((track) => track.id === id("moon"))?.albumId).toBe(id("schema"));
  const collaborative = library.tracks.find((track) => track.id === id("zebra"));
  expect(collaborative).toMatchObject({
    title: "A real title",
    artist: "The Junipers, Guest Artist",
    artistIds: [id("lead"), id("guest")],
    albumId: id("legacy"),
    albumTitle: "A real album",
  });
  expect(search(library, "guest real title").map((track) => track.id)).toEqual([id("zebra")]);
  expect(sortTracks(library.tracks, "title")).toHaveLength(8);
  expect(
    library.albums.find((album) => album.id === id("schema"))?.tracks.map((track) => track.id),
  ).toEqual([id("zebra"), id("schema-track"), id("moon")]);
  const guest = library.artists.find((artist) => artist.id === id("guest"));
  expect(guest?.tracks.map((track) => track.id)).toEqual([id("zebra"), id("schema-track")]);
  expect(guest?.albumIds).toEqual([id("legacy"), id("schema")]);
  expect(library.artists.find((artist) => artist.id === id("album-credit"))?.albumIds).toEqual([
    id("empty"),
    id("schema"),
  ]);
  expect(library.tracks.find((track) => track.id === id("literal"))).toMatchObject({
    artist: "Literal guest",
    albumTitle: "Literal album",
  });
  expect(library.artists.find((artist) => artist.name === "Literal guest")?.key).toBe(
    " Literal guest ",
  );
  expect(library.tracks.find((track) => track.id === id("anonymous"))).toMatchObject({
    title: "Untitled",
    artist: "Unknown artist",
    albumTitle: "Unknown album",
  });
  const now = new Date("2026-11-01T12:00:00Z");
  const history = [{ iri: "urn:play:1", trackIri: id("zebra"), startTime: now }];
  expect(
    computeTopArtists(history, library.models.tracks, "Today", now)
      .map((artist) => artist.key)
      .sort(),
  ).toEqual([id("guest"), id("lead")]);
  expect(
    mostPlayedTracks(library, history, "Today", now)
      .filter((entry) => entry.track.artistIds.includes(id("guest")))
      .map((entry) => entry.track.id),
  ).toEqual([id("zebra")]);
  // Raw wrappers remain suitable for field-scoped conditional writes and retain source text.
  expect(library.models.tracks.find((track) => track.value === id("zebra"))?.title).toBe(
    " A real title ",
  );
  expect(library.models.albums.find((album) => album.value === id("legacy"))?.title).toBe(
    " A real album ",
  );
  expect(library.models.artists.find((artist) => artist.value === id("guest"))?.title).toBe(
    " Guest Artist ",
  );
});
