// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The gallery VIEW + its data hook, driven by a stubbed authenticated fetch (the
// auth seam). Proves the view renders a real LDP listing (parsed by the data
// layer) as a folder list + photo grid, navigates into a sub-folder and back via
// the breadcrumb, and renders the empty / loading / error / access-denied
// states — all with NO real pod and NO login flow.

import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoGallery } from '../../src/ui/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const ROOT = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/photos/> a ldp:Container ;
  ldp:contains <https://pod.example/photos/2026/>,
               <https://pod.example/photos/sunset.ttl> .
<https://pod.example/photos/2026/> a ldp:Container .
<https://pod.example/photos/sunset.ttl> a ldp:Resource .
`;

const SUNSET = `
@prefix schema: <https://schema.org/> .
<https://pod.example/photos/sunset.ttl#it> a schema:Photograph ;
  schema:name "Sunset over the bay" ;
  schema:contentUrl <https://pod.example/photos/sunset.jpg> ;
  schema:width 6240 ; schema:height 4160 .
`;

const Y2026 = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/photos/2026/> a ldp:Container ;
  ldp:contains <https://pod.example/photos/2026/aurora.ttl> .
<https://pod.example/photos/2026/aurora.ttl> a ldp:Resource .
`;

const AURORA = `
@prefix schema: <https://schema.org/> .
<https://pod.example/photos/2026/aurora.ttl#it> a schema:Photograph ;
  schema:name "Aurora" ;
  schema:contentUrl <https://pod.example/photos/2026/aurora.jpg> .
`;

const EMPTY = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/photos/empty/> a ldp:Container .
`;

// A photo with NO contentUrl — the placeholder-thumbnail branch.
const NO_BINARY_ROOT = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/photos/> a ldp:Container ;
  ldp:contains <https://pod.example/photos/draft.ttl> .
<https://pod.example/photos/draft.ttl> a ldp:Resource .
`;
const DRAFT = `
@prefix schema: <https://schema.org/> .
<https://pod.example/photos/draft.ttl#it> a schema:Photograph ;
  schema:name "Untitled draft" .
`;

function turtle(url: string, body: string): Response {
  const res = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle', etag: '"v1"' },
  });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

function routerFetch(map: Record<string, string>): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = map[url];
    if (body === undefined) {
      const res = new Response(null, { status: 404 });
      Object.defineProperty(res, 'url', { value: url });
      return res;
    }
    return turtle(url, body);
  }) as unknown as typeof globalThis.fetch;
}

function statusFetch(status: number): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const res = new Response(null, { status });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }) as unknown as typeof globalThis.fetch;
}

