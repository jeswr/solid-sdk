/**
 * The framework-agnostic offline/stale/pending status surface: connectivity
 * tracking, per-resource freshness, the `updated` BroadcastChannel bridge, and
 * the referential-stability `getSnapshot` requires for `useSyncExternalStore`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ConnectivityTarget,
  createStatusSurface,
  type OfflineStatusSurface,
  type StatusChannel,
} from '../src/status.js';
import type { OfflineEvent } from '../src/types.js';

/** A scriptable BroadcastChannel stand-in. */
class MockChannel implements StatusChannel {
  private listeners = new Set<(event: MessageEvent) => void>();
  closed = false;
  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(data: OfflineEvent): void {
    for (const l of this.listeners) l({ data } as MessageEvent);
  }
}

/** A scriptable connectivity event source (online/offline). */
class MockConnectivity implements ConnectivityTarget {
  private listeners = new Map<'online' | 'offline', Set<() => void>>();
  addEventListener(type: 'online' | 'offline', listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: 'online' | 'offline', listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: 'online' | 'offline'): void {
    for (const l of this.listeners.get(type) ?? []) l();
  }
}

let surfaces: OfflineStatusSurface[] = [];
afterEach(() => {
  for (const s of surfaces) s.close();
  surfaces = [];
});

function make(opts: {
  channel?: MockChannel;
  connectivity?: MockConnectivity;
  online?: boolean;
}): OfflineStatusSurface {
  const s = createStatusSurface({
    channel: opts.channel,
    connectivity: opts.connectivity,
    isOnline: () => opts.online ?? true,
  });
  surfaces.push(s);
  return s;
}

describe('status surface — snapshot + subscription', () => {
  it('starts online (per isOnline) with no tracked resources', () => {
    const s = make({ online: true });
    const snap = s.getSnapshot();
    expect(snap).toMatchObject({ online: true, pending: 0, stale: 0, updated: 0 });
    expect(snap.resources).toEqual({});
  });

  it('getSnapshot is referentially stable until something changes', () => {
    const s = make({ online: true });
    const a = s.getSnapshot();
    expect(s.getSnapshot()).toBe(a); // no change → same object (useSyncExternalStore safe)
    s.markPending('https://pod/doc');
    const b = s.getSnapshot();
    expect(b).not.toBe(a);
    expect(s.getSnapshot()).toBe(b);
  });

  it('notifies subscribers and counts pending/stale/fresh', () => {
    const s = make({ online: true });
    const cb = vi.fn();
    const unsub = s.subscribe(cb);

    s.markPending('https://pod/a');
    s.markStale('https://pod/b');
    expect(cb).toHaveBeenCalledTimes(2);

    const snap = s.getSnapshot();
    expect(snap.pending).toBe(1);
    expect(snap.stale).toBe(1);
    expect(snap.resources['https://pod/a']).toBe('pending');
    expect(snap.resources['https://pod/b']).toBe('stale');

    s.markFresh('https://pod/a');
    expect(s.getSnapshot().pending).toBe(0);
    expect(s.getSnapshot().resources['https://pod/a']).toBe('fresh');

    // Setting the same value again does not re-notify.
    cb.mockClear();
    s.markFresh('https://pod/a');
    expect(cb).not.toHaveBeenCalled();

    unsub();
    s.markPending('https://pod/c');
    expect(cb).not.toHaveBeenCalled(); // unsubscribed
  });

  it("flips a TRACKED resource to 'updated' on a matching broadcast", () => {
    const channel = new MockChannel();
    const s = make({ channel, online: true });
    const cb = vi.fn();
    s.subscribe(cb);

    // Untracked URL: broadcast is ignored (we don't grow the map for every change).
    channel.emit({ url: 'https://pod/untracked', event: 'updated' });
    expect(cb).not.toHaveBeenCalled();
    expect(s.getSnapshot().updated).toBe(0);

    // Track it, then broadcast → flips to 'updated'.
    s.markFresh('https://pod/doc');
    channel.emit({ url: 'https://pod/doc', event: 'updated', etag: '"v2"' });
    expect(s.getSnapshot().resources['https://pod/doc']).toBe('updated');
    expect(s.getSnapshot().updated).toBe(1);
  });

  it('tracks connectivity from online/offline events', () => {
    const connectivity = new MockConnectivity();
    const s = make({ connectivity, online: true });
    expect(s.getSnapshot().online).toBe(true);

    connectivity.fire('offline');
    expect(s.getSnapshot().online).toBe(false);
    connectivity.fire('online');
    expect(s.getSnapshot().online).toBe(true);
  });

  it('forget() drops a resource from the snapshot', () => {
    const s = make({ online: true });
    s.markStale('https://pod/x');
    expect(s.getSnapshot().resources['https://pod/x']).toBe('stale');
    s.forget('https://pod/x');
    expect(s.getSnapshot().resources['https://pod/x']).toBeUndefined();
    expect(s.getSnapshot().stale).toBe(0);
  });

  it('close() detaches from the channel + connectivity', () => {
    const channel = new MockChannel();
    const connectivity = new MockConnectivity();
    const s = createStatusSurface({ channel, connectivity, isOnline: () => true });
    s.close();
    expect(channel.closed).toBe(true);
    // After close, a broadcast does nothing (listener removed).
    const cb = vi.fn();
    s.subscribe(cb);
    channel.emit({ url: 'whatever', event: 'updated' });
    expect(cb).not.toHaveBeenCalled();
  });
});

