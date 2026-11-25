// AUTHORED-BY Claude Sonnet 5.5

/**
 * One two-step delete in flight. It is recorded before the description is deleted, because
 * once the description is gone nothing else says where its binary and thumbnail are.
 */
export interface DeleteJournalEntry {
  readonly descriptionUrl: string;
  /** The shard container the item lived in; the only place a resume may delete from. */
  readonly shardUrl: string;
  readonly binaryUrl?: string;
  readonly thumbnailUrl?: string;
}

/**
 * A durable record of deletes still to finish. Implement it over IndexedDB or a file for
 * crash-resistant deletes. Entries read back from storage are treated as untrusted: the store
 * re-validates every URL before it deletes anything.
 */
export interface DeleteJournal {
  /** Insert or replace the entry for `entry.descriptionUrl`. */
  put(entry: DeleteJournalEntry): Promise<void>;
  /** Forget the entry for `descriptionUrl` (no-op when absent). */
  delete(descriptionUrl: string): Promise<void>;
  list(): Promise<readonly DeleteJournalEntry[]>;
}

/** In-memory journal: survives nothing, but makes `resumePending` work within one session. */
export function createMemoryJournal(): DeleteJournal {
  const entries = new Map<string, DeleteJournalEntry>();
  return {
    async put(entry) {
      entries.set(entry.descriptionUrl, { ...entry });
    },
    async delete(descriptionUrl) {
      entries.delete(descriptionUrl);
    },
    async list() {
      return [...entries.values()];
    },
  };
}
