// AUTHORED-BY Codex GPT-6.1-Sol
import { LiteralFrom, OptionalAs, SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import type { Store } from "n3";
import { Recording, type Track } from "./entities";
import { DataFactory, MusicNode } from "./rdf";
import { httpIri, InvalidMusicError } from "./validation";
import { M, MO, S } from "./vocab";

/** Ported Pod Music ListItem ordering; duplicates are deliberately retained. */
export class Playlist extends Recording {
  stampType(): this {
    return this.stamp(`${S}MusicPlaylist`, `${M}Playlist`);
  }

  get tracks(): string[] {
    const entries = this.objects(`${S}itemListElement`).flatMap((term) => {
      if (term.termType !== "NamedNode" && term.termType !== "BlankNode") return [];
      const entry = new MusicNode(term, this.dataset as Store);
      const position = Number(entry.strings(`${S}position`)[0]);
      const item = entry.iris(`${S}item`)[0];
      return item && Number.isInteger(position) && position > 0 ? [{ position, item }] : [];
    });
    if (entries.length)
      return entries.sort((a, b) => a.position - b.position).map((entry) => entry.item);
    return [...new Set(this.iris(`${S}track`, `${MO}track`))].sort();
  }

  setTracks(iris: readonly string[]): this {
    const checked = iris.map(httpIri); // validate before mutating any existing entry
    // Clear membership, leaving foreign/shared entry subjects untouched. Detached entries
    // are harmless; whole-document rewrites must not delete another playlist's metadata.
    this.clear(`${S}itemListElement`);
    this.clear(`${S}track`);
    this.clear(`${MO}track`);
    const links = SetFrom.subjectPredicate(
      this,
      `${S}itemListElement`,
      TermAs.is,
      TermFrom.instance,
    );
    for (const [index, iri] of checked.entries()) {
      const entry = new MusicNode(DataFactory.blankNode(), this.dataset as Store);
      // Blank entries use the typed rdf:type set directly (entity stamp requires an IRI).
      entry.writeIri(`${RDF}type`, `${S}ListItem`);
      OptionalAs.object(entry, `${S}position`, index + 1, LiteralFrom.integer);
      entry.writeIri(`${S}item`, iri);
      links.add(entry);
    }
    return this;
  }

  addTrack(iri: string): this {
    return this.setTracks([...this.tracks, iri]);
  }

  removeAt(index: number): this {
    const tracks = this.tracks;
    if (!Number.isInteger(index) || index < 0 || index >= tracks.length) return this;
    tracks.splice(index, 1);
    return this.setTracks(tracks);
  }

  /** Zero-based indices, including the final destination after removal. */
  reorder(from: number, to: number): this {
    const tracks = this.tracks;
    if (
      ![from, to].every((index) => Number.isInteger(index) && index >= 0 && index < tracks.length)
    ) {
      throw new InvalidMusicError("Playlist position is out of range");
    }
    const [track] = tracks.splice(from, 1);
    tracks.splice(to, 0, track as string);
    return this.setTracks(tracks);
  }
}

import { NS } from "./vocab";

const RDF = NS.RDF;

/** Interop mirror; the media:loved flags on tracks remain the source of truth. */
export function syncLikedPlaylist(dataset: Store, iri: string, tracks: readonly Track[]): Playlist {
  const playlist = new Playlist(httpIri(iri), dataset).stampType();
  playlist.title = "Liked songs";
  return playlist.setTracks(tracks.filter((track) => track.loved).map((track) => track.value));
}
