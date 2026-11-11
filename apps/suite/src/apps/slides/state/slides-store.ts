// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type Deck,
  DeckConflictError,
  type DeckRepository,
  decodeDeck,
  type StoredDeck,
  serializeDeck,
} from "@jeswr/solid-slides";
export interface SlidesSnapshot {
  decks: StoredDeck[];
  pending: number;
  error: boolean;
  conflict: { local: Deck; remote: StoredDeck } | null;
}
interface Removal {
  item: StoredDeck;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}
/** Deck-specific serial autosave; failed snapshots remain editable and retryable. */
export class SlidesStore {
  private state: SlidesSnapshot;
  private listeners = new Set<() => void>();
  private dirty = new Map<string, number>();
  private generation = 0;
  private aliases = new Map<string, string>();
  resolveUrl = (url: string): string => this.aliases.get(url) ?? url;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> | undefined;
  private exitSaving: Promise<void> | undefined;
  private trash = new Map<string, Removal>();
  constructor(
    private repository: DeckRepository,
    decks: StoredDeck[],
    private report: (message: string) => void,
    private persist: (value: string) => void = () => {},
  ) {
    this.state = { decks, pending: 0, error: false, conflict: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<SlidesSnapshot>) {
    this.state = { ...this.state, ...patch, pending: this.dirty.size };
    try {
      this.persist(
        JSON.stringify({
          drafts: this.state.decks.filter((entry) => this.dirty.has(entry.url)),
          conflict: this.state.conflict,
          trash: [...this.trash].map(([url, removed]) => ({
            url,
            item: removed.item,
            deadline: removed.deadline,
          })),
        }),
      );
    } catch {
      this.report("Device storage is full. Keep this page open until your edits save.");
    }
    for (const listener of this.listeners) listener();
  }
  restore(value: string) {
    try {
      const saved = JSON.parse(value);
      const drafts: StoredDeck[] = Array.isArray(saved) ? saved : saved.drafts;
      for (const draft of drafts) {
        const deck = decodeDeck(JSON.stringify(draft.deck));
        if (!draft.url.startsWith(this.repository.container) || typeof draft.etag !== "string")
          continue;
        this.state.decks = [
          ...this.state.decks.filter((entry) => entry.url !== draft.url),
          { ...draft, deck },
        ];
        this.dirty.set(draft.url, ++this.generation);
      }
      if (saved.conflict)
        this.state.conflict = {
          local: decodeDeck(JSON.stringify(saved.conflict.local)),
          remote: {
            ...saved.conflict.remote,
            deck: decodeDeck(JSON.stringify(saved.conflict.remote.deck)),
          },
        };
      for (const removed of saved.trash ?? []) {
        if (
          !removed.url.startsWith(this.repository.container) ||
          !Number.isFinite(removed.deadline)
        )
          continue;
        const item = { ...removed.item, deck: decodeDeck(JSON.stringify(removed.item.deck)) };
        const deletion: Removal = { item, deadline: removed.deadline, timer: undefined };
        deletion.timer = setTimeout(
          () => {
            void this.deleteAfterUndo(removed.url, deletion);
          },
          Math.max(0, removed.deadline - Date.now()),
        );
        this.trash.set(removed.url, deletion);
        this.state.decks = this.state.decks.filter((entry) => entry.url !== item.url);
      }
      this.publish({});
      if (this.dirty.size) this.schedule();
    } catch {
      this.report("A saved draft could not be opened. Your pod files are unchanged.");
    }
  }
  add(deck: Deck): string {
    const url = `${this.repository.container}draft-${crypto.randomUUID()}.ttl`;
    this.dirty.set(url, ++this.generation);
    this.publish({ decks: [{ url, etag: "", deck }, ...this.state.decks] });
    this.schedule();
    return url;
  }
  edit(url: string, deck: Deck) {
    url = this.resolveUrl(url);
    if (!this.state.decks.some((entry) => entry.url === url)) return;
    this.dirty.set(url, ++this.generation);
    this.publish({
      decks: this.state.decks.map((entry) =>
        entry.url === url ? { ...entry, deck: { ...deck, modified: new Date() } } : entry,
      ),
    });
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, 650);
  }
  flush(keepalive = false): Promise<void> {
    clearTimeout(this.timer);
    if (this.saving) {
      if (!keepalive) return this.saving;
      // A normal request can be cancelled by teardown. Send a separate conditional
      // keepalive snapshot; only other teardown requests share this flight.
      this.exitSaving ??= this.saveDirty(true, true).finally(() => {
        this.exitSaving = undefined;
      });
      return this.exitSaving;
    }
    this.saving = this.saveDirty(keepalive).finally(() => {
      this.saving = undefined;
    });
    return this.saving;
  }
  private async saveDirty(keepalive: boolean, updatesOnly = false) {
    for (const [url, version] of [...this.dirty]) {
      const item = this.state.decks.find((entry) => entry.url === url);
      if (!item) continue;
      if (updatesOnly && !item.etag) continue;
      try {
        const saved = item.etag
          ? await this.repository.save(item, item.deck, keepalive)
          : await this.repository.create(item.deck);
        this.settleSaved(url, saved, version);
      } catch (error) {
        if (error instanceof DeckConflictError) {
          const latest = this.state.decks.find((entry) => entry.url === url)?.deck ?? error.local;
          const latestVersion = this.dirty.get(url);
          if (
            (await serializeDeck(url, latest)) === (await serializeDeck(url, error.remote.deck))
          ) {
            this.settleSaved(url, error.remote, latestVersion);
            continue;
          }
          this.dirty.delete(url);
          this.publish({
            conflict: { local: latest, remote: error.remote },
            decks: this.state.decks.map((entry) => (entry.url === url ? error.remote : entry)),
          });
          this.report(
            "This presentation changed elsewhere. Keep a copy of your edits or reload the pod version.",
          );
        } else {
          this.publish({ error: true });
          this.report(
            "Couldn't save your presentation. Your edits are kept on this device. Retry when connected.",
          );
        }
        return;
      }
    }
    if (this.dirty.size && !updatesOnly) this.schedule();
  }
  private settleSaved(url: string, saved: StoredDeck, version: number | undefined) {
    if (url !== saved.url) {
      this.aliases.set(url, saved.url);
    }
    if (this.dirty.get(url) === version || !this.dirty.has(url)) this.dirty.delete(url);
    else {
      this.dirty.delete(url);
      this.dirty.set(saved.url, ++this.generation);
    }
    this.publish({
      error: false,
      decks: this.state.decks.map((entry) =>
        entry.url === url ? { ...saved, deck: entry.deck } : entry,
      ),
    });
    // A deck deleted while creation was in flight stays deleted, with its actual URL.
    const removed = this.trash.get(url);
    if (removed) removed.item = { ...saved, deck: removed.item.deck };
  }
  resolveConflict(keepCopy: boolean): string | undefined {
    const conflict = this.state.conflict;
    if (!conflict) return;
    this.publish({ conflict: null });
    if (keepCopy)
      return this.add({ ...conflict.local, name: `${conflict.local.name} (your copy)` });
  }
  remove(url: string) {
    const item = this.state.decks.find((entry) => entry.url === url);
    if (!item) return;
    clearTimeout(this.trash.get(url)?.timer);
    const deletion: Removal = { item, deadline: Date.now() + 6000, timer: undefined };
    deletion.timer = setTimeout(() => {
      void this.deleteAfterUndo(url, deletion);
    }, 6000);
    this.trash.set(url, deletion);
    this.publish({ decks: this.state.decks.filter((entry) => entry.url !== url) });
  }
  undo(url: string) {
    const removed = this.trash.get(url);
    if (!removed) return;
    clearTimeout(removed.timer);
    this.trash.delete(url);
    this.publish({ decks: [removed.item, ...this.state.decks] });
    if (this.dirty.has(url)) this.schedule();
  }
  private async deleteAfterUndo(url: string, removed: Removal) {
    if (this.saving) await this.saving;
    if (this.trash.get(url) !== removed) return;
    try {
      if (removed.item.etag) await this.repository.remove(removed.item);
      this.dirty.delete(url);
      this.dirty.delete(removed.item.url);
      this.trash.delete(url);
      this.publish({});
    } catch {
      this.undo(url);
      this.report("Couldn't delete this presentation. It has been restored.");
    }
  }
  dispose() {
    clearTimeout(this.timer);
    for (const removed of this.trash.values()) clearTimeout(removed.timer);
    void this.flush(true);
  }
}
