// AUTHORED-BY Codex GPT-6
"use client";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorState,
  FilterChips,
} from "@jeswr/suite-ui";
import { ArrowRight, Disc3, FileUp, Heart, ListMusic, Music2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { decodeRef } from "@/lib/refs";
import { computeTopArtists, mostPlayedTracks, recentlyPlayed } from "../lib/data/history";
import { type MusicTrack, search } from "../lib/data/library";
import { SOLID_SUITE_AGENT } from "../lib/data/playback";
import type { MusicPlaylist } from "../lib/data/playlists";
import { SCROBBLE_AGENTS } from "../lib/data/scrobbles";
import { formatDuration } from "../lib/library";
import type { ArtistPeriod } from "../lib/model";
import { albumHref, artistHref, playlistHref } from "../lib/navigation";
import { useMusic } from "../state/music-context";
import { AddFromDrive, AddMusicFiles } from "./add-files";
import { Artwork } from "./artwork";
import { MusicSurface } from "./music-app";
import { PlayCollection } from "./player";
import { AddSongs, CreatePlaylist, EditPlaylistDetails } from "./playlist-dialogs";
import { Like, PlaylistTracks, TrackList, TrackName } from "./track-list";

export type MusicView =
  | "home"
  | "tracks"
  | "albums"
  | "artists"
  | "playlists"
  | "liked"
  | "history"
  | "album"
  | "artist"
  | "playlist"
  | "search";
const titles: Record<MusicView, string> = {
  home: "Your music",
  tracks: "Tracks",
  albums: "Albums",
  artists: "Artists",
  playlists: "Playlists",
  liked: "Liked songs",
  history: "History",
  album: "Album",
  artist: "Artist",
  playlist: "Playlist",
  search: "Search",
};
function Empty({ title, body }: { title: string; body: string }) {
  return (
    <EmptyState
      title={title}
      body={body}
      icon={<Music2 size={24} aria-hidden="true" />}
      primaryAction={
        <Button asChild>
          <Link href="/music/tracks">Explore tracks</Link>
        </Button>
      }
    />
  );
}
function AlbumCards({ ids }: { ids?: readonly string[] }) {
  const snapshot = useMusic().snapshot;
  const albums = snapshot?.library.albums.filter((album) => !ids || ids.includes(album.id)) ?? [];
  if (!albums.length)
    return (
      <Empty
        title="No albums yet"
        body="Albums appear here when songs are added to your library."
      />
    );
  return (
    <ul className="mus-card-grid" aria-label="Albums">
      {albums.map((album) => (
        <li key={album.id}>
          <Link className="mus-card" href={albumHref(album.id)}>
            <Artwork
              identity={album.id}
              name={album.title}
              image={
                snapshot?.library.models.albums.find((node) => node.value === album.id)?.imageUrl
              }
            />
            <strong>{album.title}</strong>
            <span className="mus-muted">{album.artist}</span>
            <span className="mus-card-meta">
              {album.tracks.length} songs · {formatDuration(album.durationSeconds)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
function Home() {
  const snapshot = useMusic().snapshot;
  const [period, setPeriod] = useState<ArtistPeriod>("1M");
  if (!snapshot) return null;
  const byId = new Map(snapshot.library.tracks.map((track) => [track.id, track]));
  const seenAlbums = new Set<string>();
  const recent = recentlyPlayed(snapshot.history, snapshot.history.length)
    .map((play) => byId.get(play.trackIri))
    .filter((track): track is MusicTrack => {
      if (!track || seenAlbums.has(track.albumId)) return false;
      seenAlbums.add(track.albumId);
      return true;
    })
    .slice(0, 10);
  const top = computeTopArtists(
    snapshot.history,
    snapshot.library.models.tracks,
    period,
    new Date(),
  ).slice(0, 5);
  const liked = snapshot.library.tracks.filter((track) => track.loved).slice(0, 5);
  return (
    <>
      <section className="mus-section" aria-labelledby="mus-recent-title">
        <div className="mus-section-head">
          <h2 id="mus-recent-title">Recently played</h2>
          <Link href="/music/history">
            View history <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        {recent.length ? (
          <ul className="mus-recent" aria-label="Recently played">
            {recent.map((track) => (
              <li key={track.id}>
                <Link className="mus-card" href={albumHref(track.albumId)}>
                  <Artwork
                    identity={track.albumId}
                    name={track.albumTitle}
                    image={
                      snapshot.library.models.albums.find((node) => node.value === track.albumId)
                        ?.imageUrl
                    }
                  />
                  <strong>{track.albumTitle}</strong>
                  <span>Last played: {track.title}</span>
                  <span>{track.artist}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            title="Your listening story starts here"
            body="Recently played songs will appear here as your history grows."
          />
        )}
      </section>
      <div className="mus-home-columns">
        <section className="mus-panel" aria-labelledby="mus-top-title">
          <div className="mus-section-head">
            <h2 id="mus-top-title">Your top artists</h2>
          </div>
          <FilterChips
            label="Listening period"
            options={["Today", "1W", "1M", "1Y"].map((id) => ({ id, label: id }))}
            value={[period]}
            onChange={(values) => setPeriod((values.at(-1) ?? "1M") as ArtistPeriod)}
            resultCount={top.length}
          />
          {top.length ? (
            <ol className="mus-ranking" aria-label="Your top artists">
              {top.map((artist, i) => {
                const group = snapshot.library.artists.find((group) => group.key === artist.key);
                const id = group?.id;
                const name = group?.name ?? artist.name;
                return (
                  <li key={artist.key}>
                    <span className="mus-rank mus-number">{i + 1}</span>
                    <Artwork
                      name={name}
                      image={
                        snapshot.library.models.artists.find((node) => node.value === artist.key)
                          ?.imageUrl
                      }
                    />
                    {id ? <Link href={artistHref(id)}>{name}</Link> : <span>{name}</span>}
                    <span className="mus-play-count mus-number">
                      {artist.plays}
                      <small>plays</small>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <Empty
              title="No plays in this period"
              body="Try a longer listening period to see your top artists."
            />
          )}
        </section>
        <section className="mus-panel" aria-labelledby="mus-liked-title">
          <div className="mus-section-head">
            <h2 id="mus-liked-title">
              <Heart size={19} aria-hidden="true" />
              Liked songs
            </h2>
            <Link href="/music/liked">See all</Link>
          </div>
          {liked.length ? (
            <ul className="mus-liked-preview">
              {liked.map((track) => (
                <li key={track.id}>
                  <TrackName track={track} />
                  <span className="mus-number mus-muted">
                    {formatDuration(track.durationSeconds)}
                  </span>
                  <Like track={track} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              title="Keep your favourites close"
              body="Tap the heart beside a song to save it here."
            />
          )}
        </section>
      </div>
    </>
  );
}
function DeletePlaylist({ playlist }: { playlist: MusicPlaylist }) {
  const music = useMusic();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Trash2 size={16} aria-hidden="true" />
          Delete playlist
        </Button>
      </DialogTrigger>
      <DialogContent className="mus-dialog">
        <DialogHeader>
          <DialogTitle>Delete {playlist.name}?</DialogTitle>
          <DialogDescription>
            The playlist will be removed from your pod. Your songs stay in your library.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await music.remove(playlist);
              setBusy(false);
              if (ok) {
                setOpen(false);
                router.push("/music/playlists");
              }
            }}
          >
            Delete playlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
const SOURCES: Record<string, string> = {
  [SOLID_SUITE_AGENT]: "Solid Suite",
  "https://open.spotify.com/": "Spotify",
  [SCROBBLE_AGENTS.lastfm]: "Last.fm",
  [SCROBBLE_AGENTS.listenbrainz]: "ListenBrainz",
};
const playSource = (agent: string | undefined) => (agent && SOURCES[agent]) || "Music";
const HISTORY_PAGE = 300;
function HistoryView() {
  const music = useMusic();
  const snapshot = music.snapshot;
  // Imported history can hold tens of thousands of plays; render them in pages.
  const [shown, setShown] = useState(HISTORY_PAGE);
  // "Show more" moves focus to the first newly shown play, since the button can disappear.
  const focusFrom = useRef<number | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusFrom.current === null) return;
    timeline.current
      ?.querySelector<HTMLElement>(`[data-play-index="${focusFrom.current}"]`)
      ?.focus();
    focusFrom.current = null;
  });
  if (!snapshot) return null;
  const groups = new Map<string, typeof snapshot.history>();
  const order = new Map<string, number>();
  for (const play of snapshot.history.slice(0, shown)) {
    order.set(play.iri, order.size);
    const key = play.startTime.toISOString().slice(0, 10);
    const group = groups.get(key) ?? [];
    group.push(play);
    groups.set(key, group);
  }
  const tracks = new Map(snapshot.library.tracks.map((track) => [track.id, track]));
  return (
    <>
      {groups.size ? (
        <div className="mus-timeline" ref={timeline}>
          {[...groups].map(([date, plays]) => (
            <section key={date}>
              <h2>
                {new Date(`${date}T12:00:00Z`).toLocaleDateString("en", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </h2>
              <ul>
                {plays.map((play) => {
                  const track = tracks.get(play.trackIri);
                  return (
                    <li key={play.iri} data-play-index={order.get(play.iri)} tabIndex={-1}>
                      <time className="mus-number" dateTime={play.startTime.toISOString()}>
                        {play.startTime.toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })}
                      </time>
                      {track ? (
                        <TrackName track={track} />
                      ) : play.title ? (
                        <span className="mus-track-name">
                          <strong>{play.title}</strong>
                          {play.artist && <span className="mus-muted">{play.artist}</span>}
                        </span>
                      ) : (
                        <span>Unavailable song</span>
                      )}
                      <Badge variant="secondary">{playSource(play.agent)}</Badge>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <Empty
          title="No listening history yet"
          body="Your listening history will appear here, grouped by day. You can also import it from Last.fm or ListenBrainz."
        />
      )}
      {snapshot.history.length > shown && (
        <div className="mus-load-older">
          <Button
            variant="outline"
            onClick={() => {
              focusFrom.current = shown;
              setShown((value) => value + HISTORY_PAGE);
            }}
          >
            Show more plays
          </Button>
          <p className="mus-muted">
            Showing {shown.toLocaleString("en")} of {snapshot.history.length.toLocaleString("en")}{" "}
            plays
          </p>
        </div>
      )}
      {music.olderError && <ErrorState error="unreachable" actions={{ retry: music.older }} />}
      <div className="mus-load-older">
        <Button
          variant="outline"
          disabled={music.olderLoading}
          onClick={() => {
            void music.older();
          }}
        >
          {music.olderLoading ? "Loading older history…" : "Load older history"}
        </Button>
        <p className="mus-muted">Times shown in UTC</p>
      </div>
    </>
  );
}
function Content({ view, id, query }: { view: MusicView; id?: string | undefined; query: string }) {
  const addSongs = useRef<HTMLButtonElement>(null);
  const music = useMusic();
  const snapshot = music.snapshot;
  const [importing, setImporting] = useState(false);
  const [yourFiles, setYourFiles] = useState(false);
  if (!snapshot) return null;
  const { library } = snapshot;
  if (view === "home") return <Home />;
  if (view === "tracks")
    return (
      <>
        <div className="mus-library-note">
          <span>
            <Music2 size={18} aria-hidden="true" />A collection that stays with you.
          </span>
          <Button
            variant="outline"
            disabled={importing || music.saving}
            onClick={async () => {
              setImporting(true);
              await music.importFixture();
              setImporting(false);
            }}
          >
            {importing ? "Importing…" : "Import Spotify sample"}
          </Button>
        </div>
        <div className="mus-file-actions">
          <AddMusicFiles />
          <AddFromDrive />
        </div>
        <FilterChips
          resultCount={
            yourFiles
              ? library.tracks.filter((track) => track.contentUrl).length
              : library.tracks.length
          }
          label="Library files"
          options={[
            { id: "all", label: "All tracks" },
            { id: "files", label: "Your files" },
          ]}
          value={[yourFiles ? "files" : "all"]}
          onChange={(values) => setYourFiles(values.at(-1) === "files")}
        />
        <PlayCollection
          tracks={yourFiles ? library.tracks.filter((track) => track.contentUrl) : library.tracks}
        />
        <TrackList
          tracks={yourFiles ? library.tracks.filter((track) => track.contentUrl) : library.tracks}
        />
      </>
    );
  if (view === "liked")
    return (
      <>
        <PlayCollection tracks={library.tracks.filter((track) => track.loved)} />
        <TrackList tracks={library.tracks.filter((track) => track.loved)} label="Liked songs" />
      </>
    );
  if (view === "search") {
    const results = search(library, query);
    return (
      <>
        <p className="mus-muted" role="status">
          {results.length} {results.length === 1 ? "song" : "songs"} found for “{query}”
        </p>
        {results.length ? (
          <TrackList tracks={results} label="Search results" />
        ) : (
          <EmptyState
            variant="no-results"
            query={query}
            primaryAction={
              <Button asChild>
                <Link href="/music/tracks">Browse all tracks</Link>
              </Button>
            }
          />
        )}
      </>
    );
  }
  if (view === "albums") return <AlbumCards />;
  if (view === "artists")
    return library.artists.length ? (
      <ul className="mus-card-grid mus-artist-grid" aria-label="Artists">
        {library.artists.map((artist) => (
          <li key={artist.id}>
            <Link className="mus-card" href={artistHref(artist.id)}>
              <Artwork
                identity={artist.id}
                name={artist.name}
                image={library.models.artists.find((node) => node.value === artist.id)?.imageUrl}
              />
              <strong>{artist.name}</strong>
              <span className="mus-muted">
                {artist.albumIds.length} albums · {artist.tracks.length} songs
              </span>
            </Link>
          </li>
        ))}
      </ul>
    ) : (
      <Empty title="No artists yet" body="Your artists appear as you build your library." />
    );
  if (view === "playlists")
    return snapshot.playlists.length ? (
      <ul className="mus-card-grid" aria-label="Playlists">
        {snapshot.playlists.map((playlist) => (
          <li key={playlist.id}>
            <Link href={playlistHref(playlist.id)} className="mus-card">
              <span className="mus-playlist-cover">
                <ListMusic size={44} strokeWidth={1.25} aria-hidden="true" />
              </span>
              <strong>{playlist.name}</strong>
              <span className="mus-muted">{playlist.tracks.length} songs</span>
              <span className="mus-card-meta">{playlist.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    ) : (
      <EmptyState
        title="Make room for a new mood"
        body="Bring songs together in your own playlists."
        primaryAction={<CreatePlaylist />}
      />
    );
  if (view === "history") return <HistoryView />;
  if (view === "album") {
    const album = library.albums.find((a) => a.id === id);
    if (album)
      return (
        <>
          <div className="mus-detail-header">
            <Artwork
              identity={album.id}
              name={album.title}
              image={library.models.albums.find((node) => node.value === id)?.imageUrl}
            />
            <div>
              <p className="mus-eyebrow">Album</p>
              <p className="mus-detail-credit">{album.artist}</p>
              <p className="mus-muted">
                {album.tracks.length} songs · {formatDuration(album.durationSeconds)}
              </p>
            </div>
          </div>
          <PlayCollection tracks={album.tracks as MusicTrack[]} />
          <TrackList
            tracks={album.tracks as MusicTrack[]}
            sortable={false}
            label={`${album.title} songs`}
          />
        </>
      );
  }
  if (view === "artist") {
    const artist = library.artists.find((a) => a.id === id);
    if (artist) {
      const top = mostPlayedTracks(library, snapshot.history, "1Y", new Date())
        .filter((entry) => entry.track.artistIds.includes(artist.id))
        .slice(0, 5);
      return (
        <>
          <div className="mus-detail-header">
            <Artwork
              name={artist.name}
              image={library.models.artists.find((node) => node.value === id)?.imageUrl}
            />
            <div>
              <p className="mus-eyebrow">Artist</p>
              <p className="mus-detail-credit">{artist.albumIds.length} albums</p>
              <p className="mus-muted">{artist.tracks.length} songs in your library</p>
            </div>
          </div>
          <PlayCollection tracks={artist.tracks} />
          <section className="mus-section">
            <h2>Albums</h2>
            <AlbumCards ids={artist.albumIds} />
          </section>
          <section className="mus-section">
            <h2>Top tracks this year</h2>
            {top.length ? (
              <TrackList tracks={top.map((entry) => entry.track)} sortable={false} />
            ) : (
              <Empty
                title="No plays this year"
                body="Your most played tracks by this artist will appear here."
              />
            )}
          </section>
        </>
      );
    }
  }
  if (view === "playlist") {
    const playlist = snapshot.playlists.find((p) => p.id === id);
    if (playlist)
      return (
        <>
          <div className="mus-detail-header">
            <span className="mus-playlist-cover">
              <ListMusic size={48} strokeWidth={1.25} aria-hidden="true" />
            </span>
            <div className="mus-playlist-fields">
              {playlist.description && <p>{playlist.description}</p>}
              <p className="mus-muted">{playlist.tracks.length} songs · Saved to your pod</p>
            </div>
          </div>
          <div className="mus-playlist-toolbar">
            <AddSongs playlist={playlist} triggerRef={addSongs} />
            <EditPlaylistDetails playlist={playlist} />
            <DeletePlaylist playlist={playlist} />
          </div>
          <PlayCollection
            total={playlist.tracks.length}
            tracks={playlist.tracks.flatMap((id) => {
              const track = library.tracks.find((t) => t.id === id);
              return track ? [track] : [];
            })}
          />
          <PlaylistTracks playlist={playlist} emptyFocus={addSongs} />
          {!playlist.tracks.length && (
            <EmptyState
              title="Find your playlist’s first song"
              body="Choose songs from your library to start this collection."
              primaryAction={<AddSongs playlist={playlist} />}
            />
          )}
        </>
      );
  }
  return (
    <EmptyState
      title="This item is unavailable"
      body="It may have moved or been removed from your library."
      primaryAction={
        <Button asChild>
          <Link href="/music/tracks">Browse tracks</Link>
        </Button>
      }
      secondaryAction={
        <Button
          variant="outline"
          onClick={() => {
            void music.refresh();
          }}
        >
          Retry
        </Button>
      }
    />
  );
}
export function MusicScreen({
  view,
  reference,
  query = "",
}: {
  view: MusicView;
  reference?: string;
  query?: string;
}) {
  const music = useMusic();
  let id: string | undefined;
  try {
    if (reference) id = decodeRef(reference);
  } catch {
    /* Render an unavailable item without following the reference. */
  }
  const snapshot = music.snapshot;
  const title =
    view === "album"
      ? snapshot?.library.albums.find((album) => album.id === id)?.title
      : view === "artist"
        ? snapshot?.library.artists.find((artist) => artist.id === id)?.name
        : view === "playlist"
          ? snapshot?.playlists.find((playlist) => playlist.id === id)?.name
          : undefined;
  return (
    <>
      <header className="mus-page-header">
        <div>
          <p className="mus-eyebrow">
            {view === "home" ? "A little closer to what you love" : "Your library"}
          </p>
          <h1>{title ?? titles[view]}</h1>
          {view === "home" && <p className="mus-muted">Good music. All yours.</p>}
        </div>
        {view === "playlists" && <CreatePlaylist />}
        {view === "history" && (
          <Button asChild variant="outline">
            <Link href="/music/import">
              <FileUp size={16} aria-hidden="true" />
              Import history
            </Link>
          </Button>
        )}
        {view === "liked" && (
          <span className="mus-header-icon">
            <Heart size={28} aria-hidden="true" />
          </span>
        )}
        {view === "albums" && <Disc3 className="mus-header-icon" size={28} aria-hidden="true" />}
      </header>
      <MusicSurface>
        <Content view={view} id={id} query={query} />
      </MusicSurface>
    </>
  );
}
