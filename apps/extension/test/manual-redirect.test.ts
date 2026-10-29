// AUTHORED-BY Codex GPT-6.1-Sol

import { describe, expect, it, vi } from 'vitest';
import { fetchWithRedirects, type RedirectRequest } from '../src/background/core/manual-redirect';
import { opaqueRedirect, redirectProbe } from './redirect-fixtures';

const URL = 'https://pod.example/foo';

describe('manual redirects — credential-free discovery, bounded and fail closed', () => {
  it.each([
    'POST',
    'put',
    'PATCH',
    'DELETE',
    'OPTIONS',
    'PROPFIND',
  ])('rejects %s redirects with exactly one request and no probe', async (method) => {
    const send = vi.fn(async () => ({ response: opaqueRedirect() }));
    const probe = vi.fn<typeof fetch>();
    await expect(
      fetchWithRedirects({ url: URL, method, headers: {}, body: 'payload' }, send, probe),
    ).rejects.toThrow('Redirect rejected');
    expect(send).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();
  });

  it.each([0, 5, 6])('allows at most five discovery/re-send rounds (%s)', async (redirects) => {
    const send = vi.fn(async () => ({
      response: send.mock.calls.length <= redirects ? opaqueRedirect() : new Response('done'),
    }));
    const probe = vi.fn<typeof fetch>(
      async (): Promise<Response> => redirectProbe(`${URL}/${probe.mock.calls.length}`),
    );
    const result = fetchWithRedirects({ url: URL, method: 'GET', headers: {} }, send, probe);
    if (redirects > 5) await expect(result).rejects.toThrow('Redirect rejected');
    else expect(await (await result).response.text()).toBe('done');
    expect(send).toHaveBeenCalledTimes(Math.min(redirects + 1, 6));
    expect(probe).toHaveBeenCalledTimes(Math.min(redirects, 5));
  });

  it('rejects a non-redirect status-0 response without probing', async () => {
    const send = vi.fn(async () => ({ response: Response.error() }));
    const probe = vi.fn<typeof fetch>();
    await expect(
      fetchWithRedirects({ url: URL, method: 'GET', headers: {} }, send, probe),
    ).rejects.toThrow('Redirect rejected');
    expect(send).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();
  });

  it.each([
    ['', true],
    [URL, true],
    [`${URL}/`, false],
  ])('rejects unusable probe results (%s, redirected=%s)', async (url, redirected) => {
    const send = vi.fn(async () => ({ response: opaqueRedirect() }));
    const probe = vi.fn<typeof fetch>(async () => redirectProbe(url, redirected));
    await expect(
      fetchWithRedirects({ url: URL, method: 'GET', headers: {} }, send, probe),
    ).rejects.toThrow('Redirect rejected');
    expect(send).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the probe throws', async () => {
    const send = vi.fn(async () => ({ response: opaqueRedirect() }));
    const probe = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('probe failed'));
    await expect(
      fetchWithRedirects({ url: URL, method: 'GET', headers: {} }, send, probe),
    ).rejects.toThrow('probe failed');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    'http://pod.example/',
    'file:///etc/passwd',
    'data:text/plain,secret',
    'javascript:void(0)',
    'not a URL',
    'https://user:pass@pod.example/',
    'https://user@pod.example/',
    'https://:pass@pod.example/',
  ])('rejects forbidden initial URLs and discovered targets before sending: %s', async (url) => {
    const send = vi.fn(async () => ({ response: opaqueRedirect() }));
    const probe = vi.fn<typeof fetch>(async () => redirectProbe(url));
    await expect(
      fetchWithRedirects({ url, method: 'GET', headers: {} }, send, probe),
    ).rejects.toThrow('Forbidden URL');
    expect(send).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    await expect(
      fetchWithRedirects({ url: URL, method: 'GET', headers: {} }, send, probe),
    ).rejects.toThrow('Forbidden URL');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    'get',
    'head',
  ])('preserves %s, headers and signal across loopback HTTP discovery rounds without reading probe bodies', async (method) => {
    const seen: RedirectRequest[] = [];
    const signal = new AbortController().signal;
    const read = vi.fn(() => {
      throw new Error('Probe body must never be read');
    });
    const probe = vi.fn<typeof fetch>(async () => {
      const response = redirectProbe(`http://localhost:3000/final/${probe.mock.calls.length}`);
      response.text = read;
      response.arrayBuffer = read;
      Object.defineProperty(response, 'body', { get: read });
      return response;
    });
    const headers = { Accept: 'text/turtle' };
    const result = await fetchWithRedirects(
      { url: 'http://localhost:3000/a', method, headers },
      async (request, redirected) => {
        expect(redirected).toBe(seen.length > 0);
        seen.push(request);
        return {
          response: seen.length <= 2 ? opaqueRedirect() : new Response(null, { status: 304 }),
        };
      },
      probe,
      signal,
    );
    expect(result.url).toBe('http://localhost:3000/final/2');
    expect(result.method).toBe(method.toUpperCase());
    expect(result.response.status).toBe(304);
    expect(seen.every((r) => r.method === method.toUpperCase() && r.headers === headers)).toBe(
      true,
    );
    expect(probe.mock.calls).toEqual([
      [
        'http://localhost:3000/a',
        { method: 'HEAD', credentials: 'omit', redirect: 'follow', headers: {}, signal },
      ],
      [
        'http://localhost:3000/final/1',
        { method: 'HEAD', credentials: 'omit', redirect: 'follow', headers: {}, signal },
      ],
    ]);
    expect(read).not.toHaveBeenCalled();
  });
});
