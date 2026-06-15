// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Hook-level tests for the gallery data hook — focused on the STALE-RESPONSE
// guard the component tests can't easily reach: when a slow earlier load (a GET
// for container A) resolves AFTER the user has navigated to container B, its
// result/error must be DROPPED, never overwriting B's state. Driven by gated
// fetches so the resolution order is deterministic.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePhotoGallery } from '../../src/ui/index.js';

const A = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/a/> a ldp:Container ;
  ldp:contains <https://pod.example/a/x.ttl> .
<https://pod.example/a/x.ttl> a ldp:Resource .
`;
const A_EMPTY = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/a/> a ldp:Container .
`;
const A_PHOTO = `
@prefix schema: <https://schema.org/> .
<https://pod.example/a/x.ttl#it> a schema:Photograph ; schema:name "A photo" .
`;
const B = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/b/> a ldp:Container ;
  ldp:contains <https://pod.example/b/y.ttl> .
<https://pod.example/b/y.ttl> a ldp:Resource .
`;
const B_PHOTO = `
@prefix schema: <https://schema.org/> .
<https://pod.example/b/y.ttl#it> a schema:Photograph ; schema:name "B photo" .
`;

function turtle(url: string, body: string): Response {
  const res = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle', etag: '"v1"' },
  });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

/**
 * A fetch whose response for a given URL is gated on a manually-released
 * promise, so a test can force container A's GET to resolve AFTER navigating to
 * B. `bodies` maps URL → Turtle; `gates` maps URL → the gate to await first.
 */
function gatedFetch(
  bodies: Record<string, string>,
  gates: Record<string, Promise<void>>,
): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const gate = gates[url];
    if (gate) await gate;
    const body = bodies[url];
    if (body === undefined) {
      const res = new Response(null, { status: 404 });
      Object.defineProperty(res, 'url', { value: url });
      return res;
    }
    return turtle(url, body);
  }) as unknown as typeof globalThis.fetch;
}

describe('usePhotoGallery — stale-response guard', () => {
  it('drops a slow earlier listing that resolves after a navigation (then-branch)', async () => {
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });
    // A is an EMPTY container, so its load RESOLVES cleanly (no photo-walk that
    // would observe the aborted signal and reject) — exercising the then-branch
    // staleness guard rather than the catch-branch one.
    const fetch = gatedFetch(
      {
        'https://pod.example/a/': A_EMPTY,
        'https://pod.example/b/': B,
        'https://pod.example/b/y.ttl': B_PHOTO,
      },
      // Only A's container GET is gated; B resolves immediately.
      { 'https://pod.example/a/': gateA },
    );

    const { result } = renderHook(() => usePhotoGallery('https://pod.example/a/', { fetch }));

    // Navigate to B before A's GET has resolved — A is now stale.
    act(() => {
      result.current.navigate('https://pod.example/b/');
    });

    // B loads (immediately).
    await waitFor(() => expect(result.current.listing?.url).toBe('https://pod.example/b/'));
    expect(result.current.currentUrl).toBe('https://pod.example/b/');

    // Now let A's GET finally resolve — its result must be DROPPED (the stale
    // then-branch return), leaving B's listing in place. Release the gate and
    // flush A's whole continuation chain (container GET → a/x.ttl read →
    // listGallery resolve → the hook's stale-checked `.then`) past several
    // macrotask boundaries so the then-branch staleness guard actually runs.
    await act(async () => {
      releaseA();
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    expect(result.current.listing?.url).toBe('https://pod.example/b/');
    expect(result.current.listing?.photos.map((p) => p.photo.name)).toEqual(['B photo']);
  });

  it('drops a slow earlier ERROR that resolves after a navigation (catch-branch)', async () => {
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });
    // A's container is absent (→ 404 error) and gated; B resolves fine.
    const fetch = gatedFetch(
      {
        'https://pod.example/b/': B,
        'https://pod.example/b/y.ttl': B_PHOTO,
      },
      { 'https://pod.example/a/': gateA },
    );

    const { result } = renderHook(() => usePhotoGallery('https://pod.example/a/', { fetch }));

    act(() => {
      result.current.navigate('https://pod.example/b/');
    });
    await waitFor(() => expect(result.current.listing?.url).toBe('https://pod.example/b/'));

    // Let A's gated GET resolve to a 404 — the stale catch-branch must return
    // without surfacing an error over B's good state.
    await act(async () => {
      releaseA();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.listing?.url).toBe('https://pod.example/b/');
  });

  it('resets navigation + listing when the rootUrl prop changes', async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      const map: Record<string, string> = {
        'https://pod.example/a/': A,
        'https://pod.example/a/x.ttl': A_PHOTO,
        'https://pod.example/b/': B,
        'https://pod.example/b/y.ttl': B_PHOTO,
      };
      const body = map[url];
      if (body === undefined) {
        const res = new Response(null, { status: 404 });
        Object.defineProperty(res, 'url', { value: url });
        return res;
      }
      return turtle(url, body);
    }) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ root }: { root: string }) => usePhotoGallery(root, { fetch }),
      { initialProps: { root: 'https://pod.example/a/' } },
    );
    await waitFor(() => expect(result.current.listing?.url).toBe('https://pod.example/a/'));

    // A new root prop must reset navigation to that container (the in-render
    // prevRoot reset), not strand the view on the previous root.
    rerender({ root: 'https://pod.example/b/' });
    expect(result.current.currentUrl).toBe('https://pod.example/b/');
    await waitFor(() => expect(result.current.listing?.url).toBe('https://pod.example/b/'));
    expect(result.current.listing?.photos.map((p) => p.photo.name)).toEqual(['B photo']);
  });

  it('normalises a slashless rootUrl to a trailing slash before loading', async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      const map: Record<string, string> = {
        'https://pod.example/a/': A,
        'https://pod.example/a/x.ttl': A_PHOTO,
      };
      const body = map[url];
      if (body === undefined) {
        const res = new Response(null, { status: 404 });
        Object.defineProperty(res, 'url', { value: url });
        return res;
      }
      return turtle(url, body);
    }) as unknown as typeof globalThis.fetch;

    // A slashless root must drive a slash-terminated container GET (the false
    // arm of ensureTrailingSlash).
    const { result } = renderHook(() => usePhotoGallery('https://pod.example/a', { fetch }));
    expect(result.current.currentUrl).toBe('https://pod.example/a/');
    await waitFor(() => expect(result.current.listing?.url).toBe('https://pod.example/a/'));
  });

  it('surfaces a 401 as a login-flavoured access error', async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      const res = new Response(null, { status: 401 });
      Object.defineProperty(res, 'url', { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => usePhotoGallery('https://pod.example/p/', { fetch }));
    await waitFor(() => expect(result.current.isAccessError).toBe(true));
    expect(result.current.error).toContain('log in');
  });

  it('refresh() re-fetches the current container', async () => {
    const spy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      const map: Record<string, string> = {
        'https://pod.example/a/': A,
        'https://pod.example/a/x.ttl': A_PHOTO,
      };
      const body = map[url];
      if (body === undefined) {
        const res = new Response(null, { status: 404 });
        Object.defineProperty(res, 'url', { value: url });
        return res;
      }
      return turtle(url, body);
    });
    const fetch = spy as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => usePhotoGallery('https://pod.example/a/', { fetch }));
    await waitFor(() => expect(result.current.listing?.url).toBe('https://pod.example/a/'));
    const callsAfterFirst = spy.mock.calls.length;

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(callsAfterFirst));
    expect(result.current.listing?.url).toBe('https://pod.example/a/');
  });
});
