// AUTHORED-BY Codex (GPT-6.1 Sol)
import { isMediaDate, type MediaEntry } from "./model.js";

/** One completion per log, attributed only to its stated finish date. */
export function mediaStats(entries: readonly MediaEntry[], year: number) {
  const months = Array.from({ length: 12 }, (_, month) => ({
    month,
    film: 0,
    tv: 0,
    book: 0,
    game: 0,
  }));
  const finished = entries.filter(
    (entry) =>
      entry.status === "finished" &&
      entry.finished &&
      isMediaDate(entry.finished) &&
      Number(entry.finished.slice(0, 4)) === year,
  );
  for (const entry of finished) {
    const month = months[Number(entry.finished?.slice(5, 7)) - 1];
    if (month) month[entry.kind === "episode" ? "tv" : entry.kind]++;
  }
  const rated = finished.filter((entry) => entry.rating !== undefined);
  const best = [...rated].sort(
    (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title),
  )[0];
  return {
    year,
    months,
    total: finished.length,
    rated: rated.length,
    average: rated.length
      ? rated.reduce((sum, entry) => sum + (entry.rating ?? 0), 0) / rated.length
      : null,
    best,
  };
}
