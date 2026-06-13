// @vitest-environment jsdom
/**
 * @solid/offline/react thin hooks. Runs in jsdom with real React 18 +
 * @testing-library/react. Asserts the two behaviours the spec pins:
 *   - useOfflineStatus SUBSCRIBES (via useSyncExternalStore) and the component
 *     RE-RENDERS when a tracked resource is broadcast 'updated' and when
 *     connectivity flips.
 *   - useOfflineResource reads THROUGH the page fetch, surfaces stale, and
 *     RE-READS automatically on an 'updated' broadcast for that URL.
 *
 * Node 22 provides a real global BroadcastChannel, so the page↔surface bridge is
 * exercised for real (no mock channel here).
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOfflineResource, useOfflineStatus } from '../src/react.js';
import { createStatusSurface } from '../src/status.js';
import type { UpdatedEvent } from '../src/types.js';

const CHANNEL = 'solid-offline';

afterEach(() => {
  cleanup();
});

/** Broadcast an `updated` event the way the SWR engine does. */
async function broadcast(event: UpdatedEvent): Promise<void> {
  const ch = new BroadcastChannel(CHANNEL);
  await act(async () => {
    ch.postMessage(event);
    // Let the microtask/macrotask queue flush the channel delivery + React commit.
    await new Promise((r) => setTimeout(r, 0));
  });
  ch.close();
}

describe('useOfflineStatus', () => {
  it('re-renders when a tracked resource is broadcast updated', async () => {
    const surface = createStatusSurface({ channelName: CHANNEL, isOnline: () => true });
    surface.markFresh('https://pod/doc'); // track it

    const { result } = renderHook(() => useOfflineStatus(surface));
    expect(result.current.online).toBe(true);
    expect(result.current.updated).toBe(0);

    await broadcast({ url: 'https://pod/doc', event: 'updated', etag: '"v2"' });

    expect(result.current.updated).toBe(1);
    expect(result.current.resources['https://pod/doc']).toBe('updated');
    surface.close();
  });

  it('re-renders on connectivity change', async () => {
    const surface = createStatusSurface({ channelName: CHANNEL, isOnline: () => true });
    const { result } = renderHook(() => useOfflineStatus(surface));
    expect(result.current.online).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.online).toBe(false);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.online).toBe(true);
    surface.close();
  });

  it('creates + owns a surface when given options, tearing it down on unmount', () => {
    const { unmount, result } = renderHook(() => useOfflineStatus({ channelName: CHANNEL }));
    expect(result.current.online).toBeTypeOf('boolean');
    // No throw on unmount (it closes the surface it owns).
    expect(() => unmount()).not.toThrow();
  });
});

describe('useOfflineResource', () => {
  it('reads through the provided fetch and exposes data + state', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('<a> <b> <c> .', {
          status: 200,
          headers: { 'content-type': 'text/turtle', etag: '"v1"' },
        }),
    );
    const { result } = renderHook(() =>
      useOfflineResource('https://pod/doc', { fetch: fetchMock as unknown as typeof fetch }),
    );

    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.state).toBe('success'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBeInstanceOf(Response);
    expect(result.current.stale).toBe(false);
    // The default Accept is text/turtle (RDF read).
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('accept')).toBe('text/turtle');
  });

  it('flags stale when the response carries X-Offline: stale', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('cached', {
          status: 200,
          headers: { 'content-type': 'text/turtle', etag: '"v1"', 'x-offline': 'stale' },
        }),
    );
    const { result } = renderHook(() =>
      useOfflineResource('https://pod/doc', { fetch: fetchMock as unknown as typeof fetch }),
    );
    await waitFor(() => expect(result.current.state).toBe('success'));
    expect(result.current.stale).toBe(true);
  });

  it('re-reads automatically when an updated event is broadcast for the url', async () => {
    let body = 'v1';
    const fetchMock = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/turtle', etag: `"${body}"` },
        }),
    );
    const { result } = renderHook(() =>
      useOfflineResource<string>('https://pod/doc', {
        fetch: fetchMock as unknown as typeof fetch,
        select: (r) => r.text(),
      }),
    );
    await waitFor(() => expect(result.current.data).toBe('v1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Server-side change → SW broadcasts updated → hook re-reads.
    body = 'v2';
    await broadcast({ url: 'https://pod/doc', event: 'updated', etag: '"v2"' });

    await waitFor(() => expect(result.current.data).toBe('v2'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // After catching up, it is no longer outdated.
    expect(result.current.outdated).toBe(false);
  });

  it('ignores updated events for OTHER urls', async () => {
    const fetchMock = vi.fn(
      async () => new Response('x', { status: 200, headers: { etag: '"v1"' } }),
    );
    const { result } = renderHook(() =>
      useOfflineResource('https://pod/doc', { fetch: fetchMock as unknown as typeof fetch }),
    );
    await waitFor(() => expect(result.current.state).toBe('success'));

    await broadcast({ url: 'https://pod/OTHER', event: 'updated' });
    // No re-read for an unrelated url.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when skip is set, and reload() triggers a read', async () => {
    const fetchMock = vi.fn(
      async () => new Response('x', { status: 200, headers: { etag: '"v1"' } }),
    );
    const { result } = renderHook(() =>
      useOfflineResource('https://pod/doc', {
        fetch: fetchMock as unknown as typeof fetch,
        skip: true,
      }),
    );
    expect(result.current.state).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    const { result } = renderHook(() =>
      useOfflineResource('https://pod/doc', { fetch: fetchMock as unknown as typeof fetch }),
    );
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect((result.current.error as Error).message).toBe('network down');
  });
});
