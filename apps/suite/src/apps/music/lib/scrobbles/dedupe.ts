// AUTHORED-BY Codex GPT-6.1-Sol
import type { Listen } from "./types";

const WINDOW_SECONDS = 30;
const keyPart = (text: string) => text.toLowerCase().replace(/\s/g, "");
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fields = (listen: Listen) =>
  Number(listen.album !== undefined) +
  Number(listen.durationMs !== undefined) +
  Number(listen.mbids.recording !== undefined) +
  Number(listen.mbids.release !== undefined) +
  Number(listen.mbids.artists !== undefined);

/** Strongest records first; three time buckets suffice for exact inclusive 30-second matching. */
export function dedupe(listens: Listen[]): Listen[] {
  const candidates = listens.map((listen, index) => ({
    listen,
    index,
    score: fields(listen),
    seconds: Date.parse(listen.playedAt) / 1000,
  }));
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.listen.source === "listenbrainz") - Number(a.listen.source === "listenbrainz") ||
      a.seconds - b.seconds ||
      a.index - b.index,
  );
  const groups = new Map<string, Map<number, number>>();
  const kept: Listen[] = [];
  for (const candidate of candidates) {
    const { listen, seconds } = candidate;
    const key = JSON.stringify([keyPart(listen.artist), keyPart(listen.track)]);
    let buckets = groups.get(key);
    if (!buckets) {
      buckets = new Map();
      groups.set(key, buckets);
    }
    const bucket = Math.floor(seconds / (WINDOW_SECONDS + 1));
    let duplicate = false;
    for (let nearby = bucket - 1; nearby <= bucket + 1; nearby++) {
      const other = buckets.get(nearby);
      if (other !== undefined && Math.abs(seconds - other) <= WINDOW_SECONDS) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      buckets.set(bucket, seconds);
      kept.push(listen);
    }
  }
  return kept.sort(
    (a, b) =>
      Date.parse(a.playedAt) - Date.parse(b.playedAt) ||
      compareText(a.artist, b.artist) ||
      compareText(a.track, b.track),
  );
}
