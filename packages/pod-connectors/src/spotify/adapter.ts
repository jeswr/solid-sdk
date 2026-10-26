// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { IntegrationSyncError } from "../core/errors.js";
import { arr, optionalDate, optionalNumber, optionalText, SkipCounter } from "../core/safe.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import { CLASSES, MusicPlaylist, MusicRecording } from "../core/vocab.js";
import { API, pages, spotifyJson } from "./api.js";
import { SPOTIFY_FIXTURES, type SpotifyPlaylist, type SpotifyTrack } from "./fixtures.js";
import { MEDIA, MediaThing, SCHEMA, TIME } from "./vocab.js";
import { vocabMap } from "./vocab-map.js";

export { createSpotifySourceAuth } from "./source-auth.js";

const SCOPES = [
  "user-top-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-follow-read",
  "user-read-recently-played",
] as const;
interface Artist {
  id: string;
  name?: string;
  external_urls?: { spotify?: string };
}
interface TrackItem {
  track?: SpotifyTrack | null;
  item?: SpotifyTrack | null;
  played_at?: string;
}

export const spotifyAdapter: IntegrationAdapter = {
  vocabMap,
  metadata: {
    id: "spotify",
    name: "Spotify",
    tier: "A",
    authKind: "oauth-pkce",
    scopes: SCOPES,
    categories: ["media"],
    whatYouGet:
      "Saved tracks, playlists and items, followed artists, top music and listening history.",
    requirements: [
      "Register a Spotify public PKCE client and redirect URI; inject its client id from the host.",
    ],
  },
  oauth: {
    clientId: undefined,
    authorizationEndpoint: "https://accounts.spotify.com/authorize",
    tokenEndpoint: "https://accounts.spotify.com/api/token",
    scopes: SCOPES,
    tokenExchange: "public",
  },
  fixtures: () => SPOTIFY_FIXTURES,
  async import(ctx: ImportContext): Promise<ImportOutcome> {
    const skipped = new SkipCounter();
    const checkpoint = parseCursor(ctx.cursor);
    const write = async (slug: string, dataset: Store, forClass: string, merge = false) => {
      await ctx.write({
        slug,
        dataset,
        category: "media",
        forClass,
        writeMode: merge ? "merge" : "replace",
      });
    };
    const track = (value: SpotifyTrack | null | undefined, slug: string, ds: Store) => {
      const id = optionalText(value?.id);
      if (
        !value ||
        !id ||
        (value.type && !["track", "episode"].includes(value.type)) ||
        value.is_local
      ) {
        skipped.skip();
        return undefined;
      }
      const kind = value.type === "episode" ? "episode" : "track";
      const iri = `${ctx.resolve(slug)}#${kind}-${encodeURIComponent(id)}`;
      const rec = new MusicRecording(iri, ds, DataFactory);
      if (kind === "episode") {
        rec.types.add(`${SCHEMA}PodcastEpisode`);
        rec.types.add(`${MEDIA}PodcastEpisode`);
      } else rec.mark();
      rec.name = optionalText(value.name);
      rec.identifier = id;
      rec.byArtist =
        arr(value.artists)
          .map((a) => optionalText(a?.name))
          .filter((name): name is string => name !== undefined)
          .join(", ") || undefined;
      rec.inAlbum = optionalText(value.album?.name);
      const ms = optionalNumber(value.duration_ms);
      rec.duration = ms !== undefined && ms >= 0 ? isoDuration(ms) : undefined;
      rec.sourceUrl =
        optionalText(value.external_urls?.spotify) ??
        `https://open.spotify.com/${kind}/${encodeURIComponent(id)}`;
      const media = new MediaThing(iri, ds, DataFactory);
      if (kind === "track") media.types.add(`${MEDIA}Track`);
      media.types.add(`${MEDIA}CreativeWork`);
      media.title = rec.name ?? id;
      return iri;
    };
    const tracks = async (slug: string, path: string, wrapped = false) => {
      const ds = new Store();
      for await (const page of pages<SpotifyTrack & TrackItem>(ctx, `${API}${path}`))
        for (const item of arr(page.items)) track(wrapped ? item?.track : item, slug, ds);
      await write(slug, ds, CLASSES.MusicRecording);
    };
    const artists = async (slug: string, path: string, followed = false) => {
      const ds = new Store();
      for await (const page of pages<Artist>(ctx, `${API}${path}`, (json) =>
        followed ? (json.artists ?? {}) : json,
      )) {
        for (const value of arr(page.items)) {
          const id = optionalText(value?.id);
          if (!value || !id) {
            skipped.skip();
            continue;
          }
          const artist = new MediaThing(
            `${ctx.resolve(slug)}#artist-${encodeURIComponent(id)}`,
            ds,
            DataFactory,
          );
          artist.types.add(`${MEDIA}Artist`);
          artist.types.add(`${SCHEMA}MusicGroup`);
          artist.name = optionalText(value.name);
          artist.artistName = artist.name;
          artist.identifier = id;
          artist.sourceUrl =
            optionalText(value.external_urls?.spotify) ??
            `https://open.spotify.com/artist/${encodeURIComponent(id)}`;
        }
      }
      await write(slug, ds, `${MEDIA}Artist`);
    };

    ctx.progress({ label: "Fetching saved tracks and top music…", done: 0, total: 4 });
    await tracks("music/saved-tracks.ttl", "/me/tracks?limit=50", true);
    for (const range of ["short_term", "medium_term", "long_term"]) {
      await tracks(
        range === "medium_term" ? "music/top-tracks.ttl" : `music/top-tracks-${range}.ttl`,
        `/me/top/tracks?limit=50&time_range=${range}`,
      );
      await artists(
        `music/top-artists-${range}.ttl`,
        `/me/top/artists?limit=50&time_range=${range}`,
      );
    }
    ctx.progress({ label: "Fetching followed artists…", done: 1, total: 4 });
    await artists("music/followed-artists.ttl", "/me/following?type=artist&limit=50", true);

    ctx.progress({ label: "Fetching playlists and items…", done: 2, total: 4 });
    const user = await spotifyJson<{ id?: string }>(ctx.api, `${API}/me`);
    const userId = optionalText(user?.id);
    const slug = "music/playlists.ttl";
    const ds = new Store();
    for await (const page of pages<SpotifyPlaylist>(ctx, `${API}/me/playlists?limit=50`)) {
      for (const value of arr(page.items)) {
        const id = optionalText(value?.id);
        if (!value || !id) {
          skipped.skip();
          continue;
        }
        const playlistIri = `${ctx.resolve(slug)}#playlist-${encodeURIComponent(id)}`;
        const playlist = new MusicPlaylist(playlistIri, ds, DataFactory).mark();
        playlist.name = optionalText(value.name);
        playlist.identifier = id;
        playlist.description = optionalText(value.description);
        playlist.numTracks = optionalNumber(value.items?.total ?? value.tracks?.total) ?? 0;
        playlist.sourceUrl =
          optionalText(value.external_urls?.spotify) ??
          `https://open.spotify.com/playlist/${encodeURIComponent(id)}`;
        const media = new MediaThing(playlistIri, ds, DataFactory);
        media.title = playlist.name;
        if (value.collaborative !== true && (!userId || optionalText(value.owner?.id) !== userId)) {
          skipped.skip();
          continue;
        }
        // Publish contents only after all pages succeed; access can be lost mid-pagination.
        const contents = new Store();
        const collection = new MediaThing(playlistIri, contents, DataFactory);
        // Keep repeated tracks and their order as named ListItems; snapshots remove deleted entries.
        let position = 0;
        try {
          for await (const items of pages<TrackItem>(
            ctx,
            `${API}/playlists/${encodeURIComponent(id)}/items?limit=50`,
          )) {
            for (const item of arr(items.items)) {
              position++;
              const work = track(item?.item ?? item?.track, slug, contents);
              if (!work) continue;
              const iri = `${ctx.resolve(slug)}#playlist-${encodeURIComponent(id)}-item-${position}`;
              const entry = new MediaThing(iri, contents, DataFactory);
              entry.types.add(`${SCHEMA}ListItem`);
              entry.item = work;
              entry.position = position;
              collection.entries.add(iri);
            }
          }
        } catch (error) {
          if (
            !(error instanceof IntegrationSyncError) ||
            (error.status !== 403 && error.status !== 404)
          )
            throw error;
          skipped.skip();
          continue;
        }
        ds.addQuads([...contents]);
      }
    }
    await write(slug, ds, CLASSES.MusicPlaylist);

    ctx.progress({ label: "Fetching recently played…", done: 3, total: 4 });
    const historySlug = "music/recently-played.ttl";
    const history = new Store();
    let newest = checkpoint?.direction === "after" ? checkpoint.time : undefined;
    const query = checkpoint ? `&${checkpoint.direction}=${checkpoint.time}` : "";
    for await (const page of pages<TrackItem>(
      ctx,
      `${API}/me/player/recently-played?limit=50${query}`,
    )) {
      for (const item of arr(page.items)) {
        const date = optionalDate(item?.played_at);
        if (!date) {
          skipped.skip();
          continue;
        }
        if (checkpoint?.direction === "after" && date.getTime() <= checkpoint.time) continue;
        const work = track(item?.track, historySlug, history);
        if (!work) continue;
        const id = `${encodeURIComponent(item?.track?.id ?? "")}-${date.getTime()}`;
        const event = new MediaThing(
          `${ctx.resolve(historySlug)}#play-${id}`,
          history,
          DataFactory,
        );
        event.types.add(`${MEDIA}PlaybackEvent`);
        event.types.add(`${SCHEMA}ListenAction`);
        event.identifier = id;
        event.sourceUrl = `https://open.spotify.com/${item?.track?.type === "episode" ? "episode" : "track"}/${encodeURIComponent(item?.track?.id ?? "")}`;
        event.playedWork = work;
        event.playedVia = "https://open.spotify.com/";
        const instantIri = `${ctx.resolve(historySlug)}#time-${date.getTime()}`;
        event.atTime = instantIri;
        const instant = new MediaThing(instantIri, history, DataFactory);
        instant.types.add(`${TIME}Instant`);
        instant.instant = date;
        newest = Math.max(newest ?? 0, date.getTime());
      }
    }
    await write(historySlug, history, `${MEDIA}PlaybackEvent`, true);
    ctx.progress({ label: "Done", done: 4, total: 4 });
    return {
      skipped: skipped.value,
      cursor: newest === undefined ? ctx.cursor : `after:${newest}`,
    };
  },
};

function parseCursor(
  cursor: string | undefined,
): { direction: "before" | "after"; time: number } | undefined {
  if (cursor === undefined) return undefined;
  const match = /^(before|after):(\d+)$/.exec(cursor);
  const time = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(time) || time < 0)
    throw new IntegrationSyncError("spotify", "Invalid Spotify recently-played cursor.");
  return { direction: match[1] as "before" | "after", time };
}

/** Spotify track length is metadata, never inferred as actual time listened. */
function isoDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `PT${h > 0 ? `${h}H` : ""}${m > 0 ? `${m}M` : ""}${seconds % 60}S`;
}
