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
import type { UpdatedEvent } from '../src/types.js';

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
  emit(data: UpdatedEvent): void {
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
