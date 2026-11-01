// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { ensureSample } from "../src/apps/music/demo/sample";
import { importSpotifyFixture } from "../src/apps/music/demo/spotify";
import { computeTopArtists, loadHistory } from "../src/apps/music/lib/data/history";
import { loadLibrary, search } from "../src/apps/music/lib/data/library";
import { listPlaylists } from "../src/apps/music/lib/data/playlists";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://sample.test/alice/";
const now = new Date("2026-11-01T12:00:00Z");
it("seeds a realistic idempotent sample with different period leaders", async () => {
  const pod = createDemoPod({ root });
  const session = { mode: "demo" as const, fetch: pod.fetch, storageUrl: root };
  await Promise.all([ensureSample(session, now), ensureSample(session, now)]);
  const library = await loadLibrary(pod.fetch, root);
  expect(library.tracks).toHaveLength(40);
  expect(library.albums).toHaveLength(8);
  expect(library.artists).toHaveLength(6);
  expect(library.tracks.filter((track) => track.loved)).toHaveLength(8);
  expect(listPlaylists(library)).toHaveLength(2);
  const history = await loadHistory(pod.fetch, root, now, 14);
  expect(history).toHaveLength(300);
  const leaders = ["Today", "1W", "1M", "1Y"].map(
    (period) => computeTopArtists(history, library.models.tracks, period as "Today", now)[0]?.name,
  );
  expect(new Set(leaders).size).toBe(4);
  const before = pod.snapshot();
  await ensureSample(session, now);
  expect(pod.snapshot()).toEqual(before);
  // A new browser facade also recognizes an existing Music library.
  await ensureSample({ ...session, fetch: (input, init) => pod.fetch(input, init) }, now);
  expect(pod.snapshot()).toEqual(before);
});
it("does not seed after storage errors, and can retry", async () => {
  const pod = createDemoPod({ root });
  let fail = true;
  const session = {
    mode: "demo" as const,
    storageUrl: root,
    fetch: ((input, init) =>
      fail
        ? Promise.resolve(new Response(null, { status: 500 }))
        : pod.fetch(input, init)) as typeof fetch,
  };
  await expect(ensureSample(session, now)).rejects.toThrow();
  fail = false;
  await ensureSample(session, now);
  expect((await loadLibrary(pod.fetch, root)).tracks).toHaveLength(40);
});
it("runs the real Spotify mapping entirely against recorded JSON and the pod", async () => {
  const pod = createDemoPod({ root });
  await importSpotifyFixture(pod.fetch, root);
  const library = await loadLibrary(pod.fetch, root);
  expect(search(library, "Blinding Lights").length).toBeGreaterThan(0);
  expect(search(library, "Rick Astley").length).toBeGreaterThan(0);
  expect(library.models.playlists.some((p) => p.title === "Focus Flow")).toBe(true);
  expect(library.tracks.find((t) => t.title === "Blinding Lights")?.sourceUrl).toContain(
    "open.spotify.com",
  );
  expect(await loadHistory(pod.fetch, root, now)).toHaveLength(1);
  expect(await loadHistory(pod.fetch, root, now, 1)).toEqual([]);
  const before = pod.snapshot();
  await importSpotifyFixture(pod.fetch, root);
  expect(pod.snapshot()).toEqual(before);
});