// AUTHORED-BY Codex GPT-6.1-Sol
const URL = 'https://pod/doc';
describe('revalidation status transitions', () => {
  it.each([
    'revalidated',
    'updated',
    'revalidate-failed',
  ] as const)('%s settles pending with a stable snapshot', (event) => {
    const channel = new MockChannel();
    const s = make({ channel });
    s.markStale(URL);
    const before = s.getSnapshot();
    channel.emit({ url: URL, event: 'revalidating' });
    expect(s.getSnapshot()).toMatchObject({
      pending: 1,
      stale: 0,
      updated: 0,
      resources: { [URL]: 'pending' },
    });
    expect(before.resources[URL]).toBe('stale');
    channel.emit({ url: URL, event });
    const state = event === 'revalidated' ? 'fresh' : event === 'updated' ? 'updated' : 'stale';
    expect(s.getSnapshot()).toMatchObject({ pending: 0, resources: { [URL]: state } });
    expect(s.getSnapshot()).toBe(s.getSnapshot());
  });

  it.each([
    'fresh',
    'stale',
    'updated',
    'pending',
  ] as const)('restores previous %s on failure', (state) => {
    const channel = new MockChannel();
    const s = make({ channel });
    if (state === 'stale') s.markStale(URL);
    else if (state === 'pending') s.markPending(URL);
    else {
      s.markFresh(URL);
      if (state === 'updated') channel.emit({ url: URL, event: 'updated' });
    }
    const before = s.getSnapshot();
    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: URL, event: 'revalidate-failed' });
    expect(s.getSnapshot()).toEqual(before);
  });

  it.each([
    'revalidating',
    'revalidated',
    'updated',
    'revalidate-failed',
  ] as const)('ignores untracked %s messages', (event) => {
    const channel = new MockChannel();
    const s = make({ channel });
    const before = s.getSnapshot();
    channel.emit({ url: URL, event });
    expect(s.getSnapshot()).toBe(before);
  });

  it('keeps parallel work pending and does not roll back a successful attempt', () => {
    const channel = new MockChannel();
    const s = make({ channel });
    s.markStale(URL);
    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: URL, event: 'updated' });
    expect(s.getSnapshot().pending).toBe(1);
    channel.emit({ url: URL, event: 'revalidate-failed' });
    expect(s.getSnapshot()).toMatchObject({
      pending: 0,
      updated: 1,
      resources: { [URL]: 'updated' },
    });
  });

  it.each([
    ['updated', 'revalidated'],
    ['revalidated', 'updated'],
    ['updated', 'updated'],
  ] as const)('preserves an unread update across parallel %s / %s results', (first, second) => {
    const channel = new MockChannel();
    const s = make({ channel });
    s.markFresh(URL);
    const seen: string[] = [];
    s.subscribe(() => seen.push(s.getSnapshot().resources[URL] as string));

    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: URL, event: 'revalidating' });
    const pending = s.getSnapshot();
    channel.emit({ url: URL, event: first });
    expect(s.getSnapshot()).toBe(pending);
    channel.emit({ url: URL, event: second });
    expect(s.getSnapshot()).toMatchObject({
      pending: 0,
      updated: 1,
      resources: { [URL]: 'updated' },
    });
    expect(seen).toEqual(['pending', 'updated']);
  });

  it('retains an update through later confirmations until a consumer marks a fresh read', () => {
    const channel = new MockChannel();
    const s = make({ channel });
    s.markFresh(URL);
    channel.emit({ url: URL, event: 'updated' });
    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: URL, event: 'revalidated' });
    expect(s.getSnapshot().resources[URL]).toBe('updated');
    channel.emit({ url: URL, event: 'revalidated' });
    expect(s.getSnapshot().resources[URL]).toBe('updated');
    s.markFresh(URL);
    expect(s.getSnapshot()).toMatchObject({
      pending: 0,
      updated: 0,
      resources: { [URL]: 'fresh' },
    });
  });

  it.each([
    ['fresh', 'markStale', 'stale'],
    ['stale', 'markFresh', 'fresh'],
    ['fresh', 'markPending', 'pending'],
  ] as const)('keeps %s → %s through a failed attempt', (initial, mark, expected) => {
    const channel = new MockChannel();
    const s = make({ channel });
    if (initial === 'fresh') s.markFresh(URL);
    else s.markStale(URL);
    channel.emit({ url: URL, event: 'revalidating' });
    const pending = s.getSnapshot();
    const listener = vi.fn();
    s.subscribe(listener);
    s[mark](URL);
    expect(s.getSnapshot()).toBe(pending);
    expect(listener).not.toHaveBeenCalled();
    channel.emit({ url: URL, event: 'revalidate-failed' });
    expect(s.getSnapshot().resources[URL]).toBe(expected);
    expect(s.getSnapshot().pending).toBe(expected === 'pending' ? 1 : 0);
  });

  it('keeps the latest manual mark after a parallel confirmation and failure', () => {
    const channel = new MockChannel();
    const s = make({ channel });
    s.markStale(URL);
    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: URL, event: 'revalidated' });
    s.markFresh(URL);
    s.markStale(URL);
    expect(s.getSnapshot().pending).toBe(1);
    channel.emit({ url: URL, event: 'revalidate-failed' });
    expect(s.getSnapshot()).toMatchObject({ pending: 0, stale: 1, resources: { [URL]: 'stale' } });
  });

  it.each([
    'revalidated',
    'updated',
  ] as const)('acknowledges an update during parallel work before a later %s', (event) => {
    const channel = new MockChannel();
    const s = make({ channel });
    s.markFresh(URL);
    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: URL, event: 'updated' });
    s.markFresh(URL);
    expect(s.getSnapshot().pending).toBe(1);
    channel.emit({ url: URL, event });
    expect(s.getSnapshot().resources[URL]).toBe(event === 'updated' ? 'updated' : 'fresh');
    expect(s.getSnapshot().pending).toBe(0);
  });

  it('keeps resources independent and settles forgotten attempts without retracking', () => {
    const channel = new MockChannel();
    const s = make({ channel });
    s.markStale(URL);
    s.markFresh('https://pod/other');
    channel.emit({ url: URL, event: 'revalidating' });
    channel.emit({ url: 'https://pod/other', event: 'revalidating' });
    expect(s.getSnapshot().pending).toBe(2);
    s.forget(URL);
    channel.emit({ url: URL, event: 'revalidated' });
    expect(s.getSnapshot().resources[URL]).toBeUndefined();
    s.markFresh(URL);
    channel.emit({ url: URL, event: 'revalidate-failed' });
    expect(s.getSnapshot().resources[URL]).toBe('fresh');
    channel.emit({ url: 'https://pod/other', event: 'revalidate-failed' });
    expect(s.getSnapshot().pending).toBe(0);
  });

  describe.each(['late tracking', 'forget and retrack'] as const)('%s', (tracking) => {
    it.each([
      'revalidated',
      'updated',
      'revalidate-failed',
    ] as const)('keeps newer work pending after an older %s', (event) => {
      const channel = new MockChannel();
      const s = make({ channel });
      if (tracking === 'forget and retrack') s.markStale(URL);
      channel.emit({ url: URL, event: 'revalidating' }); // Attempt A.
      if (tracking === 'forget and retrack') s.forget(URL);
      expect(s.getSnapshot().resources[URL]).toBeUndefined();

      s.markStale(URL);
      // Tracking changes affect visibility, not the lifetime of attempt A.
      expect(s.getSnapshot().pending).toBe(1);
      channel.emit({ url: URL, event: 'revalidating' }); // Attempt B.
      const pending = s.getSnapshot();
      const listener = vi.fn();
      s.subscribe(listener);
      channel.emit({ url: URL, event }); // A settles while B is unresolved.
      expect(s.getSnapshot()).toBe(pending);
      expect(s.getSnapshot().pending).toBe(1);
      expect(listener).not.toHaveBeenCalled();

      channel.emit({ url: URL, event: 'revalidate-failed' }); // B settles.
      const settled = event === 'updated' ? 'updated' : event === 'revalidated' ? 'fresh' : 'stale';
      expect(s.getSnapshot()).toMatchObject({ pending: 0, resources: { [URL]: settled } });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('cleans up attempts that start and settle while untracked', () => {
      const channel = new MockChannel();
      const s = make({ channel });
      if (tracking === 'forget and retrack') {
        s.markStale(URL);
        channel.emit({ url: URL, event: 'revalidating' });
        s.forget(URL);
      }
      const untracked = s.getSnapshot();
      channel.emit({ url: URL, event: 'revalidating' });
      channel.emit({ url: URL, event: 'updated' });
      if (tracking === 'forget and retrack') channel.emit({ url: URL, event: 'revalidated' });
      expect(s.getSnapshot()).toBe(untracked);
      s.markStale(URL);
      expect(s.getSnapshot()).toMatchObject({ pending: 0, resources: { [URL]: 'stale' } });
    });
  });

  it('ignores unmatched failures and unknown events without notifying', () => {
    const channel = new MockChannel();
    const s = make({ channel });
    s.markPending(URL);
    const before = s.getSnapshot();
    const listener = vi.fn();
    s.subscribe(listener);
    channel.emit({ url: URL, event: 'revalidate-failed' });
    channel.emit({ url: URL, event: 'unrelated' } as unknown as OfflineEvent);
    expect(s.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});