describe('PhotoGallery', () => {
  it('renders folder tiles and a photo grid with a thumbnail + caption', async () => {
    const fetch = routerFetch({
      'https://pod.example/photos/': ROOT,
      'https://pod.example/photos/sunset.ttl': SUNSET,
    });
    render(<PhotoGallery rootUrl="https://pod.example/photos/" fetch={fetch} title="My Photos" />);

    expect(screen.getByRole('heading', { name: 'My Photos' })).toBeInTheDocument();

    // The sub-folder is a navigable button.
    expect(await screen.findByRole('button', { name: /2026/ })).toBeInTheDocument();

    // The photo renders as an <img> with the contentUrl + accessible alt text,
    // and its caption shows the title + dimensions.
    const img = await screen.findByRole('img', { name: 'Sunset over the bay' });
    expect(img).toHaveAttribute('src', 'https://pod.example/photos/sunset.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(screen.getByText('Sunset over the bay')).toBeInTheDocument();
    expect(screen.getByText('6240 × 4160')).toBeInTheDocument();
  });

  it('navigates into a sub-folder and back via the breadcrumb', async () => {
    const fetch = routerFetch({
      'https://pod.example/photos/': ROOT,
      'https://pod.example/photos/sunset.ttl': SUNSET,
      'https://pod.example/photos/2026/': Y2026,
      'https://pod.example/photos/2026/aurora.ttl': AURORA,
    });
    render(<PhotoGallery rootUrl="https://pod.example/photos/" fetch={fetch} />);

    const folderBtn = await screen.findByRole('button', { name: /2026/ });
    await act(async () => {
      folderBtn.click();
    });

    // Now inside 2026/: Aurora is shown, Sunset is gone.
    expect(await screen.findByRole('img', { name: 'Aurora' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Sunset over the bay' })).not.toBeInTheDocument();

    // Breadcrumb shows Photos > 2026; click Photos to climb back.
    const rootCrumb = screen.getByRole('button', { name: 'Photos' });
    await act(async () => {
      rootCrumb.click();
    });
    expect(await screen.findByRole('img', { name: 'Sunset over the bay' })).toBeInTheDocument();
  });

  it('shows the empty state for a container with no children', async () => {
    const fetch = routerFetch({ 'https://pod.example/photos/empty/': EMPTY });
    render(<PhotoGallery rootUrl="https://pod.example/photos/empty/" fetch={fetch} />);
    expect(await screen.findByText('No photos here yet.')).toBeInTheDocument();
  });

  it('renders a placeholder for a photo with no image binary', async () => {
    const fetch = routerFetch({
      'https://pod.example/photos/': NO_BINARY_ROOT,
      'https://pod.example/photos/draft.ttl': DRAFT,
    });
    render(<PhotoGallery rootUrl="https://pod.example/photos/" fetch={fetch} />);
    expect(await screen.findByText('Untitled draft')).toBeInTheDocument();
    // No <img> rendered — the placeholder branch instead.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a login-flavoured access error (401) with NO retry button', async () => {
    const fetch = statusFetch(401);
    render(<PhotoGallery rootUrl="https://pod.example/private/" fetch={fetch} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You need to log in');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('renders a permission access error (403) with NO retry button', async () => {
    const fetch = statusFetch(403);
    render(<PhotoGallery rootUrl="https://pod.example/private/" fetch={fetch} />);
    expect(await screen.findByRole('alert')).toHaveTextContent("don't have permission");
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('renders a generic error (404) WITH a working retry that re-fetches', async () => {
    let present = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!present) {
        const res = new Response(null, { status: 404 });
        Object.defineProperty(res, 'url', { value: url });
        return res;
      }
      const body = url === 'https://pod.example/photos/' ? ROOT : SUNSET;
      return turtle(url, body);
    }) as unknown as typeof globalThis.fetch;

    render(<PhotoGallery rootUrl="https://pod.example/photos/" fetch={fetch} />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    present = true;
    await act(async () => {
      retry.click();
    });
    expect(await screen.findByRole('img', { name: 'Sunset over the bay' })).toBeInTheDocument();
  });

  it('shows a loading status while the first request is in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = (async (input: string | URL | Request) => {
      await gate;
      const url = typeof input === 'string' ? input : input.toString();
      const body = url === 'https://pod.example/photos/' ? ROOT : SUNSET;
      return turtle(url, body);
    }) as unknown as typeof globalThis.fetch;

    render(<PhotoGallery rootUrl="https://pod.example/photos/" fetch={fetch} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(await screen.findByRole('img', { name: 'Sunset over the bay' })).toBeInTheDocument();
  });

  it('falls back to the global fetch when no fetch prop is given', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = url === 'https://pod.example/photos/' ? ROOT : SUNSET;
      return turtle(url, body);
    }) as typeof fetch);
    render(<PhotoGallery rootUrl="https://pod.example/photos/" />);
    expect(await screen.findByRole('img', { name: 'Sunset over the bay' })).toBeInTheDocument();
  });

  it('renders without a title heading when none is given', async () => {
    const fetch = routerFetch({
      'https://pod.example/photos/': ROOT,
      'https://pod.example/photos/sunset.ttl': SUNSET,
    });
    render(<PhotoGallery rootUrl="https://pod.example/photos/" fetch={fetch} />);
    await screen.findByRole('img', { name: 'Sunset over the bay' });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
