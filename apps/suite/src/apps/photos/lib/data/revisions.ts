// AUTHORED-BY Codex GPT-6
import { requireEtag } from "./shared";

interface Revision {
  url: string;
  etag: string | null;
}
/** Follow this client's confirmed write chain only. Reads from another revision
 * start a new chain; stale callers cannot adopt an unrelated client's validator.
 * Callers serialize writes and verify read-back content when PUT omits an ETag. */
export function confirmedRevisions<T extends Revision>() {
  const resources = new Map<string, { known: Set<string | null>; current: T }>();
  return {
    latest(record: T): T {
      const previous = resources.get(record.url);
      return previous?.known.has(record.etag) ? previous.current : record;
    },
    confirm(source: T, saved: T): T {
      const current = { ...saved, etag: requireEtag(saved.etag) };
      const previous = resources.get(source.url);
      const known = new Set(previous?.known.has(source.etag) ? previous.known : []);
      known.add(source.etag);
      known.add(current.etag);
      resources.set(source.url, { known, current });
      return current;
    },
    forget(url: string) {
      resources.delete(url);
    },
  };
}
