// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createPodScopedFetch,
  normalizePodBase,
  podScopedUrl,
} from "@jeswr/guarded-fetch";
import type { BlankNode, Term } from "@rdfjs/types";
import { Container } from "@solid/object";
import { Artist, Track } from "./entities";
import { historyShard, type Playback, PlaybackEvent, readHistory } from "./history";
import { type MusicLibrary, readLibrary } from "./library";
import { DataFactory, Store, serializeMusic } from "./rdf";
import { httpIri, InvalidMusicError } from "./validation";

export interface MusicDocument {
  dataset: Store;
  etag: string | null;
  url: string;
}

/** Caller provides the fetch appropriate for this resource; errors retain RdfFetchError. */
export async function loadMusic(
  fetch: typeof globalThis.fetch,
  url: string,
): Promise<MusicDocument> {
  const result = await fetchRdf(httpIri(url), { fetch });
  // Blank-node labels are local to a document, including JSON-LD labels that a
  // parser may retain verbatim. Allocate fresh terms before datasets are merged.
  const blanks = new Map<string, BlankNode>();
  const scope = <T extends Term>(term: T): T | BlankNode => {
    if (term.termType !== "BlankNode") return term;
    let scoped = blanks.get(term.value);
    if (!scoped) {
      scoped = DataFactory.blankNode();
      blanks.set(term.value, scoped);
    }
    return scoped;
  };
  const dataset = new Store(
    [...result.dataset].map((quad) =>
      DataFactory.quad(scope(quad.subject), quad.predicate, scope(quad.object), scope(quad.graph)),
    ),
  );
  return { dataset, etag: result.etag, url: result.url };
}

/** One listing level, as in pod-music; multi-subject Spotify documents are supported. */
export async function loadLibrary(
  fetch: typeof globalThis.fetch,
  container: string,
): Promise<MusicLibrary> {
  const root = normalizePodBase(container);
  const scoped = createPodScopedFetch(root, { fetch });
  const listing = await loadMusic(scoped, root);
  const model = new Container(root, listing.dataset, DataFactory);
  const dataset = new Store(listing.dataset);
  for (const entry of model.contains) {
    if (entry.termType !== "NamedNode") continue;
    const child = podScopedUrl(root, entry.value, { allowRoot: false });
    if (!child || new URL(child).pathname.endsWith("/")) continue;
    const resource = await loadMusic(scoped, child);
    dataset.addQuads([...resource.dataset]);
  }
  return readLibrary(dataset);
}

export type WriteCondition = { ifMatch: string } | { ifNoneMatch: "*" };

/** HTTP write errors expose status and the server ETag for the later conflict adapter. */
export class MusicWriteError extends Error {
  override name = "MusicWriteError";
  constructor(
    readonly status: number,
    readonly etag: string | null,
  ) {
    super(`Music write failed (${status})`);
  }
}

export async function saveMusic(
  fetch: typeof globalThis.fetch,
  musicBase: string,
  url: string,
  dataset: Store,
  condition: WriteCondition,
): Promise<string | null> {
  const target = assertWithinPodScope(musicBase, httpIri(url), { allowRoot: false });
  // A runtime guard is needed for JS callers as well as the discriminated TS type.
  const headers = new Headers({ "Content-Type": "text/turtle" });
  if ("ifMatch" in condition && condition.ifMatch) headers.set("If-Match", condition.ifMatch);
  else if ("ifNoneMatch" in condition && condition.ifNoneMatch === "*")
    headers.set("If-None-Match", "*");
  else throw new InvalidMusicError("A write precondition is required");
  const response = await createPodScopedFetch(musicBase, { fetch, maxRedirects: 0 })(target, {
    method: "PUT",
    headers,
    body: await serializeMusic(dataset),
  });
  if (!response.ok) throw new MusicWriteError(response.status, response.headers.get("etag"));
  return response.headers.get("etag");
}

/** Explicit month selection keeps the hook in charge of cache warming and period selection. */
export async function loadHistory(
  fetch: typeof globalThis.fetch,
  musicBase: string,
  months: readonly Date[],
): Promise<Playback[]> {
  const dataset = new Store();
  const scoped = createPodScopedFetch(musicBase, { fetch });
  for (const url of new Set(months.map((month) => historyShard(musicBase, month)))) {
    try {
      dataset.addQuads([...(await loadMusic(scoped, url)).dataset]);
    } catch (error) {
      if (!(error instanceof RdfFetchError) || error.status !== 404) throw error;
    }
  }
  return readHistory(dataset);
}

