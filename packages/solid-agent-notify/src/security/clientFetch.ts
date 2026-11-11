// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createGuardedFetch,
  type DnsLookup,
  GuardError,
  isWithinPodScope,
  refuseRedirects,
  SsrfError,
} from "@jeswr/guarded-fetch";
import { isDirectChild, isReadMarker } from "../inbox.js";

/** Exact loopback hostname policy shared by discovery, transport and app opt-ins. */
export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Caller-owned authenticated transport. Node hostname targets require explicit DNS pinning. */
export interface ClientTransportOptions {
  fetch: typeof fetch;
  pinningFetch?: typeof fetch;
  /** Tests may explicitly select the DNS-less browser path. */
  dnsLookup?: DnsLookup | null;
  /** Opt in only for local development; admits exactly localhost, 127.0.0.1 and [::1]. */
  devLoopback?: boolean;
  /** Trusted session storage roots: only GET/HEAD within these roots may use other HTTPS ports. */
  ownStorageRoots?: readonly string[];
  /** Trusted discovered own inbox: also permit direct-child marker PUT and child DELETE. */
  ownInboxUrl?: string;
}

/** A destination refused before authenticated I/O. */
export class NotifyTargetError extends TypeError {}

export const MAX_RESPONSE_BYTES = 256 * 1024;

/** Internal listing metadata; individual bodies always fail on overflow. */
export interface ListingBudget {
  truncated: boolean;
}

/** Retain only a bounded prefix, letting the RDF parser keep complete statements. */
function listingResponse(response: Response, budget: ListingBudget): Response {
  if (!response.ok || !response.body) return response;
  const reader = response.body.getReader();
  let remaining = MAX_RESPONSE_BYTES;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
      } else if (value.byteLength > remaining) {
        budget.truncated = true;
        controller.enqueue(value.subarray(0, remaining));
        controller.close();
        void reader.cancel().catch(() => {});
      } else {
        remaining -= value.byteLength;
        controller.enqueue(value);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const result = new Response(body, { status: response.status, headers });
  Object.defineProperty(result, "url", { value: response.url });
  return result;
}

/** Public HTTPS, bounded bodies/deadline, no redirects, and a narrow loopback opt-in. */
export function clientFetch(
  options: ClientTransportOptions,
  listing?: ListingBudget,
): typeof fetch {
  const g = globalThis as { window?: unknown; document?: unknown };
  const browser = g.window === globalThis && g.document !== undefined && g.document !== null;
  const roots = [...(options.ownStorageRoots ?? [])];
  const transport = options.pinningFetch ?? options.fetch;
  const bounded: typeof fetch = async (input, init) => {
    // refuseRedirects is the primary control. Check the original response before
    // body capping rebuilds it and loses redirected metadata (including empty URLs).
    const response = await refuseRedirects(transport)(input, init);
    if (response.redirected) {
      await response.body?.cancel();
      throw new TypeError("Notification transport followed a redirect");
    }
    return listing ? listingResponse(response, listing) : response;
  };
  return async (input, init) => {
    let expected: URL;
    try {
      expected = new URL(input instanceof Request ? input.url : String(input));
    } catch {
      throw new NotifyTargetError("Expected an absolute notification URL");
    }
    const destination = expected.href;
    expected.hash = "";
    const host = expected.hostname;
    const loopback = options.devLoopback === true && isLoopbackHostname(host);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const ownRequest =
      roots.some((root) => isWithinPodScope(root, expected.href)) &&
      (method === "GET" ||
        method === "HEAD" ||
        (options.ownInboxUrl !== undefined &&
          isDirectChild(destination, options.ownInboxUrl) &&
          (method === "DELETE" || (method === "PUT" && isReadMarker(expected.href)))));
    let dispatched = false;
    const policy = {
      beforeDispatch: () => {
        dispatched = true;
      },
      dnsLookup: browser ? null : options.dnsLookup,
      requireDnsPinning: !loopback,
      allowUnresolvedHosts: browser,
      allowLoopback: loopback,
      enforcePortGate: !ownRequest,
      maxRedirects: 0,
      maxBytes: MAX_RESPONSE_BYTES,
      timeoutMs: 8_000,
      ...(options.pinningFetch ? { pinningFetch: bounded } : { fetch: bounded }),
    };
    if (
      !loopback &&
      !host.includes(":") &&
      (!host.includes(".") || host.split(".").some((label) => label === ""))
    ) {
      throw new NotifyTargetError("Expected a host with non-empty DNS labels");
    }
    const guarded = refuseRedirects(createGuardedFetch(policy));
    let response: Response;
    try {
      response = await guarded(input, init);
    } catch (error) {
      if (!dispatched && (error instanceof SsrfError || error instanceof GuardError)) {
        throw new NotifyTargetError("Unsafe notification destination");
      }
      throw error;
    }
    const actual = new URL(response.url || expected.href);
    actual.hash = "";
    if (actual.href !== expected.href) {
      await response.body?.cancel();
      throw new TypeError("Notification transport followed a redirect");
    }
    return response;
  };
}
