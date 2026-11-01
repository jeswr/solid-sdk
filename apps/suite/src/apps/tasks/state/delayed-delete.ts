// AUTHORED-BY Codex GPT-6.1-Sol
export const UNDO_WINDOW = 8000;

/** One timer per resource; Undo and expiry/dismiss/pagehide all settle an entry exactly once. */
export class DelayedDeletes {
  private pending = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; commit: () => void; restore: () => void }
  >();
  schedule(url: string, hide: () => void, commit: () => void, restore: () => void) {
    if (this.pending.has(url)) return false;
    hide();
    this.pending.set(url, {
      timer: setTimeout(() => this.finish(url), UNDO_WINDOW),
      commit,
      restore,
    });
    return true;
  }
  undo(url: string) {
    const entry = this.take(url);
    entry?.restore();
    return !!entry;
  }
  finish(url: string) {
    this.take(url)?.commit();
  }
  flush = () => {
    for (const url of this.pending.keys()) this.finish(url);
  };
  private take(url: string) {
    const entry = this.pending.get(url);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(url);
    }
    return entry;
  }
}
