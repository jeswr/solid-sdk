// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import {
  type BrokenDeck,
  type Deck,
  DeckConflictError,
  type DeckRepository,
  DeckVersionError,
  decodeDeck,
  renumber,
  type StoredDeck,
  serializeDeck,
} from "@jeswr/solid-slides";
export interface DeckConflict {
  url: string;
  local: Deck;
  remote: StoredDeck;
}
export interface SlidesSnapshot {
  decks: StoredDeck[];
  /** Presentation files the last listing could not open. */
  broken: BrokenDeck[];
  pending: number;
  error: boolean;
  /** One per presentation, oldest first. */
  conflicts: DeckConflict[];
  /** The conflict to resolve now; the others wait their turn. */
  conflict: DeckConflict | null;
}
interface Removal {
  item: StoredDeck;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}
/** Snapshots remembered per presentation to recognise this store's own earlier writes. */
const SENT_LIMIT = 4;
/** Retries from a version this store wrote itself before a mismatch counts as a conflict. */
const OWN_VERSION_RETRIES = 2;
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
  private queued: Promise<void> | undefined;
  private exitSaving: Promise<void> | undefined;
  private trash = new Map<string, Removal>();
  private sent = new Map<string, Deck[]>();
  /** Creations not yet on the pod: they use temporary URLs until the pod names them. */
  private unsaved = new Set<string>();
  constructor(
    private repository: DeckRepository,
    decks: StoredDeck[],
    private report: (message: string) => void,
    private persist: (value: string) => void = () => {},
    broken: BrokenDeck[] = [],
  ) {
    this.state = { decks, broken, pending: 0, error: false, conflicts: [], conflict: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<SlidesSnapshot>) {
    const conflicts = patch.conflicts ?? this.state.conflicts;
    this.state = {
      ...this.state,
      ...patch,
      conflicts,
      conflict: conflicts[0] ?? null,
      pending: this.dirty.size,
    };
    try {
      this.persist(
        JSON.stringify({
          drafts: this.state.decks
            .filter((entry) => this.dirty.has(entry.url))
            .map((entry) => (this.unsaved.has(entry.url) ? { ...entry, unsaved: true } : entry)),
          conflicts: this.state.conflicts,
          trash: [...this.trash].map(([url, removed]) => ({
            url,
            item: removed.item,
            deadline: removed.deadline,
            ...(this.unsaved.has(removed.item.url) ? { unsaved: true } : {}),
          })),
        }),
      );
    } catch {
      this.report("Device storage is full. Keep this page open until your edits save.");
    }
    for (const listener of this.listeners) listener();
  }
  private inCollection(url: unknown): url is string {
    return typeof url === "string" && url.startsWith(this.repository.container);
  }
  private decodeStored(value: { url: unknown; etag: unknown; deck: unknown }): StoredDeck {
    if (!this.inCollection(value.url) || typeof value.etag !== "string")
      throw new TypeError("Draft outside this collection");
    return { url: value.url, etag: value.etag, deck: decodeDeck(JSON.stringify(value.deck)) };
  }
  /** Each saved entry is restored on its own, so one bad entry never loses the others. */
  restore(value: string) {
    let saved: {
      drafts?: unknown;
      conflict?: unknown;
      conflicts?: unknown;
      trash?: unknown;
    };
    try {
      const parsed = JSON.parse(value);
      saved = Array.isArray(parsed) ? { drafts: parsed } : parsed;
      if (!saved || typeof saved !== "object") throw new TypeError("Not a draft record");
    } catch {
      this.report("A saved draft could not be opened. Your pod files are unchanged.");
      return;
    }
    let failed = 0;
    const list = (entries: unknown) => (Array.isArray(entries) ? entries : []);
    for (const draft of list(saved.drafts)) {
      try {
        const restored = this.decodeStored(draft);
        this.state.decks = [
          ...this.state.decks.filter((entry) => entry.url !== restored.url),
          restored,
        ];
        this.dirty.set(restored.url, ++this.generation);
        if (draft.unsaved === true) this.unsaved.add(restored.url);
      } catch {
        failed++;
      }
    }
    for (const conflict of [
      ...list(saved.conflicts),
      ...(saved.conflict ? [saved.conflict] : []),
    ]) {
      try {
        const remote = this.decodeStored(conflict.remote);
        // withConflict may replace the state with one that holds an extra copy.
        const conflicts = this.withConflict(this.state.conflicts, {
          url: remote.url,
          local: decodeDeck(JSON.stringify(conflict.local)),
          remote,
        });
        this.state.conflicts = conflicts;
      } catch {
        failed++;
      }
    }
    for (const removed of list(saved.trash)) {
      try {
        if (!this.inCollection(removed.url) || !Number.isFinite(removed.deadline)) continue;
        const item = this.decodeStored(removed.item);
        // An unsaved creation is never deleted from the pod, and an undo resumes creating it.
        if (removed.unsaved === true) {
          this.unsaved.add(item.url);
          this.dirty.set(item.url, ++this.generation);
        }
        const deletion: Removal = { item, deadline: removed.deadline, timer: undefined };
        deletion.timer = setTimeout(
          () => {
            void this.deleteAfterUndo(removed.url, deletion);
          },
          Math.max(0, removed.deadline - Date.now()),
        );
        this.trash.set(removed.url, deletion);
        this.state.decks = this.state.decks.filter((entry) => entry.url !== item.url);
      } catch {
        failed++;
      }
    }
    this.publish({});
    if (failed) this.report("A saved draft could not be opened. Your pod files are unchanged.");
    if (this.dirty.size) this.schedule();
  }
  /**
   * The first conflict for a presentation keeps its local edits; a later one updates the pod
   * side, and its different local edits become a separate unsaved copy instead of being lost.
   * The copy is added to the decks in place; the caller publishes.
   */
  private withConflict(conflicts: DeckConflict[], next: DeckConflict): DeckConflict[] {
    const existing = conflicts.find((entry) => entry.url === next.url);
    if (!existing) return [...conflicts, next];
    if (JSON.stringify(existing.local) !== JSON.stringify(next.local)) {
      const copy = this.draft({ ...next.local, name: `${next.local.name} (your copy)` });
      this.state = { ...this.state, decks: [copy, ...this.state.decks] };
      this.schedule();
    }
    return conflicts.map((entry) =>
      entry === existing ? { ...existing, remote: next.remote } : entry,
    );
  }
  /** Registers an unsaved creation without publishing it. */
  private draft(deck: Deck): StoredDeck {
    const url = `${this.repository.container}draft-${crypto.randomUUID()}.ttl`;
    this.unsaved.add(url);
    this.dirty.set(url, ++this.generation);
    return { url, etag: "", deck };
  }
  add(deck: Deck): string {
    const created = this.draft(deck);
    this.publish({ decks: [created, ...this.state.decks] });
    this.schedule();
    return created.url;
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
  /**
   * `keepalive` lets the request outlive the page. Only a real teardown (`teardown`) sends a
   * second, concurrent snapshot while a save is in flight, because a normal request can be
   * cancelled by unload; otherwise the keepalive save waits for the one in flight.
   */
  flush(keepalive = false, teardown = keepalive): Promise<void> {
    clearTimeout(this.timer);
    if (this.saving) {
      if (!keepalive) return this.saving;
      if (!teardown) {
        this.queued ??= this.saving.then(() => {
          this.queued = undefined;
          return this.dirty.size ? this.flush(true, false) : undefined;
        });
        return this.queued;
      }
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
  private remember(url: string, deck: Deck) {
    this.sent.set(url, [deck, ...(this.sent.get(url) ?? [])].slice(0, SENT_LIMIT));
  }
  private async sentBefore(url: string, body: string) {
    // Every save remembers its snapshot before it can conflict.
    for (const deck of this.sent.get(url) as Deck[])
      if ((await serializeDeck(url, { ...deck, slides: renumber(deck.slides) })) === body)
        return true;
    return false;
  }
  private async saveDirty(keepalive: boolean, updatesOnly = false) {
    for (const [url, version] of [...this.dirty]) {
      const item = this.state.decks.find((entry) => entry.url === url);
      if (!item) continue;
      if (updatesOnly && this.unsaved.has(url)) continue;
      if (!(await this.saveOne(url, item, version, keepalive))) return;
    }
    if (this.dirty.size && !updatesOnly) this.schedule();
  }
  private async saveOne(
    url: string,
    item: StoredDeck,
    version: number | undefined,
    keepalive: boolean,
  ): Promise<boolean> {
    let current = item;
    for (let attempt = 0; ; attempt++) {
      try {
        if (this.unsaved.has(url)) {
          this.settleSaved(url, await this.repository.create(current.deck), version);
          return true;
        }
        this.remember(url, current.deck);
        this.settleSaved(
          url,
          await this.repository.save(current, current.deck, keepalive),
          version,
        );
        return true;
      } catch (error) {
        if (!(error instanceof DeckConflictError)) {
          this.publish({ error: true });
          this.report(
            error instanceof DeckVersionError
              ? "Your pod didn't confirm this presentation's version, so Slides can't save over it safely. Your edits are kept on this device."
              : "Couldn't save your presentation. Your edits are kept on this device. Retry when connected.",
          );
          return false;
        }
        const latest = this.state.decks.find((entry) => entry.url === url)?.deck ?? error.local;
        const latestVersion = this.dirty.get(url);
        const remote = await serializeDeck(url, error.remote.deck);
        if ((await serializeDeck(url, latest)) === remote) {
          this.settleSaved(url, error.remote, latestVersion);
          return true;
        }
        if (attempt < OWN_VERSION_RETRIES && (await this.sentBefore(url, remote))) {
          // The pod holds a snapshot this store sent (say, an overlapping keepalive save):
          // carry on from that version instead of reporting a conflict with ourselves.
          current = { ...error.remote, deck: latest };
          version = latestVersion;
          continue;
        }
        this.dirty.delete(url);
        const conflicts = this.withConflict(this.state.conflicts, {
          url,
          local: latest,
          remote: error.remote,
        });
        this.publish({
          conflicts,
          decks: this.state.decks.map((entry) => (entry.url === url ? error.remote : entry)),
        });
        this.report(
          "This presentation changed elsewhere. Keep a copy of your edits or reload the pod version.",
        );
        return false;
      }
    }
  }
  private settleSaved(url: string, saved: StoredDeck, version: number | undefined) {
    if (url !== saved.url) {
      this.aliases.set(url, saved.url);
    }
    this.unsaved.delete(url);
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
  /** Resolves the oldest conflict. */
  resolveConflict(keepCopy: boolean): string | undefined {
    const [conflict, ...rest] = this.state.conflicts;
    if (!conflict) return;
    this.publish({ conflicts: rest });
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
  /**
   * Deletes the presentation file only. Its uploaded images stay: another window, device or
   * unsaved draft may still show them, and unused uploads are not garbage-collected yet.
   */
  private async deleteAfterUndo(url: string, removed: Removal) {
    if (this.saving) await this.saving;
    if (this.trash.get(url) !== removed) return;
    try {
      if (!this.unsaved.has(removed.item.url)) await this.repository.remove(removed.item);
      this.dirty.delete(url);
      this.dirty.delete(removed.item.url);
      this.unsaved.delete(removed.item.url);
      this.trash.delete(url);
      this.publish({});
    } catch {
      this.undo(url);
      this.report("Couldn't delete this presentation. It has been restored.");
    }
  }
  /** Saves what is pending and carries out confirmed deletions instead of dropping them. */
  dispose() {
    clearTimeout(this.timer);
    void this.flush(true, false);
    for (const [url, removed] of this.trash) {
      clearTimeout(removed.timer);
      void this.deleteAfterUndo(url, removed);
    }
  }
}
