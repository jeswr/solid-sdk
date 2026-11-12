// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { normalizePodBase } from "@jeswr/guarded-fetch";
import { LiteralFrom, OptionalAs } from "@rdfjs/wrapper";
import type { Store } from "n3";
import { type MusicReference, Track } from "./entities";
import { DataFactory, MusicNode } from "./rdf";
import { httpIri, InvalidMusicError, nonNegative, validDate } from "./validation";
import { M, NS, S } from "./vocab";

export interface Playback {
  iri: string;
  trackIri: string;
  startTime: Date;
  endTime?: Date | undefined;
  agent?: string | undefined;
  /** Names from a recording described beside the play, for songs not in the library. */
  title?: string | undefined;
  artist?: string | undefined;
}

/**
 * schema:ListenAction and the solid-listening sector PlaybackEvent converge here.
 * Canonical writes go through @jeswr/solid-listening's generated Listen model.
 */
export class PlaybackEvent extends MusicNode {
  stampType(): this {
    return this.stampModel("Listen");
  }
  get trackIri(): string | undefined {
    return this.iris(`${S}object`, `${M}playedWork`)[0];
  }
  set trackIri(value: string | undefined) {
    // Validate before touching either alias.
    const checked = value === undefined ? undefined : httpIri(value);
    const quads = [
      ...this.modelQuads("Listen", "listenedTo", checked),
      ...this.modelQuads("Listen", "playedWork", checked),
    ];
    this.clear(`${S}object`);
    this.clear(`${M}playedWork`);
    this.addQuads(quads);
  }
  get startTime(): Date | undefined {
    const direct = this.date(this, `${S}startTime`, `${NS.CORE}atTime`);
    if (direct) return direct;
    for (const term of this.objects(`${NS.CORE}atTime`)) {
      if (term.termType !== "NamedNode" && term.termType !== "BlankNode") continue;
      const instant = new MusicNode(term, this.dataset as Store);
      const date = this.date(instant, `${NS.TIME}inXSDDateTime`);
      if (date) return date;
    }
    return undefined;
  }
  set startTime(value: Date | undefined) {
    if (value !== undefined) validDate(value);
    this.assertWritableSubject();
    // Reuse private imported instants, but never change another resource's time.
    const dataset = this.dataset as Store;
    const linkedInstantIri = this.iris(`${NS.CORE}atTime`)[0];
    let instantIri = linkedInstantIri ?? `${this.value}-instant`;
    if (
      !linkedInstantIri ||
      dataset
        .getQuads(null, null, DataFactory.namedNode(instantIri), null)
        .some((quad) => !this.equals(quad.subject))
    ) {
      instantIri = `${this.value}-instant`;
      let suffix = 0;
      while (
        dataset.countQuads(DataFactory.namedNode(instantIri), null, null, null) > 0 ||
        dataset.countQuads(null, null, DataFactory.namedNode(instantIri), null) > 0
      ) {
        suffix += 1;
        instantIri = `${this.value}-instant-${suffix}`;
      }
    }
    const instant = new MusicNode(instantIri, dataset);
    const instantTime = instant.modelQuads("ListenInstant", "playedAt", value);
    const quads = [
      ...this.modelQuads("Listen", "startTime", value),
      ...this.modelQuads("Listen", "atTime", value === undefined ? undefined : instantIri),
    ];
    if (value !== undefined) {
      instant.stampModel("ListenInstant");
      instant.clear(`${NS.TIME}inXSDDateTime`);
      instant.addQuads(instantTime);
    }
    this.clear(`${S}startTime`);
    this.clear(`${NS.CORE}atTime`);
    this.addQuads(quads);
  }
  get endTime(): Date | undefined {
    return this.date(this, `${S}endTime`);
  }
  set endTime(value: Date | undefined) {
    if (value !== undefined) validDate(value);
    const quads = this.modelQuads("Listen", "endTime", value);
    this.clear(`${S}endTime`);
    this.addQuads(quads);
  }
  get agent(): string | undefined {
    return this.iris(`${S}agent`, `${NS.CORE}hadParticipant`)[0];
  }
  set agent(value: string | undefined) {
    const checked = value === undefined ? undefined : httpIri(value);
    const quads = [
      ...this.modelQuads("Listen", "agent", checked),
      ...this.modelQuads("Listen", "hadParticipant", checked),
    ];
    this.clear(`${S}agent`);
    this.clear(`${NS.CORE}hadParticipant`);
    this.addQuads(quads);
  }
  get msPlayed(): number | undefined {
    for (const text of this.strings(`${M}msPlayed`)) {
      const number = Number(text);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return undefined;
  }
  set msPlayed(value: number | undefined) {
    const checked = value === undefined ? undefined : nonNegative(value);
    if (checked !== undefined && !Number.isInteger(checked)) {
      throw new InvalidMusicError("Milliseconds played must be an integer");
    }
    // Hand-written on purpose: the generated xsd:integer writer drops integers beyond
    // Number.MAX_SAFE_INTEGER, which this field has always written exactly (README of
    // @jeswr/solid-listening, "Suite Music library").
    this.clear(`${M}msPlayed`);
    OptionalAs.object(this, `${M}msPlayed`, checked, (milliseconds, factory) =>
      LiteralFrom.datatypeTuple([`${NS.XSD}integer`, BigInt(milliseconds).toString()], factory),
    );
  }
  private date(node: MusicNode, ...predicates: string[]): Date | undefined {
    for (const text of node.strings(...predicates)) {
      const date = new Date(text);
      if (Number.isFinite(date.getTime())) return date;
    }
    return undefined;
  }
}

export function readHistory(dataset: Store): Playback[] {
  const result: Playback[] = [];
  for (const subject of dataset.getSubjects(null, null, null)) {
    if (subject.termType !== "NamedNode") continue;
    const event = new PlaybackEvent(subject, dataset);
    if (!event.types.has(`${M}PlaybackEvent`) && !event.types.has(`${S}ListenAction`)) continue;
    const { trackIri, startTime } = event;
    if (!trackIri || !startTime) continue;
    const play: Playback = {
      iri: event.value,
      trackIri,
      startTime,
      endTime: event.endTime,
      agent: event.agent,
    };
    // Imported listens describe their recording in the same document.
    const recording = new Track(trackIri, dataset);
    const title = recording.strings(`${S}name`, `${NS.DCT}title`)[0];
    if (title) {
      play.title = title;
      play.artist = recording.artists.find((artist) => artist.name)?.name;
    }
    result.push(play);
  }
  return result.sort(
    (a, b) => b.startTime.getTime() - a.startTime.getTime() || a.iri.localeCompare(b.iri),
  );
}

export function monthKey(date: Date): string {
  return validDate(date).toISOString().slice(0, 7);
}

export function historyShard(musicBase: string, date: Date): string {
  return new URL(`history/${monthKey(date)}.ttl`, normalizePodBase(musicBase)).href;
}

export type ArtistPeriod = "Today" | "1W" | "1M" | "1Y";

/** Today starts at UTC midnight; other periods are rolling 7/30/365 days, inclusive. */
export function periodStart(period: ArtistPeriod, now: Date): Date {
  validDate(now);
  if (period === "Today") return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const days = { "1W": 7, "1M": 30, "1Y": 365 }[period];
  return new Date(now.getTime() - days * 86_400_000);
}

export interface TopArtist {
  key: string;
  name: string;
  plays: number;
}

/** Case, width and spacing-insensitive form of a song or artist name. */
export function nameKey(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en").trim().replace(/\s+/gu, " ");
}

export function computeTopArtists(
  history: readonly Playback[],
  tracks: readonly Track[],
  period: ArtistPeriod,
  now: Date,
): TopArtist[] {
  const start = periodStart(period, now).getTime();
  const library = new Map(tracks.map((track) => [track.value, track]));
  // Named-only listens count towards the library artist with the same name.
  const byName = new Map<string, string>();
  for (const track of tracks)
    for (const artist of track.artists) {
      const key = artist.iri ?? artist.name;
      const name = artist.name && nameKey(artist.name);
      if (key && name && !byName.has(name)) byName.set(name, key);
    }
  const counts = new Map<string, TopArtist>();
  const seen = new Set<string>();
  for (const play of history) {
    if (
      seen.has(play.iri) ||
      !(play.startTime.getTime() >= start && play.startTime.getTime() <= now.getTime())
    )
      continue;
    seen.add(play.iri);
    const credited = library.get(play.trackIri)?.artists;
    const credits: MusicReference[] = credited ?? (play.artist ? [{ name: play.artist }] : []);
    for (const artist of credits) {
      // Uncredited (named-only) listens always carry a name.
      const named = artist.name as string;
      const key =
        artist.iri ?? (credited ? artist.name : (byName.get(nameKey(named)) ?? nameKey(named)));
      if (!key) continue;
      const previous = counts.get(key);
      counts.set(key, {
        key,
        name: previous?.name ?? artist.name ?? "Unknown artist",
        plays: (previous?.plays ?? 0) + 1,
      });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.plays - a.plays || a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
  );
}

/** Latest play of each track, preserving repeated listens in the history itself. */
export function recentlyPlayed(history: readonly Playback[], limit = 20): Playback[] {
  nonNegative(limit);
  const seen = new Set<string>();
  return [...history]
    .filter((play) => Number.isFinite(play.startTime.getTime()))
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime() || a.iri.localeCompare(b.iri))
    .filter((play) => {
      if (seen.has(play.trackIri)) return false;
      seen.add(play.trackIri);
      return true;
    })
    .slice(0, Math.floor(limit));
}
