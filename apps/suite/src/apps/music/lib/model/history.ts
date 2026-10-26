// AUTHORED-BY Codex GPT-6.1-Sol
import { normalizePodBase } from "@jeswr/guarded-fetch";
import { LiteralFrom, OptionalAs, SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import type { Store } from "n3";
import type { Track } from "./entities";
import { MusicNode } from "./rdf";
import { httpIri, nonNegative, validDate } from "./validation";
import { M, NS, S } from "./vocab";

export interface Playback {
  iri: string;
  trackIri: string;
  startTime: Date;
  endTime?: Date | undefined;
  agent?: string | undefined;
}

/** schema:ListenAction and the solid-listening sector PlaybackEvent converge here. */
export class PlaybackEvent extends MusicNode {
  stampType(): this {
    return this.stamp(`${S}ListenAction`, `${M}PlaybackEvent`);
  }
  get trackIri(): string | undefined {
    return this.iris(`${S}object`, `${M}playedWork`)[0];
  }
  set trackIri(value: string | undefined) {
    // Validate before touching either alias.
    if (value !== undefined) httpIri(value);
    this.clear(`${S}object`);
    this.clear(`${M}playedWork`);
    this.writeIri(`${S}object`, value);
    this.writeIri(`${M}playedWork`, value);
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
    // Reuse imported instant IRIs; new events get a stable, event-specific IRI.
    const instant = new MusicNode(
      this.iris(`${NS.CORE}atTime`)[0] ?? `${this.value}-instant`,
      this.dataset as Store,
    );
    if (value !== undefined) {
      instant.stamp(`${NS.TIME}Instant`);
      instant.clear(`${NS.TIME}inXSDDateTime`);
      OptionalAs.object(instant, `${NS.TIME}inXSDDateTime`, value, LiteralFrom.dateTime);
    }
    this.clear(`${S}startTime`);
    this.clear(`${NS.CORE}atTime`);
    OptionalAs.object(this, `${S}startTime`, value, LiteralFrom.dateTime);
    if (value !== undefined) {
      SetFrom.subjectPredicate(this, `${NS.CORE}atTime`, TermAs.is, TermFrom.instance).add(instant);
    }
  }
  get endTime(): Date | undefined {
    return this.date(this, `${S}endTime`);
  }
  set endTime(value: Date | undefined) {
    if (value !== undefined) validDate(value);
    this.clear(`${S}endTime`);
    OptionalAs.object(this, `${S}endTime`, value, LiteralFrom.dateTime);
  }
  get agent(): string | undefined {
    return this.iris(`${S}agent`, `${NS.CORE}hadParticipant`)[0];
  }
  set agent(value: string | undefined) {
    if (value !== undefined) httpIri(value);
    this.clear(`${S}agent`);
    this.clear(`${NS.CORE}hadParticipant`);
    this.writeIri(`${S}agent`, value);
    this.writeIri(`${NS.CORE}hadParticipant`, value);
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
    this.clear(`${M}msPlayed`);
    OptionalAs.object(this, `${M}msPlayed`, checked, LiteralFrom.double);
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
    if (trackIri && startTime)
      result.push({
        iri: event.value,
        trackIri,
        startTime,
        endTime: event.endTime,
        agent: event.agent,
      });
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

export function computeTopArtists(
  history: readonly Playback[],
  tracks: readonly Track[],
  period: ArtistPeriod,
  now: Date,
): TopArtist[] {
  const start = periodStart(period, now).getTime();
  const library = new Map(tracks.map((track) => [track.value, track]));
  const counts = new Map<string, TopArtist>();
  const seen = new Set<string>();
  for (const play of history) {
    if (
      seen.has(play.iri) ||
      !(play.startTime.getTime() >= start && play.startTime.getTime() <= now.getTime())
    )
      continue;
    seen.add(play.iri);
    for (const artist of library.get(play.trackIri)?.artists ?? []) {
      const key = artist.iri ?? artist.name;
      if (!key) continue;
      const previous = counts.get(key);
      counts.set(key, {
        key,
        name: artist.name ?? "Unknown artist",
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
