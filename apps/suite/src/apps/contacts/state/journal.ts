// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { DurableJournal, type IntentStorage } from "@jeswr/solid-offline/journal";
import type { SavedDocument } from "../lib/model/intent";
import type { MergeSelection } from "./merge";

export interface Intent {
  id: string;
  kind: "create" | "delete" | "restore" | "migrate" | "book" | "merge";
  startedAt: string;
  bookUrl: string;
  destination: string;
  destinations: string[];
  person?: SavedDocument;
  source?: SavedDocument;
  /** Delete only: the trash copy, created before anything is unlinked or deleted. */
  trash?: SavedDocument;
  /** Merge only: each duplicate's pre-merge RDF and the labels it must leave. */
  duplicates?: MergeDuplicate[];
  /** Merge only: the reviewed choices, so only an identical request resumes this record. */
  selection?: MergeSelection;
  labels: string[];
  completed: string[];
  repairs: string[];
  attempting?: string;
  phase: "forward" | "reconcile" | "rollback";
}
export interface MergeDuplicate {
  person: SavedDocument;
  labels: string[];
}
export { browserIntentStorage, type IntentStorage } from "@jeswr/solid-offline/journal";

export function journalPrefix(webId: string, bookUrl: string) {
  return `solid-suite:contacts:intent:${encodeURIComponent(webId)}:${encodeURIComponent(bookUrl)}:`;
}
export class IntentJournal extends DurableJournal<Intent> {
  constructor(
    webId: string,
    readonly bookUrl: string,
    warn: (message: string) => void,
    storage?: () => IntentStorage,
  ) {
    super(
      journalPrefix(webId, bookUrl),
      (value) => {
        const intent = value as Intent;
        if (intent.bookUrl !== bookUrl) throw new Error("Contacts recovery record is invalid.");
        return intent;
      },
      warn,
      "This browser cannot save Contacts recovery. Keep this tab open until saving finishes; recovery will be lost on reload.",
      storage,
    );
  }
}
