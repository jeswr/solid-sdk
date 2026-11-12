// AUTHORED-BY Claude Opus 5.5
/**
 * The Suite Music library model: a thin facade over the generated flat entities
 * `LibraryTrack`, `LibraryArtist`, `LibraryAlbum`, `LibraryPlaylist` and `Listen`, plus
 * the composite's `playedAt` node view for play instants. The shapes (codegen/
 * media.shapes.ttl, "Suite Music library profile") describe exactly what the app writes,
 * under the jeswr.org sector namespace it has always used.
 *
 * Two policies the generator cannot express live here:
 *  1. Each sector class is written together with its schema.org co-type
 *     ({@link LIBRARY_CO_TYPES}). A type alias would be removed by `mark()`.
 *  2. Writes run on a scratch store and return quads for the caller to merge. A
 *     generated wrapper's write checks alias migration over every typed subject of its
 *     dataset under a 10,000-read budget, which a whole library or a month of history
 *     exceeds. The entities declare no aliases, so there is nothing to migrate, and the
 *     scratch write applies the same datatype mappers and guards.
 */
import type { EntityWrapper } from "@jeswr/model-runtime";
import type { Quad } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import {
  entities,
  type LibraryAlbumWrapper,
  type LibraryArtistWrapper,
  type LibraryPlaylistWrapper,
  type LibraryTrackWrapper,
  type ListenWrapper,
  nodes,
  type ScrobblePlayedAtNodeWrapper,
} from "./generated/model.js";

const SCHEMA = "https://schema.org/";

/** The jeswr.org media-sector namespace the Suite Music app writes. */
export const LIBRARY_MEDIA = "https://jeswr.org/ns/sectors/media#";

/** The schema.org type written beside each sector class (the app keeps both). */
export const LIBRARY_CO_TYPES = {
  LibraryTrack: `${SCHEMA}MusicRecording`,
  LibraryArtist: `${SCHEMA}MusicGroup`,
  LibraryAlbum: `${SCHEMA}MusicAlbum`,
  LibraryPlaylist: `${SCHEMA}MusicPlaylist`,
  Listen: `${SCHEMA}ListenAction`,
} as const;

interface LibraryViews {
  LibraryTrack: LibraryTrackWrapper;
  LibraryArtist: LibraryArtistWrapper;
  LibraryAlbum: LibraryAlbumWrapper;
  LibraryPlaylist: LibraryPlaylistWrapper;
  Listen: ListenWrapper;
  /** A play's `time:Instant` (the composite's PlayedAtInstantShape node). */
  ListenInstant: ScrobblePlayedAtNodeWrapper;
}
export type LibraryView = keyof LibraryViews;
/** A generated field of one view (not the shared wrapper members). */
export type LibraryField<V extends LibraryView> = Exclude<
  keyof LibraryViews[V],
  keyof EntityWrapper
>;
/** The value one field accepts; a set field takes one member to add. */
export type LibraryValue<V extends LibraryView, F extends LibraryField<V>> =
  LibraryViews[V][F] extends ReadonlySet<infer M> ? M : LibraryViews[V][F];

const wrappers = {
  LibraryTrack: entities.LibraryTrack.Wrapper,
  LibraryArtist: entities.LibraryArtist.Wrapper,
  LibraryAlbum: entities.LibraryAlbum.Wrapper,
  LibraryPlaylist: entities.LibraryPlaylist.Wrapper,
  Listen: entities.Listen.Wrapper,
  ListenInstant: nodes.Scrobble.playedAt.Wrapper,
};

function scratch<V extends LibraryView>(view: V, subject: string) {
  const store = new Store();
  return { store, wrapper: new wrappers[view](subject, store, DataFactory) as LibraryViews[V] };
}

/** The class assertions for `subject`: the sector class and its schema.org co-type. */
export function libraryTypeQuads(view: LibraryView, subject: string): Quad[] {
  const { store, wrapper } = scratch(view, subject);
  wrapper.mark();
  if (view !== "ListenInstant")
    wrapper.types.add(LIBRARY_CO_TYPES[view as keyof typeof LIBRARY_CO_TYPES]);
  return [...store];
}

/**
 * The quads the generated model writes for one field value on `subject`. `undefined`
 * writes nothing. A defined value the model drops (out of range, wrong type, unsafe IRI,
 * unrepresentable number) throws `RangeError`, so callers can validate before mutating.
 */
export function libraryFieldQuads<V extends LibraryView, F extends LibraryField<V>>(
  view: V,
  subject: string,
  field: F,
  value: LibraryValue<V, F> | undefined,
): Quad[] {
  const { store, wrapper } = scratch(view, subject);
  if (value === undefined) return [];
  // A set field's getter is a live guarded set (not a `Set` instance): add one member.
  const current: unknown = wrapper[field];
  if (typeof current === "object" && current !== null && "add" in current)
    (current as { add(member: unknown): void }).add(value);
  else (wrapper as Record<F, unknown>)[field] = value;
  const quads = [...store];
  if (quads.length === 0) throw new RangeError(`The music model rejected ${String(field)}`);
  return quads;
}
