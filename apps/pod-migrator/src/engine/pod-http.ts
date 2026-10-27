// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
import type { PodHttp } from "./types.js";

/** Only checked primitive strings ever reach the credential-bearing transport. */
export function createPodHttp(opts: {
  root: string;
  fetch: typeof fetch;
  allowInsecureLoopback?: boolean;
}): PodHttp {
  if (typeof opts.root !== "string" || /[?#\\]/.test(opts.root))
    throw new TypeError("Invalid pod root");
  const root = normalizePodBase(opts.root);
  const parsed = new URL(root);
  if (
    parsed.protocol !== "https:" &&
    !(opts.allowInsecureLoopback && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
  )
    throw new TypeError("HTTPS pod root required");
  function checked(url: string): string {
    if (typeof url !== "string" || /[?#\\]/.test(url) || /%25/i.test(url))
      throw new TypeError("A plain pod resource URL is required");
    return assertWithinPodScope(root, url);
  }
  async function send(url: string, method: string, init: RequestInit): Promise<Response> {
    const target = checked(url);
    const response = await opts.fetch(target, { ...init, method, redirect: "manual" });
    if (
      response.type === "opaqueredirect" ||
      response.redirected ||
      (response.status >= 300 && response.status < 400)
    )
      throw new TypeError("Pod redirects are refused");
    if (response.url && checked(response.url) !== target)
      throw new TypeError("Unexpected response URL");
    const location = response.headers.get("location");
    if (location) checked(new URL(location, target).href);
    return response;
  }
  return Object.freeze({
    root,
    get: (url, init = {}) =>
      send(url, "GET", { headers: { Accept: init.accept ?? "*/*" }, signal: init.signal }),
    head: (url, init = {}) => send(url, "HEAD", { signal: init.signal }),
    put: (url, body, init) => {
      const headers: Record<string, string> = { "Content-Type": init.contentType };
      if (init.ifNoneMatch) headers["If-None-Match"] = init.ifNoneMatch;
      if (init.ifMatch) headers["If-Match"] = init.ifMatch;
      return send(url, "PUT", {
        headers,
        body: typeof body === "string" ? body : new Uint8Array(body),
        signal: init.signal,
      });
    },
    delete: (url, init = {}) => send(url, "DELETE", { signal: init.signal }),
  } satisfies PodHttp);
}
