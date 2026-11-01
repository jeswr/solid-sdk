// AUTHORED-BY Codex GPT-6.1-Sol
/** Discover opaque redirects without credentials; authorize each direct resource send. */
import { isValidClientIdUrl } from './origin-policy';

export interface RedirectRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string | null;
}

/**
 * Only GET/HEAD may follow, with at most five discovery/re-send rounds. Chrome hides
 * ALL manual redirect targets, so a credential-free HEAD probe discovers the final URL.
 * Probe bytes are never consumed. `send` MUST use redirect:'manual' and authorize the
 * supplied URL/method before every resource attempt (including any nonce retry).
 */
export async function fetchWithRedirects<T extends { response: Response }>(
  request: RedirectRequest,
  send: (request: RedirectRequest, redirected: boolean) => Promise<T>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<T & { url: string; method: string }> {
  let current = { ...request, method: request.method.toUpperCase() };
  for (let hops = 0; ; hops++) {
    // Same transport policy as the worker: HTTPS, or HTTP on dev loopback only.
    if (!isValidClientIdUrl(current.url)) throw new TypeError('Forbidden URL');
    const parsed = new URL(current.url);
    if (parsed.username || parsed.password) throw new TypeError('Forbidden URL');
    const result = await send(current, hops > 0);
    const { response } = result;
    if (response.type !== 'opaqueredirect') {
      if (response.status === 0) throw new TypeError('Redirect rejected');
      return { ...result, url: current.url, method: current.method };
    }

    if ((current.method !== 'GET' && current.method !== 'HEAD') || hops === 5) break;
    const probe = await fetchImpl(current.url, {
      method: 'HEAD',
      credentials: 'omit',
      redirect: 'follow',
      headers: {},
      signal,
    });
    if (!probe.redirected || !probe.url || probe.url === current.url)
      throw new TypeError('Redirect rejected');
    current = { ...current, url: probe.url };
  }
  throw new TypeError('Redirect rejected');
}
