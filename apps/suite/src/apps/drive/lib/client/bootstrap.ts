// AUTHORED-BY Codex
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { accessControl } from "./access";
import { DriveError, discoverContentTargets } from "./client";
import { commitHttp, type ResourceAssertion, unconfirmedIdentityMessage } from "./commit";

class BootstrapIdentityError extends DriveError {
  constructor(url: string) {
    super("missing-validator", 428, url);
    this.message = unconfirmedIdentityMessage;
  }
}

/** Adapt registration I/O to Drive's namespace and irreversible-step boundary.
 * Captures are keyed by URL and validator: later reads cannot replace discovery
 * for the same bytes. Only this adapter's own successful writes advance approval.
 */
export function driveBootstrapFetch(http: typeof fetch, storageUrl: string): typeof fetch {
  const access = accessControl(http, storageUrl);
  const discovery = new Map<string, ResourceAssertion["verifyHeaders"]>();
  const approved = new Map<string, string | null>();
  const key = (url: string, etag: string) => JSON.stringify([url, etag]);
  const capture = (url: string, response: Response) => {
    const etag = response.headers.get("etag");
    if (!approved.has(url) && (response.ok || response.status === 404))
      approved.set(url, response.ok ? etag : null);
    if (response.ok && etag && !etag.startsWith("W/") && !discovery.has(key(url, etag)))
      discovery.set(key(url, etag), access.captureEndpoint(url, response.headers));
  };
  return async (input, init) => {
    const request = new Request(input, init);
    const parsed = new URL(request.url);
    parsed.hash = "";
    const url = parsed.href;
    const body =
      typeof init?.body === "string" ? init.body : request.body ? await request.blob() : undefined;
    // Request bodies, namespace discovery and all other hydration finish before
    // commitHttp's final HEAD. No caller callback can insert work after it.
    const hydrated: RequestInit = {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
      redirect: "error",
      cache: "no-store",
      ...(body === undefined ? {} : { body }),
    };
    if (request.method === "GET" || request.method === "HEAD") {
      const response = await http(url, hydrated);
      capture(url, response);
      return response;
    }
    assertWithinPodScope(storageUrl, url);
    await discoverContentTargets(http, storageUrl, access, [url]);
    const etag = request.headers.get("if-match");
    if (approved.has(url) && approved.get(url) !== etag) throw new BootstrapIdentityError(url);
    approved.set(url, etag);
    const verifyHeaders = etag ? discovery.get(key(url, etag)) : undefined;
    if (etag && !verifyHeaders) throw new BootstrapIdentityError(url);
    const response = await commitHttp({
      http,
      url,
      init: hydrated,
      verifyHeaders: verifyHeaders ?? access.captureEndpoint(url, new Headers()),
      error: (status, url) => new DriveError("conflict", status, url),
      response: async (response) => response,
    });
    if (response.ok) {
      capture(url, response);
      approved.set(url, response.headers.get("etag"));
    }
    return response;
  };
}
