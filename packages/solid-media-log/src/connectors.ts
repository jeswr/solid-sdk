// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@jeswr/fetch-rdf";
import { Provenance } from "@jeswr/pod-connectors/core/provenance";
import { Book, CLASSES, VideoGame, WatchAction } from "@jeswr/pod-connectors/core/vocab";
import { DataFactory } from "n3";
import { type MediaEntry, mediaUrl } from "./model.js";

export const CONNECTOR_CLASSES = [CLASSES.WatchAction, CLASSES.Book, CLASSES.VideoGame];
export interface ConnectorEntry {
  id: string;
  data: MediaEntry;
}
/** Read the adapters' actual typed output. Source documents are never mutated. */
export function connectorEntries(dataset: DatasetCore): ConnectorEntry[] {
  const subjects = new Set<string>();
  for (const quad of dataset)
    if (quad.subject.termType === "NamedNode") subjects.add(quad.subject.value);
  const entries: ConnectorEntry[] = [];
  for (const id of subjects) {
    if (!mediaUrl(id)) continue;
    const book = new Book(id, dataset, DataFactory);
    const title = book.name?.trim();
    if (!title || title.length > 500) continue;
    const origin = mediaUrl(book.sourceUrl ?? id);
    const derived = new Provenance(id, dataset, DataFactory).derivedFrom;
    const provider = (name: string, host: string) =>
      derived.has(`urn:solid:connector:${name}:export`) ||
      [...derived, book.sourceUrl ?? ""].some((value) => {
        const safe = mediaUrl(value);
        return safe !== undefined && new URL(safe).hostname === host;
      });
    if (book.types.has(CLASSES.Book)) {
      const shelf = book.readingStatus;
      const rating = book.ratingValue;
      entries.push({
        id,
        data: {
          title,
          kind: "book",
          creator: book.author,
          status:
            shelf === "read"
              ? "finished"
              : shelf === "currently-reading"
                ? "in-progress"
                : shelf === "did-not-finish"
                  ? "abandoned"
                  : "want",
          rating:
            rating !== undefined && rating >= 0.5 && rating <= 5 && Number.isInteger(rating * 2)
              ? rating
              : undefined,
          source: provider("goodreads", "www.goodreads.com") ? "Goodreads" : "Imported",
          origin,
        },
      });
    } else if (book.types.has(CLASSES.VideoGame)) {
      const game = new VideoGame(id, dataset, DataFactory);
      entries.push({
        id,
        data: {
          title,
          kind: "game",
          status:
            game.timeRequired && game.timeRequired !== "PT0M" && game.timeRequired !== "PT0S"
              ? "in-progress"
              : "want",
          source: provider("steam", "store.steampowered.com") ? "Steam" : "Imported",
          origin,
        },
      });
    } else if (book.types.has(CLASSES.WatchAction)) {
      // The generic Action carries neither a typed work nor reliable completion.
      // Only the known Netflix history adapter guarantees a watched item here.
      if (!provider("netflix", "www.netflix.com")) continue;
      const watch = new WatchAction(id, dataset, DataFactory);
      const at = watch.startTime;
      entries.push({
        id,
        data: {
          title,
          kind: "film",
          status: "finished",
          finished: at && Number.isFinite(at.getTime()) ? at.toISOString().slice(0, 10) : undefined,
          source: "Netflix",
          origin,
        },
      });
    }
  }
  return groupNetflixEntries(entries);
}
/** Netflix exports encode series/season/episode in their display title, not typed links.
 * Keep series in progress: watching some episodes does not prove a series is finished.
 * Group across documents as well as within one export; the stable origin survives edits.
 */
export function groupNetflixEntries(entries: readonly ConnectorEntry[]): ConnectorEntry[] {
  const series = new Map<string, ConnectorEntry>();
  const result: ConnectorEntry[] = [];
  for (const entry of entries) {
    if (entry.data.source !== "Netflix") {
      result.push(entry);
      continue;
    }
    const separator = entry.data.title.indexOf(": ");
    const grouped = entry.data.kind === "tv" && entry.data.progressUnit === "episode";
    const episodic =
      separator > 0 &&
      (entry.data.title.indexOf(": ", separator + 2) > 0 ||
        /^(?:season|series|episode|limited series|volume|part)\b/i.test(
          entry.data.title.slice(separator + 2),
        ));
    if (!episodic && !grouped) {
      result.push(entry);
      continue;
    }
    const title = grouped ? entry.data.title : entry.data.title.slice(0, separator).trim();
    const id = new URL(
      `./#series-${encodeURIComponent(title.toLocaleLowerCase("en-GB"))}`,
      entry.id,
    ).href;
    const previous = series.get(id);
    if (previous)
      previous.data.progress = (previous.data.progress ?? 0) + (entry.data.progress ?? 1);
    else {
      const record: ConnectorEntry = {
        id,
        data: {
          ...entry.data,
          title,
          kind: "tv",
          status: "in-progress",
          finished: undefined,
          progress: entry.data.progress ?? 1,
          progressUnit: "episode",
          origin: id,
        },
      };
      series.set(id, record);
      result.push(record);
    }
  }
  return result;
}
