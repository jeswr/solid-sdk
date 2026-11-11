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
      const watch = new WatchAction(id, dataset, DataFactory);
      const at = watch.startTime;
      entries.push({
        id,
        data: {
          title,
          kind: "tv",
          status: "finished",
          finished: at && Number.isFinite(at.getTime()) ? at.toISOString().slice(0, 10) : undefined,
          source: provider("netflix", "www.netflix.com") ? "Netflix" : "Imported",
          origin,
        },
      });
    }
  }
  return entries;
}
