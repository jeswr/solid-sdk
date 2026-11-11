// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import type {
  createEventsRepository,
  EventData,
  Invitation,
  InviteeData,
} from "@jeswr/solid-events";

type Repository = ReturnType<typeof createEventsRepository>;
// A controller can outlive its provider while a save completes. Carry only an invalidation
// signal across remounts; each listener re-reads through its own account's repository.
const savesSettled = new Set<(source: EventsController) => void>();
export interface EventsSnapshot {
  events: Invitation[];
  loading: boolean;
  error: boolean;
  saving: number;
}
/** An account-owned controller; confirmed rows plus ordered optimistic invitations.
 * Failed generations disappear without rolling back a newer edit or an unrelated event. */
export class EventsController {
  private confirmed = new Map<string, Invitation>();
  private edits = new Map<symbol, Invitation>();
  private listeners = new Set<() => void>();
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private active = true;
  private state: EventsSnapshot = { events: [], loading: true, error: false, saving: 0 };
  private onSavesSettled = (source: EventsController) => {
    if (source !== this && source.repository.base === this.repository.base && !this.edits.size)
      void this.refresh();
  };
  constructor(
    readonly repository: Repository,
    readonly onFailure: () => void,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch: Partial<EventsSnapshot> = {}) {
    const rows = new Map(this.confirmed);
    for (const event of this.edits.values()) rows.set(event.url, event);
    this.state = { ...this.state, ...patch, events: [...rows.values()], saving: this.edits.size };
    if (this.active) for (const listener of this.listeners) listener();
  }
  async refresh() {
    const generation = ++this.generation;
    try {
      const events = await this.repository.list();
      if (!this.active || generation !== this.generation) return;
      this.confirmed = new Map(events.map((e) => [e.url, e]));
      this.emit({ loading: false, error: false });
    } catch {
      if (this.active && generation === this.generation) this.emit({ loading: false, error: true });
    }
  }
  save(data: EventData, invitees: InviteeData[] = [], existing?: Invitation): string {
    const id = crypto.randomUUID();
    const url = existing?.url ?? new URL(`${id}/index.ttl`, this.repository.base).href;
    const token = Symbol();
    ++this.generation;
    this.edits.set(token, { ...data, url, etag: existing?.etag ?? null });
    this.emit();
    const task = this.queue.then(async () => {
      let result: Invitation;
      if (existing) {
        result = await this.repository.update(this.confirmed.get(url) ?? existing, data);
      } else {
        result = await this.repository.create(data, invitees, id);
      }
      this.confirmed.set(result.url, result);
    });
    this.queue = task
      .catch(() => {
        this.onFailure();
      })
      .finally(() => {
        this.edits.delete(token);
        if (this.active) {
          this.emit();
          if (!this.edits.size) void this.refresh();
        }
        if (!this.edits.size) for (const listener of savesSettled) listener(this);
      });
    return url;
  }
  settled() {
    return this.queue;
  }
  activate() {
    this.active = true;
    savesSettled.add(this.onSavesSettled);
  }
  dispose() {
    this.active = false;
    savesSettled.delete(this.onSavesSettled);
    ++this.generation;
    this.listeners.clear();
  }
}
