// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import type { Store } from "n3";
import { MusicNode } from "./rdf";
import { durationSeconds, httpIri, nonEmpty, nonNegative } from "./validation";
import { M, MO, NS, S } from "./vocab";

export interface MusicReference {
  iri?: string | undefined;
  name?: string | undefined;
}

type RecordingView = "LibraryTrack" | "LibraryArtist" | "LibraryAlbum" | "LibraryPlaylist";

/** Canonical writes go through @jeswr/solid-listening's generated library model. */
export class Recording extends MusicNode {
  protected get view(): RecordingView {
    return "LibraryTrack";
  }
  get artists(): MusicReference[] {
    return this.references(`${S}byArtist`, `${M}performedByArtist`, `${MO}performer`);
  }
  get album(): MusicReference | undefined {
    return this.references(`${S}inAlbum`, `${M}inAlbum`, `${MO}record`)[0];
  }

  private references(...predicates: string[]): MusicReference[] {
    const refs = this.objects(...predicates)
      .filter(
        (term) =>
          term.termType === "NamedNode" ||
          term.termType === "BlankNode" ||
          (term.termType === "Literal" && term.value.trim().length > 0),
      )
      .map((term): MusicReference => {
        if (term.termType === "Literal") return { name: term.value };
        const node = new MusicNode(term, this.dataset as Store);
        return {
          iri: term.termType === "NamedNode" ? term.value : undefined,
          name: node.strings(`${S}name`, `${NS.FOAF}name`, `${NS.DCT}title`, `${NS.RDFS}label`)[0],
        };
      });
    return refs.filter(
      (ref, index) =>
        refs.findIndex((other) => other.iri === ref.iri && other.name === ref.name) === index,
    );
  }

  /** schema:name and dcterms:title together (albums, tracks and playlists). */
  protected writeTitle(checked: string): void {
    const view = this.view as Exclude<RecordingView, "LibraryArtist">;
    const quads = [
      ...this.modelQuads(view, "name", checked),
      ...this.modelQuads(view, "title", checked),
    ];
    this.clear(`${S}name`);
    this.clear(`${NS.DCT}title`);
    this.addQuads(quads);
  }

  get sourceUrl(): string | undefined {
    return this.iris(`${S}url`)[0] ?? this.strings(`${S}url`)[0];
  }
  set sourceUrl(value: string | undefined) {
    const checked = value === undefined ? undefined : httpIri(value);
    const quads = this.modelQuads(this.view, "url", checked);
    this.clear(`${S}url`);
    this.addQuads(quads);
  }

  get imageUrl(): string | undefined {
    return (
      this.iris(`${S}image`, `${S}thumbnailUrl`)[0] ??
      this.strings(`${S}image`, `${S}thumbnailUrl`)[0]
    );
  }
  set imageUrl(value: string | undefined) {
    const checked = value === undefined ? undefined : httpIri(value);
    const quads = this.modelQuads(this.view, "image", checked);
    this.clear(`${S}image`);
    this.clear(`${S}thumbnailUrl`);
    this.addQuads(quads);
  }

  setArtist(iri: string | undefined): void {
    const checked = iri === undefined ? undefined : httpIri(iri);
    const quads = [
      ...this.modelQuads(this.view, "byArtist", checked),
      ...this.modelQuads(this.view, "performedByArtist", checked),
    ];
    for (const p of [`${S}byArtist`, `${M}performedByArtist`, `${MO}performer`]) this.clear(p);
    this.addQuads(quads);
  }
}

export class Artist extends Recording {
  protected override get view(): RecordingView {
    return "LibraryArtist";
  }
  stampType(): this {
    return this.stampModel("LibraryArtist");
  }
  override get title(): string {
    return super.title;
  }
  override set title(value: string) {
    const checked = nonEmpty(value);
    const quads = [
      ...this.modelQuads("LibraryArtist", "name", checked),
      ...this.modelQuads("LibraryArtist", "foafName", checked),
    ];
    this.clear(`${S}name`);
    this.clear(`${NS.FOAF}name`);
    this.addQuads(quads);
  }
}

export class Album extends Recording {
  protected override get view(): RecordingView {
    return "LibraryAlbum";
  }
  stampType(): this {
    return this.stampModel("LibraryAlbum");
  }
  override get title(): string {
    return super.title;
  }
  override set title(value: string) {
    this.writeTitle(nonEmpty(value));
  }
  get tracks(): string[] {
    return [...new Set(this.iris(`${S}track`, `${MO}track`))];
  }
  addTrack(iri: string): void {
    this.assertWritableSubject();
    this.addQuads(this.modelQuads("LibraryAlbum", "track", httpIri(iri)));
  }
}

export class Track extends Recording {
  get contentUrl(): string | undefined {
    return this.iris(`${S}contentUrl`)[0] ?? this.strings(`${S}contentUrl`)[0];
  }
  set contentUrl(value: string | undefined) {
    const checked = value === undefined ? undefined : httpIri(value);
    const quads = this.modelQuads("LibraryTrack", "contentUrl", checked);
    this.clear(`${S}contentUrl`);
    this.addQuads(quads);
  }
  get lyricsUrl(): string | undefined {
    return this.iris(`${S}lyrics`)[0];
  }
  set lyricsUrl(value: string | undefined) {
    const checked = value === undefined ? undefined : httpIri(value);
    const quads = this.modelQuads("LibraryTrack", "lyrics", checked);
    this.clear(`${S}lyrics`);
    this.addQuads(quads);
  }
  stampType(): this {
    return this.stampModel("LibraryTrack");
  }
  override get title(): string {
    return super.title;
  }
  override set title(value: string) {
    this.writeTitle(nonEmpty(value));
  }
  setAlbum(iri: string | undefined): void {
    const checked = iri === undefined ? undefined : httpIri(iri);
    const quads = [
      ...this.modelQuads("LibraryTrack", "schemaInAlbum", checked),
      ...this.modelQuads("LibraryTrack", "inAlbum", checked),
    ];
    for (const p of [`${S}inAlbum`, `${M}inAlbum`, `${MO}record`]) this.clear(p);
    this.addQuads(quads);
  }
  get durationSeconds(): number | undefined {
    for (const value of this.strings(`${S}duration`, `${M}durationSeconds`, `${MO}duration`)) {
      const seconds = durationSeconds(value);
      if (seconds !== undefined) return seconds;
    }
    return undefined;
  }
  set durationSeconds(value: number | undefined) {
    const checked = value === undefined ? undefined : nonNegative(value);
    // The generated xsd:decimal writer never uses exponent notation.
    const quads = [
      ...this.modelQuads(
        "LibraryTrack",
        "duration",
        checked === undefined ? undefined : `PT${checked}S`,
      ),
      ...this.modelQuads("LibraryTrack", "durationSeconds", checked),
    ];
    for (const p of [`${S}duration`, `${M}durationSeconds`, `${MO}duration`]) this.clear(p);
    this.addQuads(quads);
  }
  get loved(): boolean {
    return this.strings(`${M}loved`).some((value) => value === "true" || value === "1");
  }
  set loved(value: boolean) {
    const quads = this.modelQuads("LibraryTrack", "loved", value);
    this.clear(`${M}loved`);
    this.addQuads(quads);
  }
  get isrc(): string | undefined {
    return this.strings(`${M}isrc`, `${MO}isrc`)[0];
  }
  set isrc(value: string | undefined) {
    const quads = this.modelQuads("LibraryTrack", "isrc", value);
    this.clear(`${M}isrc`);
    this.clear(`${MO}isrc`);
    this.addQuads(quads);
  }
}
