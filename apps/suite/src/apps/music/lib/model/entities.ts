// AUTHORED-BY Codex GPT-6.1-Sol
import { LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, SetFrom } from "@rdfjs/wrapper";
import { MusicNode } from "./rdf";
import { durationSeconds, httpIri, nonNegative } from "./validation";
import { M, MO, S } from "./vocab";

export interface MusicReference {
  iri?: string | undefined;
  name?: string | undefined;
}

export class Recording extends MusicNode {
  get artists(): MusicReference[] {
    return this.references(`${S}byArtist`, `${M}performedByArtist`, `${MO}performer`);
  }
  get album(): MusicReference | undefined {
    return this.references(`${S}inAlbum`, `${M}inAlbum`, `${MO}record`)[0];
  }

  private references(...predicates: string[]): MusicReference[] {
    const refs = this.objects(...predicates)
      .filter((term) => ["NamedNode", "BlankNode", "Literal"].includes(term.termType))
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

  get sourceUrl(): string | undefined {
    return this.iris(`${S}url`)[0] ?? this.strings(`${S}url`)[0];
  }
  set sourceUrl(value: string | undefined) {
    const checked = value === undefined ? undefined : httpIri(value);
    this.clear(`${S}url`);
    this.writeIri(`${S}url`, checked);
  }

  get imageUrl(): string | undefined {
    return (
      this.iris(`${S}image`, `${S}thumbnailUrl`)[0] ??
      this.strings(`${S}image`, `${S}thumbnailUrl`)[0]
    );
  }
  set imageUrl(value: string | undefined) {
    const checked = value === undefined ? undefined : httpIri(value);
    this.clear(`${S}image`);
    this.clear(`${S}thumbnailUrl`);
    this.writeIri(`${S}image`, checked);
  }

  setArtist(iri: string | undefined): void {
    const checked = iri === undefined ? undefined : httpIri(iri);
    for (const p of [`${S}byArtist`, `${M}performedByArtist`, `${MO}performer`]) this.clear(p);
    this.writeIri(`${S}byArtist`, checked);
    this.writeIri(`${M}performedByArtist`, checked);
  }
}

import type { Store } from "n3";
import { NS } from "./vocab";

export class Artist extends Recording {
  stampType(): this {
    return this.stamp(`${S}MusicGroup`, `${M}Artist`);
  }
}

export class Album extends Recording {
  stampType(): this {
    return this.stamp(`${S}MusicAlbum`, `${M}Album`);
  }
  get tracks(): string[] {
    return [...new Set(this.iris(`${S}track`, `${MO}track`))];
  }
  addTrack(iri: string): void {
    SetFrom.subjectPredicate(this, `${S}track`, NamedNodeAs.string, NamedNodeFrom.string).add(
      httpIri(iri),
    );
  }
}

export class Track extends Recording {
  stampType(): this {
    return this.stamp(`${S}MusicRecording`, `${M}Track`);
  }
  setAlbum(iri: string | undefined): void {
    const checked = iri === undefined ? undefined : httpIri(iri);
    for (const p of [`${S}inAlbum`, `${M}inAlbum`, `${MO}record`]) this.clear(p);
    this.writeIri(`${S}inAlbum`, checked);
    this.writeIri(`${M}inAlbum`, checked);
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
    for (const p of [`${S}duration`, `${M}durationSeconds`, `${MO}duration`]) this.clear(p);
    this.writeString(`${S}duration`, checked === undefined ? undefined : `PT${checked}S`);
    OptionalAs.object(this, `${M}durationSeconds`, checked, LiteralFrom.double);
  }
  get loved(): boolean {
    return this.strings(`${M}loved`).some((value) => value === "true" || value === "1");
  }
  set loved(value: boolean) {
    this.clear(`${M}loved`);
    OptionalAs.object(this, `${M}loved`, value, LiteralFrom.boolean);
  }
  get isrc(): string | undefined {
    return this.strings(`${M}isrc`, `${MO}isrc`)[0];
  }
  set isrc(value: string | undefined) {
    this.clear(`${M}isrc`);
    this.writeString(`${M}isrc`, value);
  }
}
