// AUTHORED-BY Codex GPT-6
import type { PodSession } from "@/lib/session/pod-session";
import { createDocument, loadLibrary, musicRoot, provision } from "../lib/data/library";
import { setLiked } from "../lib/data/liked";
import { createPlaylist, editPlaylist } from "../lib/data/playlists";
import { Album, Artist, historyShard, PlaybackEvent, Store, Track } from "../lib/model";
import { S } from "../lib/model/vocab";

const pending = new WeakMap<typeof globalThis.fetch, Promise<void>>();
export function ensureSample(
  session: Pick<PodSession, "mode" | "fetch" | "storageUrl">,
  now = new Date(),
): Promise<void> {
  let task = pending.get(session.fetch);
  if (!task) {
    task = seed(session, now).catch((error: unknown) => {
      pending.delete(session.fetch);
      throw error;
    });
    pending.set(session.fetch, task);
  }
  return task;
}
async function seed(session: Pick<PodSession, "mode" | "fetch" | "storageUrl">, now: Date) {
  if (session.mode !== "demo") return;
  const { fetch, storageUrl } = session;
  const base = musicRoot(storageUrl);
  const exists = await fetch(base, { method: "HEAD" });
  if (exists.ok) return;
  if (exists.status !== 404) throw new Error("Could not open Music sample storage");
  await provision(fetch, storageUrl);
  const artists = [
    "Mira & the Tides",
    "The Paper Satellites",
    "Juniper Coast",
    "Sol Anara",
    "Lumen Quartet",
    "Echo Orchard",
  ];
  const albums = [
    "Soft Horizons",
    "Maps of the Evening",
    "Saltwater Letters",
    "A Room of Sun",
    "After the Rain",
    "Night Garden",
    "Small Hours",
    "Golden Thread",
  ];
  const titles = [
    "Morning Glass",
    "The Long Way Home",
    "Quiet Current",
    "Blue Hour",
    "Wildflower",
    "Paper Moon",
    "Lanterns",
    "Halfway to June",
    "Open Windows",
    "Still Water",
    "Low Tide",
    "Silver Lines",
    "Driftwood",
    "Woven Light",
    "Northbound",
    "A Little Further",
    "Sunroom",
    "Amber Sky",
    "First Light",
    "Warm Rain",
    "Falling Into Place",
    "The Green Room",
    "Cloud Study",
    "Unfolding",
    "Slow Sunday",
    "Night Bloom",
    "Old Photographs",
    "Between Stations",
    "Faraway Fields",
    "Daybreak",
    "Small Hours",
    "Sleepless City",
    "Passing Trains",
    "Winter Song",
    "Almost Home",
    "Golden Thread",
    "Cedar Road",
    "New Leaves",
    "Last Summer",
    "Everything in Time",
  ];
  const artistData = new Store();
  const albumData = new Store();
  const trackData = new Store();
  const artistIds = artists.map((name, i) => {
    const artist = new Artist(`${base}artists/catalog.ttl#artist-${i}`, artistData).stampType();
    artist.title = name;
    artist.imageUrl = `https://i.scdn.co/image/demo-artist-${i}`;
    return artist.value;
  });
  const albumIds = albums.map((name, i) => {
    const album = new Album(`${base}albums/catalog.ttl#album-${i}`, albumData).stampType();
    album.title = name;
    album.setArtist(artistIds[i % 6] as string);
    album.imageUrl = `https://i.scdn.co/image/demo-album-${i}`;
    return album.value;
  });
  const trackIds = titles.map((title, i) => {
    const track = new Track(`${base}tracks/catalog.ttl#track-${i}`, trackData).stampType();
    track.title = title;
    track.setArtist(artistIds[Math.floor(i / 5) % 6] as string);
    track.setAlbum(albumIds[Math.floor(i / 5)] as string);
    track.durationSeconds = 165 + ((i * 17) % 120);
    track.loved = i % 5 === 0;
    track.writeString(`${S}trackNumber`, String((i % 5) + 1));
    track.writeString(`${S}discNumber`, "1");
    track.writeString(`${S}dateCreated`, new Date(now.getTime() - i * 86400000).toISOString());
    if (i % 7 === 0) track.sourceUrl = `https://open.spotify.com/track/fictional${i}`;
    return track.value;
  });
  await createDocument(fetch, storageUrl, `${base}artists/catalog.ttl`, artistData);
  await createDocument(fetch, storageUrl, `${base}albums/catalog.ttl`, albumData);
  await createDocument(fetch, storageUrl, `${base}tracks/catalog.ttl`, trackData);
  const a = await createPlaylist(
    fetch,
    storageUrl,
    "slow-mornings",
    "Slow mornings",
    "A soft start, an open window, and nowhere to rush.",
  );
  await editPlaylist(fetch, storageUrl, a, { kind: "add", tracks: trackIds.slice(0, 6) });
  const b = await createPlaylist(
    fetch,
    storageUrl,
    "after-hours",
    "After hours",
    "For the last train and the quiet walk home.",
  );
  await editPlaylist(fetch, storageUrl, b, { kind: "add", tracks: trackIds.slice(25, 33) });
  const shards = new Map<string, Store>();
  for (let i = 0; i < 300; i++) {
    // Each wider window favours a different artist. Times are never in the future.
    const days = i < 12 ? 0 : i < 42 ? 1 + (i % 5) : i < 102 ? 8 + (i % 20) : 31 + ((i * 7) % 365);
    const artistIndex = i < 12 ? 0 : i < 42 ? 1 : i < 102 ? 2 : 3;
    const startTime =
      days === 0
        ? new Date(
            new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`).getTime() +
              Math.floor(
                ((now.getTime() -
                  new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`).getTime()) *
                  i) /
                  12,
              ),
          )
        : new Date(now.getTime() - days * 86400000 - (i % 60) * 60000);
    const url = historyShard(base, startTime);
    const dataset = shards.get(url) ?? new Store();
    shards.set(url, dataset);
    const play = new PlaybackEvent(`${url}#sample-${i}`, dataset).stampType();
    play.trackIri = trackIds[artistIndex * 5 + (i % 5)] as string;
    play.startTime = startTime;
    play.agent = i % 3 === 0 ? "https://open.spotify.com/" : "https://music.example.org/";
  }
  for (const [url, dataset] of shards) await createDocument(fetch, storageUrl, url, dataset);
  const library = await loadLibrary(fetch, storageUrl);
  await setLiked(fetch, storageUrl, library, trackIds[0] as string, true);
}
