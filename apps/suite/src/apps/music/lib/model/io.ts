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

/** Read-modify-write one monthly shard; a 412 is propagated without overwriting it. */
export async function appendPlayback(
  fetch: typeof globalThis.fetch,
  musicBase: string,
  play: Playback,
): Promise<MusicDocument> {
  const url = historyShard(musicBase, play.startTime);
  let document: MusicDocument;
  let condition: WriteCondition;
  try {
    document = await loadMusic(createPodScopedFetch(musicBase, { fetch }), url);
    if (!document.etag)
      throw new InvalidMusicError("An ETag is required to append to existing history");
    condition = { ifMatch: document.etag };
  } catch (error) {
    if (!(error instanceof RdfFetchError) || error.status !== 404) throw error;
    document = { dataset: new Store(), etag: null, url };
    condition = { ifNoneMatch: "*" };
  }
  const id = assertWithinPodScope(musicBase, httpIri(play.iri), { allowRoot: false });
  if (id.split("#")[0] !== url || !new URL(id).hash) {
    throw new InvalidMusicError("A playback IRI must be a fragment in its month shard");
  }
  const event = new PlaybackEvent(id, document.dataset).stampType();
  event.trackIri = play.trackIri;
  event.startTime = play.startTime;
  event.endTime = play.endTime;
  event.agent = play.agent;
  document.etag = await saveMusic(fetch, musicBase, url, document.dataset, condition);
  return document;
}