async function openShard(
  fetch: typeof globalThis.fetch,
  musicBase: string,
  url: string,
): Promise<{ document: MusicDocument; condition: WriteCondition }> {
  try {
    const document = await loadMusic(createPodScopedFetch(musicBase, { fetch }), url);
    if (!document.etag)
      throw new InvalidMusicError("An ETag is required to append to existing history");
    return { document, condition: { ifMatch: document.etag } };
  } catch (error) {
    if (!(error instanceof RdfFetchError) || error.status !== 404) throw error;
    return { document: { dataset: new Store(), etag: null, url }, condition: { ifNoneMatch: "*" } };
  }
}

function playbackId(musicBase: string, url: string, iri: string): string {
  const id = assertWithinPodScope(musicBase, httpIri(iri), { allowRoot: false });
  if (id.split("#")[0] !== url || !new URL(id).hash) {
    throw new InvalidMusicError("A playback IRI must be a fragment in its month shard");
  }
  return id;
}

function writePlayback(dataset: Store, id: string, play: Playback): void {
  const event = new PlaybackEvent(id, dataset).stampType();
  event.trackIri = play.trackIri;
  event.startTime = play.startTime;
  event.endTime = play.endTime;
  event.agent = play.agent;
}

/** Read-modify-write one monthly shard; a 412 is propagated without overwriting it. */
export async function appendPlayback(
  fetch: typeof globalThis.fetch,
  musicBase: string,
  play: Playback,
): Promise<MusicDocument> {
  const url = historyShard(musicBase, play.startTime);
  const { document, condition } = await openShard(fetch, musicBase, url);
  writePlayback(document.dataset, playbackId(musicBase, url, play.iri), play);
  document.etag = await saveMusic(fetch, musicBase, url, document.dataset, condition);
  return document;
}

/** A listen whose song is not in the library: its recording is described in the shard. */
export interface ImportedRecording {
  iri: string;
  title: string;
  artistIri: string;
  artist: string;
}
export interface ImportedPlayback extends Playback {
  recording?: ImportedRecording | undefined;
}

/**
 * Appends many plays with one read-modify-write per monthly shard. Plays whose IRI
 * is already in the shard are left alone, so importing the same export twice adds
 * nothing. A 412 is propagated; shards written before it stay written.
 */
export async function appendPlaybacks(
  fetch: typeof globalThis.fetch,
  musicBase: string,
  plays: readonly ImportedPlayback[],
  onShard: (done: number, total: number) => void = () => {},
): Promise<{ added: number; existing: number }> {
  const shards = new Map<string, ImportedPlayback[]>();
  for (const play of plays) {
    const url = historyShard(musicBase, play.startTime);
    playbackId(musicBase, url, play.iri);
    if (play.recording) {
      for (const iri of [play.recording.iri, play.recording.artistIri])
        if (playbackId(musicBase, url, iri) === play.iri)
          throw new InvalidMusicError("A recording needs its own fragment");
      if (play.trackIri !== play.recording.iri)
        throw new InvalidMusicError("An imported play must point at its recording");
    }
    const group = shards.get(url) ?? [];
    group.push(play);
    shards.set(url, group);
  }
  let added = 0;
  let existing = 0;
  let done = 0;
  for (const [url, group] of [...shards].sort(([a], [b]) => a.localeCompare(b))) {
    const { document, condition } = await openShard(fetch, musicBase, url);
    const dataset = document.dataset;
    const has = (iri: string) =>
      dataset.countQuads(DataFactory.namedNode(iri), null, null, null) > 0;
    let changed = false;
    for (const play of group) {
      if (has(play.iri)) {
        existing += 1;
        continue;
      }
      const recording = play.recording;
      if (recording && !has(recording.iri)) {
        if (!has(recording.artistIri)) {
          const artist = new Artist(recording.artistIri, dataset).stampType();
          artist.title = recording.artist;
        }
        const track = new Track(recording.iri, dataset).stampType();
        track.title = recording.title;
        track.setArtist(recording.artistIri);
      }
      writePlayback(dataset, play.iri, play);
      added += 1;
      changed = true;
    }
    if (changed) await saveMusic(fetch, musicBase, url, dataset, condition);
    onShard(++done, shards.size);
  }
  return { added, existing };
}
