// AUTHORED-BY Codex GPT-6.1-Sol
import { createGuardedFetch, refuseRedirects } from "@jeswr/guarded-fetch";

/** Caller-owned authenticated transport. Node hostname targets require explicit DNS pinning. */
export interface ClientTransportOptions {
  fetch: typeof fetch;
  /** An authenticated fetch explicitly asserted to pin DNS; required for Node hostname targets. */
  pinningFetch?: typeof fetch;
}

/** Browser transport boundary: public HTTPS, bounded bodies/deadline, and no redirects. */
export function clientFetch(options: ClientTransportOptions): typeof fetch {
  const g = globalThis as { window?: unknown; document?: unknown };
  const browser = g.window === globalThis && g.document !== undefined && g.document !== null;
  const guarded = refuseRedirects(
    createGuardedFetch({
      fetch: options.fetch,
      pinningFetch: options.pinningFetch,
      requireDnsPinning: true,
      // Browsers cannot pin sockets. Retain the guard's syntactic browser policy;
      // all other runtimes require pinning rather than silently accepting rebinding.
      allowUnresolvedHosts: browser,
      maxRedirects: 0,
      maxBytes: 256 * 1024,
      timeoutMs: 8_000,
    }),
  );
  return async (input, init) => {
    const expected = new URL(input instanceof Request ? input.url : String(input));
    expected.hash = "";
    const response = await guarded(input, init);
    if (new URL(response.url).href !== expected.href) {
      await response.body?.cancel();
      throw new TypeError("Notification transport followed a redirect");
    }
    return response;
  };
}
