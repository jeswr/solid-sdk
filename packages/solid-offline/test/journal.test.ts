// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserIntentStorage,
  DurableJournal,
  type IntentStorage,
  withJournalLock,
} from '../src/journal.js';

class MemoryStorage implements IntentStorage {
  entries = new Map<string, string>();
  get length() {
    return this.entries.size;
  }
  key(index: number) {
    return [...this.entries.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.entries.set(key, value);
  }
  removeItem(key: string) {
    this.entries.delete(key);
  }
}
interface Record {
  id: string;
  startedAt: string;
  steps: string[];
}
const record = (id = 'operation', startedAt = '2026-11-01'): Record => ({
  id,
  startedAt,
  steps: [],
});
function setup() {
  const storage = new MemoryStorage();
  const prefix = `journal:${crypto.randomUUID()}:`;
  const warn = vi.fn();
  let blocked = false;
  const source = () => {
    if (blocked) throw Error('blocked getter');
    return storage;
  };
  const open = () =>
    new DurableJournal<Record>(
      prefix,
      (value) => value as Record,
      warn,
      'recovery lost on reload',
      source,
    );
  return {
    storage,
    prefix,
    warn,
    open,
    block: () => {
      blocked = true;
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DurableJournal', () => {
  it('stores independently, sorts snapshots, checks keys and supports the default browser storage', () => {
    const p = setup();
    vi.stubGlobal('localStorage', p.storage);
    expect(browserIntentStorage()).toBe(p.storage);
    const journal = new DurableJournal<Record>(
      p.prefix,
      (value) => value as Record,
      p.warn,
      'unavailable',
    );
    const early = record('early');
    const late = record('late', '2026-12-01');
    expect(journal.list()).toEqual([]);
    expect(journal.put(late)).toBe(true);
    journal.put(early);
    p.storage.setItem('other', 'unrelated');
    expect(journal.list()).toEqual([early, late]);
    journal.remove(early);
    expect(journal.list()).toEqual([late]);
    p.storage.setItem(p.prefix + late.id, JSON.stringify({ ...late, id: 'wrong' }));
    expect(() => journal.list()).toThrow('invalid');
    p.storage.setItem(p.prefix + late.id, '{');
    expect(() => journal.list()).toThrow();
  });
  it('evicts another writer’s completed records before fallback, including provider remounts', () => {
    const p = setup();
    const journal = p.open();
    journal.put(record());
    expect(journal.list()).toEqual([record()]);
    p.storage.removeItem(`${p.prefix}operation`);
    expect(journal.list()).toEqual([]);
    p.block();
    expect(p.open().list()).toEqual([]);
    expect(p.warn).toHaveBeenCalledTimes(1);
  });
  it('evicts enumerated deletions even if a subsequent value read fails', () => {
    const p = setup();
    const journal = p.open();
    journal.put(record('completed'));
    journal.put(record('pending'));
    p.storage.removeItem(`${p.prefix}completed`);
    vi.spyOn(p.storage, 'getItem').mockImplementation(() => {
      throw Error('read blocked');
    });
    expect(journal.list()).toEqual([record('pending')]);
    expect(p.open().list()).toEqual([record('pending')]);
  });
  it('forgets a record disappearing between enumeration and read, and ignores null keys', () => {
    const p = setup();
    const journal = p.open();
    journal.put(record());
    vi.spyOn(p.storage, 'getItem').mockReturnValue(null);
    expect(journal.list()).toEqual([]);
    p.block();
    expect(p.open().list()).toEqual([]);
    const q = setup();
    q.storage.setItem('unrelated', 'value');
    vi.spyOn(q.storage, 'key').mockReturnValue(null);
    expect(q.open().list()).toEqual([]);
  });
  it('refreshes deletions before a failed write without dropping another namespace or a new volatile record', () => {
    const p = setup();
    const q = setup();
    const other = q.open();
    other.put(record('other-account'));
    const journal = p.open();
    journal.put(record('completed'));
    p.storage.removeItem(`${p.prefix}completed`);
    vi.spyOn(p.storage, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    expect(journal.put(record('new'))).toBe(false);
    expect(p.open().list()).toEqual([record('new')]);
    expect(other.list()).toEqual([record('other-account')]);
    journal.remove(record('new'));
    expect(p.open().list()).toEqual([]);
  });
  it('preserves dirty checkpoints but observes persistent deletions even after a quota failure', () => {
    const p = setup();
    const journal = p.open();
    const original = record();
    journal.put(original);
    vi.spyOn(p.storage, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    const dirty = { ...original, steps: ['created'] };
    expect(journal.put(dirty)).toBe(false);
    expect(p.open().list()).toEqual([dirty]);
    expect(JSON.parse(p.storage.getItem(p.prefix + original.id) as string)).toEqual(original);
    p.storage.removeItem(p.prefix + original.id);
    expect(p.open().list()).toEqual([]);
    expect(p.warn).toHaveBeenCalledOnce();
  });
  it('observes null-valued deletions in volatile storage without adopting its old checkpoint', () => {
    const p = setup();
    const journal = p.open();
    journal.put(record());
    vi.spyOn(p.storage, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    journal.put({ ...record(), steps: ['created'] });
    vi.spyOn(p.storage, 'getItem').mockReturnValue(null);
    expect(p.open().list()).toEqual([]);
  });
  it('retains removal tombstones and never restores stale readable storage after failed removals', () => {
    const p = setup();
    const journal = p.open();
    journal.put(record());
    vi.spyOn(p.storage, 'removeItem').mockImplementation(() => {
      throw Error('read only');
    });
    journal.remove(record());
    expect(p.open().list()).toEqual([]);
    expect(p.warn).toHaveBeenCalledOnce();
  });
  it('keeps in-memory records when the storage getter is unavailable and warns once', () => {
    const p = setup();
    p.block();
    const journal = p.open();
    expect(journal.put(record())).toBe(false);
    expect(p.open().list()).toEqual([record()]);
    journal.remove(record());
    expect(journal.list()).toEqual([]);
    expect(p.warn).toHaveBeenCalledExactlyOnceWith('recovery lost on reload');
  });
  it('retains corrupt observed data rather than falling back to an older valid checkpoint', () => {
    const p = setup();
    const journal = p.open();
    journal.put(record());
    p.storage.setItem(`${p.prefix}operation`, '{');
    expect(() => journal.list()).toThrow();
    p.block();
    expect(() => p.open().list()).toThrow();
  });
  it('serializes instances and namespace handoffs, releases failed locks and supports absent Web Locks', async () => {
    const p = setup();
    const request = vi.fn(async (_name: string, work: () => Promise<unknown>) => work());
    vi.stubGlobal('navigator', { locks: { request } });
    const firstJournal = p.open();
    const nextJournal = p.open();
    const calls: number[] = [];
    let finish!: () => void;
    const first = firstJournal.lock(async () => {
      calls.push(1);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      throw Error('failed');
    });
    const failure = expect(first).rejects.toThrow('failed');
    const second = nextJournal.lock(async () => {
      calls.push(2);
      return 'done';
    });
    await vi.waitFor(() => expect(calls).toEqual([1]));
    finish();
    await failure;
    expect(await second).toBe('done');
    expect(calls).toEqual([1, 2]);
    expect(request).toHaveBeenCalledTimes(2);
    vi.stubGlobal('navigator', {});
    expect(await firstJournal.lock(async () => 'no Web Locks')).toBe('no Web Locks');
    vi.stubGlobal('navigator', undefined);
    expect(await withJournalLock('legacy-key', async () => 'handoff')).toBe('handoff');
  });
});
